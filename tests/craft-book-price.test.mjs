import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ACTOR = readFileSync(new URL("../module/documents/actor.mjs", import.meta.url), "utf8");
const SHEET = readFileSync(new URL("../module/sheets/actor-sheet.mjs", import.meta.url), "utf8");
const TEMPLATE = readFileSync(
  new URL("../templates/actor/tab-crafting.hbs", import.meta.url), "utf8");
const CARD = readFileSync(
  new URL("../templates/chat/craft-card.hbs", import.meta.url), "utf8");

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
  assert.match(helper, /unitCost/);
  assert.match(helper, /line\.quantity > 0/, "an unspent row is not a cost");
});

test("the card shows the breakdown, not just a total", () => {
  assert.match(CARD, /LYRIAN\.Craft\.BookPrice/);
  assert.match(CARD, /each value\.lines/);
  assert.match(CARD, /LYRIAN\.Hint\.CraftBookPrice/);
});
