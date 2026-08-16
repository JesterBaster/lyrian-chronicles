/**
 * Re-check the current user's permission immediately before an Actor action.
 * A sheet can remain open after ownership is revoked, so render-time controls
 * and Foundry's update permission checks are not sufficient for no-cost rolls.
 */
export function canPerformActorAction(actor, user = globalThis.game?.user) {
  if (!actor) return true;
  return Boolean(user?.isGM || actor.isOwner);
}

/** Warn and reject an action when the current user no longer owns its Actor. */
export function requireActorActionPermission(actor, { notify = true, user = globalThis.game?.user } = {}) {
  if (canPerformActorAction(actor, user)) return true;
  if (notify) {
    globalThis.ui?.notifications?.warn(
      globalThis.game?.i18n?.format?.("LYRIAN.Warn.NotOwner", { name: actor?.name ?? "" })
    );
  }
  return false;
}
