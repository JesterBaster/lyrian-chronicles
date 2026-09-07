import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import { mergeField, mergeEntry, readerText } from "../tools/merge-rulebook-snapshot.mjs";

/**
 * Every rule here exists because the 0.13.1 → 0.13.2 comparison caught the
 * incoming snapshot losing something. The cases are the real ones.
 */

test("a field the capture cannot see never overwrites the approved value", () => {
  // The page renders a class's key ability as its display name. Taking that
  // would replace a link with a label.
  assert.deepEqual(
    mergeField("keyAbility", "8f7ad9e9-ff8f-40a6-b757-a92e4fbf8f3b", "SPELL CHALLENGE"),
    { value: "8f7ad9e9-ff8f-40a6-b757-a92e4fbf8f3b", reason: "protected" }
  );
  // Tier and difficulty are counted from pip glyphs, which came back as one
  // constant for all 185 classes.
  assert.equal(mergeField("tier", "3", "2").value, "3");
  assert.equal(mergeField("difficulty", "4", "3").value, "4");
  // Our slug separator differs from the site's.
  assert.equal(mergeField("trueAbilityId", "chair_grab", "chair-grab").value, "chair_grab");
});

test("an absent value is not a change", () => {
  // 138 abilities came back with no AP cost. Taking that would have left them
  // free to use.
  assert.deepEqual(mergeField("apCost", "2", ""), { value: "2", reason: "absent" });
  assert.deepEqual(mergeField("keywords", "Rage", ""), { value: "Rage", reason: "absent" });
  // But a value the approved copy lacks and the capture has is a real gain.
  assert.deepEqual(mergeField("description", "", "<p>New.</p>"),
    { value: "<p>New.</p>", reason: "filled" });
  // Blank both ways is not an update, however each spells it.
  assert.equal(mergeField("otherCosts", undefined, "").reason, "same");
});

test("the same words in poorer markup are not an improvement", () => {
  const rich = "<p>You gain <strong>+2</strong> Power.</p>";
  const flat = "<p>You gain +2 Power.</p>";
  assert.deepEqual(mergeField("description", rich, flat), { value: rich, reason: "cosmetic" });

  // Real edits still land, markup or not.
  const edited = "<p>You gain +2 Power and lose 1 Guard.</p>";
  assert.deepEqual(mergeField("description", rich, edited), { value: edited, reason: "updated" });
});

test("a reader sees past markup, entities and stray spacing", () => {
  assert.equal(readerText("<p>Key ability .</p>"), readerText("<p>Key&nbsp;ability.</p>"));
  assert.equal(readerText("<em>A</em> &amp; B"), "a & b", "entities decode, tags vanish");
  assert.notEqual(readerText("<p>Katana or Scythe.</p>"), readerText("<p>Katana, Chainsaw or Scythe.</p>"));
});

test("the website's own scaffolding is never rulebook text", () => {
  // The rulebook and setting guide come back as the whole rendered Angular
  // component tree, which also trips the compiler's executable-markup check.
  const real = "<h2>Main Locations</h2><p>The Lyrian Penninsula…</p>";
  const scaffolded = '<router-outlet></router-outlet><app-settings-guide _nghost-ng-c2427799284="">…';
  assert.deepEqual(mergeField("content", real, scaffolded), { value: real, reason: "scaffolding" });
});

test("a structure flattened to a label is a loss, whatever the field is called", () => {
  // The Demon house fields are {text, ability} pairs the build reads both
  // halves of. The capture renders each as just the ability's name, which
  // left every Demon with no clan to choose.
  const house = { text: "Oracles", ability: "95a005b4-b06e-4596-9c6b-8e53c36" };
  assert.deepEqual(mergeField("lir", house, "Predict"), { value: house, reason: "flattened" });
  // The rule is structural, so a field nobody has thought of yet is covered.
  assert.equal(mergeField("someFutureField", { a: 1 }, "Label").reason, "flattened");
});

