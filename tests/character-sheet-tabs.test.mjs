/**
 * The Abilities, Breakthrough and Inventory mappers.
 *
 * These tabs are name-driven: the template looks everything else up. So the
 * interesting behaviour is not what gets written but where the block ends and
 * whether the name will actually resolve against the sheet's reference tabs.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  abilitySheetCells,
  breakthroughSheetCells,
  discoverAbilityLayout,
  discoverBreakthroughLayout,
  discoverInventoryLayout,
  inventorySheetCells,
  matchesBySearch,
  matchesExactly,
  plainText
} from "../module/rules/character-sheet-tabs.mjs";

/** A column of `{value, formula}` cells, built from a sparse description. */
const column = (entries) => new Map(Object.entries(entries)
  .map(([row, cell]) => [Number(row), typeof cell === "string"
    ? { value: cell, formula: "", empty: !cell }
    : cell]));

const lookup = (rows) => Object.fromEntries(
  rows.map((row) => [row, { value: "", formula: `IF(A${row}="","",INDEX(x))` }])
);

/* -------------------------------------------- */

test("the ability blocks stop where the sheet's lookups stop", () => {
  // Two blocks, a header between them and a version stamp after — the shape
  // the real template has.
  const columns = (name) => ({
    A: column({ 1: "Active Ability Name", 59: "Passive Ability Name", 81: "2.0" }),
    B: column({ ...lookup([2, 3, 4]), 59: "Cost", ...lookup([60, 61]) })
  })[name];

  const layout = discoverAbilityLayout(columns);
  assert.deepEqual(layout.active, [2, 3, 4], "the run must not swallow the passive header");
  assert.deepEqual(layout.passive, [60, 61], "nor run on into the version stamp");
});

test("abilities are split by timing and land in their own block", () => {
  const layout = { active: [2, 3], passive: [10, 11] };
  const { cells, warnings } = abilitySheetCells({
    abilities: [
      { name: "Cleave", passive: false },
      { name: "Iron Skin", passive: true },
      { name: "Riposte", passive: false }
    ]
  }, layout);

  assert.deepEqual(Object.fromEntries(cells), { A2: "Cleave", A3: "Riposte", A10: "Iron Skin" });
  assert.deepEqual(warnings, []);
});

test("more abilities than rows is reported, not silently dropped", () => {
  const { cells, warnings } = abilitySheetCells({
    abilities: [{ name: "One" }, { name: "Two" }, { name: "Three" }]
  }, { active: [2, 3], passive: [] });

  assert.deepEqual(cells.map(([ref]) => ref), ["A2", "A3"]);
  assert.deepEqual(warnings, [{ kind: "abilityOverflow", label: "Three", section: "active" }]);
});

test("a name the spreadsheet does not list is flagged before it silently blanks", () => {
  const known = ["Cleave", "Iron Skin"];
  const { warnings } = abilitySheetCells({
    abilities: [{ name: "cleave" }, { name: "Homebrew Smash" }]
  }, { active: [2, 3], passive: [] }, { known });

  // MATCH is case-insensitive, so "cleave" resolves; the invented one does not.
  assert.deepEqual(warnings, [{ kind: "unknownAbility", label: "Homebrew Smash" }]);
});

/* -------------------------------------------- */

test("breakthroughs carry the EXP actually spent, which the sheet cannot know", () => {
  const columns = (name) => ({
    A: column({ 1: "Breakthrough" }),
    C: column(lookup([2, 3]))
  })[name];

  const layout = discoverBreakthroughLayout(columns);
  assert.deepEqual(layout.rows, [2, 3]);

  const { cells } = breakthroughSheetCells({
    breakthroughs: [
      { name: "Angelblooded (Human)", expCost: 100 },
      { name: "Arachne (Spiderfolk)", expCost: 0 }
    ]
  }, layout);

  assert.deepEqual(Object.fromEntries(cells), {
    A2: "Angelblooded (Human)", B2: 100, A3: "Arachne (Spiderfolk)"
  });
});

test("the breakthrough tab matches backwards, and the check matches it", () => {
  const known = ["Angelblooded (Human)"];

  // SEARCH looks for the reference inside what was typed, so a player's note
  // after the name still resolves — and the check must not call it unknown.
  assert.equal(matchesBySearch("Angelblooded (Human) — level 3", known), true);
  assert.equal(matchesBySearch("Angelblooded", known), false, "a prefix is not the reference");
  assert.equal(matchesExactly("Angelblooded (Human) — level 3", known), false,
    "the abilities tab would not resolve the same string");

  const { warnings } = breakthroughSheetCells({
    breakthroughs: [{ name: "Angelblooded (Human) — level 3" }, { name: "Made Up" }]
  }, { rows: [2, 3] }, { known });
  assert.deepEqual(warnings, [{ kind: "unknownBreakthrough", label: "Made Up" }]);
});

/* -------------------------------------------- */

test("the inventory's extent comes from the sheet's own burden total", () => {
  const columns = (name) => ({
    A: column({ 1: "Expedition Inventory" }),
    H: column({
      2: { value: "", formula: "SUM(D2:D137)" },
      3: { value: "Inventory Clim Value", formula: "" }
    })
  })[name];

  const layout = discoverInventoryLayout(columns);
  assert.equal(layout.rows.length, 136);
  assert.equal(layout.rows[0], 2);
  assert.equal(layout.rows.at(-1), 137);
});

test("an inventory with no burden total to read from yields no rows", () => {
  const columns = (name) => ({ A: column({ 1: "Expedition Inventory" }), H: column({}) })[name];
  assert.deepEqual(discoverInventoryLayout(columns).rows, []);
  assert.deepEqual(discoverInventoryLayout(() => column({})).rows, []);
});

test("an inventory row carries the stack, not the single item", () => {
  const { cells, warnings } = inventorySheetCells({
    inventory: [
      {
        name: "Iron Ingot", location: "Backpack", quantity: 5,
        burden: 5, value: 20, description: "A bar of iron."
      },
      { name: "Cookbook", location: "Backpack", quantity: 1, burden: 0, value: 10 }
    ]
  }, { rows: [2, 3] });

  assert.deepEqual(Object.fromEntries(cells), {
    A2: "Iron Ingot", B2: "Backpack", C2: 5, D2: 5, E2: 20, G2: "A bar of iron.",
    A3: "Cookbook", B3: "Backpack", C3: 1, E3: 10
  });
  // Burden 0 is left blank rather than written: the sheet sums the column and
  // a blank and a zero total the same, but a blank reads as "carries nothing".
  assert.equal(cells.some(([ref]) => ref === "D3"), false);
  assert.deepEqual(warnings, []);
});

test("descriptions arrive as text a cell can hold", () => {
  assert.equal(plainText("<p>A <b>sturdy</b> blade.</p>"), "A sturdy blade.");
  // A tag between a word and its punctuation would otherwise leave a gap.
  assert.equal(plainText("A <i>blade</i>."), "A blade.");
  assert.equal(plainText("Deals <b>2d4</b>, then <b>1d6</b> (fire)."), "Deals 2d4, then 1d6 (fire).");
  assert.equal(plainText("one<br>two"), "one two", "a break is still a word boundary");
  assert.equal(plainText("Tom&#39;s &amp; Jerry&#39;s"), "Tom's & Jerry's");
  assert.equal(plainText(""), "");
  assert.equal(plainText(null), "");

  const long = plainText("x".repeat(900), 100);
  assert.equal(long.length, 100);
  assert.equal(long.endsWith("…"), true, "a truncated description says that it was");
});
