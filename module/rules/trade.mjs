/**
 * Trading between two actors.
 *
 * A trade is agreed by two people but can only be *performed* by one: a player
 * may write to their own actor and nobody else's, so the settlement always runs
 * on a GM client. Everything here is the decision-making half — what may be
 * offered, whether both sides can still honour it, and exactly which document
 * writes settle it — kept free of Foundry so each rule can be tested directly.
 *
 * The awkward parts are stacks and mods:
 *
 *   A stack of five arrows split three ways is a decrement on the giver and a
 *   new stack of three on the receiver, not a move. Handing over all five is a
 *   move, and leaving a zero-quantity husk behind would be worse than deleting.
 *
 *   A Mod installed in a weapon is a separate item pointing at that weapon by
 *   id. Trading the weapon without it would strip the weapon; trading it while
 *   keeping the old id would leave the Mod pointing at an item on someone
 *   else's sheet. So mods travel with their host and are re-pointed on arrival.
 */

const SYSTEM_ID = "lyrian-chronicles";

/** Item types that live in a bag and can therefore change hands. */
export const TRADEABLE_ITEM_TYPES = Object.freeze(["weapon", "armor", "gear", "equipment"]);

/** Only gear keeps a count; everything else is a single object. */
export function stackSize(item) {
  if (item?.type !== "gear") return 1;
  const quantity = Number(item?.system?.quantity ?? 1);
  return Number.isFinite(quantity) ? Math.max(0, Math.trunc(quantity)) : 0;
}

function installedModFlagOf(item) {
  return item?.flags?.[SYSTEM_ID]?.installedMod
    ?? item?.getFlag?.(SYSTEM_ID, "installedMod")
    ?? null;
}

/**
 * Whether an item may be offered on its own.
 *
 * An installed Mod is excluded because it is not loose property — it is part of
 * the item it sits in, and travels when that item does.
 */
export function isTradeable(item) {
  if (!TRADEABLE_ITEM_TYPES.includes(item?.type)) return false;
  if (installedModFlagOf(item)) return false;
  return true;
}

/** The Mods installed into one host item. */
export function installedModsFor(hostId, items = []) {
  return Array.from(items).filter((item) => installedModFlagOf(item)?.targetItemId === hostId);
}

