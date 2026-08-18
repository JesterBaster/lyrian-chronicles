/**
 * Which combatants a sheet-side initiative roll should apply to.
 *
 * Rolling initiative from the sheet used to only post a chat card, so the
 * tracker stayed empty and the roll did not place the actor in the encounter.
 * The roll now writes through to the combatant, which means deciding which
 * combatant it belongs to.
 *
 * A token that is currently controlled wins, because that is the one the
 * player is acting for. With nothing controlled every combatant sharing the
 * actor is set, which is the right answer for the ordinary case of exactly
 * one, and a predictable one for duplicates.
 */
export function initiativeTargets({ combatants = [], actorId = "", controlledTokenIds = [] } = {}) {
  if (!actorId) return [];

  const mine = Array.from(combatants).filter((combatant) => combatant?.actorId === actorId);
  if (mine.length < 2) return mine;

  const controlled = new Set(controlledTokenIds);
  const selected = mine.filter((combatant) => controlled.has(combatant.tokenId));
  return selected.length ? selected : mine;
}
