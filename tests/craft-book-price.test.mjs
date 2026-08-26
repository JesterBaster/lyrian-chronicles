import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ACTOR = readFileSync(new URL("../module/documents/actor.mjs", import.meta.url), "utf8");
const SHEET = readFileSync(new URL("../module/sheets/actor-sheet.mjs", import.meta.url), "utf8");
const TEMPLATE = readFileSync(
  new URL("../templates/actor/tab-crafting.hbs", import.meta.url), "utf8");
const CARD = readFileSync(
  new URL("../templates/chat/craft-card.hbs", import.meta.url), "utf8");
const ITEM_DATA = readFileSync(new URL("../module/data/item.mjs", import.meta.url), "utf8");
const IMPORT = readFileSync(
  new URL("../module/rules/equipment-import.mjs", import.meta.url), "utf8");

const content = (file) => JSON.parse(
  readFileSync(new URL(`../content/${file}`, import.meta.url), "utf8"));

/* -------------------------------------------- */
/*  The target comes off what is being made      */
/* -------------------------------------------- */

test("every craftable the system ships states its own crafting cost", () => {
  // The auto-fill below is only worth anything if the compendium actually
  // carries the number. If a rebuild ever drops the field this fails here
  // rather than silently leaving players typing 30 into every project.
  for (const file of ["weapons-01.json", "armor-shields-01.json", "consumables-01.json"]) {
    const documents = content(file);
    const priced = documents.filter((entry) => Number(entry.system?.craftingPoints) > 0);
    assert.ok(
      priced.length / documents.length > 0.8,
      `${file}: only ${priced.length} of ${documents.length} carry craftingPoints`
    );
  }

  const axe = content("weapons-01.json").find((entry) => entry.name === "Axe (One-Handed)");
  assert.equal(axe.system.craftingPoints, 30, "the sheet's Blacksmithing (Common) baseline");
});

test("dropping a base item sets the project's target from it", () => {
  const start = SHEET.indexOf("async _onDropItem(event, item)");
  const drop = SHEET.slice(start, start + 1600);
  assert.ok(start >= 0, "the drop handler is missing");

  assert.match(drop, /Number\(item\.system\?\.craftingPoints\)/);
  // Never mid-craft: moving the target after points are banked would rewrite
  // the deal a player already rolled against.
  assert.match(drop, /if \(points && !projects\[index\]\.diceSpent\) projects\[index\]\.requiredPoints = points;/);
});

/* -------------------------------------------- */
/*  The tool bonuses reach the session           */
/* -------------------------------------------- */

test("the editor reads and the tab shows both tool bonuses", () => {
  assert.match(SHEET, /\[data-project-dice-bonus\]/);
  assert.match(SHEET, /\[data-project-finish-bonus\]/);
  assert.match(TEMPLATE, /data-project-dice-bonus value="\{\{project\.diceBonus\}\}"/);
  assert.match(TEMPLATE, /data-project-finish-bonus value="\{\{project\.finishBonus\}\}"/);

  // Both are signed, so a GM can express an improvised-tool penalty. A min="0"
  // here would quietly clamp that back to nothing.
  for (const field of ["data-project-dice-bonus", "data-project-finish-bonus"]) {
    const input = TEMPLATE.slice(TEMPLATE.indexOf(field));
    assert.doesNotMatch(input.slice(0, 200), /min="0"/, `${field} must stay signed`);
  }
});

test("the progress the tab shows includes the finish bonus", () => {
  // Showing banked points against a target that the finish bonus is measured
  // against would read as failing while the bar said met.
  assert.match(TEMPLATE, /\{\{project\.status\.finalPoints\}\}<em>\/\{\{project\.status\.required\}\}<\/em>/);
  assert.match(TEMPLATE, /lyrianPercent project\.status\.finalPoints project\.status\.required/);
});

/* -------------------------------------------- */
/*  Pricing the result                           */
/* -------------------------------------------- */

