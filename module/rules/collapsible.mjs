/**
 * Collapsed-section memory for the actor sheet.
 *
 * Which sections a reader has folded away is a property of the reader, not of
 * the character, so it is stored on the User rather than the Actor. That keeps
 * two players looking at the same sheet from fighting over each other's view,
 * needs no schema change or migration, and stays writable by a player who has
 * only observer rights on the actor.
 *
 * Keys are scoped by tab so that, say, a "weapons" group on the inventory tab
 * and a "weapons" group on the proficiencies tab fold independently.
 */

/** Build the stable storage key for one section. */
export function collapseKey(scope, id) {
  const left = String(scope ?? "").trim();
  const right = String(id ?? "").trim();
  if (!left || !right) return "";
  return `${left}:${right}`;
}

/** Whether a section is currently folded away. Unknown sections start open. */
export function isCollapsed(state, scope, id) {
  const key = collapseKey(scope, id);
  if (!key) return false;
  return Boolean(state?.[key]);
}

/**
 * Return the next state with one section's fold flipped.
 *
 * Open sections are deleted rather than stored as false, so the flag holds
 * only what has actually been folded instead of growing a key for every
 * section the reader has ever seen.
 */
export function withCollapsed(state, scope, id, collapsed) {
  const key = collapseKey(scope, id);
  const next = { ...(state ?? {}) };
  if (!key) return next;
  if (collapsed) next[key] = true;
  else delete next[key];
  return next;
}
