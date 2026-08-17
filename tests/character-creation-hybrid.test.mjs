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

const {
  LyrianCharacterCreation,
  applyCreationInput,
  creationClassCost
} = await import("../module/apps/character-creation.mjs");

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
  assert.equal(app.creationState.step, "race");
  assert.deepEqual(app.creationState.mainAssign, {});
});


test("wizard native form state updates stats, class, and class level", () => {
  const app = creation();
  applyCreationInput(app.creationState, { name: "mainAssign.power", value: "5" });
  applyCreationInput(app.creationState, { name: "subAssign.cunning", value: "4" });
  applyCreationInput(app.creationState, { name: "classId", value: classes[0]._id });
  applyCreationInput(app.creationState, { name: "classLevel", value: "6" });

  assert.equal(app.creationState.mainAssign.power, 5);
  assert.equal(app.creationState.subAssign.cunning, 4);
  assert.equal(app.creationState.classId, classes[0]._id);
  assert.equal(app.creationState.classLevel, 6);

  applyCreationInput(app.creationState, { name: "mainAssign.power", value: "" });
  assert.equal("power" in app.creationState.mainAssign, false);
});

test("class creation cost includes unlock and chosen levels", () => {
  assert.equal(creationClassCost({ tier: 1 }, 1), 100);
  assert.equal(creationClassCost({ tier: 1 }, 8), 800);
  assert.equal(creationClassCost({ tier: 3 }, 4), 600);
});

test("wizard template uses the requested order and keeps Apply clickable", async () => {
  const template = await readFile(
    path.join(ROOT, "templates", "apps", "character-creation.hbs"), "utf8"
  );
  const order = [
    '"race"', '"classes"', '"breakthroughs"', '"stats"', '"equipment"', '"review"'
  ].map((step) => template.indexOf(step));
  assert.ok(order.every((position) => position >= 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(template, /data-action="finish"/);
  assert.doesNotMatch(template, /data-action="finish"[^>]*disabled/);
});

test("wizard context tracks optional Breakthrough and equipment budgets", async () => {
  const app = creation();
  const optional = breakthroughs.find((entry) => !String(entry.system.stableId).includes("hybrid-race"));
  app.creationState.breakthroughIds = [optional._id];
  app.creationState.equipmentIds = ["weapons:test-weapon"];
  const originalPackIndex = app._packIndex;
  app._packIndex = async (pack) => {
    if (pack === "weapons") {
      return [{
        id: "test-weapon",
        name: "Test Weapon",
        img: "icons/svg/sword.svg",
        system: { cost: "250 Clim", burden: "1" }
      }];
    }
    return originalPackIndex(pack);
  };

  const context = await app._prepareContext();
  assert.equal(context.selectedBreakthroughs.length, 1);
  assert.equal(context.breakthroughExpLeft, 300 - Number(optional.system.expCost));
  assert.equal(context.selectedEquipment.length, 1);
  assert.equal(context.equipmentClimLeft, 2750);
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
