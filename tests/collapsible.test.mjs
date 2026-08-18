import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import { collapseKey, isCollapsed, withCollapsed } from "../module/rules/collapsible.mjs";

test("keys are scoped by tab so identically named sections fold apart", () => {
  assert.equal(collapseKey("skills", "fitness"), "skills:fitness");
  assert.notEqual(
    collapseKey("inventory", "weapons"),
    collapseKey("proficiencies", "weapons")
  );
});

test("an incomplete key never folds anything", () => {
  assert.equal(collapseKey("", "fitness"), "");
  assert.equal(collapseKey("skills", ""), "");
  assert.equal(isCollapsed({ "skills:fitness": true }, "", "fitness"), false);
});

test("sections start open and remember being folded", () => {
  let state = {};
  assert.equal(isCollapsed(state, "skills", "fitness"), false);

  state = withCollapsed(state, "skills", "fitness", true);
  assert.equal(isCollapsed(state, "skills", "fitness"), true);
  // Folding one section leaves its neighbours alone.
  assert.equal(isCollapsed(state, "skills", "might"), false);

  state = withCollapsed(state, "skills", "fitness", false);
  assert.equal(isCollapsed(state, "skills", "fitness"), false);
});

test("unfolding drops the key rather than storing false", () => {
  // Otherwise the flag grows an entry for every section ever seen.
  const state = withCollapsed({ "skills:fitness": true }, "skills", "fitness", false);
  assert.deepEqual(state, {});
});

test("the previous state is never mutated in place", () => {
  const before = { "skills:fitness": true };
  const after = withCollapsed(before, "abilities", "racial", true);
  assert.deepEqual(before, { "skills:fitness": true });
  assert.equal(after["abilities:racial"], true);
});

test("missing or malformed stored state is treated as fully open", () => {
  assert.equal(isCollapsed(undefined, "skills", "fitness"), false);
  assert.equal(isCollapsed(null, "skills", "fitness"), false);
  assert.deepEqual(withCollapsed(undefined, "skills", "fitness", true), {
    "skills:fitness": true
  });
});

test("every foldable section declares both halves of its key", () => {
  for (const file of readdirSync("templates/actor").filter((f) => f.endsWith(".hbs"))) {
    const source = readFileSync(`templates/actor/${file}`, "utf8");
    for (const [tag] of source.matchAll(/<details[^>]*data-collapse-scope[^>]*>/g)) {
      assert.match(tag, /data-collapse-scope="[^"]+"/, file);
      assert.match(tag, /data-collapse-id="[^"]+"/, file);
      // Without this the section renders open and then snaps shut, or never
      // reopens at all, because nothing reads the stored state at render time.
      assert.match(tag, /lyrianSectionOpen/, file);
    }
  }
});

test("foldable sections use summary, not a heading the browser will not toggle", () => {
  for (const file of readdirSync("templates/actor").filter((f) => f.endsWith(".hbs"))) {
    const source = readFileSync(`templates/actor/${file}`, "utf8");
    const sections = source.split("<details").slice(1);
    for (const section of sections) {
      if (!section.includes("data-collapse-scope")) continue;
      const head = section.slice(0, section.indexOf("</summary>") + 10);
      assert.ok(head.includes("<summary"), `${file}: a foldable section has no summary`);
    }
  }
});

test("folding is driven by a deliberate header click, not the toggle event", () => {
  const source = readFileSync("module/sheets/actor-sheet.mjs", "utf8");

  // Listening to `toggle` meant pressing Add — which sits inside the header —
  // both created the item and folded away the list it went into, which then
  // shortened the page and threw the scroll to the top.
  assert.ok(
    !/addEventListener\("toggle"/.test(source),
    "a toggle listener records folds the reader never asked for"
  );
  assert.match(source, /details\[data-collapse-scope\] > summary/);
  assert.match(source, /addEventListener\("click"/);

  // Controls inside a header must act without folding the section.
  assert.match(source, /closest\("button, a, input, select, textarea, \[data-action\]"\)/);
  assert.match(source, /event\.preventDefault\(\)/);
});
