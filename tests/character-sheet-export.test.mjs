import assert from "node:assert/strict";
import test from "node:test";

import {
  assignStatArray, coreSheetCells, discoverCoreLayout, locateBlankRun, locateRows, sameLabel
} from "../module/rules/character-sheet-export.mjs";

/* -------------------------------------------- */
/*  Finding the rows                             */
/* -------------------------------------------- */

test("labels match the way a reader reads them", () => {
  assert.ok(sameLabel("Common Knowledge", "common knowledge"));
  assert.ok(sameLabel("Animal Husbandry", " Animal  Husbandry "));
  assert.ok(sameLabel("EXP & Transactions", "EXP  Transactions"), "punctuation is noise");
  assert.ok(!sameLabel("Stealth", "Deception"));
  assert.ok(!sameLabel("", ""), "two blanks are not a match");
});

test("a block is found by its own labels, not by a remembered row", () => {
  // The sheet lists Athletics at row 9 today. Hardcoding that writes a
  // character's Stealth into their Deception the day a row is inserted.
  const sheet = { E9: "Athletics", E10: "Riding", E11: "Stealth", E12: "Deception" };
  const rows = locateRows((ref) => sheet[ref] ?? "",
    { column: "E", from: 9, to: 30, labels: ["Stealth", "Athletics", "Missing Skill"] });

  assert.equal(rows.get("Athletics"), 9);
  assert.equal(rows.get("Stealth"), 11);
  assert.equal(rows.has("Missing Skill"), false, "an absent label is absent, not row 9");

  // Shift everything down and the answers follow.
  const shifted = { E10: "Athletics", E11: "Riding", E12: "Stealth" };
  const after = locateRows((ref) => shifted[ref] ?? "",
    { column: "E", from: 9, to: 30, labels: ["Stealth", "Athletics"] });
  assert.equal(after.get("Athletics"), 10);
  assert.equal(after.get("Stealth"), 12);
});

test("a free list is however many blank rows the template leaves", () => {
  const sheet = { A15: "", A16: "", A17: "Taken", A18: "" };
  assert.deepEqual(locateBlankRun((ref) => sheet[ref] ?? "", { column: "A", from: 15, to: 18 }),
    [15, 16, 18]);
});

/* -------------------------------------------- */
/*  The creation array                           */
/* -------------------------------------------- */

const MAIN = [
  { key: "focus", label: "Focus", value: 3, bonus: 0 },
  { key: "power", label: "Power", value: 4, bonus: 0 },
  { key: "agility", label: "Agility", value: 4, bonus: 0 },
  { key: "toughness", label: "Toughness", value: 5, bonus: 0 }
];

test("stats are written as who picked which number, because that is what the sheet reads", () => {
  // Core!B9 is IFS(B45=A9,A45,…) — the stat cells are formulas fed by the
  // array. Writing totals into them would replace the sheet's own model.
  const { picks, unmatched } = assignStatArray(MAIN, [5, 4, 4, 3]);
  assert.deepEqual(picks, ["Toughness", "Power", "Agility", "Focus"]);
  assert.deepEqual(unmatched, []);
});

test("duplicate array values are each spent once", () => {
  // 4 appears twice; Power and Agility must take one slot each, not both the
  // same one, or a stat silently vanishes from the sheet.
  const { picks } = assignStatArray(MAIN, [5, 4, 4, 3]);
  assert.equal(picks.filter((p) => p === "Power").length, 1);
  assert.equal(picks.filter((p) => p === "Agility").length, 1);
  assert.equal(new Set(picks).size, 4);
});

test("a spread the array cannot express is reported, not forced", () => {
  // Hand-edited, or built under an older rule. Writing a wrong pick would
  // change the character's stats the moment the sheet opened.
  const odd = [
    { key: "focus", label: "Focus", value: 7 },
    { key: "power", label: "Power", value: 4 },
    { key: "agility", label: "Agility", value: 4 },
    { key: "toughness", label: "Toughness", value: 5 }
  ];
  const { picks, unmatched } = assignStatArray(odd, [5, 4, 4, 3]);
  assert.deepEqual(picks, ["Toughness", "Power", "Agility", ""], "the slot is left empty");
  assert.deepEqual(unmatched, [{ key: "focus", value: 7 }]);
});

