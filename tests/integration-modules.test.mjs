import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { movementRanges } from "../module/integrations/drag-ruler.mjs";
import { LYRIAN_COLORSET } from "../module/integrations/dice-so-nice.mjs";
import { attackerTokenUuid } from "../module/rules/attack-card.mjs";

const LYRIAN_MJS = readFileSync(new URL("../module/lyrian.mjs", import.meta.url), "utf8");
const INDEX = readFileSync(
  new URL("../module/integrations/index.mjs", import.meta.url), "utf8");
const DRAG_RULER = readFileSync(
  new URL("../module/integrations/drag-ruler.mjs", import.meta.url), "utf8");
const LANG = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));

/* -------------------------------------------- */
/*  Drag Ruler                                   */
/* -------------------------------------------- */

test("movement bands are what the remaining AP actually buys", () => {
  // Movement is bought a move at a time out of the AP that also pays for
  // attacks, so the bands are one move and everything still affordable.
  assert.deepEqual(movementRanges({ speed: 20, ap: 4 }), [
    { range: 20, color: "move" },
    { range: 80, color: "sprint" }
  ]);

  // One AP left is one move, and no second band to imply otherwise.
  assert.deepEqual(movementRanges({ speed: 20, ap: 1 }), [{ range: 20, color: "move" }]);
});

test("a token with no AP is drawn as unable to move", () => {
  // Drag Ruler reads an empty range list as "no limit", so an out-of-AP token
  // would be shown free to run anywhere. A zero band says what is true.
  assert.deepEqual(movementRanges({ speed: 20, ap: 0 }), [{ range: 0, color: "spent" }]);
  assert.deepEqual(movementRanges({ speed: 0, ap: 4 }), [{ range: 0, color: "spent" }]);
  assert.deepEqual(movementRanges(), [{ range: 0, color: "spent" }]);
});

test("a flier or swimmer is measured by the speed it would use", () => {
  // Holding a flier to its walking speed would paint a move it can legally
  // make as overreaching.
  assert.deepEqual(movementRanges({ speed: 20, fly: 40, ap: 2 }), [
    { range: 40, color: "move" },
    { range: 80, color: "sprint" }
  ]);
  assert.deepEqual(movementRanges({ speed: 30, swim: 15, ap: 1 }), [
    { range: 30, color: "move" }
  ], "a slower swim speed never reduces the walk");
});

test("nonsense input yields a refusal, not NaN bands", () => {
  for (const bad of [{ speed: "fast", ap: 4 }, { speed: 20, ap: -3 }, { speed: -20, ap: 2 }]) {
    const ranges = movementRanges(bad);
    for (const band of ranges) {
      assert.ok(Number.isFinite(band.range), `${JSON.stringify(bad)} produced ${band.range}`);
      assert.ok(band.range >= 0);
    }
  }
});

