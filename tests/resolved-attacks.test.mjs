import assert from "node:assert/strict";
import test from "node:test";

import { resolvedAttackFlagUpdate } from "../module/rules/resolved-attacks.mjs";

test("resolved attack updates explicitly delete the oldest merged flag keys", () => {
  const resolved = Object.fromEntries(Array.from({ length: 50 }, (_, index) => [
    `card-${index}`, { defence: "none", at: index }
  ]));
  const update = resolvedAttackFlagUpdate({
    systemId: "lyrian-chronicles",
    resolved,
    messageId: "new-card",
    value: { defence: "block", at: 100 },
    limit: 50
  });
  assert.deepEqual(update["flags.lyrian-chronicles.resolvedAttacks.new-card"], {
    defence: "block", at: 100
  });
  assert.equal(update["flags.lyrian-chronicles.resolvedAttacks.-=card-0"], null);
  assert.equal(Object.keys(update).length, 2);
});
