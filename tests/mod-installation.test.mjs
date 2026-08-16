import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  compatibleModTargets,
  installedModFlag,
  isCompatibleModTarget,
  isCraftingMod,
  normalizeModTargetName
} from "../module/rules/mod-installation.mjs";
import { convertOfficialEquipment } from "../module/rules/equipment-import.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const content = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, "content", name), "utf8"));

const mod = (craftingType, compatibleTargets = [], extra = {}) => ({
  name: "Test Mod",
  type: "equipment",
  uuid: "Compendium.lyrian-chronicles.mods.Item.test",
  system: {
    category: "Crafting Mods",
    craftingType,
    compatibleTargets,
    modSlot: "A",
    stableId: "test-mod",
    ...extra
  }
});

const item = (id, name, type, category) => ({
  id, name, type, system: { category }, getFlag: () => null
});

test("crafting Mod references are distinguished from ordinary equipment", () => {
  assert.equal(isCraftingMod(mod("Universal Weapon")), true);
  assert.equal(isCraftingMod({ type: "equipment", system: { category: "Equipment" } }), false);
});

test("universal weapon and armor Mods select only their approved target families", () => {
  const weapon = item("w", "Light Sword (One-Handed)", "weapon");
  const armor = item("a", "Armor (Light)", "armor", "light");
  const shield = item("s", "Shield", "armor", "shield");
  assert.deepEqual(compatibleModTargets(mod("Universal Weapon"), [armor, weapon, shield]), [weapon]);
  assert.deepEqual(compatibleModTargets(mod("Universal Armor"), [weapon, shield, armor]), [armor]);
});

test("universal artifice Mods use official source metadata", () => {
  const artifice = {
    ...item("artifice", "Refractor Gun", "gear"),
    getFlag: (scope, key) => scope === "lyrian-chronicles" && key === "officialEquipment"
      ? { category: "Artifice" }
      : null
  };
  const ordinary = item("gear", "Adventurer's Kit", "gear");
  assert.equal(isCompatibleModTarget(mod("Universal Artifice"), artifice), true);
  assert.equal(isCompatibleModTarget(mod("Universal Artifice"), ordinary), false);
});

test("item-specific targets handle approved punctuation and armor aliases", () => {
  const crossbow = item("c", "Crossbow (Two-Handed)", "weapon");
  const lightArmor = item("a", "Armor (Light)", "armor", "light");
  assert.equal(isCompatibleModTarget(mod("Item-specific", ["Cross-Bow (Two-Handed)"]), crossbow), true);
  assert.equal(isCompatibleModTarget(mod("Item-specific", ["Light Armor"]), lightArmor), true);
  assert.equal(normalizeModTargetName("Gauntlets (One-handed)"), "gauntlets one handed");
});

test("approved alternate target labels resolve without broadening handed restrictions", () => {
  const cannon = item("cannon", "Cannon (Two-Handed)", "weapon");
  const chainsaw = item("chainsaw", "Chainsaw Artifice (Two-Handed Weapon)", "weapon");
  const longsword = item("longsword", "Longsword (One-Handed/Two-Handed)", "weapon");
  const camouflage = item("field", "Personal Camouflage Field", "gear");
  const sling = item("sling", "Shepherd's Sling (One-Handed)", "weapon");
  assert.equal(isCompatibleModTarget(mod("Item-specific", ["Cannon"]), cannon), true);
  assert.equal(isCompatibleModTarget(mod("Item-specific", ["Chainsaw"]), chainsaw), true);
  assert.equal(isCompatibleModTarget(mod("Item-specific", ["Longsword (Versatile)"]), longsword), true);
  assert.equal(isCompatibleModTarget(mod("Item-specific", ["Personal Camoflage Field"]), camouflage), true);
  assert.equal(isCompatibleModTarget(mod("Item-specific", ["Shepard's Sling (One-Handed)"]), sling), true);
});

test("Single Edge remains restricted to a one-handed Light Sword", () => {
  const singleEdge = mod("Item-specific", ["Light Sword (One-Handed)"]);
  const lightSword = item("light", "Light Sword (One-Handed)", "weapon");
  const heavyBlade = item("heavy", "Heavy Blade (Two-Handed)", "weapon");
  assert.equal(isCompatibleModTarget(singleEdge, lightSword), true);
  assert.equal(isCompatibleModTarget(singleEdge, heavyBlade), false);
});

test("installed Mod flags preserve target, slot, and source identity", () => {
  const source = mod("Universal Weapon", [], { modSlot: "B" });
  const target = item("weapon", "Light Sword (One-Handed)", "weapon");
  assert.deepEqual(installedModFlag(source, target), {
    targetItemId: "weapon",
    targetName: "Light Sword (One-Handed)",
    slot: "B",
    craftingType: "Universal Weapon",
    compatibleTargets: [],
    stableId: "test-mod",
    sourceUuid: "Compendium.lyrian-chronicles.mods.Item.test"
  });
});

test("all 298 approved item-specific Mods resolve to a reviewed equipment target", () => {
  const references = [
    "weapons-01.json", "armor-shields-01.json", "consumables-01.json",
    "gear-kits-01.json", "artifices-01.json"
  ].flatMap(content);
  const targets = references.map((data, index) => {
    const converted = convertOfficialEquipment(data, { assumeProficient: true });
    if (!converted) return null;
    return {
      id: `target-${index}`,
      name: converted.name,
      type: converted.type,
      system: converted.system,
      flags: converted.flags,
      getFlag(scope, key) { return this.flags?.[scope]?.[key] ?? null; }
    };
  }).filter(Boolean);
  const mods = [
    "mods-01.json", "mods-02.json", "mods-03.json", "mods-04.json",
    "mods-05.json", "mods-06.json", "mods-07.json", "mods-08.json"
  ].flatMap(content).filter((entry) => entry.system.craftingType === "Item-specific");
  const unresolved = mods
    .filter((entry) => compatibleModTargets(entry, targets).length === 0)
    .map((entry) => `${entry.name}: ${entry.system.compatibleTargets.join(", ")}`);
  assert.equal(mods.length, 298);
  assert.deepEqual(unresolved, []);
});
