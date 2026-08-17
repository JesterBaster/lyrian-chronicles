/**
 * Preserve an application's scroll offset across a part replacement.
 *
 * ApplicationV2 swaps a whole part element on every re-render. The scroll
 * container is `.window-content`, which sits outside the part and so survives
 * the swap — but while the old content is detached it holds nothing, and the
 * browser clamps its scrollTop to zero. The offset is therefore captured
 * before the swap and written back immediately after.
 *
 * This matters wherever a control re-renders the whole view: pressing + or -
 * on a skill in the creation wizard rebuilt the page and threw the reader back
 * to the top, which made allocating points down the list unusable.
 */

/** The scrolling element for a windowed application, if it has one. */
function scroller(element) {
  return element?.querySelector?.(".window-content") ?? null;
}

/** Read the current scroll offset, or 0 when there is nothing scrolling. */
export function captureScroll(element) {
  return scroller(element)?.scrollTop ?? 0;
}

/**
 * Write a captured offset back.
 * A zero offset is skipped: it is both the default and the value a collapsed
 * container reports, so writing it can only ever be a no-op or a bug.
 */
export function restoreScroll(element, top) {
  const target = Number(top) || 0;
  if (target <= 0) return;
  const element_ = scroller(element);
  if (element_) element_.scrollTop = target;
}
