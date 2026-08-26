import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ACTOR = readFileSync(new URL("../module/documents/actor.mjs", import.meta.url), "utf8");
const SHEET = readFileSync(new URL("../module/sheets/actor-sheet.mjs", import.meta.url), "utf8");
const TEMPLATE = readFileSync(
  new URL("../templates/actor/tab-crafting.hbs", import.meta.url), "utf8");
const LANG = JSON.parse(
  readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));

/* -------------------------------------------- */
/*  A failed craft is not a dead project         */
/* -------------------------------------------- */

test("a finished project can be started again without being rebuilt", () => {
  // A craft that fell short loses its materials, not its blueprint. Without
  // this the row was inert once it ended and the only way to try again was to
  // delete the project and retype every field.
  const start = ACTOR.indexOf("async _restartCraft(projectIndex)");
  const restart = ACTOR.slice(start, ACTOR.indexOf("\n  /** End a craft", start));
  assert.ok(start >= 0, "the restart is missing");

  // Exactly the session is cleared, and nothing else: the plan is spread in
  // first and only these six keys are written over it.
  const written = restart.slice(restart.indexOf("projects[index] = {"));
  const literal = written.slice(0, written.indexOf("\n    };"));
  assert.match(literal, /\.\.\.project,/);
  assert.deepEqual(
    [...literal.matchAll(/^\s{6}(\w+):/gm)].map((match) => match[1]).sort(),
    ["completed", "diceSpent", "finished", "installedMods", "points", "usedActions"]
  );
  for (const cleared of ["points: 0", "diceSpent: 0", "usedActions: \\[\\]",
    "installedMods: \\[\\]", "finished: false", "completed: false"]) {
    assert.match(literal, new RegExp(cleared), `restart must reset ${cleared}`);
  }

  // A craft still running is not restartable — that would be a free reroll.
  assert.match(restart, /if \(!project\.finished && !project\.completed\)/);
  assert.match(restart, /LYRIAN\.Warn\.CraftNotFinished/);
});

test("the restart runs under the same lock as every other craft action", () => {
  const start = ACTOR.indexOf("async restartCraft(projectIndex)");
  const wrapper = ACTOR.slice(start, ACTOR.indexOf("\n  async _restartCraft", start));
  assert.match(wrapper, /requireActorActionPermission\(this\)/);
  assert.match(wrapper, /runExclusiveActorAction\(this, \(\) => this\._restartCraft/);
});

test("the tab offers the restart exactly when the craft has ended", () => {
  assert.match(TEMPLATE, /\{\{#if project\.status\.finished\}\}[\s\S]{0,400}data-action="restartCraft"/);
  // and the end button in the other branch, not both at once
  assert.match(TEMPLATE, /\{\{else\}\}[\s\S]{0,400}data-action="endCraft"/);
  assert.match(SHEET, /restartCraft: LyrianActorSheet\.#onRestartCraft/);
  assert.match(SHEET, /this\.document\.restartCraft\(Number\(target\.dataset\.projectIndex\)\)/);
});

/* -------------------------------------------- */
/*  One stack backs one craft                    */
/* -------------------------------------------- */

test("a Mod paid for by one project cannot be paid for by another", () => {
  const start = ACTOR.indexOf("async _installProjectMod(projectIndex, modItemId)");
  const install = ACTOR.slice(start, ACTOR.indexOf("\n  /** End a craft", start));

  assert.match(install, /const committedElsewhere = projects\.some\(\(other, row\) => row !== index/);
  assert.match(install, /LYRIAN\.Craft\.ModRefused\.committed/);
  // Refused before the points are taken, not after.
  assert.ok(
    install.indexOf("committedElsewhere") < install.indexOf("installCraftMod("),
    "the guard must come before the charge"
  );
});

test("the fit button hides a Mod another project has already paid for", () => {
  const start = SHEET.indexOf("const committed = new Map();");
  const block = SHEET.slice(start, SHEET.indexOf("context.craftingModOptions", start));
  assert.ok(start >= 0, "the committed-mod map is missing");
  assert.match(block, /committed\.has\(mod\.id\) && committed\.get\(mod\.id\) !== projectRow/);

  // The dropdown still lists it: a project's Mod row is a plan, not a payment,
  // and dropping it from the options would blank the select of the project
  // that committed it.
  const options = SHEET.slice(SHEET.indexOf("context.craftingModOptions"));
  assert.doesNotMatch(options.slice(0, 400), /committed\.has/);
});

test("points spent on a Mod that cannot be fitted are reported", () => {
  const start = ACTOR.indexOf("async _resolveCraft(projectIndex)");
  const resolve = ACTOR.slice(start, ACTOR.indexOf("\n  /** Post the result", start));
  assert.match(resolve, /paid\.length < \(project\.installedMods \?\? \[\]\)\.length/);
  assert.match(resolve, /LYRIAN\.Warn\.CraftModLost/);
});

test("every string these paths reach for exists", () => {
  for (const key of [
    "LYRIAN.Craft.Restart",
    "LYRIAN.Craft.Restarted",
    "LYRIAN.Hint.CraftRestart",
    "LYRIAN.Craft.ModRefused.committed",
    "LYRIAN.Warn.CraftNotFinished",
    "LYRIAN.Warn.CraftModLost"
  ]) {
    assert.ok(key in LANG, `missing lang key ${key}`);
  }
});
