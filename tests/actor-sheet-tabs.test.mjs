import assert from "node:assert/strict";
import test from "node:test";

const TAB_LABELS = {
  main: "Overview",
  skills: "Skills",
  proficiencies: "Proficiencies",
  abilities: "Abilities",
  inventory: "Inventory",
  crafting: "Crafting",
  progression: "Spirit Core",
  biography: "Story"
};

class ActorSheetV2Stub {
  constructor(type, items = []) {
    this.document = { type, items };
  }

  _prepareTabs() {
    return Object.fromEntries(Object.keys(TAB_LABELS).map((id) => [id, {
      id,
      label: `LYRIAN.Tab.${id}`
    }]));
  }
}

const originalFoundry = globalThis.foundry;
const originalGame = globalThis.game;

globalThis.foundry = {
  applications: {
    api: { HandlebarsApplicationMixin: (Base) => class extends Base {} },
    sheets: { ActorSheetV2: ActorSheetV2Stub }
  }
};
globalThis.game = {
  i18n: {
    localize: (key) => TAB_LABELS[key.split(".").at(-1)] ?? key
  }
};

const { LyrianActorSheet } = await import("../module/sheets/actor-sheet.mjs");

test.after(() => {
  globalThis.foundry = originalFoundry;
  globalThis.game = originalGame;
});

test("tab configuration uses explicit localization keys", () => {
  assert.deepEqual(
    LyrianActorSheet.TABS.primary.tabs.map(({ id, label }) => [id, label]),
    Object.keys(TAB_LABELS).map((id) => [id, `LYRIAN.Tab.${id}`])
  );
  assert.equal(LyrianActorSheet.TABS.primary.labelPrefix, undefined);
});

test("Artisan character tabs use localized labels", () => {
  const tabs = new LyrianActorSheet("character", [
    { type: "class", system: { artisan: true } }
  ])._prepareTabs("primary");

  assert.deepEqual(
    Object.fromEntries(Object.entries(tabs).map(([id, tab]) => [id, tab.label])),
    TAB_LABELS
  );
});

test("non-Artisan characters hide the Crafting tab", () => {
  const tabs = new LyrianActorSheet("character", [
    { type: "class", system: { artisan: false } }
  ])._prepareTabs("primary");

  assert.equal(tabs.crafting, undefined);
  assert.deepEqual(Object.keys(tabs), [
    "main", "skills", "proficiencies", "abilities", "inventory", "progression", "biography"
  ]);
});

for (const type of ["npc", "monster"]) {
  test(`${type} tabs use localized labels and hide character-only tabs`, () => {
    const tabs = new LyrianActorSheet(type)._prepareTabs("primary");

    assert.deepEqual(Object.keys(tabs), ["main", "abilities", "inventory", "biography"]);
    assert.deepEqual(
      Object.fromEntries(Object.entries(tabs).map(([id, tab]) => [id, tab.label])),
      {
        main: "Overview",
        abilities: "Abilities",
        inventory: "Inventory",
        biography: "Story"
      }
    );
  });
}
