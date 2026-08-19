import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { damageTypeChoices, resolveDamageType } from "../module/rules/damage-types.mjs";
import { LYRIAN } from "../module/config.mjs";

const helpers = { localize: (key) => key };

const flatten = (groups) => groups.flatMap((group) => group.options);
const keysOf = (groups) => flatten(groups).map((option) => option.key);

test("every configured damage type reaches the picker", () => {
  const groups = damageTypeChoices(LYRIAN.damageTypes, helpers);
  assert.deepEqual(keysOf(groups).sort(), Object.keys(LYRIAN.damageTypes).sort());

  // The ones the request named, each in its rulebook group.
  const groupOf = (key) => groups.find((g) => g.options.some((o) => o.key === key))?.group;
  assert.equal(groupOf("slashing"), "physical");
  assert.equal(groupOf("poison"), "physical");
  assert.equal(groupOf("water"), "magic");
  assert.equal(groupOf("frost"), "magic");
  assert.equal(groupOf("dark"), "divine");
  assert.equal(groupOf("astra"), "astra");
});

test("options keep config order, so a sub-type stays under its parent", () => {
  const keys = keysOf(damageTypeChoices(LYRIAN.damageTypes, helpers));
  // Sorting alphabetically would scatter these away from what they narrow.
  assert.ok(keys.indexOf("physical") < keys.indexOf("slashing"));
  assert.ok(keys.indexOf("earth") < keys.indexOf("acid"));
  assert.ok(keys.indexOf("dark") < keys.indexOf("necrotic"));

  const bySub = Object.fromEntries(
    flatten(damageTypeChoices(LYRIAN.damageTypes, helpers)).map((o) => [o.key, o.parent]));
  assert.equal(bySub.slashing, "physical");
  assert.equal(bySub.acid, "earth");
  assert.equal(bySub.necrotic, "dark");
  assert.equal(bySub.fire, "", "a top-level type has no parent");
});

test("groups are labelled, and every label has a string", () => {
  const groups = damageTypeChoices(LYRIAN.damageTypes, helpers);
  const lang = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
  for (const group of groups) {
    assert.equal(group.label, `LYRIAN.DamageGroup.${group.group}`);
    assert.ok(group.label in lang, `${group.label} has no localization`);
  }
  for (const option of flatten(groups)) assert.ok(option.label in lang, option.label);
});

test("the current type is marked once, not compared in the template", () => {
  const groups = damageTypeChoices(LYRIAN.damageTypes, { ...helpers, selected: "frost" });
  const chosen = flatten(groups).filter((option) => option.selected);
  assert.deepEqual(chosen.map((option) => option.key), ["frost"]);
});

test("an unknown or blank selection falls back rather than selecting nothing", () => {
  for (const value of ["", null, undefined, "sonic"]) {
    const chosen = flatten(damageTypeChoices(LYRIAN.damageTypes, { ...helpers, selected: value }))
      .filter((option) => option.selected);
    assert.deepEqual(chosen.map((option) => option.key), ["physical"],
      `${value} should fall back to physical`);
  }
});

test("resolveDamageType keeps a real type and replaces a broken one", () => {
  assert.equal(resolveDamageType("dark", LYRIAN.damageTypes), "dark");
  // A type dropped from the config, or a blank left by an import, would
  // otherwise reach the chat card as an empty label and read as untyped.
  assert.equal(resolveDamageType("sonic", LYRIAN.damageTypes), "physical");
  assert.equal(resolveDamageType("", LYRIAN.damageTypes), "physical");
  assert.equal(resolveDamageType(undefined, LYRIAN.damageTypes), "physical");
  assert.equal(resolveDamageType("", LYRIAN.damageTypes, "astra"), "astra");
});

/* -------------------------------------------- */
/*  Wiring                                       */
/* -------------------------------------------- */

test("both attack rows carry a picker", () => {
  const overview = readFileSync(
    new URL("../templates/actor/tab-main.hbs", import.meta.url), "utf8");

  assert.match(overview, /\{\{#\*inline "damageTypePicker"\}\}/);
  assert.match(overview, /damageTypePicker scope="universal" choices=universalDamageTypeChoices/);
  assert.match(overview, /damageTypePicker scope="weapon" choices=row\.damageTypeChoices/);

  // Handlebars resolves an inline partial only after its declaration, and the
  // monster stat block at the top of the file uses this one too.
  assert.ok(
    overview.indexOf('{{#*inline "damageTypePicker"}}') < overview.indexOf("{{> damageTypePicker"),
    "the partial must be declared before its first use"
  );

  // Selection is read off the option, not climbed to through the two nested
  // eaches — that depth changes silently whenever the markup is rearranged.
  assert.match(overview, /\{\{#if option\.selected\}\}selected\{\{\/if\}\}/);
  assert.doesNotMatch(overview, /\.\.\/\.\.\/selected/);

  // A weapon's type lives on its Item, so a form name here would aim the
  // actor's own submit at a path it does not have.
  const picker = overview.slice(overview.indexOf('{{#*inline "damageTypePicker"'));
  assert.equal(picker.slice(0, picker.indexOf("{{/inline}}")).includes('name="'), false);
});

test("changing the picker writes to the right document", () => {
  const sheet = readFileSync(new URL("../module/sheets/actor-sheet.mjs", import.meta.url), "utf8");
  const start = sheet.indexOf('this.#bindOnce("[data-damage-type]"');
  assert.notEqual(start, -1, "the picker is never bound");
  const handler = sheet.slice(start, sheet.indexOf("\n    });", start));

  // An unknown value from an edited select must not be stored.
  assert.match(handler, /if \(!LYRIAN\.damageTypes\[damageType\]\) return/);
  // Unarmed lives on the actor; a weapon's type lives on the Item.
  assert.match(handler, /"system\.universalDamageType": damageType/);
  assert.match(handler, /"system\.damageType": damageType/);
});

test("the rolled attack uses the chosen type", () => {
  const item = readFileSync(new URL("../module/documents/item.mjs", import.meta.url), "utf8");
  assert.match(item, /damageType: resolveDamageType\(this\.system\.damageType, LYRIAN\.damageTypes\)/);

  // Both weaponless attacks — a character's unarmed strike and a monster's
  // stat-block attack — were hardcoded to physical. That is what made the
  // picker necessary, so neither may go back to a literal.
  const actor = readFileSync(new URL("../module/documents/actor.mjs", import.meta.url), "utf8");
  assert.equal(
    (actor.match(/damageType: resolveDamageType\(this\.system\.universalDamageType/g) ?? []).length,
    2
  );
  assert.doesNotMatch(actor, /damageType: "physical"/);
});

test("the unarmed type is stored, and the schema change is migrated", () => {
  const schema = readFileSync(new URL("../module/data/actor.mjs", import.meta.url), "utf8");
  assert.match(schema, /schema\.universalDamageType = new fields\.StringField/);
  assert.match(schema, /choices: Object\.keys\(LYRIAN\.damageTypes\)/);

  const migration = readFileSync(
    new URL("../migrations/0.6.29.mjs", import.meta.url), "utf8");
  assert.match(migration, /system\.universalDamageType/);
  const versions = readFileSync(new URL("../migrations/migrate.mjs", import.meta.url), "utf8");
  assert.match(versions, /"0\.6\.29"/);
});
