import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  MAX_PER_TYPE,
  expandAttackPlan,
  multiAttackCost,
  normalizeAttackCounts,
  totalAttacks
} from "../module/rules/multi-attack.mjs";

const attackTypes = {
  light: { ap: 1 },
  heavy: { ap: 2 },
  precise: { ap: 2 }
};

test("a plan keeps only the types actually asked for", () => {
  assert.deepEqual(
    normalizeAttackCounts({ light: 2, heavy: 0, precise: 1 }, attackTypes),
    [{ type: "light", count: 2 }, { type: "precise", count: 1 }]
  );
});

test("nonsense counts are discarded rather than guessed at", () => {
  assert.deepEqual(normalizeAttackCounts({}, attackTypes), []);
  assert.deepEqual(normalizeAttackCounts({ light: -3 }, attackTypes), []);
  assert.deepEqual(normalizeAttackCounts({ light: "many" }, attackTypes), []);
  assert.deepEqual(normalizeAttackCounts({ light: Infinity }, attackTypes), []);
  // A type the system does not define is not an attack.
  assert.deepEqual(normalizeAttackCounts({ wild: 5 }, attackTypes), []);
});

test("fractional counts round down to whole swings", () => {
  assert.deepEqual(normalizeAttackCounts({ light: 2.9 }, attackTypes), [
    { type: "light", count: 2 }
  ]);
});

test("counts are capped so a free attack cannot flood chat", () => {
  // AP normally bounds this well below the cap, but free attacks skip payment.
  assert.deepEqual(normalizeAttackCounts({ light: 5000 }, attackTypes), [
    { type: "light", count: MAX_PER_TYPE }
  ]);
});

test("cost is the sum of every swing, not of each type once", () => {
  const plan = normalizeAttackCounts({ light: 2, heavy: 1 }, attackTypes);
  assert.equal(multiAttackCost(plan, attackTypes), 4);
  assert.equal(totalAttacks(plan), 3);
});

test("an empty plan costs nothing", () => {
  assert.equal(multiAttackCost([], attackTypes), 0);
  assert.equal(totalAttacks([]), 0);
  assert.deepEqual(expandAttackPlan([]), []);
});

test("a plan expands to one entry per swing, grouped by type", () => {
  const plan = normalizeAttackCounts({ light: 2, precise: 1 }, attackTypes);
  assert.deepEqual(expandAttackPlan(plan), ["light", "light", "precise"]);
});

test("the whole cost is charged once, before any swing resolves", () => {
  const source = readFileSync("module/documents/actor.mjs", "utf8");
  const body = source.slice(source.indexOf("async _rollMultiAttack"));
  const paid = body.indexOf("spendResources");
  const swing = body.indexOf("_rollWeaponAttack");
  assert.ok(paid > 0 && swing > 0);
  assert.ok(paid < swing, "AP must be paid before the first attack resolves");
  // Otherwise a sequence could pay for two swings and fail to afford the third.
  assert.match(body, /if \(!free && cost > 0\)/);
});

test("the sequence holds one lock and takes none per swing", () => {
  const source = readFileSync("module/documents/actor.mjs", "utf8");
  const body = source.slice(
    source.indexOf("async _rollMultiAttack"),
    source.indexOf("async rollUniversalAttack")
  );
  // The per-attack entry points take the same lock, so calling them here would
  // refuse every swing after the first.
  assert.ok(!/rollAttack\(/.test(body), "must not call the locked weapon entry point");
  assert.match(body, /weapon\._rollWeaponAttack\(attackType, \{ free: true \}\)/);
  assert.match(body, /this\._rollUniversalAttack\(attackType, \{ free: true \}\)/);
});

test("both armed and unarmed rows offer the action", () => {
  const template = readFileSync("templates/actor/tab-main.hbs", "utf8");
  assert.equal((template.match(/data-action="multiAttack"/g) ?? []).length, 2);
});
