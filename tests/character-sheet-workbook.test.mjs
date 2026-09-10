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
    { type: "ability", name: "Cleave", system: { timing: "action" } },
    { type: "ability", name: "Riposte", system: { timing: "reaction" } },
    { type: "ability", name: "Iron Skin", system: { timing: "passive" } },
    { type: "breakthrough", name: "Angelblooded (Human)", system: { expCost: 100 } },
    { type: "keyword", name: "Isolated", system: {} },
    {
      type: "weapon", name: "Longsword",
      system: { burden: 2, value: 150, equipped: true, description: "<p>A <i>blade</i>.</p>" }
    },
    {
      type: "armor", name: "Chain Shirt",
      system: { burden: 3, value: 300, equipped: false }
    },
    {
      type: "gear", name: "Iron Ingot",
      system: { quantity: 5, burden: 1, value: 20, combatItem: true, totalBurden: 5 }
    },
    {
      type: "gear", name: "Cookbook",
      system: { quantity: 1, burden: 4, value: 10, combatItem: false, isKit: false, totalBurden: 0 }
    },
    {
      type: "equipment", name: "Alchemy Rig",
      system: { quantity: 2, burden: "2 (4 assembled)", cost: "1,200 Clim" }
    }
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

test("abilities are split by timing, and only `passive` is passive", () => {
  const view = characterExportView(ACTOR, { localize });
  assert.deepEqual(view.abilities, [
    { name: "Cleave", passive: false },
    { name: "Riposte", passive: false },
    { name: "Iron Skin", passive: true }
  ]);
});

test("breakthroughs carry the cost the system charged", () => {
  const view = characterExportView(ACTOR, { localize });
  assert.deepEqual(view.breakthroughs, [{ name: "Angelblooded (Human)", expCost: 100 }]);
});

test("the inventory takes the four carryable types and nothing else", () => {
  const view = characterExportView(ACTOR, { localize });
  assert.deepEqual(view.inventory.map((line) => line.name),
    ["Longsword", "Chain Shirt", "Iron Ingot", "Cookbook", "Alchemy Rig"],
    "a keyword, a class, an ability and a breakthrough are not things you carry");

  const byName = Object.fromEntries(view.inventory.map((line) => [line.name, line]));

  // Equipped is the only part of the sheet's four-way location dropdown the
  // system can actually answer, so it answers that and leaves the rest.
  assert.equal(byName.Longsword.location, "Combat Loadout");
  assert.equal(byName["Chain Shirt"].location, "Backpack");
  assert.equal(byName.Longsword.description, "A blade.");

  // Weapons and armor carry no quantity field; they are one item.
  assert.equal(byName["Chain Shirt"].quantity, 1);
  assert.equal(byName["Chain Shirt"].burden, 3);

  // Gear knows its own total, and a non-combat item that is not a kit is
  // weightless however heavy its burden field says it is.
  assert.equal(byName["Iron Ingot"].burden, 5);
  assert.equal(byName.Cookbook.burden, 0);

  // Equipment stores both as free text; the leading number is what is meant,
  // and the burden is per item so it still multiplies out.
  assert.equal(byName["Alchemy Rig"].burden, 4);
  assert.equal(byName["Alchemy Rig"].value, 1200);
});
