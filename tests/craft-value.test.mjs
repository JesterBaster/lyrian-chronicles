import test from "node:test";
import assert from "node:assert/strict";

import { craftValue, modClim, parseClim, CLIM_PER_CRAFTING_POINT }
  from "../module/rules/craft-value.mjs";

test("Clim is read out of the strings the compendium actually ships", () => {
  assert.equal(parseClim("300 Clim"), 300);
  assert.equal(parseClim("1,050 Clim"), 1050);
  assert.equal(parseClim("11,550 Clim"), 11550);
  assert.equal(parseClim("500c"), 500);
  assert.equal(parseClim(2050), 2050);

  // "Original Weapon + 3000" prices the artifice conversion, not the weapon
  // underneath it. Taking the first number is the only honest reading — the
  // weapon's own cost is not in this string.
  assert.equal(parseClim("Original Weapon + 3000"), 3000);

  assert.equal(parseClim(""), 0, "a blank cost is free, not NaN");
  assert.equal(parseClim(undefined), 0);
  assert.equal(parseClim("Priceless"), 0);
  assert.equal(parseClim(-40), 0, "a negative cost is not a discount");
});

test("a Mod adds 25 Clim per crafting point", () => {
  assert.equal(CLIM_PER_CRAFTING_POINT, 25);
  assert.equal(modClim(10), 250, "the sheet's 250c per 10cp");
  assert.equal(modClim(80), 2000);
  assert.equal(modClim(0), 0);
});

test("the source spreadsheet's worked missile price comes out exactly", () => {
  // "Set of Missiles, Made with 1 Iron Ingot, 1 Dark Iron Ingot (Alloyed),
  //  Featherflight, Momentum
  //  - Set of Missiles (500c)      - Alloying Dark Iron 15cp (375c)
  //  - Iron Ingot (Ignored)        - Featherflight 35cp (875c)
  //  - Dark Iron Ingot (550c)      - Momentum 25cp (625c)
  //  The total value of this weapon is 2925c"
  //
  // The Iron ingot is left off the project's material rows here because the
  // sheet ignores it: a recipe's baseline metal is already inside the item's
  // own price.
  const value = craftValue({
    base: { name: "Set of Missiles", system: { cost: "500 Clim" } },
    mods: [
      { name: "Alloying Dark Iron", cost: 15 },
      { name: "Featherflight", cost: 35 },
      { name: "Momentum", cost: 25 }
    ],
    materials: [{ name: "Dark Iron", quantity: 1, value: 550 }]
  });

  assert.equal(value.base, 500);
  assert.equal(value.mods, 1875);
  assert.equal(value.materials, 550);
  assert.equal(value.total, 2925);
});

test("a material row spends whole stacks at the stack's price", () => {
  // A project row's quantity is a count of stacks, not of units:
  // planCraftMaterials decrements the owned item's `quantity`, and one dropped
  // "Tamahagane — Blacksmithing" stack is one 2000-unit ingot worth 1050 Clim.
  // Dividing by that unit count priced an ingot at half a Clim.
  const one = craftValue({ materials: [{ name: "Tamahagane", quantity: 1, value: 1050 }] });
  assert.equal(one.total, 1050);

  const three = craftValue({ materials: [{ name: "Tamahagane", quantity: 3, value: 1050 }] });
  assert.equal(three.total, 3150);
});

test("a base is priced from whichever field its type carries", () => {
  // A compendium entry is type "equipment" and states cost as a string; the
  // weapon a craft actually produces states value as a number. Reading only
  // one of the two silently priced half the crafts at nothing.
  const reference = craftValue({ base: { name: "Longsword", system: { cost: "1,000 Clim" } } });
  assert.equal(reference.total, 1000);

  const converted = craftValue({ base: { name: "Longsword", system: { value: 1000 } } });
  assert.equal(converted.total, 1000);
});

test("a material row spending nothing is not priced", () => {
  const value = craftValue({
    materials: [{ name: "Iron", quantity: 0, value: 300 }]
  });
  assert.equal(value.total, 0);
  assert.deepEqual(value.lines, [{ kind: "material", name: "Iron", quantity: 0, clim: 0 }]);
});

test("a craft with nothing to price costs nothing", () => {
  const value = craftValue();
  assert.deepEqual(value, { base: 0, mods: 0, materials: 0, total: 0, lines: [] });
});
