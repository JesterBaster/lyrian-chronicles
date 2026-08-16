import assert from "node:assert/strict";
import test from "node:test";

import {
  actorHeaderNeedsRefresh,
  isHeaderOnlyRender
} from "../module/rules/sheet-refresh.mjs";

test("resource changes request a live actor-header refresh", () => {
  assert.equal(actorHeaderNeedsRefresh({ system: { hp: { value: 12 } } }), true);
  assert.equal(actorHeaderNeedsRefresh({ system: { mana: { temp: 3 } } }), true);
  assert.equal(actorHeaderNeedsRefresh({ "system.ap.value": 2 }), true);
  assert.equal(actorHeaderNeedsRefresh({ "system.rp": { value: 1 } }), true);
});

test("unrelated actor changes do not interrupt an open form", () => {
  assert.equal(actorHeaderNeedsRefresh({ name: "New Name" }), false);
  assert.equal(actorHeaderNeedsRefresh({ system: { details: { age: "30" } } }), false);
  assert.equal(actorHeaderNeedsRefresh({}), false);
});

test("only a header-only partial render takes the lightweight context path", () => {
  assert.equal(isHeaderOnlyRender({ parts: ["header"] }), true);
  assert.equal(isHeaderOnlyRender({ parts: ["header", "main"] }), false);
  assert.equal(isHeaderOnlyRender({}), false);
});
