/**
 * "Refund" on an ability's chat card.
 *
 * Right-click the card a use posted and choose Refund: the AP, RP and mana it
 * spent come back, and so do the once-per-round, Secret Art and dual wield
 * allowances it used up. The record of what to give back is written on the
 * card when the ability is used (see LyrianItem#_attachRefund), so the refund
 * is exact rather than estimated — and once given, the card says so and the
 * option goes away, so it cannot be refunded twice.
 *
 * Only the actor's owner or a GM sees the option. Damage or healing already
 * applied is not undone: that went through its own buttons, and reversing it
 * is a GM's call rather than a resource refund.
 *
 * Built against Foundry v14's context menu entry: `label`, `visible(target)`
 * and `onClick(event, target)`. The v13 names `name`, `condition` and
 * `callback` still work in v14 but are deprecated until v16.
 */
import { queueActorTransaction } from "./rules/action-transactions.mjs";
import {
  isRefundable,
  REFUND_FLAG,
  refundSummary,
  refundUpdates
} from "./rules/ability-refund.mjs";

const SCOPE = "lyrian-chronicles";

/** The message a chat log entry belongs to. */
function messageFor(target) {
  const element = target?.jquery ? target[0] : target;
  const id = element?.dataset?.messageId ?? element?.closest?.("[data-message-id]")?.dataset?.messageId;
  return id ? game.messages.get(id) : null;
}

function recordOf(message) {
  return message?.getFlag?.(SCOPE, REFUND_FLAG) ?? null;
}

/** Whether this user may refund this card: there is something left, and the actor is theirs. */
function canRefund(message) {
  const record = recordOf(message);
  if (!isRefundable(record)) return false;
  if (game.user.isGM) return true;
  const actor = record.actorUuid ? fromUuidSync(record.actorUuid) : null;
  return Boolean(actor?.isOwner);
}

/**
 * Give back what one use of an ability cost.
 * @param {ChatMessage} message  The card the use posted.
 */
export async function refundAbilityUse(message) {
  const record = recordOf(message);
  if (!isRefundable(record)) {
    ui.notifications.warn(game.i18n.localize("LYRIAN.Refund.AlreadyRefunded"));
    return null;
  }

  const actor = record.actorUuid ? await fromUuid(record.actorUuid) : null;
  if (!actor) {
    ui.notifications.warn(game.i18n.localize("LYRIAN.Refund.ActorGone"));
    return null;
  }
  if (!game.user.isGM && !actor.isOwner) {
    ui.notifications.warn(game.i18n.format("LYRIAN.Warn.NotOwner", { name: actor.name }));
    return null;
  }

  // The card is marked first. If two people refund at once, or this user may
  // not edit the card, the second attempt stops here rather than paying twice.
  try {
    await message.setFlag(SCOPE, REFUND_FLAG, { ...record, refunded: true });
  } catch (error) {
    ui.notifications.warn(game.i18n.localize("LYRIAN.Refund.CannotMark"));
    console.warn("Lyrian Chronicles | could not mark the card refunded", error);
    return null;
  }

  // In the same queue as spending, so a refund and a use cannot interleave.
  const { restored } = await queueActorTransaction(actor, async () => {
    const updates = refundUpdates(record, actor.system);
    if (Object.keys(updates.actor).length) await actor.update(updates.actor);
    const item = record.itemUuid ? await fromUuid(record.itemUuid) : null;
    if (item && Object.keys(updates.item).length) await item.update(updates.item);
    return updates;
  });

  const summary = refundSummary(restored, {
    ap: game.i18n.localize("LYRIAN.Resource.AP"),
    rp: game.i18n.localize("LYRIAN.Resource.RP"),
    mana: game.i18n.localize("LYRIAN.Resource.Mana")
  });
  const name = foundry.utils.escapeHTML(record.itemName || "");
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p>${summary
      ? game.i18n.format("LYRIAN.Refund.Done", { name, refund: summary })
      : game.i18n.format("LYRIAN.Refund.DoneNoCost", { name })}</p>`
  });
  return restored;
}

export function registerChatRefund() {
  Hooks.on("getChatMessageContextOptions", (application, options) => {
    options.push({
      label: game.i18n.localize("LYRIAN.Refund.Option"),
      icon: '<i class="fa-solid fa-rotate-left"></i>',
      visible: (target) => canRefund(messageFor(target)),
      onClick: (event, target) => refundAbilityUse(messageFor(target))
    });
  });
}