test("an empty object counts as absent", () => {
  // `source_ids: {}` is how the capture reports ids it cannot see. Taking it
  // literally emptied the GUID map the build resolves house abilities through.
  const entry = (ids) => ({
    stable_id: "x", data: {}, relationships: {}, source_ids: ids,
    source_url: "u", rulebook_version: "0.13.2", retrieved_at: "t"
  });
  const base = entry({ id: "abc", index_id: "def" });
  const merged = mergeEntry(base, entry({})).entry;
  assert.deepEqual(merged.source_ids, { id: "abc", index_id: "def" });
});

test("relationships stand unless the newer set names more", () => {
  const base = {
    stable_id: "x", data: {}, source_ids: {}, source_url: "u",
    rulebook_version: "0.13.1", retrieved_at: "t",
    relationships: { granted_ability: "ability--flight" }
  };
  const incoming = { ...base, rulebook_version: "0.13.2", relationships: { granted_ability: null } };
  assert.deepEqual(mergeEntry(base, incoming).entry.relationships,
    { granted_ability: "ability--flight" }, "a null is not a change of mind");

  const richer = { ...base, relationships: { granted_ability: "ability--flight", extra: "ability--new" } };
  assert.deepEqual(mergeEntry(base, richer).entry.relationships, richer.relationships);
});

test("an entry with no approved counterpart is taken whole", () => {
  const incoming = { stable_id: "ability--burst-fire", data: { name: "Burst Fire" } };
  const { entry, reasons } = mergeEntry(undefined, incoming);
  assert.equal(entry, incoming);
  assert.deepEqual(reasons, { added: 1 });
});

test("provenance moves to the new edition even where the data did not", () => {
  const base = {
    stable_id: "x", data: { name: "A" }, relationships: {}, source_ids: { id: "1" },
    source_url: "https://rpg.angelssword.com/game/0.13.1/abilities",
    rulebook_version: "0.13.1", retrieved_at: "old"
  };
  const incoming = {
    ...base, source_url: "https://rpg.angelssword.com/game/0.13.2/abilities",
    rulebook_version: "0.13.2", retrieved_at: "new", source_ids: {}
  };
  const merged = mergeEntry(base, incoming).entry;
  assert.equal(merged.rulebook_version, "0.13.2");
  assert.match(merged.source_url, /0\.13\.2/);
  assert.equal(merged.retrieved_at, "new");
  assert.deepEqual(merged.data, { name: "A" }, "unchanged data stays unchanged");
});

/* -------------------------------------------- */
/*  The result, as shipped                       */
/* -------------------------------------------- */

test("the shipped snapshot kept everything 0.13.1 had and added 0.13.2's", () => {
  const load = (version) => {
    const dir = new URL(`../content-source/approved/${version}/`, import.meta.url);
    const entries = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "manifest.json")) {
      entries.push(...JSON.parse(readFileSync(new URL(file, dir), "utf8")));
    }
    return new Map(entries.map((e) => [e.stable_id, e]));
  };
  const before = load("0.13.1");
  const after = load("0.13.2");

  assert.equal(before.size, 2116);
  assert.equal(after.size, 2151);
  for (const id of before.keys()) assert.ok(after.has(id), `${id} was dropped`);

  // No entry may come out of the merge with less than it went in with.
  const KNOWN_BLANK = new Set(["imageAlignment"]);
  for (const [id, old] of before) {
    const merged = after.get(id);
    for (const [field, value] of Object.entries(old.data ?? {})) {
      if (KNOWN_BLANK.has(field)) continue;
      const had = value !== "" && value !== null && value !== undefined;
      const has = merged.data?.[field] !== "" && merged.data?.[field] !== null
        && merged.data?.[field] !== undefined;
      assert.ok(!had || has, `${id}.${field} was emptied by the merge`);
    }
    assert.ok(Object.keys(merged.source_ids ?? {}).length
      >= Object.keys(old.source_ids ?? {}).length, `${id} lost its source ids`);
  }
});

test("no shipped rulebook text carries the website's markup", () => {
  for (const file of readdirSync(new URL("../content/", import.meta.url))) {
    if (!file.endsWith(".json") || file === "compendium-index.json") continue;
    const raw = readFileSync(new URL(`../content/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(raw, /<router-outlet|_nghost|_ngcontent/,
      `${file} carries Angular scaffolding`);
  }
});
