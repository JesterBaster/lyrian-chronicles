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
    materials: [
      { name: "Dark Iron", quantity: 1000, cost: "550 Clim", unitCost: "1,000 units" }
    ]
  });

  assert.equal(value.base, 500);
  assert.equal(value.mods, 1875);
  assert.equal(value.materials, 550);
  assert.equal(value.total, 2925);
});

test("a material is priced by the lot it is sold in", () => {
  // "Tamahagane 1050c / 2000u" — 1050 Clim buys the 2000-unit lot a craft
  // draws one ingot from, so spending the lot costs the listed price.
  const lot = craftValue({
    materials: [{ name: "Tamahagane", quantity: 2000, cost: "1,050 Clim", unitCost: "2,000 units" }]
  });
  assert.equal(lot.total, 1050);

  const half = craftValue({
    materials: [{ name: "Tamahagane", quantity: 1000, cost: "1,050 Clim", unitCost: "2,000 units" }]
  });
  assert.equal(half.total, 525);

  // Sold by the piece — "1 Core", "1 Hide" — there is no unit count, so the
  // row's quantity multiplies the listed price instead of dividing it.
  const pieces = craftValue({
    materials: [{ name: "Dire Hide", quantity: 3, cost: "600 Clim", unitCost: "1 Hide" }]
  });
  assert.equal(pieces.total, 1800);
});

test("the breakdown names every line so a GM can drop one", () => {
  // The sheet writes "Iron Ingot (Ignored)" against the baseline metal a
  // recipe already includes, and nothing in the data marks which material
  // that is. Everything listed is priced and shown, rather than guessed at.
  const value = craftValue({
    base: { name: "Armor (Medium)", system: { cost: "1,000 Clim" } },
    mods: [{ name: "Berserker Armor", cost: 10 }],
    materials: [
      { name: "Iron", quantity: 500, cost: "300 Clim", unitCost: "500 units" },
      { name: "Tamahagane", quantity: 2000, cost: "1,050 Clim", unitCost: "2,000 units" }
    ]
  });

  assert.deepEqual(value.lines.map((line) => [line.kind, line.name, line.clim]), [
    ["base", "Armor (Medium)", 1000],
    ["mod", "Berserker Armor", 250],
    ["material", "Iron", 300],
    ["material", "Tamahagane", 1050]
  ]);
  assert.equal(value.total, 2600);

  // Dropping the ignored baseline ingot leaves the sheet's own figure for
  // this armour before its polarity infusion: 1000 + 1050 + 250.
  assert.equal(value.total - 300, 2300);
});

test("a material row spending nothing is not priced", () => {
  const value = craftValue({
    materials: [{ name: "Iron", quantity: 0, cost: "300 Clim", unitCost: "500 units" }]
  });
  assert.equal(value.total, 0);
  assert.deepEqual(value.lines, [{ kind: "material", name: "Iron", quantity: 0, clim: 0 }]);
});

test("a craft with nothing to price costs nothing", () => {
  const value = craftValue();
  assert.deepEqual(value, { base: 0, mods: 0, materials: 0, total: 0, lines: [] });
});
