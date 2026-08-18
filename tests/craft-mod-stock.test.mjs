import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isCompatibleModTarget, isCraftingMod } from "../module/rules/mod-installation.mjs";

const sheet = readFileSync("module/sheets/actor-sheet.mjs", "utf8");

const mod = (craftingType, extra = {}) => ({
  type: "equipment",
  name: "Agile Weave",
  system: { category: "Crafting Mods", modSlot: "A", craftingType, ...extra }
});

test("every shipped mod is recognised as a crafting mod", () => {
  const content = JSON.parse(readFileSync("content/mods-01.json", "utf8"));
  const entries = Array.isArray(content) ? content : (content.entries ?? content.items ?? []);
  assert.ok(entries.length > 0);
  for (const entry of entries) {
    assert.ok(isCraftingMod(entry), `${entry.name} is not recognised as a crafting mod`);
  }
});

test("no shipped mod takes the Universal Crafting exemption", () => {
  // This is why the old drop path caught all of them: the exemption that let a
  // mod reach the inventory applied to nothing in the book.
  const content = JSON.parse(readFileSync("content/mods-01.json", "utf8"));
  const entries = Array.isArray(content) ? content : (content.entries ?? content.items ?? []);
  const exempt = entries.filter((entry) => entry.system?.craftingType === "Universal Crafting");
  assert.equal(exempt.length, 0);
});

test("a mod installs only when dropped onto something it fits", () => {
  const weaponMod = mod("Universal Weapon");
  const weapon = { type: "weapon", name: "Longsword", system: {} };
  const armor = { type: "armor", name: "Plate", system: { category: "heavy" } };

  assert.equal(isCompatibleModTarget(weaponMod, weapon), true);
  assert.equal(isCompatibleModTarget(weaponMod, armor), false);

  const armorMod = mod("Universal Armor");
  assert.equal(isCompatibleModTarget(armorMod, armor), true);
  assert.equal(isCompatibleModTarget(armorMod, weapon), false);
});

test("an already-modded item is not a target for a second install", () => {
  const weaponMod = mod("Universal Weapon");
  const installed = {
    type: "weapon",
    name: "Longsword",
    system: {},
    flags: { "lyrian-chronicles": { installedMod: { targetItemId: "x" } } }
  };
  assert.equal(isCompatibleModTarget(weaponMod, installed), false);
});

test("the drop path installs on a compatible target and otherwise keeps the mod", () => {
  const drop = sheet.slice(sheet.indexOf("if (isCraftingMod(item) && item.system.craftingType"));
  const body = drop.slice(0, drop.indexOf("const result = await super._onDropItem"));

  // Install only for an explicit, compatible target.
  assert.match(body, /isCompatibleModTarget\(item, target\)/);
  assert.match(body, /return this\.#installMod\(event, item\)/);

  // Everything else falls through to the normal drop, so the mod is added to
  // the inventory rather than warned about and discarded.
  assert.ok(
    !/LYRIAN\.Mod\.NoTarget/.test(body),
    "an unplaced mod must be kept, not rejected"
  );
});

test("the project mod list offers owned mods that are not already installed", () => {
  const prepare = sheet.slice(sheet.indexOf("context.craftingModOptions"));
  const body = prepare.slice(0, prepare.indexOf("context.craftingOutputTypes"));
  assert.match(body, /isCraftingMod\(item\)/);
  // An installed copy is flagged; listing it would offer the same mod twice.
  assert.match(body, /!item\.getFlag\("lyrian-chronicles", "installedMod"\)/);
});
