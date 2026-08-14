import assert from "node:assert/strict";
import test from "node:test";
import { collectWorshipBenefits, divineProfile } from "../module/rules/worship.mjs";

test("canonical Divines resolve to their official damage types", () => {
  assert.deepEqual(divineProfile("Ayuzi Kirara"), {
    key: "ayuzi-kirara",
    name: "Ayuzi Kirara",
    damageType: "Fire"
  });
  assert.equal(divineProfile("Unknown Saint"), null);
});

test("worship alone is biographical and grants no automatic benefit", () => {
  const result = collectWorshipBenefits({
    system: { details: { worship: "Kari" } },
    items: []
  });

  assert.equal(result.hasDivinesChosen, false);
  assert.equal(result.active, false);
  assert.equal(result.damageType, "Holy");
});

test("Divine's Chosen activates the selected Divine damage type", () => {
  const result = collectWorshipBenefits({
    system: { details: { worship: "Athena" } },
    items: [
      {
        name: "Divine's Chosen",
        type: "breakthrough",
        flags: { "lyrian-chronicles": { stableId: "breakthrough--divine-s-chosen" } },
        system: { description: "Choose a Divine." }
      },
      {
        name: "Divine Weapon",
        type: "ability",
        system: { benefits: "Your weapon may deal your chosen Divine's damage." }
      }
    ]
  });

  assert.equal(result.active, true);
  assert.equal(result.damageType, "Lightning");
  assert.deepEqual(result.relatedBenefits, ["Divine Weapon"]);
});

test("Divine's Chosen does not activate an unrecognized custom faith", () => {
  const result = collectWorshipBenefits({
    system: { details: { worship: "Unknown Saint" } },
    items: [{ name: "Divine's Chosen", type: "breakthrough", system: {} }]
  });

  assert.equal(result.hasDivinesChosen, true);
  assert.equal(result.active, false);
  assert.equal(result.damageType, "");
});