test("the sub-stat array works the same, with five slots", () => {
  const subs = [
    { key: "fitness", label: "Fitness", value: 5 },
    { key: "cunning", label: "Cunning", value: 4 },
    { key: "reason", label: "Reason", value: 3 },
    { key: "awareness", label: "Awareness", value: 2 },
    { key: "presence", label: "Presence", value: 1 }
  ];
  const { picks, unmatched } = assignStatArray(subs, [5, 4, 3, 2, 1]);
  assert.deepEqual(picks, ["Fitness", "Cunning", "Reason", "Awareness", "Presence"]);
  assert.deepEqual(unmatched, []);
});

/* -------------------------------------------- */
/*  The cells                                    */
/* -------------------------------------------- */

const LAYOUT = {
  mainStatArray: [5, 4, 4, 3],
  subStatArray: [5, 4, 3, 2, 1],
  mainBonusRows: new Map([[45, "Focus"], [46, "Power"], [47, "Agility"], [48, "Toughness"]]),
  subBonusRows: new Map([[45, "Fitness"], [46, "Cunning"]]),
  skillRows: new Map([["Athletics", 9], ["Stealth", 11], ["Magic", 17]]),
  craftingRows: [9, 10],
  classRows: [15, 16]
};

const CHARACTER = {
  name: "Kaelen Vos",
  race: "Human",
  subRace: "",
  identity: { gender: "Female", age: "24", height: "5'7\"", weight: "130 lb", worships: "Kari" },
  mainStats: MAIN.map((s) => ({ ...s, bonus: s.key === "power" ? 1 : 0 })),
  subStats: [
    { key: "fitness", label: "Fitness", value: 5, bonus: 2 },
    { key: "cunning", label: "Cunning", value: 4, bonus: 0 }
  ],
  skills: [
    { label: "Athletics", rank: 3, expertise: "Climbing" },
    { label: "Stealth", rank: 2, expertise: "" },
    { label: "Magic", rank: 0, expertise: "" }
  ],
  craftingSkills: [{ label: "Blacksmith", rank: 4 }],
  classes: [{ name: "Fighter", level: 2 }]
};

const asObject = (cells) => Object.fromEntries(cells);

test("a character lands in the cells a player would have typed", () => {
  const { cells, warnings } = coreSheetCells(CHARACTER, LAYOUT);
  const out = asObject(cells);

  assert.equal(out.B2, "Kaelen Vos");
  assert.equal(out.B3, "Female");
  assert.equal(out.B7, "Kari");
  assert.equal(out.D2, "Human");

  // The array, not the totals.
  assert.deepEqual([out.B45, out.B46, out.B47, out.B48],
    ["Toughness", "Power", "Agility", "Focus"]);
  assert.deepEqual([out.D45, out.D46], ["Fitness", "Cunning"]);

  // Bonuses go against their stat's label, wherever that sits.
  assert.equal(out.F46, 1, "Power's +1");
  assert.equal(out.H45, 2, "Fitness's +2");

  assert.equal(out.H9, 3, "Athletics points");
  assert.equal(out.I9, "Climbing");
  assert.equal(out.H11, 2, "Stealth points");
  assert.equal(out.H17, undefined, "a skill with no points writes nothing");

  assert.equal(out.N9, "Blacksmith");
  assert.equal(out.P9, 4);
  assert.equal(out.A15, "Fighter");
  assert.equal(out.C15, 2);

  assert.deepEqual(warnings, []);
});

test("nothing empty is written, so the template's blanks stay blank", () => {
  const { cells } = coreSheetCells({ name: "", identity: {}, skills: [] }, LAYOUT);
  assert.deepEqual(cells, []);
});

