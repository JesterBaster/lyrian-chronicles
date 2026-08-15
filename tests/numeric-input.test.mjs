import assert from "node:assert/strict";
import test from "node:test";

import {
  nonNegativeInteger,
  normalizeResourceCosts,
  positiveInteger
} from "../module/rules/numeric-input.mjs";

test("non-negative rules amounts reject malformed and fractional input", () => {
  assert.equal(nonNegativeInteger(0), 0);
  assert.equal(nonNegativeInteger("3"), 3);
  assert.equal(nonNegativeInteger(-1), null);
  assert.equal(nonNegativeInteger(1.5), null);
  assert.equal(nonNegativeInteger(Number.NaN), null);
  assert.equal(nonNegativeInteger(Number.POSITIVE_INFINITY), null);
});

test("positive rules amounts reject zero and negative values", () => {
  assert.equal(positiveInteger(1), 1);
  assert.equal(positiveInteger("25"), 25);
  assert.equal(positiveInteger(0), null);
  assert.equal(positiveInteger(-25), null);
});

test("resource costs are normalized together or rejected together", () => {
  assert.deepEqual(normalizeResourceCosts({ ap: "2", rp: 1, mana: 0 }), {
    ap: 2,
    rp: 1,
    mana: 0
  });
  assert.equal(normalizeResourceCosts({ ap: -1 }), null);
  assert.equal(normalizeResourceCosts({ mana: 0.5 }), null);
});
