import assert from "node:assert/strict";
import test from "node:test";

import { adjustResourcePool } from "../module/rules/resource-utils.mjs";

test("a negative adjustment consumes temporary points first", () => {
  assert.deepEqual(
    adjustResourcePool({ value: 10, temp: 3 }, -2),
    { value: 10, temp: 1 }
  );
});

test("a negative adjustment spills from temporary into normal points", () => {
  assert.deepEqual(
    adjustResourcePool({ value: 10, temp: 2 }, -5),
    { value: 7, temp: 0 }
  );
});

test("mana, AP, and RP cannot fall below zero", () => {
  assert.deepEqual(
    adjustResourcePool({ value: 1, temp: 1 }, -5),
    { value: 0, temp: 0 }
  );
});

test("HP respects its negative maximum floor after temp HP is exhausted", () => {
  assert.deepEqual(
    adjustResourcePool({ value: -58, temp: 1 }, -5, { floor: -60 }),
    { value: -60, temp: 0 }
  );
});

test("a positive adjustment restores normal points and preserves temp", () => {
  assert.deepEqual(
    adjustResourcePool({ value: 4, temp: 3 }, 1),
    { value: 5, temp: 3 }
  );
});

test("invalid or zero adjustments leave the pool unchanged", () => {
  assert.deepEqual(
    adjustResourcePool({ value: 4, temp: 3 }, Number.NaN),
    { value: 4, temp: 3 }
  );
  assert.deepEqual(
    adjustResourcePool({ value: 4, temp: 3 }, 0),
    { value: 4, temp: 3 }
  );
});