test("the speed provider registers as a system, not as a module", () => {
  // registerModule is for companion packages and would make Drag Ruler look
  // for a module id that does not exist.
  assert.match(DRAG_RULER, /dragRuler\.registerSystem\(SYSTEM_ID, LyrianSpeedProvider\)/);
  assert.match(DRAG_RULER, /Hooks\.once\("dragRuler\.ready"/);
  // Every colour the provider returns must be declared, or Drag Ruler throws
  // when it tries to look one up.
  const declared = [...DRAG_RULER.matchAll(/\{ id: "(\w+)", default: 0x/g)].map((m) => m[1]);
  const used = new Set([...DRAG_RULER.matchAll(/color: "(\w+)"/g)].map((m) => m[1]));
  for (const colour of used) assert.ok(declared.includes(colour), `${colour} is used but not declared`);
});

/* -------------------------------------------- */
/*  Dice So Nice!                                */
/* -------------------------------------------- */

test("the colourway is a shape Dice So Nice accepts", () => {
  for (const key of ["name", "description", "category", "foreground", "background"]) {
    assert.ok(LYRIAN_COLORSET[key], `a colorset needs ${key}`);
  }
  for (const key of ["foreground", "background", "outline", "edge"]) {
    assert.match(LYRIAN_COLORSET[key], /^#[0-9a-f]{6}$/i, `${key} must be a hex colour`);
  }
});

test("blocking a crit shows the dice that decided the damage", () => {
  // The re-roll was evaluated and thrown away: nobody saw it, and a 3D dice
  // module had no roll on the message to animate.
  const start = LYRIAN_MJS.indexOf("const claimedDamage");
  const block = LYRIAN_MJS.slice(start, LYRIAN_MJS.indexOf("return { resolved: true };", start));
  assert.ok(start >= 0, "the defence resolution moved");

  assert.match(block, /let blockRoll = null;/);
  assert.doesNotMatch(block, /\(await new Roll\([^)]*\)\.evaluate\(\)\)\.total/,
    "the roll must be kept, not consumed inline");
  assert.match(block, /rolls: blockRoll \? \[blockRoll\] : \[\]/);
});

/* -------------------------------------------- */
/*  Sequencer                                    */
/* -------------------------------------------- */

test("an attack says which token swung, not just which actor", () => {
  // An effect is drawn between two points on the canvas. A linked actor with
  // three tokens on the board cannot name one from the actor alone.
  const unlinked = { token: { uuid: "Scene.s1.Token.t9" }, getActiveTokens: () => [] };
  assert.equal(attackerTokenUuid(unlinked), "Scene.s1.Token.t9",
    "a token's own actor knows its token directly");

  const linked = { getActiveTokens: () => [{ uuid: "Scene.s1.Token.t1" }] };
  assert.equal(attackerTokenUuid(linked), "Scene.s1.Token.t1");

  // Two copies on the board is a genuine ambiguity; guessing would put the
  // effect on the wrong one.
  const twins = { getActiveTokens: () => [{ uuid: "a" }, { uuid: "b" }] };
  assert.equal(attackerTokenUuid(twins), null);

  assert.equal(attackerTokenUuid(null), null);
  assert.equal(attackerTokenUuid({}), null, "an actor off the canvas has no token");
});

/* -------------------------------------------- */
/*  Wiring                                       */
/* -------------------------------------------- */

test("registration is inert without the modules installed", () => {
  // Every integration waits on a hook only its own module fires. Nothing may
  // touch a global at import time, or a table with none of them installed
  // pays for all of them.
  for (const file of ["token-action-hud", "drag-ruler", "dice-so-nice"]) {
    const source = readFileSync(
      new URL(`../module/integrations/${file}.mjs`, import.meta.url), "utf8");
    const body = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
    const registration = body.slice(body.indexOf("export function register"));
    assert.match(registration, /Hooks\.once\(/, `${file} must wait on a hook`);
  }

  assert.match(INDEX, /registerTokenActionHud\(\);/);
  assert.match(INDEX, /registerDragRuler\(\);/);
  assert.match(INDEX, /registerDiceSoNice\(\);/);
  assert.match(LYRIAN_MJS, /registerIntegrations\(\);/);
});

test("every string these integrations reach for exists", () => {
  const sources = ["token-action-hud", "drag-ruler", "dice-so-nice"].map((file) =>
    readFileSync(new URL(`../module/integrations/${file}.mjs`, import.meta.url), "utf8"));

  const keys = new Set();
  for (const source of sources) {
    for (const match of source.matchAll(/"(LYRIAN\.[A-Za-z0-9_.]+)"/g)) keys.add(match[1]);
    // Template-built keys: LYRIAN.TAH.ActionType.${actionType}
    for (const match of source.matchAll(/`(LYRIAN\.[A-Za-z0-9_.]*)\$\{/g)) {
      const prefix = match[1];
      assert.ok(
        Object.keys(LANG).some((key) => key.startsWith(prefix)),
        `nothing in the language file starts with ${prefix}`
      );
    }
  }
  for (const key of keys) assert.ok(key in LANG, `missing language key ${key}`);
});
