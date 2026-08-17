import assert from "node:assert/strict";
import test from "node:test";

import {
  boundedDamage,
  legitimateAttackProfile,
  verifiedPierce
} from "../module/rules/attack-verification.mjs";

test("bounded damage preserves honest claims at or below the ceiling", () => {
  assert.deepEqual(boundedDamage({ claimed: 7, ceiling: 12 }), { amount: 7, clamped: false });
  assert.deepEqual(boundedDamage({ claimed: 12, ceiling: 12 }), { amount: 12, clamped: false });
});

test("bounded damage collapses forged, negative, missing, and non-numeric claims", () => {
  assert.deepEqual(boundedDamage({ claimed: 99999, ceiling: 12 }), { amount: 12, clamped: true });
  assert.deepEqual(boundedDamage({ claimed: -10, ceiling: 12 }), { amount: 0, clamped: false });
  assert.deepEqual(boundedDamage({ claimed: "not-a-number", ceiling: 12 }), { amount: 0, clamped: false });
  assert.deepEqual(boundedDamage({ ceiling: 12 }), { amount: 0, clamped: false });
});

test("verified pierce comes from real keywords and the real precise profile", () => {
  const attackTypes = {
    light: { pinpoint: false },
    precise: { pinpoint: true }
  };
  assert.deepEqual(
    verifiedPierce({
      sourceKeywords: new Set(["halfPierce"]),
      attackType: "precise",
      focus: 5,
      attackTypes
    }),
    { pinpoint: 5, halfPierce: true, fullPierce: false }
  );
  assert.deepEqual(
    verifiedPierce({
      sourceKeywords: ["fullPierce", "halfPierce"],
      attackType: "light",
      focus: 5,
      attackTypes
    }),
    { pinpoint: 0, halfPierce: false, fullPierce: true }
  );
  assert.equal(verifiedPierce({ attackType: "light", attackTypes }).halfPierce, false);
  assert.equal(verifiedPierce({ attackType: "light", attackTypes, critical: true }).halfPierce, true);
});

test("forged chat damage is bounded by the resolved weapon's maximised formula", async () => {
  const actor = {
    uuid: "Actor.attacker",
    type: "character",
    system: {
      stats: { power: { total: 4 }, focus: { total: 3 } },
      accuracy: { standard: 7, precise: 10 },
      proficiencies: { unarmed: true }
    },
    getRollData: () => ({ power: 4 })
  };
  const source = {
    uuid: "Actor.attacker.Item.weapon",
    type: "weapon",
    actor,
    system: {
      keywords: new Set(),
      getDamageFormula: () => ({ formula: "2d4", flat: 4 })
    },
    getRollData: () => ({ power: 4 })
  };
  const documents = new Map([[actor.uuid, actor], [source.uuid, source]]);
  class FakeRoll {
    constructor(formula, data) {
      this.formula = formula;
      this.data = data;
      this.total = 0;
    }
    async evaluate({ maximize } = {}) {
      assert.equal(maximize, true);
      assert.equal(this.formula, "2d4 + 4");
      this.total = 12;
      return this;
    }
  }

  const profile = await legitimateAttackProfile({
    attack: {
      actorUuid: actor.uuid,
      sourceUuid: source.uuid,
      sourceKind: "item",
      attackType: "light",
      damage: { total: 99999 }
    },
    resolveUuid: async (uuid) => documents.get(uuid) ?? null,
    RollClass: FakeRoll
  });
  assert.equal(profile.ceiling, 12);
  assert.deepEqual(
    boundedDamage({ claimed: 99999, ceiling: profile.ceiling }),
    { amount: 12, clamped: true }
  );
});

test("unresolvable or mismatched attack sources are refused", async () => {
  class FakeRoll {}
  assert.equal(await legitimateAttackProfile({
    attack: { actorUuid: "Actor.missing", sourceUuid: "Item.fake", sourceKind: "item" },
    resolveUuid: async () => null,
    RollClass: FakeRoll
  }), null);
});
