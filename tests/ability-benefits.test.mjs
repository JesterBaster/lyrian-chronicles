import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { LYRIAN } from "../module/config.mjs";
import { verifiedPierce } from "../module/rules/attack-verification.mjs";
import { isCriticalHit } from "../module/rules/ability-attack.mjs";

const itemDocument = readFileSync("module/documents/item.mjs", "utf8");
const itemModel = readFileSync("module/data/item.mjs", "utf8");
const sheet = readFileSync("module/sheets/actor-sheet.mjs", "utf8");

/* Costs ------------------------------------------------------------------- */

test("an ability's three costs are all charged, in one payment", () => {
  const body = itemDocument.slice(itemDocument.indexOf("async _rollAbility"));
  const payment = body.slice(body.indexOf("spendResources"), body.indexOf("spendResources") + 200);
  for (const cost of ["ap: sys.apCost", "rp: sys.rpCost", "mana: sys.manaCost"]) {
    assert.ok(payment.includes(cost), `${cost} is not charged`);
  }
});

test("costs are paid before the ability resolves, and refusal stops it", () => {
  const body = itemDocument.slice(itemDocument.indexOf("async _rollAbility"));
  const paid = body.indexOf("spendResources");
  const rolled = body.indexOf("new Roll(");
  assert.ok(paid > 0 && rolled > 0 && paid < rolled, "an unaffordable ability must not roll");
  assert.match(body.slice(paid, paid + 260), /if \(!paid\) return abilityRefused\("payment"\)/);
});

/* Keywords ---------------------------------------------------------------- */

test("piercing keywords survive case and spacing differences", () => {
  // The roll stores them camelCase; verification normalizes before comparing,
  // so a hand-typed "Full Pierce" still has to line up with the rolled result.
  for (const spelling of ["fullPierce", "fullpierce", "Full Pierce", "FULL-PIERCE"]) {
    const pierce = verifiedPierce({ sourceKeywords: [spelling], attackType: "light" });
    assert.equal(pierce.fullPierce, true, `${spelling} was not recognised`);
  }
});

test("full pierce supersedes half pierce rather than stacking", () => {
  const both = verifiedPierce({
    sourceKeywords: ["halfPierce", "fullPierce"], attackType: "light"
  });
  assert.equal(both.fullPierce, true);
  assert.equal(both.halfPierce, false);
});

test("a critical grants half pierce without the keyword", () => {
  const crit = verifiedPierce({ sourceKeywords: [], attackType: "light", critical: true });
  assert.equal(crit.halfPierce, true);
});

test("pinpoint follows the attack type, not the keyword", () => {
  // Marking an ability Pinpoint does nothing on its own: the value comes from
  // a Precise attack profile. Worth knowing before relying on the keyword.
  const precise = verifiedPierce({ sourceKeywords: [], attackType: "precise", focus: 4 });
  const light = verifiedPierce({ sourceKeywords: ["pinpoint"], attackType: "light", focus: 4 });
  assert.equal(precise.pinpoint, 4);
  assert.equal(light.pinpoint, 0, "the keyword alone grants no pinpoint");
});

test("only the keywords with real machinery behind them are enforced", () => {
  const enforced = ["rapid", "secretArt", "sureHit", "halfPierce", "fullPierce"];
  for (const keyword of enforced) {
    const used = new RegExp(`has\\("${keyword}"\\)|has\\("${keyword.toLowerCase()}"\\)`, "i");
    assert.ok(
      used.test(itemDocument) || used.test(itemModel) ||
        used.test(readFileSync("module/rules/attack-verification.mjs", "utf8")),
      `${keyword} is declared as enforced but nothing reads it`
    );
  }
  // The rest are labels the table adjudicates. Listed so that adding machinery
  // for one is a deliberate change rather than a surprise.
  for (const label of ["lockOn", "trickAttack", "stealth", "downed"]) {
    assert.ok(label in LYRIAN.abilityKeywords);
  }
});

/* Use limits -------------------------------------------------------------- */

test("once per round is enforced, and Rapid is exempt", () => {
  const body = itemDocument.slice(itemDocument.indexOf("async _rollAbility"));
  assert.match(body, /enforceOncePerRound && sys\.usedThisRound && !sys\.isRapid/);
  assert.match(body, /if \(enforceOncePerRound && !sys\.isRapid\) updates\["system\.usedThisRound"\] = true/);
  assert.match(itemModel, /this\.isRapid = this\.keywords\?\.has\("rapid"\)/);
});

test("a Secret Art is spent for the whole encounter", () => {
  const body = itemDocument.slice(itemDocument.indexOf("async _rollAbility"));
  assert.match(body, /sys\.isSecretArt && actor\.system\.encounter\?\.secretArtUsed/);
  assert.match(body, /"system\.encounter\.secretArtUsed": true/);
  // Set by keyword or by timing, so either way of authoring one works.
  assert.match(itemModel, /has\("secretArt"\).*\|\|.*timing === "secretArt"/s);
});

test("a critical uses the weapon's own threshold, not a fixed 20", () => {
  assert.equal(isCriticalHit(20), true);
  assert.equal(isCriticalHit(19), false);
  assert.equal(isCriticalHit(19, 19), true, "a katana-style threshold must widen the range");
});

/* Boundaries -------------------------------------------------------------- */

test("upkeep is recorded but never charged", () => {
  // The field and its sheet input exist, so a GM can enter a per-turn cost
  // that nothing deducts. Recorded here so wiring it up is a deliberate change.
  assert.match(itemModel, /schema\.upkeep = int\(0/);
  const actor = readFileSync("module/documents/actor.mjs", "utf8");
  assert.ok(!/upkeep/.test(actor), "nothing in the actor spends upkeep");
  assert.ok(!/upkeep/.test(itemDocument), "nothing in ability use spends upkeep");
});

test("passive abilities grant nothing automatically", () => {
  // They are bucketed for display only; a passive reading "+2 Guard" does not
  // change Guard. Same boundary as mods and breakthroughs.
  assert.match(sheet, /timing === "passive"/);
  const actorModel = readFileSync("module/data/actor.mjs", "utf8");
  assert.ok(!/passive/.test(actorModel), "no passive feeds the derived totals");
});
