import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildCraftPayload } from "../module/rules/crafting.mjs";
import { actorActionFingerprint } from "../module/rules/action-transactions.mjs";

const SHEET = readFileSync(new URL("../module/sheets/actor-sheet.mjs", import.meta.url), "utf8");
const TEMPLATE = readFileSync(
  new URL("../templates/actor/tab-crafting.hbs", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../styles/lyrian.css", import.meta.url), "utf8");

/* -------------------------------------------- */
/*  Settling a craft carries no roll             */
/* -------------------------------------------- */

test("the payload survives being built without a roll", () => {
  // The craft ends after the dice were already rolled by the actions that led
  // there, so the resolve step has no roll of its own. Reading roll.total
  // would have thrown at the end of every single craft.
  const project = {
    name: "Bow", skill: "carpentry", requiredPoints: 30, points: 30,
    outputUuid: "", outputName: "", attempts: 1
  };
  const payload = buildCraftPayload({
    actorUuid: "Actor.1", projectIndex: 0, project, skillLabel: "Carpentry",
    success: true, materials: [], consumed: true,
    status: { points: 30, required: 30, succeeds: true }
  });

  assert.equal(payload.roll, null, "null, not a fabricated zero a consumer would trust");
  assert.equal(payload.points, 30);
  assert.equal(payload.requiredPoints, 30);
  assert.equal(payload.status.succeeds, true);
});

test("an action's payload still carries its roll", () => {
  const payload = buildCraftPayload({
    actorUuid: "Actor.1", projectIndex: 0,
    project: { name: "Bow", skill: "carpentry", requiredPoints: 30, points: 11, attempts: 0 },
    skillLabel: "Carpentry", roll: { total: 6, formula: "1d10" },
    success: false, materials: [], consumed: true
  });
  assert.deepEqual(payload.roll, { total: 6, formula: "1d10" });
});

/* -------------------------------------------- */
/*  The concurrency lock                         */
/* -------------------------------------------- */

test("the action fingerprint notices a craft advancing", () => {
  // It used to read project.dc, which no longer exists — so every project
  // hashed identically and two clients could interleave a craft unnoticed.
  const actor = (points, diceSpent) => ({
    system: {
      ap: { value: 4, max: 4, temp: 0 }, rp: { value: 2, max: 2, temp: 0 },
      mana: { value: 6, max: 6, temp: 0 }, hp: { value: 30, max: 30, temp: 0 },
      crafting: { projects: [{
        skill: "blacksmith", requiredPoints: 30, points, diceSpent, craftingDice: 4,
        installedMods: [], finished: false, materials: [], outputUuid: "",
        attempts: 0, completed: false
      }] }
    },
    items: []
  });

  assert.notEqual(actorActionFingerprint(actor(0, 0)), actorActionFingerprint(actor(11, 1)));
  assert.equal(actorActionFingerprint(actor(0, 0)), actorActionFingerprint(actor(0, 0)));
  assert.doesNotMatch(
    readFileSync(new URL("../module/rules/action-transactions.mjs", import.meta.url), "utf8"),
    /dc: Number\(project\.dc/);
});

/* -------------------------------------------- */
/*  What the sheet hands the template            */
/* -------------------------------------------- */

test("the session view is merged onto each project", () => {
  // Kept on the project rather than in a parallel array, so the template can
  // read one object per card without a lookup helper it would have to invent.
  assert.match(SHEET, /context\.craftingProjects = context\.craftingProjects\.map/);
  for (const field of ["status", "actions:", "pendingMods:"]) {
    assert.ok(SHEET.includes(field), `the view is missing ${field}`);
  }
  // A refused action explains itself instead of being a button that does nothing.
  assert.match(SHEET, /LYRIAN\.Craft\.Refused\.\$\{action\.reason\}/);
});

test("only unfitted, still-owned mods are offered", () => {
  const start = SHEET.indexOf("pendingMods:");
  const block = SHEET.slice(start, start + 700);
  assert.match(block, /\.filter\(\(mod\) => mod && !fitted\.has\(mod\.id\)\)/);
  assert.match(block, /affordable: status\.points >= cost && !status\.finished/);
});

test("the editor reads the new fields and keeps the live session", () => {
  const start = SHEET.indexOf("_readCraftingProjects() {");
  const reader = SHEET.slice(start, SHEET.indexOf("\n  /*", start));
  assert.match(reader, /data-project-required/);
  assert.match(reader, /data-project-dice/);
  assert.doesNotMatch(reader, /data-project-dc/);
  // Everything not read from the DOM rides on the spread, which is the only
  // reason an in-progress craft survives an edit to the project's name.
  assert.match(reader, /\.\.\.current,/);
});

/* -------------------------------------------- */
/*  The tab                                      */
/* -------------------------------------------- */

test("the tab offers the actions and shows where the craft stands", () => {
  assert.match(TEMPLATE, /data-action="craftAction"[\s\S]{0,120}data-craft-action="\{\{action\.key\}\}"/);
  assert.match(TEMPLATE, /data-action="installCraftMod"/);
  assert.match(TEMPLATE, /data-action="endCraft"/);
  assert.match(TEMPLATE, /\{\{project\.status\.finalPoints\}\}/);
  assert.doesNotMatch(TEMPLATE, /data-action="attemptCraft"/);

  // The rework added a third field to a row built for two, and inputs carry an
  // intrinsic width of about 180px — together that overflowed the sheet.
  assert.match(CSS, /\.lyrian \.lyr-craft-project input,\s*\n\.lyrian \.lyr-craft-project select \{ width: 100%; min-width: 0; \}/);
  assert.match(CSS, /\.lyr-craft-project__check \{[\s\S]{0,200}flex-wrap: wrap/);
});

test("the migration carries the old DC across as the new target", () => {
  const migration = readFileSync(
    new URL("../migrations/0.6.32.mjs", import.meta.url), "utf8");
  assert.match(migration, /next\.requiredPoints = typeof project\.dc === "number" \? project\.dc : 30/);
  assert.match(migration, /delete next\.dc/);
  // A project already finished must not reopen as a fresh craft.
  assert.match(migration, /next\.finished = Boolean\(project\.completed\)/);

  const versions = readFileSync(new URL("../migrations/migrate.mjs", import.meta.url), "utf8");
  assert.match(versions, /"0\.6\.32"/);
});
