/**
 * Which abilities the Abilities tab lists where.
 *
 * The tab has a section per race and class for what those grant, and an "Other
 * Actions" list for everything else. Anything granted has to leave the second
 * list or it reads twice — which is exactly what a player saw after adding an
 * ability from the compendium that their class already gave them.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  duplicatesOwnedAbility,
  isGrantedFeature,
  withoutGranted
} from "../module/rules/ability-sections.mjs";

/** An owned Item, as the sheet sees one. */
const ability = (id, name, { stableId = "", source = null } = {}) => ({
  id,
  name,
  type: "ability",
  system: { stableId },
  flags: source ? { "lyrian-chronicles": { featureSource: source } } : {},
  getFlag: (scope, key) => (scope === "lyrian-chronicles" && key === "featureSource" ? source : null)
});

const CLASS_GRANT = { kind: "class", sourceItemId: "class1", stableId: "ability--cleave" };

test("a granted ability does not also appear in Other Actions", () => {
  const granted = ability("g1", "Cleave", { stableId: "ability--cleave", source: CLASS_GRANT });
  const other = ability("a1", "Riposte", { stableId: "ability--riposte" });

  assert.deepEqual(withoutGranted([granted, other], [granted]).map((i) => i.id), ["a1"]);
});

test("the player's own copy of a granted ability is dropped too", () => {
  // The case that actually bites: sync only adopts an owned copy when it has
  // not already made one, so browsing the compendium for an ability your class
  // grants leaves two separate Items with the same name.
  const granted = ability("g1", "Cleave", { stableId: "ability--cleave", source: CLASS_GRANT });
  const mine = ability("a1", "Cleave", { stableId: "ability--cleave" });
  const unrelated = ability("a2", "Riposte", { stableId: "ability--riposte" });

  const shown = withoutGranted([mine, unrelated], [granted]);
  assert.deepEqual(shown.map((i) => i.id), ["a2"],
    "the class section already lists Cleave, with its level badge");
});

test("a hand-made ability with no id is matched by name instead", () => {
  const granted = ability("g1", "Cleave", { source: CLASS_GRANT });
  const typedIn = ability("a1", "cleave");
  assert.deepEqual(withoutGranted([typedIn], [granted]), []);
});

test("a stable id beats a matching name, and nothing else is hidden", () => {
  // Two different abilities that share a name must both survive; the rulebook
  // has 40 such pairs.
  const granted = ability("g1", "Advanced Artificing", {
    stableId: "ability--advanced-artificing", source: CLASS_GRANT
  });
  const keyAbility = ability("a1", "Advanced Artificing", {
    stableId: "key-ability--advanced-artificing"
  });

  assert.deepEqual(withoutGranted([keyAbility], [granted]).map((i) => i.id), ["a1"]);
});

test("nothing granted means nothing hidden", () => {
  const list = [ability("a1", "Cleave"), ability("a2", "Riposte")];
  assert.deepEqual(withoutGranted(list, []), list);
  assert.deepEqual(withoutGranted([], []), []);
});

test("a grant is recognised from the flag either way it is read", () => {
  const granted = ability("g1", "Cleave", { source: CLASS_GRANT });
  assert.equal(isGrantedFeature(granted), true);
  assert.equal(isGrantedFeature(ability("a1", "Cleave")), false);
  // Plain data, with no getFlag on it.
  assert.equal(isGrantedFeature({ flags: { "lyrian-chronicles": { featureSource: CLASS_GRANT } } }), true);
  assert.equal(isGrantedFeature({}), false);
});

/* -------------------------------------------- */

test("dropping an ability the actor already has is a duplicate", () => {
  const held = ability("a1", "Cleave", { stableId: "ability--cleave" });
  const dropped = ability("a2", "Cleave", { stableId: "ability--cleave" });

  assert.equal(duplicatesOwnedAbility(dropped, [held, dropped])?.id, "a1");
  // Including the granted copy, which is the common case.
  const granted = ability("g1", "Cleave", { stableId: "ability--cleave", source: CLASS_GRANT });
  assert.equal(duplicatesOwnedAbility(dropped, [granted, dropped])?.id, "g1");
});

test("an ability is never a duplicate of itself, or of a different one", () => {
  const dropped = ability("a2", "Cleave", { stableId: "ability--cleave" });
  assert.equal(duplicatesOwnedAbility(dropped, [dropped]), null);
  assert.equal(duplicatesOwnedAbility(dropped, [ability("a1", "Riposte", {
    stableId: "ability--riposte"
  })]), null);
});

test("only abilities are checked, and only ones with something to match on", () => {
  const weapon = { id: "w1", name: "Cleave", type: "weapon", system: {}, flags: {} };
  assert.equal(duplicatesOwnedAbility(weapon, [ability("a1", "Cleave")]), null);

  // Two hand-made abilities with no name are not duplicates of each other.
  const blank = ability("a2", "");
  assert.equal(duplicatesOwnedAbility(blank, [ability("a1", ""), blank]), null);
});
