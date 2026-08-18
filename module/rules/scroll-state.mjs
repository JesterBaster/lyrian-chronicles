/**
 * Preserve scroll offsets across a re-render.
 *
 * Two different things scroll in this system, and they fail for different
 * reasons:
 *
 *   .window-content   sits outside the rendered parts, so it survives the swap
 *                     — but while the old content is detached it holds nothing
 *                     and the browser clamps its offset to zero.
 *   .lyr-creation-step  sits *inside* the part, so the element itself is
 *                     destroyed and rebuilt and its offset starts at zero.
 *
 * An earlier version only looked at .window-content, which meant the creation
 * wizard — whose scrolling element is the step, not the window — kept jumping
 * to the top on every skill +/-.
 */

/** Elements that can scroll, in the order they are captured and restored. */
const SCROLLERS = Object.freeze([".window-content", ".lyr-creation-step", ".lyr-tab"]);

/**
 * Read every non-zero scroll offset under an application root.
 * Offsets of zero are skipped: they are the default, so recording them would
 * only ever let a later restore fight a legitimate position.
 */
export function captureScroll(element) {
  const offsets = {};
  if (typeof element?.querySelectorAll !== "function") return offsets;

  for (const selector of SCROLLERS) {
    const nodes = Array.from(element.querySelectorAll(selector));
    nodes.forEach((node, index) => {
      const top = Number(node?.scrollTop) || 0;
      if (top > 0) offsets[`${selector}|${index}`] = top;
    });
  }
  return offsets;
}

/** Write captured offsets back onto whatever now occupies the same positions. */
export function restoreScroll(element, offsets) {
  if (typeof element?.querySelectorAll !== "function") return;
  if (!offsets || typeof offsets !== "object") return;

  for (const [key, value] of Object.entries(offsets)) {
    const top = Number(value) || 0;
    if (top <= 0) continue;
    const divider = key.lastIndexOf("|");
    if (divider < 0) continue;
    const node = element.querySelectorAll(key.slice(0, divider))[Number(key.slice(divider + 1))];
    if (node) node.scrollTop = top;
  }
}
