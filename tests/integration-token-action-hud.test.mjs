import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Drives the real integration against a stand-in for Token Action HUD Core.
 *
 * The stubs mirror TAH Core 2.x exactly where it matters: the hook names, the
 * classes handed over on `tokenActionHudCoreApiReady`, and the fact that Core
 * reads nothing off the registered object but `.api`. Anything the integration
 * calls that Core does not provide fails here rather than in someone's game.
 */

const hooks = new Map();
globalThis.Hooks = {
  once(name, fn) { hooks.set(name, [...(hooks.get(name) ?? []), fn]); },
  on(name, fn) { this.once(name, fn); },
  callAll(name, ...args) { for (const fn of hooks.get(name) ?? []) fn(...args); },
  call(name, ...args) { this.callAll(name, ...args); }
};
globalThis.game = { i18n: { localize: (key) => key, format: (key) => key } };

class StubActionHandler {
  constructor() { this.delimiter = "|"; this.added = []; }
  addActions(actions, group) { this.added.push({ group, actions }); }
}
class StubRollHandler {
  constructor() { this.delimiter = "|"; this.calls = []; }
  isRenderItem() { return this.rightClick === true; }
  renderItem(actor, id) { this.calls.push(["render", id]); return true; }
}
class StubSystemManager {}
const Utils = {
  i18n: (key) => key,
  getImage: (item) => item.img ?? "",
  sortItemsByName: (items) => items
};

const { registerTokenActionHud, attackTypeForEvent } =
  await import("../module/integrations/token-action-hud.mjs");

registerTokenActionHud();

let registered = null;
Hooks.on("tokenActionHudSystemReady", (module) => { registered = module; });
Hooks.callAll("tokenActionHudCoreApiReady", {
  api: {
    ActionHandler: StubActionHandler,
    RollHandler: StubRollHandler,
    SystemManager: StubSystemManager,
    Utils
  }
});

/* -------------------------------------------- */

function stubActor(overrides = {}) {
  const items = new Map();
  const calls = [];
  const record = (name) => (...args) => { calls.push([name, ...args]); };
  const actor = {
    type: "character",
    calls,
    items: {
      get: (id) => items.get(id),
      [Symbol.iterator]: () => items.entries()
    },
    // Mirrors the real schema: LYRIAN.mainStats is the config table of keys,
    // the actor stores those values at system.stats. A stub that used the
    // config name as the path made a HUD reading the wrong one look correct.
    system: {
      stats: { power: { total: 3 }, focus: { total: 2 }, agility: { total: 1 }, toughness: { total: 4 } },
      subStats: { fitness: { total: 2 }, cunning: { total: 0 }, reason: { total: 1 }, awareness: { total: 1 }, presence: { total: 0 } },
      skills: { athletics: { total: 5, atCap: true } },
      artisan: { blacksmith: { total: 3 } },
      gathering: { mining: { total: 2 } }
    },
    rollUniversalAttack: record("rollUniversalAttack"),
    rollMonsterAttack: record("rollMonsterAttack"),
    rollStat: record("rollStat"),
    rollSave: record("rollSave"),
    rollSkill: record("rollSkill"),
    rollArtisan: record("rollArtisan"),
    rollGathering: record("rollGathering"),
    rollInitiativeCheck: record("rollInitiativeCheck"),
    takeRest: record("takeRest"),
    rollInjury: record("rollInjury"),
    ...overrides
  };
  actor.addItem = (item) => {
    const rolls = [];
    items.set(item.id, {
      ...item,
      rolls,
      rollAttack: (type) => rolls.push(["rollAttack", type]),
      rollAbility: () => rolls.push(["rollAbility"]),
      postToChat: () => rolls.push(["postToChat"])
    });
    return items.get(item.id);
  };
  return actor;
}

async function buildFor(actor) {
  const manager = new (registered.api.SystemManager)();
  const handler = manager.getActionHandler();
  Object.defineProperty(handler, "actor", { value: actor });
  await handler.buildSystemActions();
  return handler;
}

/* -------------------------------------------- */

