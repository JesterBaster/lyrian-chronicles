import {
  isEmptyOffer,
  normalizeTradeOffer,
  planTrade,
  repointInstalledMod,
  settleClim
} from "../rules/trade.mjs";
import {
  canOfferFrom,
  canRespond,
  canSettle,
  respondersFor,
  selectTradeAuthority
} from "../rules/trade-routing.mjs";

const SYSTEM_ID = "lyrian-chronicles";
const SOCKET_NAMESPACE = `system.${SYSTEM_ID}`;
/** Distinguishes trade traffic from the action-lock protocol on the same channel. */
const CHANNEL = "trade";

/** Offers this client is waiting on or has been asked to answer. */
const openOffers = new Map();

let bound = false;

function emit(payload) {
  game.socket.emit(SOCKET_NAMESPACE, { channel: CHANNEL, ...payload });
}

function offerId() {
  return `${game.user.id}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

/* -------------------------------------------- */
/*  Sending                                      */
/* -------------------------------------------- */

/**
 * Offer a trade from one actor to another.
 *
 * The offer is only a message: nothing moves until the other side accepts and
 * a GM settles it.
 */
export async function proposeTrade(offer) {
  const normalized = normalizeTradeOffer({ ...offer, id: offerId() });
  const from = await fromUuid(normalized.fromUuid);
  const to = await fromUuid(normalized.toUuid);

  if (!from || !to) {
    return ui.notifications.warn(game.i18n.localize("LYRIAN.Trade.MissingActor"));
  }
  if (!canOfferFrom({ user: game.user, actor: from })) {
    return ui.notifications.warn(game.i18n.format("LYRIAN.Trade.NotYours", { name: from.name }));
  }
  if (isEmptyOffer(normalized)) {
    return ui.notifications.warn(game.i18n.localize("LYRIAN.Trade.Empty"));
  }

  const responders = respondersFor(to, game.users);
  if (!responders.length) {
    return ui.notifications.warn(game.i18n.format("LYRIAN.Trade.NobodyToAsk", { name: to.name }));
  }

  normalized.fromName = from.name;
  normalized.toName = to.name;
  const message = { type: "offer", offer: normalized, userId: game.user.id };
  openOffers.set(normalized.id, message);
  emit(message);

  ui.notifications.info(game.i18n.format("LYRIAN.Trade.Sent", { name: to.name }));
  return normalized;
}

/* -------------------------------------------- */
/*  Receiving                                    */
/* -------------------------------------------- */

async function receiveOffer(message) {
  const offer = normalizeTradeOffer(message.offer);
  const to = await fromUuid(offer.toUuid);
  if (!to) return;
  if (!canRespond({ user: game.user, target: to, initiatorUserId: message.userId })) return;

  openOffers.set(offer.id, message);
  const { LyrianTradeReview } = await import("../apps/trade-review.mjs");
  new LyrianTradeReview({ offer, initiatorUserId: message.userId }).render(true);
}

/** Answer an offer. Declining tells the proposer; accepting asks a GM to settle. */
export async function respondToTrade(offer, accepted) {
  const message = openOffers.get(offer.id);
  const initiatorUserId = message?.userId ?? "";
  openOffers.delete(offer.id);

  if (!accepted) {
    emit({ type: "declined", offer, initiatorUserId });
    return null;
  }

  const authority = selectTradeAuthority(game.users);
  if (!authority) {
    ui.notifications.warn(game.i18n.localize("LYRIAN.Trade.NoGM"));
    return null;
  }

  // Exactly one client settles. Accepting as the authority settles here and
  // sends nothing; anyone else asks the authority and waits. Doing both would
  // apply the same trade twice and duplicate everything in it.
  if (authority.id === game.user.id) return settleTrade(offer);

  emit({ type: "settle", offer, userId: game.user.id, authorityId: authority.id });
  ui.notifications.info(game.i18n.localize("LYRIAN.Trade.AwaitingGM"));
  return null;
}

/* -------------------------------------------- */
/*  Settling                                     */
/* -------------------------------------------- */

/**
 * Move the goods.
 *
 * Both sides are validated together immediately beforehand, because the gap
 * between offering and accepting is exactly when someone spends the coin they
 * promised. If either side has fallen short, nothing moves at all.
 */
export async function settleTrade(rawOffer) {
  if (!canSettle(game.user)) return null;
  const offer = normalizeTradeOffer(rawOffer);
  openOffers.delete(offer.id);

  const from = await fromUuid(offer.fromUuid);
  const to = await fromUuid(offer.toUuid);
  if (!from || !to) {
    return ui.notifications.warn(game.i18n.localize("LYRIAN.Trade.MissingActor"));
  }

  const plan = planTrade({
    offer,
    from: { items: from.items, clim: from.system.clim },
    to: { items: to.items, clim: to.system.clim }
  });

  if (!plan.ok) {
    const shortage = plan.shortages[0];
    ui.notifications.warn(shortage
      ? game.i18n.format("LYRIAN.Trade.Short", {
          name: shortage.name, required: shortage.required, available: shortage.available
        })
      : game.i18n.localize("LYRIAN.Trade.Refused"));
    await postTradeCard({
      offer,
      settled: false,
      reason: plan.reason,
      give: describeSide(from, offer.give),
      take: describeSide(to, offer.take)
    });
    return null;
  }

  // Described before anything moves: afterwards the giver no longer holds the
  // items, so every name on the card would fall back to a raw id.
  const card = {
    offer,
    give: describeSide(from, offer.give),
    take: describeSide(to, offer.take)
  };

  await moveGoods(from, to, plan.fromSide);
  await moveGoods(to, from, plan.toSide);

  const purses = settleClim({
    fromClim: from.system.clim,
    toClim: to.system.clim,
    give: plan.fromSide.clim,
    take: plan.toSide.clim
  });
  if (purses.from !== undefined) await from.update({ "system.clim": purses.from });
  if (purses.to !== undefined) await to.update({ "system.clim": purses.to });

  await postTradeCard({ ...card, settled: true });
  Hooks.callAll("lyrianTrade", { offer, settled: true });
  return offer;
}

/** Create the receiver's copies, then remove the giver's originals. */
async function moveGoods(giver, receiver, side) {
  if (!side.hosts.length && !side.sourceDeletes.length && !side.sourceUpdates.length) return;

  for (const host of side.hosts) {
    const [created] = await receiver.createEmbeddedDocuments("Item", [host.data]);
    if (!created || !host.mods.length) continue;
    // The Mod names its host by id, and the copy has a new one.
    await receiver.createEmbeddedDocuments("Item", host.mods.map(
      (mod) => repointInstalledMod(mod, created.id, created.name)));
  }

  // Removed only once the copies exist, so a failure loses nothing.
  if (side.sourceUpdates.length) {
    await giver.updateEmbeddedDocuments("Item", side.sourceUpdates);
  }
  if (side.sourceDeletes.length) {
    await giver.deleteEmbeddedDocuments("Item", [...new Set(side.sourceDeletes)]);
  }
}

async function postTradeCard({ offer, settled, reason = "", give, take }) {
  const content = await foundry.applications.handlebars.renderTemplate(
    `systems/${SYSTEM_ID}/templates/chat/trade-card.hbs`,
    { offer, settled, reason, give, take }
  );
  return ChatMessage.create({ content });
}

/** Names and pictures for one side, read while the goods are still there. */
function describeSide(actor, side) {
  const items = side.items.map((line) => {
    const item = actor?.items?.get(line.itemId);
    return { name: item?.name ?? line.itemId, quantity: line.quantity, img: item?.img };
  });
  return { items, clim: side.clim, any: items.length > 0 || side.clim > 0 };
}

/* -------------------------------------------- */
/*  Wiring                                       */
/* -------------------------------------------- */

async function onMessage(message) {
  if (message?.channel !== CHANNEL) return;

  if (message.type === "offer") return receiveOffer(message);

  if (message.type === "settle") {
    // Addressed to one GM, and re-checked here rather than trusted: the
    // sender chose the address as well as the contents.
    if (message.authorityId !== game.user.id) return;
    if (selectTradeAuthority(game.users)?.id !== game.user.id) return;
    await settleTrade(message.offer);
    return;
  }

  if (message.type === "declined" && message.initiatorUserId === game.user.id) {
    ui.notifications.info(game.i18n.format("LYRIAN.Trade.Declined", {
      name: message.offer?.toName ?? ""
    }));
  }
}

/** Listen for trade traffic. Safe to call more than once. */
export function initializeTrading() {
  if (bound) return false;
  game.socket.on(SOCKET_NAMESPACE, onMessage);
  bound = true;
  return true;
}
