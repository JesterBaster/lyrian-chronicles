/**
 * Deciding which abilities the Abilities tab lists where.
 *
 * The tab has a section per race and class holding what those grant, and an
 * "Other Actions" list for everything else. Anything granted therefore has to
 * come out of the second list, or it reads twice.
 *
 * The flag `syncProgressionFeatures` stamps on the copies it creates is the
 * first half of that, and was all this used to check. It misses the case a
 * player actually hits: they browse the compendium and add an ability their
 * class already granted them. Sync only adopts an owned copy when it has not
 * already made one of its own, so the drop leaves two separate Items with the
 * same name — one under the class, one under Other Actions.
 *
 * Kept out of the sheet so it can be tested; the sheet had no way to check this
 * short of opening a world.
 */

/** What identifies an ability across two copies of it. */
function identity(item) {
  const stableId = String(item?.system?.stableId ?? "").trim();
  // A stable id is the rulebook's own identity and always wins. Falling back to
  // the name is for abilities typed in by hand, which have no id at all.
  return stableId ? `id:${stableId}` : `name:${String(item?.name ?? "").trim().toLowerCase()}`;
}

/** True when the ability is one the system generated from a race or class. */
export function isGrantedFeature(item) {
  return Boolean(item?.getFlag?.("lyrian-chronicles", "featureSource")
    ?? item?.flags?.["lyrian-chronicles"]?.featureSource);
}

/**
 * Remove from a list the abilities already shown as a race or class grant.
 *
 * Matched by identity rather than by document id: the player's own copy is a
 * different Item from the granted one, which is the whole reason both were
 * showing. Their copy is the one dropped, because the granted copy is the one
 * that carries the level badge and goes away with its class.
 *
 * @param {object[]} items    The abilities a section would list.
 * @param {object[]} granted  Every ability generated from a race or class.
 * @returns {object[]}
 */
export function withoutGranted(items = [], granted = []) {
  const grantedIds = new Set(granted.map((item) => item.id));
  const grantedIdentities = new Set(granted.map(identity));
  return items.filter((item) =>
    !grantedIds.has(item.id) && !grantedIdentities.has(identity(item)));
}

/**
 * True when adding this ability would duplicate one the actor already has.
 *
 * Used to turn a drop away before it becomes the second copy, the same way a
 * duplicate class is turned away.
 *
 * @param {object} candidate  The ability just dropped.
 * @param {object[]} owned    Everything the actor holds, the candidate included.
 */
export function duplicatesOwnedAbility(candidate, owned = []) {
  if (candidate?.type !== "ability") return null;
  const wanted = identity(candidate);
  // Only a real identity counts. Two hand-made abilities both called "" are not
  // duplicates of each other, and neither is anything with no name at all.
  if (wanted === "name:") return null;
  return owned.find((item) =>
    item?.id !== candidate.id && item?.type === "ability" && identity(item) === wanted) ?? null;
}
