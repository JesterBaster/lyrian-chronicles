import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  HYBRID_TYPES,
  hybridAncestryFamily,
  hybridRaceFlag,
  isHybridBreakthrough,
  prepareHybridAncestryData,
  prepareHybridPrimaryData,
  validateHybridSelection
} from "../module/rules/hybrid-race.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

test("Hybrid rules use the two approved 200 EXP Breakthroughs", () => {
  assert.deepEqual(Object.values(HYBRID_TYPES).map((rule) => [rule.name, rule.cost]), [
    ["Faerie-Chimera Hybrid (Race)", 200],
    ["Human-Chimera Hybrid (Race)", 200]
  ]);
  assert.equal(isHybridBreakthrough({
    system: { stableId: "breakthrough--human-chimera-hybrid-race" }
  }), true);
});

test("Hybrid primary and opposite-family ancestry requirements are exact", () => {
  assert.equal(hybridAncestryFamily("humanChimera", "Human"), "Chimera");
  assert.equal(hybridAncestryFamily("faerieChimera", "Fae"), "Chimera");
  assert.equal(hybridAncestryFamily("faerieChimera", "Chimera"), "Fae");
  assert.equal(hybridAncestryFamily("faerieChimera", "Human"), "");

  assert.deepEqual(validateHybridSelection({
    type: "faerieChimera", primaryRace: "Fae", ancestryPrimaryRace: "Chimera", budget: 300
  }), { valid: true, reason: "" });
  assert.equal(validateHybridSelection({
    type: "faerieChimera", primaryRace: "Fae", ancestryPrimaryRace: "Fae", budget: 300
  }).reason, "ancestry");
  assert.equal(validateHybridSelection({
    type: "humanChimera", primaryRace: "Human", ancestryPrimaryRace: "Chimera", budget: 199
  }).reason, "budget");
});

test("Human-Chimera keeps Human traits except Adaptability and the bonus EXP", () => {
  const human = prepareHybridPrimaryData({
    name: "Human",
    system: {
      ambition: "You start with an additional 100 EXP.",
      ambitionExp: 100,
      relationships: {
        abilities: ["ability--divine-providence", "ability--human-adaptability"],
        _links: [
          { stableId: "ability--divine-providence" },
          { stableId: "ability--human-adaptability" }
        ]
      }
    }
  }, "humanChimera");

  assert.equal(human.system.ambitionExp, 0);
  assert.equal(human.system.ambition, "");
  assert.deepEqual(human.system.relationships.abilities, ["ability--divine-providence"]);
  assert.deepEqual(human.system.relationships._links.map((link) => link.stableId), [
    "ability--divine-providence"
  ]);
});

test("Faerie-Chimera grants the other race language or Chimera dialect", () => {
  const chimera = prepareHybridPrimaryData({
    name: "Chimera", system: { relationships: {}, grantedProficiencies: "original" }
  }, "faerieChimera");
  assert.match(chimera.system.grantedProficiencies, /Common and Sylvan/);

  const catfolk = prepareHybridAncestryData({ name: "Catfolk", system: {} }, {
    type: "faerieChimera", primaryRace: "Fae"
  });
  assert.match(catfolk.system.grantedProficiencies, /special dialect/i);
});

test("High Fae Hybrid grants Faerie Flash instead of Faerie Flash II", () => {
  const highFae = prepareHybridAncestryData({
    name: "High Fae",
    system: {
      relationships: {
        traits: ["ability--lucid-sleep", "ability--faerie-flash-ii"],
        _links: [
          { stableId: "ability--lucid-sleep" },
          { stableId: "ability--faerie-flash-ii" }
        ]
      }
    }
  }, {
    type: "faerieChimera",
    primaryRace: "Chimera",
    faerieFlashLink: { stableId: "ability--faerie-flash", uuid: "Compendium.test" }
  });

  assert.deepEqual(highFae.system.relationships.traits, [
    "ability--lucid-sleep", "ability--faerie-flash"
  ]);
  assert.deepEqual(highFae.system.relationships._links.map((link) => link.stableId), [
    "ability--lucid-sleep", "ability--faerie-flash"
  ]);
});

test("Hybrid flags preserve official display and ancestry identity", () => {
  assert.deepEqual(hybridRaceFlag("faerieChimera", "Chimera", "High Fae"), {
    type: "faerieChimera",
    displayName: "Faerie-Chimera Hybrid",
    breakthroughStableId: "breakthrough--faerie-chimera-hybrid-race",
    primaryRace: "Chimera",
    ancestry: "High Fae",
    ancestryPrimaryRace: "Fae"
  });
});

test("approved content contains both exact Hybrid Breakthrough sources", async () => {
  const breakthroughs = JSON.parse(await readFile(
    path.join(ROOT, "content", "breakthroughs-01.json"), "utf8"
  ));
  for (const rule of Object.values(HYBRID_TYPES)) {
    const source = breakthroughs.find((entry) => entry.system.stableId === rule.breakthroughStableId);
    assert.equal(source?.name, rule.name);
    assert.equal(source?.system.expCost, 200);
    assert.match(source?.system.requirements ?? "", /character creation/i);
  }
});

test("the creation wizard installs Hybrid data in one embedded-document operation", async () => {
  const [application, template, itemDocument] = await Promise.all([
    readFile(path.join(ROOT, "module", "apps", "character-creation.mjs"), "utf8"),
    readFile(path.join(ROOT, "templates", "apps", "character-creation.hbs"), "utf8"),
    readFile(path.join(ROOT, "module", "documents", "item.mjs"), "utf8")
  ]);
  assert.match(template, /name="hybridType"/);
  assert.match(template, /name="hybridPrimaryRaceId"/);
  assert.match(application, /createEmbeddedDocuments\("Item", toCreate, \{ lyrianCharacterCreation: true \}\)/);
  assert.match(itemDocument, /LYRIAN\.Hybrid\.CreationOnly/);
});
