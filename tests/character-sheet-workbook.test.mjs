/**
 * Reading an actor into the shape the character sheet expects.
 *
 * The labels are localised through the real `lang/en.json`, not a stub: the
 * template names its rows in English words, so a rename there is a silent
 * export failure and this is the only place that would catch it.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { LYRIAN } from "../module/config.mjs";
import {
  characterExportView,
  exportFileName
} from "../module/rules/character-sheet-workbook.mjs";
import { CORE_SKILL_LABELS, sameLabel } from "../module/rules/character-sheet-export.mjs";

const EN = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
const localize = (key) => EN[key] ?? key;

const stat = (value, bonus = 0) => ({ value, bonus });

const ACTOR = {
  name: "Kaelen Vos",
  system: {
    details: {
      race: "Human", subrace: "", gender: "Female",
      age: "24", height: "5'7\"", weight: "130 lb", worship: "Kari"
    },
    stats: {
      power: stat(4, 1), focus: stat(3), agility: stat(4), toughness: stat(5)
    },
    subStats: {
      fitness: stat(5, 2), cunning: stat(4), reason: stat(3),
      awareness: stat(2), presence: stat(1)
    },
    skills: {
      athletics: { rank: 3, expertises: [{ name: "Climbing", rank: 2 }] },
      magic: { rank: 5, expertises: [] }
    },
    artisan: { blacksmith: { rank: 4 }, alchemist: { rank: 0 } },
    gathering: { mining: { rank: 2 }, fishing: { rank: 0 } }
  },
  items: [
    { type: "class", name: "Fighter", system: { abilitiesUnlocked: 3 } },
    { type: "weapon", name: "Longsword", system: {} }
  ]
};

test("an actor reads into the view the mapper expects", () => {
  const view = characterExportView(ACTOR, { localize });

  assert.equal(view.name, "Kaelen Vos");
  assert.equal(view.race, "Human");
  assert.equal(view.identity.worships, "Kari", "details.worship, not details.worships");

  // The array pick and the bonus stay apart — the sheet has a column for each.
  const power = view.mainStats.find((s) => s.key === "power");
  assert.deepEqual([power.value, power.bonus], [4, 1]);
  assert.equal(view.mainStats.length, 4);
  assert.equal(view.subStats.length, 5);

  const athletics = view.skills.find((s) => s.key === "athletics");
  assert.equal(athletics.rank, 3);
  assert.equal(athletics.expertise, "Climbing");
  assert.equal(view.skills.find((s) => s.key === "magic").expertise, "");
  assert.equal(view.skills.find((s) => s.key === "riding").rank, 0, "unset skills read as zero");

  assert.deepEqual(view.classes, [{ name: "Fighter", level: 3 }]);
});

test("only crafting skills with points asked for one of the sheet's six rows", () => {
  const view = characterExportView(ACTOR, { localize });
  assert.deepEqual(view.craftingSkills.map((s) => s.key), ["blacksmith", "mining"]);
  assert.equal(view.craftingSkills[0].rank, 4);
});

test("every skill label the system ships matches a row on the template", () => {
  const view = characterExportView(ACTOR, { localize });
  const missing = view.skills
    .filter((skill) => !CORE_SKILL_LABELS.some((label) => sameLabel(label, skill.label)));
  assert.deepEqual(missing.map((s) => s.key), [],
    "a skill renamed in lang/en.json no longer finds its row on the sheet");
  assert.equal(view.skills.length, Object.keys(LYRIAN.skills).length);
});

test("an empty actor exports without throwing", () => {
  const view = characterExportView({}, { localize });
  assert.equal(view.name, "");
  assert.deepEqual(view.classes, []);
  assert.deepEqual(view.craftingSkills, []);
  assert.equal(view.mainStats.every((s) => s.value === 0), true);
});

test("the filename survives a name that is mostly punctuation", () => {
  assert.equal(exportFileName("Kaelen Vos"), "Kaelen-Vos-lyrian-sheet.xlsx");
  assert.equal(exportFileName("../../etc/passwd"), "etcpasswd-lyrian-sheet.xlsx");
  assert.equal(exportFileName("???"), "character-lyrian-sheet.xlsx");
  assert.equal(exportFileName(""), "character-lyrian-sheet.xlsx");
});
