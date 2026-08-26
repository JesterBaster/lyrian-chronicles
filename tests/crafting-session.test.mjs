import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CRAFT_ACTIONS,
  applyCraftAction,
  canUseCraftAction,
  craftActionOptions,
  craftStatus,
  diceRemaining,
  installCraftMod,
  newCraftSession
} from "../module/rules/crafting-session.mjs";

/* -------------------------------------------- */
/*  The rulebook's own worked example            */
/* -------------------------------------------- */

test("John Carpenter's bow comes out exactly as the guide says", () => {
  // "John Carpenter wants to craft a Bow (Two-Handed). He has a +5 bonus to
  // his carpentry and he needs to get a minimum of 30 crafting points."
  let session = newCraftSession({ requiredPoints: 30, craftingDice: 10 });
  const basic = (die) => {
    const result = applyCraftAction(session, "basicCraft", { dieTotal: die, skillBonus: 5 });
    session = result.session;
    return session.points;
  };

  assert.equal(basic(6), 11, "rolls a 6, is now at 11");
  assert.equal(basic(7), 23, "rolls a 7, total 23");
  assert.equal(basic(4), 32, "rolls a 4, total 32");
  assert.equal(craftStatus(session).succeeds, true, "32 already clears the bow's 30");
  assert.equal(basic(3), 40, "rolls a 3, total 40");

  // "he uses Steady Craft to guarantee a 5 roll for 10 points added"
  session = applyCraftAction(session, "steadyCraft", { skillBonus: 5 }).session;
  assert.equal(session.points, 50);

  // "Carpenter's Modification A to add Recurve to his bow, leaving him with 30"
  const installed = installCraftMod(session, { itemId: "recurve", name: "Recurve A", cost: 20 });
  assert.equal(installed.refused, "");
  session = installed.session;
  assert.equal(session.points, 30, "50 less the mod's 20");

  // "30 points is enough to complete the item and John crafts a recurve bow."
  const status = craftStatus(session);
  assert.equal(status.succeeds, true);
  assert.equal(status.shortfall, 0);
  assert.deepEqual(session.installedMods.map((mod) => mod.name), ["Recurve A"]);
});

/* -------------------------------------------- */
/*  The actions                                  */
/* -------------------------------------------- */

test("only Basic Craft may be repeated", () => {
  // "you may only use each ability once during a craft unless it has the
  // Rapid keyword" — and Basic Craft is the only Rapid one.
  assert.equal(CRAFT_ACTIONS.basicCraft.rapid, true);
  for (const key of ["beginnersLuck", "steadyCraft", "standardFinish"]) {
    assert.equal(CRAFT_ACTIONS[key].rapid, false, key);
  }

  let session = newCraftSession({ requiredPoints: 10, craftingDice: 6 });
  session = applyCraftAction(session, "basicCraft", { dieTotal: 3 }).session;
  assert.equal(canUseCraftAction(session, "basicCraft").ok, true, "Rapid, so again");

  session = applyCraftAction(session, "steadyCraft", { skillBonus: 0 }).session;
  assert.deepEqual(canUseCraftAction(session, "steadyCraft"), { ok: false, reason: "used" });
});

test("Beginners Luck drops the skill bonus", () => {
  // "You do not add your crafting skill to the check."
  const session = newCraftSession({ requiredPoints: 30, craftingDice: 4 });
  const result = applyCraftAction(session, "beginnersLuck", { dieTotal: 9, skillBonus: 5 });
  assert.equal(result.added, 9, "the 5 must not be added");
  assert.equal(result.session.points, 9);
  assert.equal(CRAFT_ACTIONS.beginnersLuck.formula, "2d10kh", "two d10s, keep the highest");
});

test("Steady Craft ignores the die it is handed", () => {
  const session = newCraftSession({ requiredPoints: 30, craftingDice: 4 });
  // A 5 regardless — a caller passing a rolled value must not change it.
  const result = applyCraftAction(session, "steadyCraft", { dieTotal: 10, skillBonus: 3 });
  assert.equal(result.added, 8, "the fixed 5 plus the skill bonus");
});

test("Standard Finish doubles and ends", () => {
  let session = newCraftSession({ requiredPoints: 40, craftingDice: 5 });
  session = applyCraftAction(session, "basicCraft", { dieTotal: 8, skillBonus: 4 }).session;
  assert.equal(session.points, 12);

  const result = applyCraftAction(session, "standardFinish", {});
  assert.equal(result.doubled, true);
  assert.equal(result.session.points, 24);
  assert.equal(result.session.finished, true, "it ends the craft");
  assert.equal(result.session.diceSpent, 3, "one for the basic craft, two for the finish");
});

