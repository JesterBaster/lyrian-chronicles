import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { itemChatKeywords, itemChatStats } from "../module/rules/item-summary.mjs";

// Identity stubs: the labels come back as the keys, so a test asserts which
// key was chosen rather than what English happens to say today.
const helpers = {
  localize: (key) => key,
  localizeKey: (table, key) => `${table}:${key}`
};

const labels = (stats) => stats.map((stat) => stat.label);
const valueOf = (stats, label) => stats.find((stat) => stat.label === label)?.value;

test("a weapon reports the numbers a reader would open the sheet for", () => {
  const stats = itemChatStats({
    type: "weapon",
    system: {
      group: "katana", hands: "two", damageType: "physical", range: 5,
      effectiveCrit: 19, accuracyBonus: 2, damageBonus: -1,
      enchantment: "Frostbite", burden: 3
    }
  }, helpers);

  assert.equal(valueOf(stats, "LYRIAN.UI.Group"), "weaponGroups:katana");
  assert.equal(valueOf(stats, "LYRIAN.UI.Hands"), "LYRIAN.UI.TwoHanded");
  assert.equal(valueOf(stats, "LYRIAN.UI.Range"), "5 LYRIAN.Unit.Feet");
  assert.equal(valueOf(stats, "LYRIAN.UI.CritOn"), "19+");
  assert.equal(valueOf(stats, "LYRIAN.UI.Accuracy"), "+2");
  assert.equal(valueOf(stats, "LYRIAN.UI.Damage"), "-1");
  assert.equal(valueOf(stats, "LYRIAN.UI.Enchantment"), "Frostbite");
  assert.equal(valueOf(stats, "LYRIAN.UI.Burden"), "3");
});

test("a plain weapon prints no empty or meaningless lines", () => {
  const stats = itemChatStats({
    type: "weapon",
    system: {
      group: "lightSword", hands: "one", damageType: "physical", range: 5,
      // The default threshold and zero bonuses say nothing worth a line.
      effectiveCrit: 20, accuracyBonus: 0, damageBonus: 0, enchantment: "", burden: 1
    }
  }, helpers);

  assert.equal(valueOf(stats, "LYRIAN.UI.Hands"), "LYRIAN.UI.OneHanded");
  for (const absent of ["LYRIAN.UI.CritOn", "LYRIAN.UI.Accuracy", "LYRIAN.UI.Damage",
    "LYRIAN.UI.Enchantment"]) {
    assert.equal(labels(stats).includes(absent), false, `${absent} should be omitted`);
  }
  // Burden 1 is a real value, unlike a zero bonus, so it stays.
  assert.equal(valueOf(stats, "LYRIAN.UI.Burden"), "1");
});

test("armour reports its defences, negatives kept signed", () => {
  const stats = itemChatStats({
    type: "armor",
    system: {
      category: "heavy", guard: 3, blockValue: 2, evasionPenalty: -2,
      modification: "Reinforced", burden: 4
    }
  }, helpers);

  assert.equal(valueOf(stats, "LYRIAN.UI.Category"), "armorCategories:heavy");
  assert.equal(valueOf(stats, "LYRIAN.Defence.Guard"), "+3");
  assert.equal(valueOf(stats, "LYRIAN.Defence.Block"), "2");
  assert.equal(valueOf(stats, "LYRIAN.Defence.Evasion"), "-2");
  assert.equal(valueOf(stats, "LYRIAN.UI.Modification"), "Reinforced");
});

test("gear reports the stack, not a burden it does not carry", () => {
  const carried = itemChatStats({
    type: "gear",
    system: { quantity: 4, units: 12, rarity: "Common", totalBurden: 2 }
  }, helpers);
  assert.equal(valueOf(carried, "LYRIAN.UI.Quantity"), "×4");
  assert.equal(valueOf(carried, "LYRIAN.UI.Units"), "12");
  assert.equal(valueOf(carried, "LYRIAN.UI.Burden"), "2");

  const stowed = itemChatStats({
    type: "gear",
    system: { quantity: 1, units: 0, rarity: "", totalBurden: 0 }
  }, helpers);
  assert.deepEqual(labels(stowed), ["LYRIAN.UI.Quantity"]);
});

