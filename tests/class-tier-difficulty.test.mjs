import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { LYRIAN } from "../module/config.mjs";

/**
 * Tier and difficulty are drawn on the rulebook site as filled pip glyphs, not
 * as numbers, so a capture has to count them. The 0.13.2 capture counted `.off`
 * *elements* — always exactly one span — rather than the pip characters inside
 * it, and every class came back `total - 1`: a flat tier 2 / difficulty 3.
 *
 * For the 181 classes that already existed the merge kept the 0.13.1 values, so
 * only the four new ones shipped wrong. This pins all 185 against an
 * independently derived table, because the same mistake on a future update
 * would be just as quiet.
 */

const TABLE = JSON.parse(readFileSync(
  new URL("./fixtures/class-tier-difficulty-0.13.2.json", import.meta.url), "utf8"));

const classes = () => [
  ...JSON.parse(readFileSync(new URL("../content/classes-01.json", import.meta.url), "utf8")),
  ...JSON.parse(readFileSync(new URL("../content/classes-02.json", import.meta.url), "utf8"))
];

const key = (name) => String(name).trim().toLowerCase();

test("every class's tier and difficulty match the rulebook", () => {
  const expected = new Map(TABLE.map((row) => [key(row.name), row]));
  const built = classes();
  assert.equal(built.length, TABLE.length, "the table must cover every class");

  const wrong = [];
  for (const document of built) {
    const row = expected.get(key(document.name));
    assert.ok(row, `${document.name} is missing from the reference table`);
    if (String(document.system.tier) !== String(row.tier)
      || String(document.system.difficulty) !== String(row.difficulty)) {
      wrong.push(`${document.name}: built ${document.system.tier}/${document.system.difficulty}, `
        + `rulebook ${row.tier}/${row.difficulty}`);
    }
  }
  assert.deepEqual(wrong, []);
});

test("the four classes new in 0.13.2 carry their real values", () => {
  const built = new Map(classes().map((d) => [d.name, d.system]));
  assert.deepEqual(
    ["Fusilier", "Manifestor", "Mystic Eyes of Petrification", "Still Stone Testament"]
      .map((name) => `${name} ${built.get(name).tier}/${built.get(name).difficulty}`),
    ["Fusilier 2/2", "Manifestor 1/2", "Mystic Eyes of Petrification 3/2",
      "Still Stone Testament 3/3"]
  );
});

test("no capture has flattened the spread to a single value", () => {
  // The failure mode is not a wrong number here and there, it is every class
  // sharing one. A spread of one value in either column means the pips were
  // miscounted again.
  const built = classes();
  const tiers = new Set(built.map((d) => String(d.system.tier)));
  const difficulties = new Set(built.map((d) => String(d.system.difficulty)));
  assert.ok(tiers.size > 1, `every class reports tier ${[...tiers][0]}`);
  assert.ok(difficulties.size > 1, `every class reports difficulty ${[...difficulties][0]}`);
});

test("tier is what a class costs to unlock, which is why it has to be right", () => {
  // actor-sheet.mjs: `owned.system.unlockCost ?? owned.system.tier * classCostPerTier`
  const perTier = LYRIAN.progression.classCostPerTier;
  assert.equal(perTier, 100);
  assert.equal(classes().filter((d) => d.system.unlockCost).length, 0,
    "nothing carries an explicit cost, so tier alone decides it");

  const sheet = readFileSync(new URL("../module/sheets/actor-sheet.mjs", import.meta.url), "utf8");
  assert.match(sheet, /system\.tier \* LYRIAN\.progression\.classCostPerTier/);

  const built = new Map(classes().map((d) => [d.name, d.system.tier]));
  assert.equal(built.get("Manifestor") * perTier, 100, "was 200 before the fix");
  assert.equal(built.get("Mystic Eyes of Petrification") * perTier, 300, "was 200");
  assert.equal(built.get("Still Stone Testament") * perTier, 300, "was 200");
});
