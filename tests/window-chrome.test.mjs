import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const CSS = readFileSync(new URL("../styles/lyrian.css", import.meta.url), "utf8");
// Comments sit between rules, so they land inside the selector text unless
// they are removed before anything is matched.
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

/** Every selector in the stylesheet, one per comma-separated part. */
function selectors() {
  return [...RULES.matchAll(/(^|\})\s*([^@{}]+?)\s*\{/g)]
    .flatMap((match) => match[2].split(",").map((part) => part.trim()))
    .filter((part) => part && !part.startsWith("@") && !/^\d/.test(part));
}

/**
 * Foundry renders the window frame — title bar, close, copy document UUID,
 * toggle controls — outside `.window-content`. Those controls are buttons that
 * carry their Font Awesome classes on the button element itself, so a rule
 * like `.lyrian button` (one class plus an element) outranks `.fa-solid` and
 * replaces the icon font with a text font: the icons render as tofu boxes in
 * whatever background the rule also painted.
 */
test("no rule restyles a bare button outside the sheet's own content", () => {
  const offenders = selectors().filter((selector) =>
    /^\.(application\.)?lyrian\s+button(\b|:|$)/.test(selector));
  assert.deepEqual(offenders, [],
    "these reach Foundry's header controls and break their icons");
});

test("the sheet's own buttons are still styled", () => {
  // The scoping above is only safe because every part renders into
  // .window-content — losing the styling entirely would be the other failure.
  const scoped = selectors().filter((selector) =>
    /^\.lyrian \.window-content button/.test(selector));
  assert.ok(scoped.length >= 2, `expected the base and hover rules, got ${scoped.length}`);

  const rule = RULES.slice(RULES.indexOf(".lyrian .window-content button {"));
  const body = rule.slice(0, rule.indexOf("}"));
  for (const property of ["font-family", "background", "border", "cursor"]) {
    assert.match(body, new RegExp(`${property}:`), `buttons lost their ${property}`);
  }
});

test("nothing else in the sheet reaches the window frame", () => {
  // Elements Foundry's own frame is built from. A selector rooted at .lyrian
  // that ends in one of these bare tags matches the frame as well as the
  // sheet, because the class sits on the application root.
  const frameTags = ["button", "a", "i", "h1", "header", "nav", "img"];
  const offenders = selectors().filter((selector) => {
    if (!/^\.(application\.)?lyrian\s/.test(selector)) return false;
    if (selector.includes(".window-content")) return false;
    // A selector routed through one of our own classes cannot reach the
    // frame, which carries none of them.
    if (/\.lyr-|\.lyrian-/.test(selector.replace(/^\.(application\.)?lyrian/, ""))) return false;
    const last = selector.split(/\s+/).at(-1).replace(/:[a-z-]+(\([^)]*\))?/g, "");
    return frameTags.includes(last);
  });
  assert.deepEqual(offenders, []);
});

test("the window frame is left to Foundry, and the content is not", () => {
  // The one place the sheet is allowed to touch the frame's child: painting
  // the content area it owns.
  assert.match(RULES, /\.application\.lyrian \.window-content \{[^}]*background:/);
  assert.doesNotMatch(RULES, /\.lyrian \.window-header\b/,
    "the header belongs to Foundry; restyling it is what broke the icons");
});