test("an ability reports its timing, cost and range", () => {
  const stats = itemChatStats({
    type: "ability",
    system: { timing: "action", costLabel: "2 AP", range: "30 ft." }
  }, helpers);
  assert.deepEqual(labels(stats), ["LYRIAN.UI.Timing", "LYRIAN.UI.Cost", "LYRIAN.UI.Range"]);
  assert.equal(valueOf(stats, "LYRIAN.UI.Timing"), "abilityTiming:action");

  // Monster abilities are the same shape and must not fall through to blank.
  assert.equal(itemChatStats({ type: "monsterAbility", system: { timing: "passive" } }, helpers)
    .length, 1);
});

test("types with nothing to summarise produce no stat lines", () => {
  for (const type of ["class", "race", "breakthrough", "injury", undefined]) {
    assert.deepEqual(itemChatStats({ type, system: {} }, helpers), []);
  }
  assert.deepEqual(itemChatStats(undefined, helpers), []);
  assert.deepEqual(itemChatStats({ type: "weapon" }, helpers).length > 0, true);
});

test("keywords come out as a list Handlebars can iterate", () => {
  // They are stored in a SetField, which templates cannot walk.
  assert.deepEqual(
    itemChatKeywords({ system: { keywords: new Set(["halfPierce", "sureHit"]) } }, helpers),
    ["abilityKeywords:halfPierce", "abilityKeywords:sureHit"]
  );
  assert.deepEqual(itemChatKeywords({ system: { keywords: ["custom"] } }, helpers),
    ["abilityKeywords:custom"]);
  assert.deepEqual(itemChatKeywords({ system: {} }, helpers), []);
  assert.deepEqual(itemChatKeywords(undefined), []);
});

test("an unrecognised keyword falls back to its own name", () => {
  assert.deepEqual(
    itemChatKeywords({ system: { keywords: ["Homebrew"] } }, { localizeKey: () => "" }),
    ["Homebrew"]
  );
});

/* -------------------------------------------- */
/*  Wiring                                       */
/* -------------------------------------------- */

test("sharing an item never rolls it and never spends it", () => {
  const source = readFileSync(new URL("../module/sheets/actor-sheet.mjs", import.meta.url), "utf8");
  const start = source.indexOf("static async #onPostItem");
  assert.notEqual(start, -1, "the postItem handler is missing");
  const handler = source.slice(start, source.indexOf("static async", start + 20));
  assert.match(handler, /postToChat\(\)/);
  for (const forbidden of ["rollAbility", "spend", "update", "usedThisRound"]) {
    assert.equal(handler.includes(forbidden), false, `${forbidden} has no place in sharing`);
  }
  assert.match(source, /postItem: LyrianActorSheet\.#onPostItem/);
});

test("both tabs offer sharing, and the gear buttons cannot consume", () => {
  const abilities = readFileSync(
    new URL("../templates/actor/tab-abilities.hbs", import.meta.url), "utf8");
  const inventory = readFileSync(
    new URL("../templates/actor/tab-inventory.hbs", import.meta.url), "utf8");

  // Every ability row shape: the loose list, and the class/race grant rows.
  assert.equal((abilities.match(/data-action="postItem"/g) ?? []).length, 2);
  // Weapons, armour, gear, other official gear, and the three mod sub-rows.
  assert.equal((inventory.match(/data-action="postItem"/g) ?? []).length, 7);

  // The old Show buttons ran through useItem, which rolls abilities and would
  // consume anything given a use path later.
  assert.equal(inventory.includes('data-action="useItem"'), false);
});

test("the shared card shows the stat lines and keywords", () => {
  const card = readFileSync(new URL("../templates/chat/item-card.hbs", import.meta.url), "utf8");
  assert.match(card, /\{\{#each stats as \|stat\|\}\}/);
  assert.match(card, /\{\{#if keywords\.length\}\}/);
  assert.match(card, /enrichedDescription/);

  const styles = readFileSync(new URL("../styles/lyrian.css", import.meta.url), "utf8");
  assert.match(styles, /\.lyrian-card__stats/);
});
