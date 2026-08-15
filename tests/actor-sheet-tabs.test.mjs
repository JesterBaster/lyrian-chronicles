import assert from "node:assert/strict";
import test from "node:test";

const TAB_LABELS = {
  main: "Overview",
  skills: "Skills",
  proficiencies: "Proficiencies",
  abilities: "Abilities",
  inventory: "Inventory",
  progression: "Spirit Core",
  biography: "Story"
};

class ActorSheetV2Stub {
  constructor(type) {
    this.document = { type };
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

test("character tabs use localized labels", () => {
  const tabs = new LyrianActorSheet("character")._prepareTabs("primary");

  assert.deepEqual(
    Object.fromEntries(Object.entries(tabs).map(([id, tab]) => [id, tab.label])),
    TAB_LABELS
  );
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
