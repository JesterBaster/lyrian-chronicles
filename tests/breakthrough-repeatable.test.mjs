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
