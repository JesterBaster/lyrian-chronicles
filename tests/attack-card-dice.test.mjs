import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const card = readFileSync("module/rules/attack-card.mjs", "utf8");
const template = readFileSync("templates/chat/attack-card.hbs", "utf8");

test("attack cards carry the dice breakdown for both rolls", () => {
  assert.match(card, /attackTooltip: await attackRoll\?\.getTooltip\(\)/);
  assert.match(card, /damageTooltip: isCrit \? "" : await damageRoll\?\.getTooltip\(\)/);
});

test("a maximised critical shows no breakdown", () => {
  // evaluate({ maximize: true }) never consults the dice, so rendering faces
  // for a crit would show numbers that were not rolled.
  const line = card.split("\n").find((row) => row.includes("damageTooltip:"));
  assert.ok(line.includes('isCrit ? ""'), "crit damage must not claim a rolled breakdown");
});

test("the card only renders a breakdown it actually has", () => {
  // An empty tooltip must not leave an expandable control that opens on nothing.
  assert.match(template, /\{\{#if attackTooltip\}\}/);
  assert.match(template, /\{\{#if damageTooltip\}\}/);
  assert.match(template, /\{\{\{attackTooltip\}\}\}/);
  assert.match(template, /\{\{\{damageTooltip\}\}\}/);
});

test("both rolls stay attached to the message so dice modules still fire", () => {
  // The breakdown is presentation; Dice So Nice and friends read message.rolls.
  assert.match(card, /rolls: \[attackRoll, damageRoll\]\.filter\(Boolean\)/);
});

test("universal attacks roll damage dice rather than a flat value", async () => {
  const { universalAttackProfile } = await import("../module/rules/universal-attack.mjs");
  const attackTypes = {
    light: { ap: 1, accuracy: "focus", damage: "2d4", powerMultiplier: 1 }
  };

  const proficient = universalAttackProfile({
    attackType: "light", attackTypes, power: 3, standardAccuracy: 2
  });
  assert.match(proficient.damageFormula, /\dd\d/, "expected dice in the formula");
  assert.equal(proficient.damageFormula, "2d4 + 3");

  // Unarmed without proficiency is a flat 1 by the rulebook, not an oversight.
  const untrained = universalAttackProfile({
    attackType: "light", attackTypes, power: 3, standardAccuracy: 2, unarmedProficient: false
  });
  assert.equal(untrained.damageFormula, "1");
});