test("the stub's stat paths are the ones the actor schema really uses", () => {
  // The HUD read `system.mainStats` — the name of the *config table*, not the
  // path on the actor — and every main stat showed +0. A stub built from the
  // same misreading made it look right, so the paths are pinned against the
  // schema itself.
  const schema = readFileSync(
    new URL("../module/data/actor.mjs", import.meta.url), "utf8");
  assert.match(schema, /schema\.stats = new fields\.SchemaField\(/);
  assert.match(schema, /schema\.subStats = new fields\.SchemaField\(/);
  assert.doesNotMatch(schema, /schema\.mainStats = /,
    "there is no system.mainStats; LYRIAN.mainStats is the key table");

  const stub = stubActor().system;
  assert.ok(stub.stats, "the stub must store main stats where the actor does");
  assert.ok(stub.subStats);
  assert.equal(stub.mainStats, undefined, "and must not offer a path the actor lacks");
});

test("the system registers itself with TAH Core, no companion module needed", () => {
  assert.ok(registered, "tokenActionHudSystemReady never fired");
  assert.equal(registered.id, "lyrian-chronicles");
  // Core reads exactly these two off `.api` and nothing else.
  assert.equal(typeof registered.api.SystemManager, "function");
  assert.equal(registered.api.requiredCoreModuleVersion, "2");
});

test("the manager answers every method TAH Core calls on it", async () => {
  const manager = new (registered.api.SystemManager)();
  assert.ok(manager.getActionHandler() instanceof StubActionHandler);
  assert.ok(manager.getRollHandler("core") instanceof StubRollHandler);
  assert.deepEqual(Object.keys(manager.getAvailableRollHandlers()), ["core"]);

  const defaults = await manager.registerDefaults();
  assert.ok(Array.isArray(defaults.layout) && defaults.layout.length);
  assert.ok(Array.isArray(defaults.groups) && defaults.groups.length);

  // Every group placed on a tab must also be declared, or TAH Core renders a
  // tab with an empty hole in it.
  const declared = new Set(defaults.groups.map((group) => group.id));
  for (const tab of defaults.layout) {
    assert.ok(tab.nestId && tab.id && tab.name, `tab ${tab.id} is incomplete`);
    for (const group of tab.groups) {
      assert.ok(declared.has(group.id), `${group.id} is on a tab but not declared`);
      assert.ok(group.nestId, `${group.id} has no nestId`);
    }
  }
  // And every declared group is placed, or it can never be seen.
  const placed = new Set(defaults.layout.flatMap((tab) => tab.groups.map((g) => g.id)));
  for (const group of defaults.groups) {
    assert.ok(placed.has(group.id), `${group.id} is declared but on no tab`);
  }
});

test("a character's HUD carries their weapons, abilities and checks", async () => {
  const actor = stubActor();
  actor.addItem({ id: "w1", name: "Longsword", type: "weapon", system: { equipped: true, accuracyBonus: 2, damageBonus: 1 } });
  actor.addItem({ id: "a1", name: "Cleave", type: "ability", system: { timing: "action", apCost: 2 } });
  actor.addItem({ id: "a2", name: "Parry", type: "ability", system: { timing: "reaction", rpCost: 1 } });
  actor.addItem({ id: "a3", name: "Toughened", type: "ability", system: { timing: "passive" } });
  actor.addItem({ id: "a4", name: "Refine Ore", type: "ability", system: { timing: "crafting" } });
  actor.addItem({ id: "a5", name: "Opening Gambit", type: "ability", system: { timing: "encounterStart" } });
  actor.addItem({ id: "g1", name: "Rope", type: "gear", system: { quantity: 3 } });

  const handler = await buildFor(actor);
  const byGroup = Object.fromEntries(handler.added.map(({ group, actions }) => [group.id, actions]));

  assert.deepEqual(byGroup.weapons.map((a) => a.name), ["Longsword"]);
  assert.equal(byGroup.weapons[0].cssClass, "active", "an equipped weapon is marked");
  assert.equal(byGroup.weapons[0].info1.text, "+2");

  // Abilities split by timing rather than piling onto one shelf. A crafting
  // ability is not spent in a fight, so it must not bury the ones that are —
  // while an encounter's opening beat happens in one and stays.
  assert.deepEqual(byGroup.actions.map((a) => a.name).sort(), ["Cleave", "Opening Gambit"]);
  assert.deepEqual(byGroup.reactions.map((a) => a.name), ["Parry"]);
  assert.deepEqual(byGroup.passives.map((a) => a.name), ["Toughened"]);
  assert.deepEqual(byGroup.downtime.map((a) => a.name), ["Refine Ore"]);

  assert.deepEqual(byGroup.gear.map((a) => a.name), ["Rope"]);
  assert.equal(byGroup.gear[0].info1.text, "3");

  // Stats, skills and the save are all present as checks.
  const power = byGroup.stats.find((a) => a.encodedValue === "stat|power");
  assert.ok(power, "the main stats are missing");
  assert.equal(power.info1.text, "+3", "a main stat must show the actor's value, not +0");
  const reason = byGroup.stats.find((a) => a.encodedValue === "stat|reason");
  assert.equal(reason.info1.text, "+1", "and so must a sub stat");
  assert.ok(byGroup.stats.some((a) => a.encodedValue === "save|save"));
  assert.ok(byGroup.skills.some((a) => a.encodedValue === "skill|athletics"));
  assert.ok(byGroup.artisan.some((a) => a.encodedValue === "artisan|blacksmith"));
  assert.ok(byGroup.gathering.some((a) => a.encodedValue === "gathering|mining"));

  // Every action must carry the fields TAH Core renders from.
  for (const { actions } of handler.added) {
    for (const action of actions) {
      assert.ok(action.id, "an action has no id");
      assert.ok(action.name, `${action.id} has no name`);
      assert.match(action.encodedValue, /^[a-z]+\|.+/, `${action.id} has a malformed value`);
      assert.ok(action.listName, `${action.id} has no listName`);
    }
  }
});

test("a monster is not offered the precise attack it cannot make", async () => {
  const character = await buildFor(stubActor());
  const monster = await buildFor(stubActor({ type: "npc" }));
  const types = (handler) => handler.added
    .find(({ group }) => group.id === "attacks").actions
    .map((action) => action.encodedValue);

  assert.deepEqual(types(character), ["attack|light", "attack|heavy", "attack|precise"]);
  assert.deepEqual(types(monster), ["attack|light", "attack|heavy"],
    "rollMonsterAttack refuses 'precise', so the button must not exist");
});

/* -------------------------------------------- */

test("modifiers pick the attack, and the tooltip says so", () => {
  assert.equal(attackTypeForEvent({}), "light");
  assert.equal(attackTypeForEvent({ ctrl: true }), "heavy");
  assert.equal(attackTypeForEvent({ alt: true }), "precise");
  // Ctrl wins a both-held press rather than producing neither.
  assert.equal(attackTypeForEvent({ ctrl: true, alt: true }), "heavy");
});

test("every action type reaches the method that answers it", async () => {
  const actor = stubActor();
  const weapon = actor.addItem({ id: "w1", name: "Axe", type: "weapon", system: {} });
  const ability = actor.addItem({ id: "a1", name: "Cleave", type: "ability", system: {} });
  const gear = actor.addItem({ id: "g1", name: "Rope", type: "gear", system: {} });

  const handler = new (registered.api.SystemManager)().getRollHandler("core");
  Object.defineProperty(handler, "actor", { value: actor });

  await handler.handleActionClick(null, "weapon|w1");
  assert.deepEqual(weapon.rolls.at(-1), ["rollAttack", "light"]);
  handler.isCtrl = true;
  await handler.handleActionClick(null, "weapon|w1");
  assert.deepEqual(weapon.rolls.at(-1), ["rollAttack", "heavy"]);
  handler.isCtrl = false;

  await handler.handleActionClick(null, "ability|a1");
  assert.deepEqual(ability.rolls.at(-1), ["rollAbility"]);
  await handler.handleActionClick(null, "item|g1");
  assert.deepEqual(gear.rolls.at(-1), ["postToChat"]);

  await handler.handleActionClick(null, "attack|heavy");
  await handler.handleActionClick(null, "stat|focus");
  await handler.handleActionClick(null, "save|save");
  await handler.handleActionClick(null, "skill|athletics");
  await handler.handleActionClick(null, "artisan|blacksmith");
  await handler.handleActionClick(null, "gathering|mining");
  await handler.handleActionClick(null, "utility|initiative");
  await handler.handleActionClick(null, "utility|rest");
  await handler.handleActionClick(null, "utility|injury");

  assert.deepEqual(actor.calls.map(([name]) => name), [
    "rollUniversalAttack", "rollStat", "rollSave", "rollSkill",
    "rollArtisan", "rollGathering", "rollInitiativeCheck", "takeRest", "rollInjury"
  ]);
  assert.deepEqual(actor.calls[0].slice(1, 2), ["heavy"]);
});

test("a monster's attack button routes to the monster roll", async () => {
  const actor = stubActor({ type: "npc" });
  const handler = new (registered.api.SystemManager)().getRollHandler("core");
  Object.defineProperty(handler, "actor", { value: actor });

  await handler.handleActionClick(null, "attack|light");
  assert.deepEqual(actor.calls.at(-1), ["rollMonsterAttack", "light"]);
});

test("right-click opens the sheet instead of spending the resource", async () => {
  const actor = stubActor();
  const weapon = actor.addItem({ id: "w1", name: "Axe", type: "weapon", system: {} });
  const handler = new (registered.api.SystemManager)().getRollHandler("core");
  Object.defineProperty(handler, "actor", { value: actor });
  handler.rightClick = true;

  await handler.handleActionClick(null, "weapon|w1");
  assert.deepEqual(handler.calls.at(-1), ["render", "w1"]);
  assert.equal(weapon.rolls.length, 0, "a right-click must not roll");

  // A check has no sheet to open, so it still rolls.
  await handler.handleActionClick(null, "skill|athletics");
  assert.deepEqual(actor.calls.at(-1), ["rollSkill", "athletics"]);
});

test("an unknown action and an empty HUD are refused quietly", async () => {
  const handler = new (registered.api.SystemManager)().getRollHandler("core");
  Object.defineProperty(handler, "actor", { value: stubActor() });
  assert.equal(await handler.handleActionClick(null, "sabotage|1"), undefined);
  assert.equal(await handler.handleActionClick(null, ""), undefined);

  const noActor = new (registered.api.SystemManager)().getActionHandler();
  Object.defineProperty(noActor, "actor", { value: null });
  await noActor.buildSystemActions();
  assert.deepEqual(noActor.added, [], "no token selected means no actions, not a crash");
});
