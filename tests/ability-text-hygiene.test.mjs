import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const pack = (prefix) => readdirSync(new URL("../content/", import.meta.url))
  .filter((f) => new RegExp(`^${prefix}-\\d{2}\\.json$`).test(f))
  .flatMap((f) => JSON.parse(readFileSync(new URL(`../content/${f}`, import.meta.url), "utf8")));
const abilities = pack("player-abilities");
const byName = (name) => abilities.find((d) => d.name === name);

test("key abilities carry no website labels as benefits", () => {
  // The 0.13.1 site capture read section headings ("ASSOCIATED ABILITY") and
  // linked ability names into benefit 2-4, which the feed leaves empty. They
  // rendered as extra "Benefit 3: ASSOCIATED ABILITY" sections.
  const dirty = abilities.filter((d) => /ASSOCIATED ABILITY/.test(d.system.description)).map((d) => d.name);
  assert.deepEqual(dirty, []);
  assert.doesNotMatch(byName("Aerial Mage").system.description, /Benefit 3/);
});

test("monster matchups keep the feed's separators", () => {
  const amanita = pack("monsters").find((d) => d.name === "Amanita Mushroom");
  assert.equal(amanita.system.details.strongAgainst, "Melee heavy parties, tight spaces");
});

test("an ability's stated attack type is pre-filled, with the attack still off", () => {
  assert.equal(byName("Disarming Attack").system.attackType, "heavy");
  assert.equal(byName("Flowing Kick").system.attackType, "heavy");
  assert.equal(byName("Benediction").system.attackType, "precise");
  assert.equal(byName("Silentium").system.attackType, "light");
  assert.ok(abilities.every((d) => d.system.hasAttack === false));
});