test("Standard Finish is refused once a Mod is on the item", () => {
  // "Cannot be used if the item being crafted has been modified beyond its
  // base form."
  let session = newCraftSession({ requiredPoints: 10, craftingDice: 6 });
  session = applyCraftAction(session, "basicCraft", { dieTotal: 9, skillBonus: 6 }).session;
  session = installCraftMod(session, { itemId: "m", name: "Mod", cost: 5 }).session;
  assert.deepEqual(canUseCraftAction(session, "standardFinish"), { ok: false, reason: "modified" });

  const refused = applyCraftAction(session, "standardFinish", {});
  assert.equal(refused.refused, "modified");
  assert.equal(refused.session.points, session.points, "nothing changed");
});

/* -------------------------------------------- */
/*  The dice budget                              */
/* -------------------------------------------- */

test("an action costing more dice than remain is refused", () => {
  let session = newCraftSession({ requiredPoints: 10, craftingDice: 3 });
  session = applyCraftAction(session, "basicCraft", { dieTotal: 1 }).session;
  session = applyCraftAction(session, "basicCraft", { dieTotal: 1 }).session;
  assert.equal(diceRemaining(session), 1);
  // Standard Finish costs two.
  assert.deepEqual(canUseCraftAction(session, "standardFinish"), { ok: false, reason: "dice" });
  assert.equal(canUseCraftAction(session, "basicCraft").ok, true);
});

test("running out of dice ends the craft", () => {
  let session = newCraftSession({ requiredPoints: 50, craftingDice: 2 });
  session = applyCraftAction(session, "basicCraft", { dieTotal: 4 }).session;
  assert.equal(session.finished, false);
  session = applyCraftAction(session, "basicCraft", { dieTotal: 4 }).session;
  assert.equal(session.finished, true, "no dice left, so there is nothing left to perform");
  assert.deepEqual(canUseCraftAction(session, "basicCraft"), { ok: false, reason: "finished" });
});

test("a finished craft short of its target has failed", () => {
  let session = newCraftSession({ requiredPoints: 50, craftingDice: 1 });
  session = applyCraftAction(session, "basicCraft", { dieTotal: 4, skillBonus: 2 }).session;
  const status = craftStatus(session);
  assert.equal(status.finished, true);
  assert.equal(status.succeeds, false);
  assert.equal(status.shortfall, 44);
  assert.equal(status.canAct, false);
});

/* -------------------------------------------- */
/*  Mods                                         */
/* -------------------------------------------- */

test("a Mod cannot be afforded twice, or on credit", () => {
  let session = newCraftSession({ requiredPoints: 10, craftingDice: 8 });
  session = applyCraftAction(session, "basicCraft", { dieTotal: 10, skillBonus: 5 }).session;
  assert.equal(session.points, 15);

  assert.equal(installCraftMod(session, { itemId: "a", cost: 40 }).refused, "points");
  assert.equal(installCraftMod(session, { itemId: "a", cost: 40 }).session.points, 15,
    "a refusal spends nothing");

  session = installCraftMod(session, { itemId: "a", name: "A", cost: 5 }).session;
  assert.equal(session.points, 10);
  assert.equal(installCraftMod(session, { itemId: "a", name: "A", cost: 5 }).refused, "duplicate");
});

test("nothing may be done after the craft has ended", () => {
  let session = newCraftSession({ requiredPoints: 5, craftingDice: 4 });
  session = applyCraftAction(session, "basicCraft", { dieTotal: 9 }).session;
  session = applyCraftAction(session, "standardFinish", {}).session;
  assert.equal(applyCraftAction(session, "basicCraft", { dieTotal: 9 }).refused, "finished");
  assert.equal(installCraftMod(session, { itemId: "x", cost: 1 }).refused, "finished");
});

/* -------------------------------------------- */
/*  What the sheet renders                       */
/* -------------------------------------------- */

test("every action is offered with a reason when it cannot be taken", () => {
  const session = newCraftSession({ requiredPoints: 10, craftingDice: 1 });
  const options = craftActionOptions(session);
  assert.deepEqual(options.map((option) => option.key),
    ["basicCraft", "beginnersLuck", "steadyCraft", "standardFinish"]);

  const finish = options.find((option) => option.key === "standardFinish");
  assert.equal(finish.available, false);
  assert.equal(finish.reason, "dice", "two dice needed, one left");
  assert.equal(options.find((option) => option.key === "basicCraft").available, true);
});

test("a new session starts empty and sanitises its inputs", () => {
  const session = newCraftSession({ requiredPoints: "30", craftingDice: 4.7 });
  assert.equal(session.requiredPoints, 30);
  assert.equal(session.craftingDice, 4);
  assert.deepEqual(
    { points: session.points, diceSpent: session.diceSpent, finished: session.finished },
    { points: 0, diceSpent: 0, finished: false }
  );

  const empty = newCraftSession();
  assert.equal(empty.requiredPoints, 0);
  assert.equal(craftStatus(empty).succeeds, true, "nothing required is trivially met");
});

