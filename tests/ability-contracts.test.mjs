import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { abilityRefused, abilitySucceeded } from "../module/rules/ability-result.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

test("ability actions use one stable result shape", () => {
  const refused = abilityRefused("payment");
  const succeeded = abilitySucceeded({ attackRoll: { total: 18 }, isCrit: true });
  assert.deepEqual(Object.keys(refused), Object.keys(succeeded));
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, "payment");
  assert.equal(succeeded.ok, true);
  assert.equal(succeeded.attackRoll.total, 18);
  assert.equal(succeeded.isCrit, true);
});

test("item chat cards render enriched rich text", async () => {
  const source = await readFile(path.join(ROOT, "module/documents/item.mjs"), "utf8");
  const template = await readFile(path.join(ROOT, "templates/chat/item-card.hbs"), "utf8");
  assert.match(source, /TextEditor\.implementation\.enrichHTML/);
  assert.match(template, /\{\{\{enrichedDescription\}\}\}/);
  assert.doesNotMatch(template, /\{\{\{system\.description\}\}\}/);
});

test("document chat announcements are awaited", async () => {
  for (const relative of ["module/documents/actor.mjs", "module/documents/combat.mjs"]) {
    const source = await readFile(path.join(ROOT, relative), "utf8");
    assert.doesNotMatch(source, /(?<!await )ChatMessage\.create\(/);
  }
});

test("NPCs track Secret Art use per encounter", async () => {
  const dataSource = await readFile(path.join(ROOT, "module/data/actor.mjs"), "utf8");
  const itemSource = await readFile(path.join(ROOT, "module/documents/item.mjs"), "utf8");
  assert.match(dataSource, /export class LyrianNPC[\s\S]*schema\.encounter[\s\S]*secretArtUsed/);
  assert.doesNotMatch(itemSource, /isSecretArt && actor\.type === "character"/);
});
