import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildHealingPayload, normalizeHealingAmount } from "../module/rules/healing.mjs";

test("healing amounts clamp to whole, non-negative numbers", () => {
  assert.equal(normalizeHealingAmount(7), 7);
  assert.equal(normalizeHealingAmount("7"), 7);
  assert.equal(normalizeHealingAmount(7.9), 7);
  assert.equal(normalizeHealingAmount(0), 0);
  // A card's flags travel through the client, so a tampered or broken amount
  // must resolve to nothing rather than healing a negative or NaN value.
  assert.equal(normalizeHealingAmount(-5), 0);
  assert.equal(normalizeHealingAmount("lots"), 0);
  assert.equal(normalizeHealingAmount(undefined), 0);
  assert.equal(normalizeHealingAmount(Infinity), 0);
});

test("healing payload carries a stable shape", () => {
  const payload = buildHealingPayload({
    actorUuid: "Actor.abc",
    itemUuid: "Item.def",
    itemName: "Mend",
    roll: { total: 9, formula: "2d6 + 2" }
  });

  assert.deepEqual(payload, {
    actorUuid: "Actor.abc",
    itemUuid: "Item.def",
    itemName: "Mend",
    total: 9,
    formula: "2d6 + 2"
  });
});

test("healing payload tolerates a missing roll and missing ids", () => {
  assert.deepEqual(buildHealingPayload({}), {
    actorUuid: "",
    itemUuid: "",
    itemName: "",
    total: 0,
    formula: ""
  });
});

test("the ability schema exposes an optional healing payload", () => {
  const source = readFileSync("module/data/item.mjs", "utf8");
  assert.match(source, /schema\.hasHealing = new fields\.BooleanField/);
  assert.match(source, /schema\.healingFormula = new fields\.StringField/);
});

test("the healing card applies from flags, not from rendered markup", () => {
  const card = readFileSync("templates/chat/healing-card.hbs", "utf8");
  assert.match(card, /data-lyrian-action="applyHealing"/);

  const script = readFileSync("module/lyrian.mjs", "utf8");
  // The handler must read flags.healing rather than anything scraped off the DOM.
  assert.match(script, /applyHealingFromCard\(flags\.healing/);
  assert.match(script, /"chat\/healing-card"/);
});

test("healing is rolled independently of the attack payload", () => {
  const source = readFileSync("module/documents/item.mjs", "utf8");
  // A drain ability both hits and heals, so healing must not sit in the
  // early-return branch taken when an ability has no attack.
  const healingRoll = source.indexOf("const healingRoll =");
  const attackBranch = source.indexOf("if (!sys.hasAttack)");
  assert.ok(healingRoll > 0 && attackBranch > 0);
  assert.ok(healingRoll < attackBranch, "healing must be rolled before the no-attack branch");
});

test("EXP spending is announced through a setting, milestones unconditionally", () => {
  const source = readFileSync("module/documents/actor.mjs", "utf8");
  assert.match(source, /options\.announce\s*\n?\s*\?\?\s*game\.settings\.get\("lyrian-chronicles", "announceExpSpending"\)/);

  // Crossing a tier raises the skill rank cap, so that banner must not sit
  // behind the same switch as the routine per-advance message.
  const banner = source.indexOf("LYRIAN.Msg.TierReached");
  const gate = source.indexOf('game.settings.get("lyrian-chronicles", "announceExpSpending")');
  assert.ok(banner > 0 && gate > 0);
  assert.ok(banner < gate, "the tier banner must post before the announce gate");

  // Default on, so an existing world's chat behaviour is unchanged until a GM
  // opts out.
  const settings = readFileSync("module/lyrian.mjs", "utf8");
  const registration = settings.slice(settings.indexOf('"announceExpSpending"'));
  assert.match(registration.slice(0, registration.indexOf("});")), /default: true/);
});
