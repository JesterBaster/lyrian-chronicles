import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Setup tab exposes the character creation wizard and is preloaded", () => {
  const template = readFileSync(new URL("../templates/actor/tab-setup.hbs", import.meta.url), "utf8");
  const bootstrap = readFileSync(new URL("../module/lyrian.mjs", import.meta.url), "utf8");

  assert.match(template, /data-tab="setup"/);
  assert.match(template, /data-action="openCharacterCreation"/);
  assert.match(template, /LYRIAN\.Setup\.Warning/);
  assert.match(bootstrap, /"actor\/tab-setup"/);
});

test("Setup is character-only and launches the public creation entrypoint", () => {
  const source = readFileSync(new URL("../module/sheets/actor-sheet.mjs", import.meta.url), "utf8");

  assert.match(source, /delete parts\.setup/);
  assert.match(source, /delete tabs\.setup/);
  assert.match(source, /game\.lyrian\.runCharacterCreation\(this\.document\)/);
  assert.match(source, /if \(!this\.document\.isOwner\)/);
});
