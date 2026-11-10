import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Rulebook 0.13.3, Kits: a carried kit is always a Burden item, but one picked
 * up during an adventure can be stored for 0 Burden (and not used that
 * adventure). Exercised through the gear model's derived data.
 */
// Just enough Foundry for the module to load; only prepareDerivedData runs.
const field = class {};
globalThis.foundry ??= {
  abstract: { TypeDataModel: class {} },
  data: { fields: new Proxy({}, { get: () => field }) },
  utils: {}
};
const { LyrianGear } = await import("../module/data/item.mjs");

const derive = (data) => {
  const system = { quantity: 1, burden: 2, combatItem: false, isKit: false, stored: false, ...data };
  LyrianGear.prototype.prepareDerivedData.call(system);
  return system;
};

test("kits count unless stored; other gear follows its combat flag", () => {
  assert.equal(derive({ isKit: true }).totalBurden, 2);
  assert.equal(derive({ isKit: true, stored: true }).totalBurden, 0);
  assert.equal(derive({ combatItem: true, quantity: 3 }).totalBurden, 6);
  assert.equal(derive({}).totalBurden, 0);
  // Stored only means something for a kit.
  assert.equal(derive({ combatItem: true, stored: true }).totalBurden, 2);
});

test("the actor's burden is the sum of each gear item's own total", () => {
  const source = readFileSync("module/data/actor.mjs", "utf8");
  assert.match(source, /if \(item\.type === "gear"\) \{\s*out\.burden \+= sys\.totalBurden \?\? 0;/);
});
