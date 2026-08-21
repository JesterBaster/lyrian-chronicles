/**
 * Artwork that cannot be drawn on the canvas.
 *
 * The official art is hosted on a CDN that sends no Access-Control-Allow-Origin
 * header. A plain `<img>` does not need one, so sheet portraits looked correct
 * — but a canvas texture does, so every token using that art failed to load and
 * rendered as nothing at all. The shipped content no longer points at it; this
 * is what finds the ones already sitting in a world.
 */

/** Hosts whose images load in an `<img>` but not as a canvas texture. */
export const BLOCKED_IMAGE_HOSTS = Object.freeze(["cdn.angelssword.com"]);

/** The bundled icon each document type falls back to, matching the generator. */
export const FALLBACK_ARTWORK = Object.freeze({
  race: "icons/svg/mystery-man.svg",
  class: "icons/svg/book.svg",
  equipment: "icons/svg/item-bag.svg",
  monster: "icons/svg/mystery-man.svg",
  npc: "icons/svg/mystery-man.svg",
  character: "icons/svg/mystery-man.svg"
});

/**
 * Whether an image path is one a canvas cannot load.
 *
 * Matched on host rather than on the whole URL: the paths carry per-asset
 * UUIDs, and a substring test against the bare domain would also catch a
 * lookalike host in a query string.
 */
export function isBlockedImage(src) {
  const value = String(src ?? "");
  if (!value) return false;
  let host = "";
  try {
    host = new URL(value).hostname;
  } catch {
    return false;   // A relative path is local, so it is never blocked.
  }
  return BLOCKED_IMAGE_HOSTS.includes(host);
}

/** The icon to use in place of a blocked image. */
export function fallbackArtwork(type, fallback = "icons/svg/mystery-man.svg") {
  return FALLBACK_ARTWORK[type] ?? fallback;
}

/**
 * The update needed to make one document's artwork loadable, or null.
 *
 * The blocked URL is kept in a flag rather than discarded: nothing is lost, a
 * GM can still paste it onto a token by hand, and if the CDN ever sends the
 * header it can be put back.
 *
 * @param {object} source     The document's stored `_source`-shaped data.
 * @param {string} [flagScope]
 * @returns {object|null}     A flat update, or null when nothing is blocked.
 */
export function repairArtwork(source, flagScope = "lyrian-chronicles") {
  const update = {};
  const img = source?.img;
  const tokenSrc = source?.prototypeToken?.texture?.src;
  const blockedImg = isBlockedImage(img);
  const blockedToken = isBlockedImage(tokenSrc);
  if (!blockedImg && !blockedToken) return null;

  const replacement = fallbackArtwork(source?.type);
  if (blockedImg) update.img = replacement;
  if (blockedToken) update["prototypeToken.texture.src"] = replacement;

  // Keep whichever original was there, without overwriting one already stored.
  const existing = source?.flags?.[flagScope]?.remoteImage;
  const original = (blockedImg ? img : null) ?? (blockedToken ? tokenSrc : null);
  if (!existing && original) update[`flags.${flagScope}.remoteImage`] = original;

  return update;
}
