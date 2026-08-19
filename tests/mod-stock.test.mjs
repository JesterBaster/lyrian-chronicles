import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { convertOfficialEquipment } from "../module/rules/equipment-import.mjs";
import { isCompatibleModTarget, isCraftingMod } from "../module/rules/mod-installation.mjs";
import { planCraftMods } from "../module/rules/crafting.mjs";

const SHEET = readFileSync(new URL("../module/sheets/actor-sheet.mjs", import.meta.url), "utf8");
const ACTOR = readFileSync(new URL("../module/documents/actor.mjs", import.meta.url), "utf8");

function mod(id, {
  craftingType = "Universal Weapon",
  name = id,
  installedOn = null
} = {}) {
  return {
    id,
    name,
    type: "equipment",
    system: { category: "Crafting Mods", modSlot: "A", craftingType, compatibleTargets: [] },
    flags: installedOn
      ? { "lyrian-chronicles": { installedMod: { targetItemId: installedOn } } }
      : {}
  };
}

/* -------------------------------------------- */
/*  A Mod dropped as stock stays a Mod           */
/* -------------------------------------------- */

test("converting a Mod to Gear would destroy everything that makes it a Mod", () => {
  // The regression this guards: the generic equipment import keeps only the
  // common fields, so craftingType, modSlot and compatibleTargets are lost and
  // isCraftingMod stops recognising the result.
  const source = {
    name: "Ceremonial Armor",
    type: "equipment",
    system: {
      category: "Crafting Mods", subType: "Mod", craftingType: "Universal Armor",
      modSlot: "A", compatibleTargets: [], quantity: 1
    }
  };
  assert.equal(isCraftingMod(source), true);

  const converted = convertOfficialEquipment(structuredClone(source), { assumeProficient: true });
  assert.equal(converted.type, "gear");
  assert.equal(isCraftingMod(converted), false,
    "a converted Mod is unrecognisable — which is why the drop must not convert it");
});

test("the drop path leaves Mods alone and files them as stock", () => {
  assert.match(SHEET, /owned\.type === "equipment" && !isCraftingMod\(owned\)/);
  // Stock lands in its own bucket rather than under "other official gear".
  assert.match(SHEET, /if \(isCraftingMod\(item\)\) buckets\.modStock\.push\(item\)/);

  const inventory = readFileSync(
    new URL("../templates/actor/tab-inventory.hbs", import.meta.url), "utf8");
  assert.match(inventory, /\{\{#each items\.modStock as \|item\|\}\}/);
});

test("installing a Mod spends the stock it came from", () => {
  const install = SHEET.slice(SHEET.indexOf("async #installMod"));
  const body = install.slice(0, install.indexOf("\n  }"));
  assert.match(body, /mod\.parent === this\.document.*mod\.delete\(\)/s,
    "an owned Mod must be consumed, or one Mod installs on unlimited items");
});

test("crafting spends the Mods it forges in", () => {
  assert.match(ACTOR, /deleteEmbeddedDocuments\("Item", modPlan\.mods\.map\(\(mod\) => mod\.id\)\)/);
});

/* -------------------------------------------- */
/*  Mods must fit what is being made             */
/* -------------------------------------------- */

test("a Mod that cannot fit the output is refused before anything is spent", () => {
  const armourMod = mod("polish", { craftingType: "Universal Armor" });
  const plan = planCraftMods({
    mods: [{ itemId: "polish" }],
    items: [armourMod],
    output: { name: "Sword", type: "weapon", system: {} },
    isCompatible: isCompatibleModTarget
  });

  assert.equal(plan.ok, false);
  assert.deepEqual(plan.incompatible.map((entry) => entry.name), ["polish"]);
  assert.deepEqual(plan.mods, []);
  assert.deepEqual(plan.missing, []);
});

test("a Mod that fits is resolved", () => {
  const plan = planCraftMods({
    mods: [{ itemId: "edge" }],
    items: [mod("edge", { craftingType: "Universal Weapon" })],
    output: { name: "Sword", type: "weapon", system: {} },
    isCompatible: isCompatibleModTarget
  });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.mods.map((entry) => entry.id), ["edge"]);
});

test("a Mod no longer carried is reported as missing, not silently dropped", () => {
  const plan = planCraftMods({
    mods: [{ itemId: "gone" }],
    items: [],
    output: { type: "weapon", system: {} },
    isCompatible: isCompatibleModTarget
  });
  assert.equal(plan.ok, false);
  assert.deepEqual(plan.missing.map((entry) => entry.itemId), ["gone"]);
  assert.deepEqual(plan.incompatible, []);
});

test("one stack installs once, however many times it is listed", () => {
  const plan = planCraftMods({
    mods: [{ itemId: "edge" }, { itemId: "edge" }],
    items: [mod("edge")],
    output: { type: "weapon", system: {} },
    isCompatible: isCompatibleModTarget
  });
  assert.deepEqual(plan.mods.map((entry) => entry.id), ["edge"]);
});

test("without an output to check against, compatibility is not guessed at", () => {
  // The pre-existing callers pass no output; they must keep working unchanged.
  const plan = planCraftMods({ mods: [{ itemId: "edge" }], items: [mod("edge")] });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.incompatible, []);
});

test("the craft refuses on either fault, and checks before spending", () => {
  const craft = ACTOR.slice(ACTOR.indexOf("async _attemptCraft"));
  const body = craft.slice(0, craft.indexOf("\n  /**", 1));
  assert.match(body, /modPlan\.missing\.length/);
  assert.match(body, /modPlan\.incompatible\.length/);
  assert.ok(
    body.indexOf("planCraftMods") < body.indexOf("updateEmbeddedDocuments"),
    "materials must not be consumed before the mod plan is known to be sound"
  );
});

/* -------------------------------------------- */
/*  Installed Mods are not raw material          */
/* -------------------------------------------- */

test("an installed Mod is never offered as a crafting material", () => {
  // Installed Mods are Gear carrying a flag, so a bare type filter catches them
  // and the material dropdown would let one be eaten off the item it is on.
  const options = SHEET.slice(SHEET.indexOf("context.craftingMaterialOptions"));
  const filter = options.slice(0, options.indexOf(".map("));
  assert.match(filter, /item\.type === "gear"/);
  assert.match(filter, /!item\.getFlag\("lyrian-chronicles", "installedMod"\)/);
});

/* -------------------------------------------- */
/*  Weapon conflicts reach the inventory         */
/* -------------------------------------------- */

test("a weapon with no hand free is explained in the inventory", () => {
  assert.match(SHEET, /equipment\?\.weaponConflicts \?\? \[\]/);
  assert.match(SHEET, /LYRIAN\.Warn\.WeaponConflict/);

  const lang = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
  assert.ok(lang["LYRIAN.Warn.WeaponConflict"].includes("{ignored}"));
  assert.ok(lang["LYRIAN.Warn.CraftModIncompatible"].includes("{mod}"));
  assert.ok(lang["LYRIAN.Warn.CraftModIncompatible"].includes("{output}"));
});
