import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The actor sheet refuses a second copy of any breakthrough that is not
 * repeatable. The build used to look for the word "repeat", which the rulebook
 * never uses, so every breakthrough came out non-repeatable and a second Skill
 * Training or Weapon Training was turned away.
 */
const breakthroughs = JSON.parse(readFileSync(
  new URL("../content/breakthroughs-01.json", import.meta.url), "utf8"));

test("breakthroughs the rulebook lets you take more than once are repeatable", () => {
  assert.deepEqual(
    breakthroughs.filter((b) => b.system.repeatable).map((b) => b.name).sort(),
    [
      "Blend In II (Slimefolk)", "Elemental Affinity", "Language Training",
      "Organized Inventory III", "Primary Stat Training", "Secondary Stat Training",
      "Skill Training", "Speciality Weapon Training", "Universal Training",
      "Weapon Training", "Wide Circuits IV"
    ]
  );
});

test("doing something multiple times inside a breakthrough is not taking it twice", () => {
  const acrobat = breakthroughs.find((b) => b.name === "Fae Flash Acrobat (Fae)");
  assert.match(acrobat.system.description, /multiple times/);
  assert.equal(acrobat.system.repeatable, false);
});

test("Primary Stat Training costs 100 more per copy, up to 700", async () => {
  const { repeatedBreakthroughCost } = await import("../module/rules/progression.mjs");
  const training = breakthroughs.find((b) => b.name === "Primary Stat Training");
  const cost = (owned) => repeatedBreakthroughCost(training.system.expCost, training.system.description, owned);
  assert.deepEqual([0, 1, 2, 3, 4, 9].map(cost), [400, 500, 600, 700, 700, 700]);

  const skill = breakthroughs.find((b) => b.name === "Skill Training");
  assert.equal(repeatedBreakthroughCost(skill.system.expCost, skill.system.description, 5), 25);
});

test("the sheet applies the step when a further copy is dropped", () => {
  const sheet = readFileSync(new URL("../module/sheets/actor-sheet.mjs", import.meta.url), "utf8");
  assert.match(sheet, /repeatedBreakthroughCost\(owned\.system\.expCost, owned\.system\.description, copies\)/);
});