test("more classes than the template has rows is reported, not dropped in silence", () => {
  const crowded = { ...CHARACTER, classes: [
    { name: "Fighter", level: 1 }, { name: "Mage", level: 1 }, { name: "Rogue", level: 1 }
  ] };
  const { cells, warnings } = coreSheetCells(crowded, LAYOUT);
  const out = asObject(cells);
  assert.equal(out.A15, "Fighter");
  assert.equal(out.A16, "Mage");
  assert.ok(warnings.some((w) => w.kind === "classOverflow" && w.label === "Rogue"));
});

test("a skill the template does not list is reported only if it carried anything", () => {
  const withUnknown = { ...CHARACTER, skills: [
    { label: "Basket Weaving", rank: 4, expertise: "" },
    { label: "Underwater Origami", rank: 0, expertise: "" }
  ] };
  const { warnings } = coreSheetCells(withUnknown, LAYOUT);
  assert.deepEqual(warnings.map((w) => w.label), ["Basket Weaving"],
    "an empty skill with nowhere to go is not worth mentioning");
});

test("a stat spread the sheet cannot hold surfaces as a warning on the export", () => {
  const odd = { ...CHARACTER, mainStats: [
    { key: "focus", label: "Focus", value: 9, bonus: 0 },
    { key: "power", label: "Power", value: 4, bonus: 0 },
    { key: "agility", label: "Agility", value: 4, bonus: 0 },
    { key: "toughness", label: "Toughness", value: 5, bonus: 0 }
  ] };
  const { warnings } = coreSheetCells(odd, LAYOUT);
  const warning = warnings.find((w) => w.kind === "statArray");
  assert.equal(warning.scope, "main");
  assert.deepEqual(warning.stats, [{ key: "focus", value: 9 }]);
});

/* -------------------------------------------- */
/*  Reading the layout off a template            */
/* -------------------------------------------- */

test("the layout is read from the template, arrays included", () => {
  const sheet = {
    A45: "5", A46: "4", A47: "4", A48: "3",
    C45: "5", C46: "4", C47: "3", C48: "2", C49: "1",
    E45: "Focus", E46: "Power", E47: "Agility", E48: "Toughness",
    G45: "Fitness", G46: "Cunning", G47: "Reason", G48: "Awareness", G49: "Presence",
    E9: "Athletics", E10: "Riding", E11: "Stealth",
    N9: "", N10: "", N11: "Taken",
    A15: "", A16: "", A17: "Taken"
  };
  const layout = discoverCoreLayout((ref) => sheet[ref] ?? "");

  assert.deepEqual(layout.mainStatArray, [5, 4, 4, 3],
    "the array is whatever the template says, not a constant here");
  assert.deepEqual(layout.subStatArray, [5, 4, 3, 2, 1]);
  assert.deepEqual([...layout.mainBonusRows.values()],
    ["Focus", "Power", "Agility", "Toughness"]);
  assert.equal(layout.skillRows.get("Stealth"), 11);
  assert.deepEqual(layout.craftingRows, [9, 10, 12, 13, 14]);
  assert.deepEqual(layout.classRows.slice(0, 2), [15, 16]);
});

test("a template with a changed array is followed, not corrected", () => {
  // A table running a different spread is not an error to route around.
  const sheet = { A45: "6", A46: "5", A47: "4", A48: "3" };
  const layout = discoverCoreLayout((ref) => sheet[ref] ?? "");
  assert.deepEqual(layout.mainStatArray, [6, 5, 4, 3]);

  const stats = [
    { key: "focus", label: "Focus", value: 6 },
    { key: "power", label: "Power", value: 5 },
    { key: "agility", label: "Agility", value: 4 },
    { key: "toughness", label: "Toughness", value: 3 }
  ];
  const { picks, unmatched } = assignStatArray(stats, layout.mainStatArray);
  assert.deepEqual(picks, ["Focus", "Power", "Agility", "Toughness"]);
  assert.deepEqual(unmatched, []);
});
