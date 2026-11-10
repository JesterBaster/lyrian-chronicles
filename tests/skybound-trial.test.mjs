import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { LYRIAN } from "../module/config.mjs";
import {
  skyboundTrialBlocksSpend,
  skyboundTrialStatus,
  skyboundTrialViolation
} from "../module/rules/skybound-trial.mjs";

const character = (overrides = {}) => ({
  spiritCore: 9900, ambitionExp: 0, skyboundTrial: false,
  exp: { spent: 9900, total: 11000, available: 1100 }, ...overrides
});

test("rulebook 0.13.3 numbers: Skybound is 10k, the hold is 9999 with 1000 stored", () => {
  assert.equal(LYRIAN.skyboundTrial.spiritCoreLimit, 9999);
  assert.equal(LYRIAN.skyboundTrial.storedExpLimit, 1000);
  assert.deepEqual(LYRIAN.spiritCoreTiers.map((t) => [t.threshold, t.label]),
    [[0, ""], [10000, "LYRIAN.Tier.Skybound"]]);
  assert.deepEqual(LYRIAN.spiritCoreMilestones.map((m) => m.threshold), [5000, 10000]);
});

test("spending past 9999 is refused until the trial is completed", () => {
  assert.equal(skyboundTrialBlocksSpend(character(), 99), false);
  assert.equal(skyboundTrialBlocksSpend(character(), 100), true);
  assert.equal(skyboundTrialBlocksSpend(character({ skyboundTrial: true }), 100), false);
});

test("the update check covers flattened and nested writes to spent EXP", () => {
  assert.deepEqual(skyboundTrialViolation(character(), { "system.exp.spent": 10000 }),
    { spiritCore: 10000, limit: 9999 });
  assert.ok(skyboundTrialViolation(character(), { system: { exp: { spent: 10100 } } }));
  assert.equal(skyboundTrialViolation(character(), { "system.exp.spent": 9999 }), null);
  // Ambition EXP is part of Spirit Core.
  assert.ok(skyboundTrialViolation(character({ ambitionExp: 50 }), { "system.exp.spent": 9950 }));
});

test("the hold refuses rises only, and ticking the trial in the same update lifts it", () => {
  const past = character({ exp: { spent: 12000 }, spiritCore: 12000 });
  assert.equal(skyboundTrialViolation(past, { "system.exp.spent": 11000 }), null);
  assert.equal(skyboundTrialViolation(character(), { "system.clim": 5 }), null);
  assert.equal(skyboundTrialViolation(character(),
    { "system.exp.spent": 10500, "system.skyboundTrial": true }), null);
  assert.ok(skyboundTrialViolation(character({ skyboundTrial: true }),
    { "system.exp.spent": 10500, "system.skyboundTrial": false }));
});

test("the sheet reports the hold and EXP banked past the stored limit", () => {
  assert.equal(skyboundTrialStatus(character()).held, false);
  const held = skyboundTrialStatus(character({ spiritCore: 9999 }));
  assert.equal(held.held, true);
  assert.equal(held.overStored, true);
  assert.equal(skyboundTrialStatus(character({ spiritCore: 9999, exp: { available: 1000 } })).overStored, false);
  assert.equal(skyboundTrialStatus(character({ spiritCore: 9999, skyboundTrial: true })).held, false);
});

test("every EXP route is gated: _preUpdate, spendExp, and the class unlock prompt", () => {
  const actor = readFileSync("module/documents/actor.mjs", "utf8");
  const preUpdate = actor.slice(actor.indexOf("async _preUpdate("));
  assert.match(preUpdate.slice(0, 900), /skyboundTrialViolation\(this\.system, changes\)/);
  const spend = actor.slice(actor.indexOf("async spendExp("));
  assert.ok(spend.indexOf("skyboundTrialBlocksSpend") < spend.indexOf('this.update({ "system.exp.spent"'));

  const sheet = readFileSync("module/sheets/actor-sheet.mjs", "utf8");
  const unlock = sheet.slice(sheet.indexOf("LYRIAN.Progression.UnlockCost"));
  assert.ok(unlock.indexOf("skyboundTrialBlocksSpend") < unlock.indexOf("LYRIAN.Progression.UnlockTitle"),
    "the hold must be checked before the unlock is confirmed and the class kept");
});
