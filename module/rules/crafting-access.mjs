/**
 * Return whether an Actor is a character with at least one owned Artisan class.
 * Class metadata is authoritative; displayed class names are intentionally ignored.
 */
export function hasArtisanClass(actor) {
  if (actor?.type !== "character") return false;
  return Array.from(actor.items ?? []).some(
    (item) => item?.type === "class" && item?.system?.artisan === true
  );
}
