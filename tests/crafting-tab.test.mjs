import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { hasArtisanClass } from "../module/rules/crafting-access.mjs";

const item = (artisan) => ({ type: "class", system: { artisan } });

test("Crafting access requires an owned Artisan class on a character", () => {
  assert.equal(hasArtisanClass({ type: "character", items: [item(true)] }), true);
  assert.equal(hasArtisanClass({ type: "character", items: [item(false)] }), false);
  assert.equal(hasArtisanClass({ type: "character", items: [{ type: "race", system: { artisan: true } }] }), false);
  assert.equal(hasArtisanClass({ type: "monster", items: [item(true)] }), false);
  assert.equal(hasArtisanClass({ type: "npc", items: [item(true)] }), false);
  assert.equal(hasArtisanClass(null), false);
});

test("Actor sheet registers and conditionally removes the Crafting part and tab", () => {
  const source = readFileSync(new URL("../module/sheets/actor-sheet.mjs", import.meta.url), "utf8");
  assert.match(source, /crafting: \{ template: .*tab-crafting\.hbs/);
  assert.match(source, /if \(!hasArtisanClass\(this\.document\)\) delete parts\.crafting/);
  assert.match(source, /if \(!hasArtisanClass\(this\.document\)\) delete tabs\.crafting/);
});

test("Crafting template exposes artisan rolls and approved crafting packs", () => {
  const source = readFileSync(new URL("../templates/actor/tab-crafting.hbs", import.meta.url), "utf8");
  assert.match(source, /data-action="rollArtisan"/);
  for (const pack of ["crafting-guide", "artifices", "materials", "mods"]) {
    assert.match(source, new RegExp(`data-pack="${pack}"`));
  }
});
