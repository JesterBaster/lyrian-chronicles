import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Crafting is a character-only ApplicationV2 part and tab", () => {
  const source = readFileSync(new URL("../module/sheets/actor-sheet.mjs", import.meta.url), "utf8");

  assert.match(source, /crafting: \{ template: .*tab-crafting\.hbs/);
  assert.match(source, /id: "crafting".*fa-solid fa-hammer/);
  assert.match(source, /delete parts\.crafting/);
  assert.match(source, /delete tabs\.crafting/);
  assert.doesNotMatch(source, /hasArtisanClass/);
});

test("Crafting registers every project action and preloads both templates", () => {
  const sheet = readFileSync(new URL("../module/sheets/actor-sheet.mjs", import.meta.url), "utf8");
  const bootstrap = readFileSync(new URL("../module/lyrian.mjs", import.meta.url), "utf8");

  for (const action of [
    "addProject", "removeProject", "addProjectMaterial", "removeProjectMaterial",
    "attemptCraft", "setProjectOutput"
  ]) {
    assert.match(sheet, new RegExp(`${action}: LyrianActorSheet\\.#on`));
  }
  assert.match(bootstrap, /"actor\/tab-crafting"/);
  assert.match(bootstrap, /"chat\/craft-card"/);
});

test("nested project fields avoid form names and preserve tab css state", () => {
  const template = readFileSync(new URL("../templates/actor/tab-crafting.hbs", import.meta.url), "utf8");

  assert.match(template, /class="tab lyr-tab \{\{tab\.cssClass\}\}"/);
  assert.match(template, /data-crafting-project/);
  assert.match(template, /data-crafting-field/);
  assert.doesNotMatch(template, /name="system\.crafting\.projects/);
  assert.match(template, /data-craft-output-drop/);
});

test("artisan and gathering editors exist only on Crafting", () => {
  const skills = readFileSync(new URL("../templates/actor/tab-skills.hbs", import.meta.url), "utf8");
  const crafting = readFileSync(new URL("../templates/actor/tab-crafting.hbs", import.meta.url), "utf8");

  assert.doesNotMatch(skills, /data-action="rollArtisan"/);
  assert.doesNotMatch(skills, /data-action="rollGathering"/);
  assert.doesNotMatch(skills, /name="system\.(artisan|gathering)\./);
  assert.match(crafting, /data-action="rollArtisan"/);
  assert.match(crafting, /data-action="rollGathering"/);
  assert.match(crafting, /name="system\.artisan\./);
  assert.match(crafting, /name="system\.gathering\./);
});
