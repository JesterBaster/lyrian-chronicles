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
  assert.match(source, /#bindOnce\("details\[data-collapse-scope\] > summary", "click"/);

  // Controls inside a header must act without folding the section.
  assert.match(source, /closest\("button, a, input, select, textarea, \[data-action\]"\)/);
  assert.match(source, /event\.preventDefault\(\)/);
});

test("listeners are bound once per element, not once per render", () => {
  const source = readFileSync("module/sheets/actor-sheet.mjs", "utf8");

  // _onRender runs after every render, including the header-only repaint that
  // follows a resource change — and that repaint leaves other parts' DOM in
  // place. Binding unconditionally stacked a listener each time, so one later
  // click ran the fold handler repeatedly and flipped the section back and forth.
  assert.match(source, /bound\.includes\(key\)/);
  assert.match(source, /element\.dataset\.lyrianBound = \[\.\.\.bound, key\]/);

  // The mark records the selector as well as the event type. Keyed on the type
  // alone, a second same-type listener on an element already bound by another
  // selector would be skipped without a trace.
  assert.match(source, /const key = `\$\{type\}\|\$\{selector\}`/);

  const render = source.slice(source.indexOf("  _onRender(context, options)"));
  const body = render.slice(0, render.indexOf("\n  }"));
  assert.ok(
    !/addEventListener/.test(body),
    "_onRender must bind through #bindOnce so nothing stacks across renders"
  );
});

test("the abilities tab folds only the groupings worth folding", () => {
  const template = readFileSync("templates/actor/tab-abilities.hbs", "utf8");
  const ids = [...template.matchAll(/data-collapse-id="([^"]*)"/g)].map((m) => m[1]);

  // Racial traits, each class, and passives stay foldable. The four timing
  // lists were merged, so nothing folds an ability away by its timing.
  assert.deepEqual(ids.sort(), ["class-{{group.item.id}}", "passives", "racial"]);
  for (const gone of ["actions", "reactions", "encounter-start", "encounter-conclusion"]) {
    assert.ok(!ids.includes(gone), `${gone} should no longer be its own section`);
  }
});

test("merging the timing lists keeps every ability reachable", () => {
  const sheet = readFileSync("module/sheets/actor-sheet.mjs", "utf8");
  // Every bucket that had its own section must feed the merged list, or those
  // abilities would vanish from the sheet entirely.
  const merged = sheet.slice(sheet.indexOf("buckets.activeAbilities = ["));
  for (const bucket of ["abilities", "reactions", "encounterStart", "encounterConclusion"]) {
    assert.match(merged.slice(0, 300), new RegExp(`\\.\\.\\.buckets\\.${bucket}`));
  }
  // Passives keep their own section and must not be folded into the list.
  assert.ok(!/\.\.\.buckets\.passives/.test(merged.slice(0, 300)));

  const template = readFileSync("templates/actor/tab-abilities.hbs", "utf8");
  assert.match(template, /\{\{#each items\.activeAbilities\}\}/);
  // Timing moves onto the row, so merging loses no information.
  assert.match(template, /lyrianLocalizeKey "abilityTiming" this\.system\.timing/);
});