/** What an actor could offer, ready for a picker. */
export function tradeableInventory(items = []) {
  return Array.from(items)
    .filter(isTradeable)
    .map((item) => ({
      id: item.id,
      name: item.name,
      img: item.img,
      type: item.type,
      stack: stackSize(item),
      equipped: Boolean(item.system?.equipped),
      mods: installedModsFor(item.id, items).length
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function wholeAtLeastZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

/** A serializable, defaulted side of an offer. */
export function normalizeTradeSide(side = {}) {
  const seen = new Map();
  for (const line of side.items ?? []) {
    const id = String(line?.itemId ?? line?.id ?? "");
    const quantity = wholeAtLeastZero(line?.quantity ?? 1);
    if (!id || !quantity) continue;
    // A repeated row is one intent, not two: combine rather than double-spend.
    seen.set(id, (seen.get(id) ?? 0) + quantity);
  }
  return {
    items: [...seen].map(([itemId, quantity]) => ({ itemId, quantity })),
    clim: wholeAtLeastZero(side.clim)
  };
}

/** A serializable, defaulted offer. */
export function normalizeTradeOffer(offer = {}) {
  return {
    id: String(offer.id ?? ""),
    fromUuid: String(offer.fromUuid ?? ""),
    toUuid: String(offer.toUuid ?? ""),
    fromName: String(offer.fromName ?? ""),
    toName: String(offer.toName ?? ""),
    give: normalizeTradeSide(offer.give),
    take: normalizeTradeSide(offer.take),
    note: String(offer.note ?? "")
  };
}

/** True when neither side puts anything up. */
export function isEmptyOffer(offer) {
  const normalized = normalizeTradeOffer(offer);
  return !normalized.give.items.length && !normalized.give.clim
    && !normalized.take.items.length && !normalized.take.clim;
}

/**
 * Check one side can still honour what it promised.
 *
 * Run immediately before settling, not only when the offer is composed: the
 * time between offering and accepting is exactly when someone spends the coin
 * or drops the item they promised.
 *
 * @returns {{ok: boolean, shortages: {itemId: string, name: string, required: number, available: number}[]}}
 */
export function validateTradeSide({ side, items = [], clim = 0 } = {}) {
  const normalized = normalizeTradeSide(side);
  const byId = new Map(Array.from(items).map((item) => [item.id, item]));
  const shortages = [];

  for (const line of normalized.items) {
    const item = byId.get(line.itemId);
    if (!item || !isTradeable(item)) {
      shortages.push({ itemId: line.itemId, name: item?.name ?? line.itemId, required: line.quantity, available: 0 });
      continue;
    }
    const available = stackSize(item);
    if (available < line.quantity) {
      shortages.push({ itemId: line.itemId, name: item.name, required: line.quantity, available });
    }
  }

  const purse = wholeAtLeastZero(clim);
  if (normalized.clim > purse) {
    shortages.push({ itemId: "clim", name: "clim", required: normalized.clim, available: purse });
  }

  return { ok: shortages.length === 0, shortages };
}

function transferableData(item) {
  const data = typeof item?.toObject === "function"
    ? item.toObject()
    : JSON.parse(JSON.stringify(item ?? {}));
  delete data._id;
  return data;
}

/**
 * The writes that move one side's goods.
 *
 * Nothing here touches a document; it describes what the settlement should do
 * so the caller can apply both sides together and a test can read the plan.
 *
 * @returns {{hosts: object[], sourceUpdates: object[], sourceDeletes: string[], clim: number}}
 */
export function planTradeSide({ side, items = [] } = {}) {
  const normalized = normalizeTradeSide(side);
  const byId = new Map(Array.from(items).map((item) => [item.id, item]));
  const hosts = [];
  const sourceUpdates = [];
  const sourceDeletes = [];

  for (const line of normalized.items) {
    const item = byId.get(line.itemId);
    if (!item) continue;

    const available = stackSize(item);
    const whole = line.quantity >= available;
    const data = transferableData(item);

    // Arriving equipped would put a stranger's sword straight into the
    // receiver's hand, and their armour straight onto their body.
    if (data.system && "equipped" in data.system) data.system.equipped = false;
    if (item.type === "gear") data.system = { ...data.system, quantity: line.quantity };

    // A Mod belongs to its host, so it can only travel when the host does.
    const mods = whole
      ? installedModsFor(item.id, items).map((mod) => transferableData(mod))
      : [];

    hosts.push({ sourceId: item.id, data, mods });

    if (whole) {
      sourceDeletes.push(item.id);
      // The host's mods leave with it rather than pointing at nothing.
      for (const mod of installedModsFor(item.id, items)) sourceDeletes.push(mod.id);
    } else {
      sourceUpdates.push({ _id: item.id, "system.quantity": available - line.quantity });
    }
  }

  return { hosts, sourceUpdates, sourceDeletes, clim: normalized.clim };
}

/**
 * Re-point an installed Mod at the copy of its host that has just been created.
 *
 * Without this the Mod would still name the giver's item id, so the receiver's
 * sheet would show a Mod attached to nothing and the host would look unmodded.
 */
export function repointInstalledMod(modData, newHostId, newHostName) {
  const data = JSON.parse(JSON.stringify(modData ?? {}));
  const flags = data.flags?.[SYSTEM_ID]?.installedMod;
  if (!flags) return data;
  data.flags[SYSTEM_ID].installedMod = {
    ...flags,
    targetItemId: newHostId,
    targetName: newHostName ?? flags.targetName
  };
  return data;
}

/**
 * Both sides of a settlement, or the reason it cannot happen.
 *
 * Validated together and up front: half a trade is worse than none, so if
 * either side has fallen short since the offer was made, nothing moves.
 */
export function planTrade({ offer, from, to } = {}) {
  const normalized = normalizeTradeOffer(offer);
  if (isEmptyOffer(normalized)) return { ok: false, reason: "empty", shortages: [] };
  if (!normalized.fromUuid || normalized.fromUuid === normalized.toUuid) {
    return { ok: false, reason: "invalid-parties", shortages: [] };
  }

  const giver = validateTradeSide({
    side: normalized.give, items: from?.items ?? [], clim: from?.clim ?? 0
  });
  const taker = validateTradeSide({
    side: normalized.take, items: to?.items ?? [], clim: to?.clim ?? 0
  });
  if (!giver.ok || !taker.ok) {
    return {
      ok: false,
      reason: "short",
      shortages: [
        ...giver.shortages.map((entry) => ({ ...entry, side: "from" })),
        ...taker.shortages.map((entry) => ({ ...entry, side: "to" }))
      ]
    };
  }

  return {
    ok: true,
    reason: "",
    shortages: [],
    offer: normalized,
    fromSide: planTradeSide({ side: normalized.give, items: from?.items ?? [] }),
    toSide: planTradeSide({ side: normalized.take, items: to?.items ?? [] })
  };
}

/**
 * The purse each actor is left with.
 *
 * Coin moves both ways in one step so a two-sided trade nets out, and an actor
 * with no purse field is left alone rather than given one.
 */
export function settleClim({ fromClim, toClim, give = 0, take = 0 }) {
  const result = {};
  if (Number.isFinite(Number(fromClim))) {
    result.from = Math.max(0, wholeAtLeastZero(fromClim) - wholeAtLeastZero(give) + wholeAtLeastZero(take));
  }
  if (Number.isFinite(Number(toClim))) {
    result.to = Math.max(0, wholeAtLeastZero(toClim) - wholeAtLeastZero(take) + wholeAtLeastZero(give));
  }
  return result;
}
