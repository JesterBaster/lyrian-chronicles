import assert from "node:assert/strict";
import test from "node:test";

import { buildAttackPayload } from "../module/rules/attack-card.mjs";

const attackRoll = { total: 17, formula: "1d20 + 4", dice: [{ total: 13 }] };
const damageRoll = { total: 9, formula: "2d4 + 4" };
const target = {
  uuid: "Actor.defender",
  tokenUuid: "Scene.test.Token.defender",
  name: "Defender",
  evasion: 12,
  dodgeEvasion: 16,
  guard: 4,
  blockGuard: 8,
  untargetable: false,
  hit: true
};

test("item attacks preserve the stable public payload", () => {
  const payload = buildAttackPayload({
    actor: { uuid: "Actor.attacker" },
    source: { uuid: "Actor.attacker.Item.weapon", name: "Sword", img: "sword.webp" },
    attackType: "light",
    damageType: "slashing",
    attackRoll,
    damageRoll,
    weaponGroup: "lightSword",
    ranged: false,
    targets: [target]
  });

  assert.equal(payload.itemUuid, "Actor.attacker.Item.weapon");
  assert.equal(payload.itemName, "Sword");
  assert.equal(payload.sourceKind, "item");
  assert.equal(payload.accuracy.natural, 13);
  assert.equal(payload.damage.total, 9);
  assert.deepEqual(payload.targets[0], {
    actorUuid: target.uuid,
    tokenUuid: target.tokenUuid,
    name: target.name,
    evasion: target.evasion,
    dodgeEvasion: target.dodgeEvasion,
    guard: target.guard,
    blockGuard: target.blockGuard,
    untargetable: false,
    hit: true
  });
});

test("monster profiles use the shared payload without pretending to be items", () => {
  const payload = buildAttackPayload({
    actor: { uuid: "Actor.monster" },
    source: { uuid: "Actor.monster", name: "Storm Beast", img: "storm.webp" },
    sourceKind: "monsterProfile",
    sourceProfile: "+4 Accuracy, 2d4+3",
    attackType: "light",
    attackRoll,
    damageRoll,
    targets: [target]
  });

  assert.equal(payload.itemUuid, null);
  assert.equal(payload.itemName, "Storm Beast");
  assert.equal(payload.sourceUuid, "Actor.monster");
  assert.equal(payload.sourceKind, "monsterProfile");
  assert.equal(payload.sourceProfile, "+4 Accuracy, 2d4+3");
  assert.equal(payload.damageType, "physical");
});