test("a finished craft is priced and stamped with what it cost", () => {
  const start = ACTOR.indexOf("async _resolveCraft(projectIndex)");
  const resolve = ACTOR.slice(start, ACTOR.indexOf("\n  /** Post the result", start));
  assert.ok(start >= 0, "the resolve step is missing");

  assert.match(resolve, /const value = craftValue\(\{/);
  // Priced before the item is created, because the price goes onto it.
  assert.ok(
    resolve.indexOf("const value = craftValue") < resolve.indexOf("createEmbeddedDocuments"),
    "the value must be known before the item exists"
  );
  assert.match(resolve, /system\.cost/);
  // A bare forged item with no materials has nothing to price; leaving the
  // schema default alone beats stamping it "0 Clim".
  assert.match(resolve, /value\.total > 0/);
  assert.match(resolve, /value: status\.succeeds \? value : null/);
});

test("materials are priced off the stacks, which outlive being spent", () => {
  const start = ACTOR.indexOf("_craftMaterialPrices(project)");
  const helper = ACTOR.slice(start, ACTOR.indexOf("\n  }", start));
  assert.ok(start >= 0, "the pricing helper is missing");

  assert.match(helper, /this\.items\.get/);
  assert.match(helper, /line\.quantity > 0/, "an unspent row is not a cost");
});

test("the pricing helper reads fields owned Gear actually has", () => {
  // LyrianGear has no `cost` and no `unitCost` — dropping a compendium
  // material converts those into `value` and `units`. Reading the compendium
  // names off an owned stack priced every material line at zero, so the whole
  // material half of the Book Price silently vanished.
  const gear = ITEM_DATA.slice(ITEM_DATA.indexOf("class LyrianGear"));
  const schema = gear.slice(0, gear.indexOf("prepareDerivedData"));
  assert.match(schema, /schema\.value = /, "gear stores its price as value");
  assert.doesNotMatch(schema, /schema\.cost = /, "gear has no cost field");
  assert.doesNotMatch(schema, /schema\.unitCost = /, "gear has no unitCost field");

  // And the converter is where the rename happens.
  assert.match(IMPORT, /const value = numberFrom\(system\.cost\);/);

  const start = ACTOR.indexOf("_craftMaterialPrices(project)");
  const helper = ACTOR.slice(start, ACTOR.indexOf("\n  }", start));
  assert.match(helper, /item\?\.system\?\.value/, "the owned stack's price is read");
});

test("a craft produces an item the character can use, not a reference page", () => {
  // A compendium entry is type "equipment": equipItem refuses anything that is
  // not a weapon or armor, and every Universal Weapon and Universal Armor Mod
  // tests the target's type. Copying one straight out therefore produced a
  // longsword that could not be equipped and rejected 81 of the Mods.
  const start = ACTOR.indexOf("_craftOutputItem(data, detectionName");
  const helper = ACTOR.slice(start, ACTOR.indexOf("\n  }", start));
  assert.ok(start >= 0, "the output conversion is missing");
  assert.match(helper, /data\?\.type !== "equipment"/, "anything else is left alone");
  assert.match(helper, /convertOfficialEquipment/);
  assert.match(helper, /if \(!converted\) return data;/, "an unrecognised entry survives unchanged");

  const resolveStart = ACTOR.indexOf("async _resolveCraft(projectIndex)");
  const resolve = ACTOR.slice(resolveStart, ACTOR.indexOf("\n  /** Post the result", resolveStart));
  assert.match(resolve, /this\._craftOutputItem\(\s*outputPlan\.data,/);

  // The pre-install check must agree with what resolve will test against, or
  // the tab refuses a Mod the craft would have fitted.
  const installStart = ACTOR.indexOf("async _installProjectMod(projectIndex, modItemId)");
  const install = ACTOR.slice(installStart, ACTOR.indexOf("\n  /** End a craft", installStart));
  assert.match(install, /this\._craftOutputItem\(plan\.data,/);
});

test("naming a craft does not cost it its type", () => {
  // The converter reads the type out of the name: "Armor (Medium)" is what
  // makes an armour an armour, and "Axe (One-Handed)" is what puts an axe in
  // the axe proficiency group. Converting after the rename would turn "Bob's
  // Plate" into gear and "Bob's Blade" into an improvised weapon.
  const start = ACTOR.indexOf("_craftOutputItem(data, detectionName");
  const helper = ACTOR.slice(start, ACTOR.indexOf("\n  }", start));
  assert.ok(start >= 0, "the conversion no longer takes a detection name");
  assert.match(helper, /const stockName = detectionName \|\| data\.name;/);
  assert.match(helper, /\{ \.\.\.data, name: stockName \}/);
  assert.match(helper, /converted\.name = data\.name;/, "the chosen label survives");

  // Both callers hand it the stock name when the project copies a base.
  const calls = [...ACTOR.matchAll(/_craftOutputItem\(\s*(?:outputPlan|plan)\.data,/g)];
  assert.equal(calls.length, 2, "resolve and the mod pre-check must both pass it");
  assert.equal(
    [...ACTOR.matchAll(/fromBase \? base\?\.name : ""/g)].length, 2,
    "and both must read it off the linked base"
  );

  // armorCategory is the name-driven half this protects.
  assert.match(IMPORT, /const armor = armorCategory\(data\.name \?\? ""\);/);
});

test("the price is stamped into the field the created type actually has", () => {
  const start = ACTOR.indexOf("async _resolveCraft(projectIndex)");
  const resolve = ACTOR.slice(start, ACTOR.indexOf("\n  /** Post the result", start));
  assert.match(resolve, /outputData\.type === "equipment"/);
  assert.match(resolve, /"system\.cost"/);
  assert.match(resolve, /"system\.value"/);
});

test("the card shows the breakdown, not just a total", () => {
  assert.match(CARD, /LYRIAN\.Craft\.BookPrice/);
  assert.match(CARD, /each value\.lines/);
  assert.match(CARD, /LYRIAN\.Hint\.CraftBookPrice/);
});
