import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import { LYRIAN } from "../module/config.mjs";

const ITEM_DOC = readFileSync(new URL("../module/documents/item.mjs", import.meta.url), "utf8");
const ITEM_DATA = readFileSync(new URL("../module/data/item.mjs", import.meta.url), "utf8");
const BUILD = readFileSync(new URL("../tools/build-compendiums.mjs", import.meta.url), "utf8");
const LANG = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));

const abilities = () => {
  const out = [];
  for (const file of readdirSync(new URL("../content/", import.meta.url))
    .filter((f) => /^(player|monster)-abilities/.test(f))) {
    out.push(...JSON.parse(readFileSync(new URL(`../content/${file}`, import.meta.url), "utf8")));
  }
  return out;
};

/* -------------------------------------------- */
/*  "-" is not a keyword                         */
/* -------------------------------------------- */

test("the rulebook's dash for \"no keywords\" is not carried as one", () => {
  // 45 abilities listed "-" where they have no keywords. Kept verbatim it
  // became a keyword of its own, shown as a chip on the sheet and listed on
  // the ability's chat card.
  const carrying = abilities().filter((doc) =>
    (doc.system.keywords ?? []).some((word) => /^[-–—]+$/.test(String(word))));
  assert.deepEqual(carrying.map((d) => d.name), []);

  // The original string is still kept, so nothing is lost.
  assert.match(BUILD, /rawKeywords: String\(data\.keywords \?\? ""\)/);
});

/* -------------------------------------------- */
/*  Dual Wield                                   */
/* -------------------------------------------- */

test("0.13.2's Dual Wield keyword reaches the code as a key, not a label", () => {
  // Only keywords the compiler normalises are automated; everything else is
  // passed through as display text and does nothing.
  assert.match(BUILD, /\["dualwield", "dualWield"\]/);
  assert.ok("dualWield" in LYRIAN.abilityKeywords, "the config must declare it");
  assert.ok(LANG[LYRIAN.abilityKeywords.dualWield], "and it needs a label");

  const tagged = abilities().filter((d) => (d.system.keywords ?? []).includes("dualWield"));
  assert.deepEqual(tagged.map((d) => d.name).sort(),
    ["Double Punch", "Fast Cartridge", "Infinite Punches"]);
  // No document may still carry the raw label, or it would be inert.
  assert.equal(abilities().filter((d) => (d.system.keywords ?? []).includes("Dual Wield")).length, 0);
});

test("the keyword derives a flag beside the other automated ones", () => {
  assert.match(ITEM_DATA, /this\.isDualWield = this\.keywords\?\.has\("dualWield"\) \?\? false;/);
});

test("an ability and the free off-hand swing share one allowance", () => {
  // "You cannot use this ability if you have already made a dual wield attack
  // this turn. After using it, you cannot make another dual wield attack this
  // turn." Both halves, or a player takes the ability and the swing.
  const start = ITEM_DOC.indexOf("async _rollAbility(options)");
  const body = ITEM_DOC.slice(start, ITEM_DOC.indexOf("\n    const healingRoll", start));
  assert.ok(start >= 0, "the ability path moved");

  assert.match(body, /sys\.isDualWield && actor\.system\.turn\?\.dualWieldUsed/);
  assert.match(body, /abilityRefused\("dual-wield-spent"\)/);
  assert.match(body, /"system\.turn\.dualWieldUsed": true/);
  assert.ok(LANG["LYRIAN.Warn.DualWieldSpent"], "the refusal needs a message");

  // The refusal comes before payment and the consumption after it, so a
  // refused ability neither charges the player nor burns the allowance.
  const refusal = body.indexOf('abilityRefused("dual-wield-spent")');
  const payment = body.indexOf("actor.spendResources");
  const consume = body.indexOf('"system.turn.dualWieldUsed": true');
  assert.ok(refusal < payment, "refuse before charging");
  assert.ok(payment < consume, "spend the allowance only once the use is real");
});

test("the weapon path still owns the swing, and reads the same flag", () => {
  // The two must agree on where the state lives, or each would let the other
  // through.
  assert.match(ITEM_DOC, /used: Boolean\(turn\.dualWieldUsed\)/);
  assert.match(ITEM_DOC, /"system\.turn\.dualWieldUsed": dualWield\.used/);
});
