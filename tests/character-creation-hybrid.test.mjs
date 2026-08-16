import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");

globalThis.foundry = {
  applications: {
    api: {
      ApplicationV2: class {
        get state() { return 0; }
      },
      HandlebarsApplicationMixin: (Base) => class extends Base {
        constructor(options) {
          super();
          this.options = options;
        }
      }
    }
  }
};

globalThis.game = {
  i18n: { localize: (key) => key },
  packs: new Map()
};

const { LyrianCharacterCreation } = await import("../module/apps/character-creation.mjs");

function indexEntry(entry) {
  return {
    id: entry._id,
    name: entry.name,
    img: entry.img,
    system: entry.system
  };
}

const [races, breakthroughs, classes] = await Promise.all([
  readFile(path.join(ROOT, "content", "races-01.json"), "utf8").then(JSON.parse),
  readFile(path.join(ROOT, "content", "breakthroughs-01.json"), "utf8").then(JSON.parse),
  readFile(path.join(ROOT, "content", "classes-01.json"), "utf8").then(JSON.parse)
]);

function creation() {
  const app = new LyrianCharacterCreation({ name: "Test", type: "character" });
  app._packIndex = async (pack) => ({
    races: races.map(indexEntry),
    breakthroughs: breakthroughs.map(indexEntry),
    classes: classes.map(indexEntry)
  })[pack] ?? [];
  return app;
}

function byStable(entries, stableId) {
  return entries.find((entry) => entry.system.stableId === stableId);
}

test("wizard creation data does not overwrite ApplicationV2 render state", () => {
  const app = creation();
  assert.equal(app.state, 0);
  assert.equal(app.creationState.step, "stats");
  assert.deepEqual(app.creationState.mainAssign, {});
});

test("Human-Chimera wizard fixes Human primary and offers Chimera ancestries", async () => {
  const app = creation();
  const human = byStable(races, "primary-race--human");
  const hybrid = byStable(breakthroughs, "breakthrough--human-chimera-hybrid-race");
  const catfolk = byStable(races, "ancestry--catfolk");
  app.creationState.raceMode = "hybrid";
  app.creationState.hybridType = "humanChimera";
  app.creationState.hybridBreakthroughId = hybrid._id;
  app.creationState.raceId = human._id;
  app.creationState.ancestryId = catfolk._id;
  app.creationState.raceMainChoice = "power";
  app.creationState.raceSubChoice = "presence";

  const context = await app._prepareContext();
  assert.equal(context.selectedRace.name, "Human");
  assert.ok(context.ancestries.length > 0);
  assert.ok(context.ancestries.every((entry) => entry.system.primaryRace === "Chimera"));
  assert.equal(context.raceComplete, true);
  assert.equal(context.hybridBudgetRemaining, 100);
  assert.equal(context.showRaceAmbition, false);
});

test("Faerie-Chimera wizard always offers the opposite ancestry family", async () => {
  const app = creation();
  const chimera = byStable(races, "primary-race--chimera");
  const hybrid = byStable(breakthroughs, "breakthrough--faerie-chimera-hybrid-race");
  const highFae = byStable(races, "ancestry--high-fae");
  app.creationState.raceMode = "hybrid";
  app.creationState.hybridType = "faerieChimera";
  app.creationState.hybridBreakthroughId = hybrid._id;
  app.creationState.raceId = chimera._id;
  app.creationState.ancestryId = highFae._id;

  const context = await app._prepareContext();
  assert.equal(context.selectedRace.name, "Chimera");
  assert.ok(context.ancestries.length > 0);
  assert.ok(context.ancestries.every((entry) => entry.system.primaryRace === "Fae"));
  assert.equal(context.raceComplete, true);
});
