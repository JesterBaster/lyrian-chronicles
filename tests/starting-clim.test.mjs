import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { creationClim, startingClim } from "../module/rules/progression.mjs";

const CREATION = readFileSync(
  new URL("../module/apps/character-creation.mjs", import.meta.url), "utf8");
const LYRIAN_MJS = readFileSync(new URL("../module/lyrian.mjs", import.meta.url), "utf8");
const LANG = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));

const withSettings = (value, run) => {
  const previous = globalThis.game;
  globalThis.game = { settings: { get: () => value } };
  try { return run(); } finally { globalThis.game = previous; }
};

test("the table's figure wins, and the book's is the default", () => {
  const config = { progression: { startingClim: 3000 } };
  assert.equal(withSettings(4000, () => startingClim(config)), 4000,
    "a Mirane campaign starts at 4000");
  assert.equal(withSettings(3000, () => startingClim(config)), 3000);
  assert.equal(withSettings(0, () => startingClim(config)), 0,
    "a campaign that starts penniless is a choice, not a mistake");
});

test("nonsense falls back to the book rather than to NaN", () => {
  const config = { progression: { startingClim: 3000 } };
  for (const bad of [undefined, null, "", "rich", NaN, -500]) {
    assert.equal(withSettings(bad, () => startingClim(config)), 3000, JSON.stringify(bad));
  }

  // A deliberate zero is still honoured — it is only blank that falls back.
  assert.equal(withSettings(0, () => startingClim(config)), 0);
});

test("it survives being called before settings exist", () => {
  // prepareDerivedData and the schema default both run at init, when
  // game.settings.get throws.
  const previous = globalThis.game;
  globalThis.game = { settings: { get() { throw new Error("not registered"); } } };
  try {
    assert.equal(startingClim({ progression: { startingClim: 3000 } }), 3000);
  } finally { globalThis.game = previous; }

  delete globalThis.game;
  assert.equal(startingClim({ progression: { startingClim: 2500 } }), 2500);
  assert.equal(startingClim(), 3000, "and with no config at all, the book's number");
});

test("the creation wizard spends the table's purse, not the config's", () => {
  // Both places that charge against the creation budget must read it, or a
  // Mirane character is handed 4000 and allowed to spend 3000.
  assert.match(CREATION, /tableStartingClim\(\) - equipmentSpent/);
  assert.match(CREATION, /startingClim: tableStartingClim\(\)/);
  assert.doesNotMatch(CREATION, /p\.startingClim/,
    "no path may still read the raw config value");
});

test("the setting is registered and described", () => {
  assert.match(LYRIAN_MJS, /game\.settings\.register\(SYSTEM_ID, "startingClim"/);
  assert.match(LYRIAN_MJS, /default: LYRIAN\.progression\.startingClim/);
  assert.ok(LANG["LYRIAN.Settings.StartingClim.Name"]);
  assert.ok(LANG["LYRIAN.Settings.StartingClim.Hint"]);
});

test("a character made without the wizard still starts with the table's purse", () => {
  // The schema default is the book's 3000, fixed when the schema is defined, so
  // Create Actor ignored a 4000-Clim table until someone ran the wizard.
  assert.equal(creationClim("character", { name: "Kaelen", type: "character" }, 4000), 4000);
  assert.equal(creationClim("character", { system: {} }, 4000), 4000);
});

test("Clim that was chosen is kept, and only characters are touched", () => {
  // A duplicate, an import or a compendium entry carries a figure on purpose.
  assert.equal(creationClim("character", { system: { clim: 120 } }, 4000), null);
  assert.equal(creationClim("character", { system: { clim: 0 } }, 4000), null,
    "a deliberate zero is a choice, not a blank");
  assert.equal(creationClim("character", { "system.clim": 50 }, 4000), null, "flat keys too");

  // NPCs and monsters have their own purse, and none by default.
  assert.equal(creationClim("npc", {}, 4000), null);
  assert.equal(creationClim("monster", {}, 4000), null);
});

test("actor creation actually asks", () => {
  const source = readFileSync(new URL("../module/documents/actor.mjs", import.meta.url), "utf8");
  const preCreate = source.slice(source.indexOf("async _preCreate("), source.indexOf("async _preUpdate("));
  assert.match(preCreate, /creationClim\(this\.type, data\)/);
});
