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

test("the Setup tab carries an export button wired to a registered action", () => {
  const template = readFileSync(new URL("../templates/actor/tab-setup.hbs", import.meta.url), "utf8");
  const source = readFileSync(new URL("../module/sheets/actor-sheet.mjs", import.meta.url), "utf8");

  assert.match(template, /data-action="exportCharacterSheet"/);
  assert.match(source, /exportCharacterSheet: LyrianActorSheet\.#onExportCharacterSheet/,
    "an unregistered data-action is a button that does nothing when clicked");

  // Export reads the actor and writes a file; it must not be behind the owner
  // gate that character creation needs, or a player looking at a party member's
  // sheet gets a dead button.
  const handler = source.slice(source.indexOf("#onExportCharacterSheet(event, target)"));
  assert.equal(/isOwner/.test(handler.slice(0, 1200)), false,
    "exporting changes nothing on the actor, so it needs no write permission");
});

test("the Setup tab carries an import button, and importing needs ownership", () => {
  const template = readFileSync(new URL("../templates/actor/tab-setup.hbs", import.meta.url), "utf8");
  const source = readFileSync(new URL("../module/sheets/actor-sheet.mjs", import.meta.url), "utf8");

  assert.match(template, /data-action="importCharacterSheet"/);
  assert.match(source, /importCharacterSheet: LyrianActorSheet\.#onImportCharacterSheet/);

  // Import writes to the actor, so unlike export it is gated — and it must ask
  // before it does: the preview is the whole promise made on the button.
  const handler = source.slice(source.indexOf("#onImportCharacterSheet(event, target)"));
  const body = handler.slice(0, 4000);
  assert.match(body, /if \(!actor\.isOwner\)/);
  assert.match(body, /DialogV2\.confirm/);
  assert.match(body, /if \(!confirmed\) return;/);
  assert.equal(/deleteEmbeddedDocuments|\.delete\(\)/.test(body), false,
    "an import adds and updates; it never removes what the sheet does not list");
});