/* -------------------------------------------- */
/*  A crafting tool's two bonuses                */
/* -------------------------------------------- */

test("a tool's crafting bonus rides on every crafting dice roll", () => {
  // "A crafting bonus gives you +1 (or +2) to each crafting dice roll."
  let session = newCraftSession({ requiredPoints: 30, craftingDice: 4, diceBonus: 2 });

  session = applyCraftAction(session, "basicCraft", { dieTotal: 6, skillBonus: 5 }).session;
  assert.equal(session.points, 13, "6 + 5 skill + 2 tool");

  // Steady Craft's die does not bounce, but it is still a crafting dice roll.
  session = applyCraftAction(session, "steadyCraft", { skillBonus: 5 }).session;
  assert.equal(session.points, 25, "5 fixed + 5 skill + 2 tool");

  // Beginner's Luck drops the skill, not the tool.
  session = applyCraftAction(session, "beginnersLuck", { dieTotal: 9, skillBonus: 5 }).session;
  assert.equal(session.points, 36, "9 + 2 tool, no skill");
});

test("Standard Finish gets no tool bonus, having no roll to put it on", () => {
  let session = newCraftSession({ requiredPoints: 30, craftingDice: 4, diceBonus: 2 });
  session = applyCraftAction(session, "basicCraft", { dieTotal: 6, skillBonus: 5 }).session;
  assert.equal(session.points, 13);

  const finish = applyCraftAction(session, "standardFinish", {});
  assert.equal(finish.session.points, 26, "doubled, and nothing else added");
});

test("a tool's finish bonus counts towards the target but is never spendable", () => {
  // "The finish bonus gives you a +5 (or +10) bonus once at the end of your
  // craft." It is guaranteed, so it counts in the projection — but a Mod is
  // paid for during the craft, out of points actually banked.
  let session = newCraftSession({ requiredPoints: 30, craftingDice: 4, finishBonus: 10 });
  session = applyCraftAction(session, "basicCraft", { dieTotal: 6, skillBonus: 5 }).session;
  session = applyCraftAction(session, "basicCraft", { dieTotal: 9, skillBonus: 5 }).session;
  assert.equal(session.points, 25);

  const status = craftStatus(session);
  assert.equal(status.points, 25, "banked");
  assert.equal(status.finalPoints, 35, "with the finish bonus that lands at the end");
  assert.equal(status.succeeds, true, "35 clears 30");
  assert.equal(status.surplus, 5);

  // 30 points of Mod cannot be bought out of 25 banked, whatever the finish
  // bonus will eventually add.
  assert.equal(installCraftMod(session, { itemId: "m", name: "Recurve", cost: 30 }).refused, "points");
  const fitted = installCraftMod(session, { itemId: "m", name: "Recurve", cost: 20 });
  assert.equal(fitted.session.points, 5);
  assert.equal(craftStatus(fitted.session).finalPoints, 15, "and now it is 15 short");
  assert.equal(craftStatus(fitted.session).succeeds, false);
});

test("a session with no tool behaves exactly as before", () => {
  const session = newCraftSession({ requiredPoints: 30, craftingDice: 4 });
  assert.equal(session.diceBonus, 0);
  assert.equal(session.finishBonus, 0);
  const status = craftStatus(session);
  assert.equal(status.finalPoints, status.points);
  assert.equal(status.finishBonus, 0);
});

test("an unknown action is refused rather than crashing", () => {
  const session = newCraftSession({ requiredPoints: 5, craftingDice: 3 });
  assert.deepEqual(canUseCraftAction(session, "sabotage"), { ok: false, reason: "unknown" });
  assert.equal(applyCraftAction(session, "sabotage", {}).refused, "unknown");
});

/* -------------------------------------------- */
/*  The rules this was built from                */
/* -------------------------------------------- */

test("the shipped crafting guide still describes this procedure", () => {
  // If the source content is ever regenerated with different rules, this
  // module is describing a game nobody is playing.
  const guide = readFileSync(new URL("../content/rules-setting-guide-01.json", import.meta.url), "utf8")
    + readFileSync(new URL("../content/crafting-guide-01.json", import.meta.url), "utf8");
  const text = guide.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ");
  for (const phrase of ["Basic Craft", "Beginners Luck", "Steady Craft", "Standard Finish"]) {
    assert.ok(text.includes(phrase), `the guide no longer mentions ${phrase}`);
  }
  assert.match(text, /crafting points does not equal the items crafting HP/);
});
