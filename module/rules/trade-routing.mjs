/**
 * Who sees a trade offer, and who is allowed to settle it.
 *
 * A player can write to their own actor and nobody else's, so a trade always
 * has to be performed by a GM. Both decisions are here rather than inside the
 * socket handler so they can be reasoned about — and tested — without a live
 * world: getting either wrong means a trade nobody can answer, or one anybody
 * can force through.
 */

/** Users who may answer an offer made to a given actor. */
export function respondersFor(actor, users = []) {
  return Array.from(users).filter((user) => {
    if (!user?.active) return false;
    // A GM can always answer, which is what makes trading with an NPC work:
    // nobody else owns the shopkeeper.
    if (user.isGM) return true;
    return Boolean(actor?.testUserPermission?.(user, "OWNER"));
  });
}

/**
 * Whether a user may answer this offer.
 *
 * The offering side must not be able to accept on the other's behalf, even
 * when they happen to own both actors — an offer is a question, and answering
 * your own question is not agreement.
 */
export function canRespond({ user, target, initiatorUserId } = {}) {
  if (!user?.id || user.id === initiatorUserId) return false;
  return respondersFor(target, [user]).length > 0;
}

/**
 * Whether a user may put the trade through.
 *
 * Deliberately GM-only. Settling writes to two actors, and a player who owns
 * one of them must never be the one moving goods off the other.
 */
export function canSettle(user) {
  return Boolean(user?.isGM);
}

/**
 * Whether a user may offer this actor's property.
 *
 * Checked at both ends: the composer hides what you do not own, and the
 * settling GM re-checks, because the offer travels over a socket and the
 * client that sent it chose its own contents.
 */
export function canOfferFrom({ user, actor } = {}) {
  if (!user?.id || !actor) return false;
  if (user.isGM) return true;
  return Boolean(actor.testUserPermission?.(user, "OWNER"));
}

/**
 * The single GM who settles, so two GMs do not both apply the same trade.
 *
 * Same rule as the action-lock authority: sort by id and take the first, which
 * every client computes identically without needing to agree over the wire.
 */
export function selectTradeAuthority(users = []) {
  return Array.from(users)
    .filter((user) => user?.active && user?.isGM)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))[0] ?? null;
}
