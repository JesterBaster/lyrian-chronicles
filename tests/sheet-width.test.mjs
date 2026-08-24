import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const CSS = readFileSync(new URL("../styles/lyrian.css", import.meta.url), "utf8");
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

/** The declaration block of the first rule whose selector matches exactly. */
function block(selector) {
  const at = RULES.indexOf(`${selector} {`);
  assert.notEqual(at, -1, `no rule for ${selector}`);
  return RULES.slice(at, RULES.indexOf("}", at));
}

/* -------------------------------------------- */
/*  Nothing may demand a width it cannot give up */
/* -------------------------------------------- */

test("the action strip can shrink and wrap", () => {
  // `flex: 0 0 auto` meant Light + Heavy + Precise + Multi + the damage type
  // picker + equip + edit demanded their full natural width forever, so the
  // window had to be dragged wider than the screen before the row fitted.
  const actions = block(".lyrian .lyr-row__actions");
  assert.doesNotMatch(actions, /flex:\s*0\s+0\s+auto/);
  assert.match(actions, /flex-wrap:\s*wrap/);
  assert.match(actions, /flex:\s*0\s+1\s+auto/);
  assert.match(actions, /min-width:\s*0/);
});

test("a row lets its actions drop to their own line", () => {
  assert.match(block(".lyrian .lyr-row"), /flex-wrap:\s*wrap/);
  // The body has to be allowed to give up width too, or it just pushes the
  // actions out instead.
  const body = block(".lyrian .lyr-row__body");
  assert.match(body, /min-width:\s*0/);
  assert.match(body, /flex:\s*1\s+1\s/);
});

test("the tab bar wraps instead of setting the sheet's minimum width", () => {
  // Ten tabs in a non-wrapping flex row came to roughly 900px on their own —
  // the widest thing on the sheet, and the real reason it had to be huge.
  assert.match(block(".lyrian nav.tabs"), /flex-wrap:\s*wrap/);
});

test("the damage type picker gives up width rather than holding the row open", () => {
  const picker = block(".lyrian .lyr-damage-type");
  assert.doesNotMatch(picker, /max-width:/);
  assert.match(picker, /flex:\s*0\s+1\s/);
  assert.match(picker, /min-width:\s*4\.5rem/);
});

test("the picker's narrow overrides come after the rule they override", () => {
  // Same specificity, so the later one wins. Declared earlier — which is where
  // they naturally read best, beside the other breakpoints — the base
  // flex-basis silently took them back and nothing narrowed.
  const base = RULES.indexOf(".lyrian .lyr-damage-type { font-size");
  assert.notEqual(base, -1, "the picker has no base rule");
  // Scoped to the picker: `flex-basis: 7rem` also appears on an unrelated
  // input far earlier in the file.
  const override = RULES.indexOf(".lyrian .lyr-damage-type { flex-basis:");
  assert.notEqual(override, -1, "there is no narrow override for the picker");
  assert.ok(override > base,
    "an equal-specificity container query declared before the base rule loses");
});

/* -------------------------------------------- */
/*  Breakpoints must ask about the sheet         */
/* -------------------------------------------- */

test("the sheet is a query container", () => {
  assert.match(block(".application.lyrian .window-content"), /container:\s*lyrsheet\s*\/\s*inline-size/);
});

test("layout breakpoints are container queries, never viewport ones", () => {
  // A viewport media query cannot answer "how wide is this sheet": a 400px
  // sheet on a 2560px monitor matches none of them, which is why the two that
  // existed never once fired.
  const media = [...RULES.matchAll(/@media\s*\(([^)]*)\)/g)].map((match) => match[1].trim());
  for (const query of media) {
    assert.match(query, /prefers-/,
      `@media (${query}) asks about the screen; sheet layout must use @container`);
  }
  assert.ok(RULES.includes("@container lyrsheet"), "no container queries were found");
});

test("the header restacks instead of overflowing", () => {
  // 96 + 180 + 230 plus gaps floors the three-column grid at about 570px.
  assert.match(block(".lyrian .lyr-header"), /grid-template-columns:\s*96px minmax\(180px, 1fr\) minmax\(230px, 1\.05fr\)/);
  const narrow = RULES.slice(RULES.indexOf("@container lyrsheet (max-width: 620px)"));
  assert.match(narrow.slice(0, 400), /grid-template-areas:\s*"portrait identity"/);
  assert.ok(RULES.includes("@container lyrsheet (max-width: 380px)"),
    "there is no single-column fallback for the narrowest sheets");
});

/* -------------------------------------------- */
/*  The default the sheet opens at               */
/* -------------------------------------------- */

test("the sheet opens narrower than the layout's old floor", () => {
  const sheet = readFileSync(new URL("../module/sheets/actor-sheet.mjs", import.meta.url), "utf8");
  const match = sheet.match(/position: \{ width: (\d+), height: (\d+) \}/);
  assert.ok(match, "the actor sheet declares no default size");
  const width = Number(match[1]);
  assert.ok(width <= 760, `default width ${width} is still wide enough to cover the screen`);
  assert.ok(width >= 600, `default width ${width} is too narrow to be usable`);
});
