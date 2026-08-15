import assert from "node:assert/strict";
import test from "node:test";

import { resolveDefence } from "../module/rules/defence-resolution.mjs";

test("no reaction preserves the original hit result", () => {
  assert.equal(resolveDefence({ originalHit: true }).hits, true);
  assert.equal(resolveDefence({ originalHit: false }).hits, false);
});

test("dodge costs 1 RP and checks Dodge Evasion", () => {
  assert.deepEqual(
    resolveDefence({ defence: "dodge", attackTotal: 18, dodgeEvasion: 20, originalHit: true }),
    { hits: false, rpCost: 1, reason: "dodged" }
  );
  assert.equal(resolveDefence({ defence: "dodge", attackTotal: 20, dodgeEvasion: 20 }).hits, true);
});

test("block costs 1 RP and makes the attack connect", () => {
  assert.deepEqual(
    resolveDefence({ defence: "block", originalHit: false }),
    { hits: true, rpCost: 1, reason: "blocked" }
  );
});

test("full cover cannot be bypassed by a reaction", () => {
  assert.equal(resolveDefence({ defence: "block", untargetable: true }).hits, false);
});
