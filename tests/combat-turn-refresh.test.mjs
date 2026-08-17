import assert from "node:assert/strict";
import test from "node:test";

/**
 * Stubs mirroring the parts of core Combat this system overrides.
 *
 * The important detail reproduced here is that core `nextTurn()` delegates to
 * `nextRound()` when the turn order wraps, rather than falling through to its
 * own update — that is what makes a naive refresh in both places fire twice.
 */
globalThis.Combatant = class {};
globalThis.ChatMessage = { create: async () => ({}) };
globalThis.game = { i18n: { localize: (key) => key } };
Number.isNumeric = (value) => typeof value === "number" && Number.isFinite(value);

globalThis.Combat = class {
  constructor(combatants = []) {
    this.round = 0;
    this.turn = 0;
    this.combatants = combatants;
  }

  get turns() { return this.combatants; }

  get combatant() { return this.turns[this.turn] ?? null; }

  async nextTurn() {
    const next = this.turn + 1;
    if (next >= this.turns.length) return this.nextRound();
    this.turn = next;
    return this;
  }

  async nextRound() {
    this.round += 1;
    this.turn = 0;
    return this;
  }
};

const { LyrianCombat } = await import("../module/documents/combat.mjs");

function combat() {
  const refreshes = [];
  const combatant = (id) => ({
    id,
    actor: { refreshTurn: async () => refreshes.push(id) }
  });
  const encounter = new LyrianCombat([combatant("a"), combatant("b")]);
  return { encounter, refreshes };
}

test("advancing a turn refreshes the combatant whose turn began", async () => {
  const { encounter, refreshes } = combat();
  await encounter.nextTurn();
  assert.deepEqual(refreshes, ["b"]);
});

test("the next-round control refreshes the first combatant of the round", async () => {
  const { encounter, refreshes } = combat();
  await encounter.nextRound();
  assert.equal(encounter.round, 1);
  // Without the nextRound override this combatant starts the round with stale
  // AP, because the tracker's round control never reaches nextTurn.
  assert.deepEqual(refreshes, ["a"]);
});

test("a turn that rolls the round over refreshes exactly once", async () => {
  const { encounter, refreshes } = combat();
  await encounter.nextTurn();   // -> b
  await encounter.nextTurn();   // wraps, delegating to nextRound -> a
  assert.equal(encounter.round, 1);
  assert.deepEqual(refreshes, ["b", "a"]);
});

test("the same combatant refreshes again in a later round", async () => {
  const { encounter, refreshes } = combat();
  await encounter.nextRound();
  await encounter.nextRound();
  assert.deepEqual(refreshes, ["a", "a"]);
});
