import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseMonsterAttackProfile } from "../module/rules/monster-attack.mjs";
import { LyrianAPI } from "../module/api.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("official monster attack formatting variants are parsed", () => {
  assert.deepEqual(parseMonsterAttackProfile("+2 Accuracy, 2d4+3"), {
    accuracy: 2,
    damageFormula: "2d4+3"
  });
  assert.deepEqual(parseMonsterAttackProfile(" +5 accuracy, 4d6 + 10 damage"), {
    accuracy: 5,
    damageFormula: "4d6+10"
  });
  assert.deepEqual(
    parseMonsterAttackProfile("+3 Accuracy, 2d4+3 (+6 Accuracy, 2d4+6 During a Storm)"),
    { accuracy: 3, damageFormula: "2d4+3" }
  );
  assert.equal(parseMonsterAttackProfile("None"), null);
});

test("every published monster basic attack is rollable or explicitly None", async () => {
  const files = ["monsters-01.json", "monsters-02.json"];
  const monsters = (await Promise.all(files.map(async (name) =>
    JSON.parse(await readFile(path.join(ROOT, "content", name), "utf8"))
  ))).flat();

  for (const monster of monsters) {
    for (const key of ["lightAttack", "heavyAttack"]) {
      const text = monster.system.official[key];
      if (!text || /^none$/i.test(text.trim())) continue;
      assert.ok(parseMonsterAttackProfile(text), `${monster.name} has unparseable ${key}: ${text}`);
    }
  }
});

test("the public action set exposes official monster profile attacks", () => {
  globalThis.game = { i18n: { localize: (value) => value } };
  const actor = {
    type: "monster",
    items: [],
    system: {
      official: {
        lightAttack: "+3 Accuracy, 2d4+2",
        heavyAttack: "None"
      },
      ap: { value: 2, max: 2, temp: 0, total: 2 },
      rp: { value: 1, max: 1, temp: 0, total: 1 },
      mana: { value: 0, max: 0, temp: 0, total: 0 },
      hp: { value: 20, max: 20, temp: 0, total: 20 },
      skills: {},
      evasion: 10,
      dodgeEvasion: 14,
      guard: 2,
      blockGuard: 4,
      potency: 11,
      save: 2
    }
  };

  assert.deepEqual(LyrianAPI.getActionSet(actor).monsterAttacks, [{
    type: "light",
    sourceProfile: "+3 Accuracy, 2d4+2",
    accuracy: 3,
    damageFormula: "2d4+2",
    apCost: 1,
    affordable: true
  }]);
  delete globalThis.game;
});
