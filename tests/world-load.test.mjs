import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ENTRY = readFileSync(new URL("../module/lyrian.mjs", import.meta.url), "utf8");
const ACTOR = readFileSync(new URL("../module/documents/actor.mjs", import.meta.url), "utf8");
const LANG = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));

/** The body of the ready hook, where world load is sequenced. */
function readyHook() {
  const at = ENTRY.indexOf('Hooks.once("ready"');
  assert.notEqual(at, -1, "there is no ready hook");
  return ENTRY.slice(at);
}

test("a seeding failure cannot skip the migrations", () => {
  const body = readyHook();
  // seedSystemPacks throws outright when the content index is missing. That
  // rejection escaped the hook, so runMigrations was never reached and the
  // world stayed un-migrated with only a console trace to explain it.
  const seedAt = body.indexOf("await seedSystemPacks()");
  const migrateAt = body.indexOf("await runMigrations(");
  assert.ok(seedAt !== -1 && migrateAt !== -1);
  assert.ok(seedAt < migrateAt, "content is refreshed before schema is migrated");

  // Each is guarded on its own, so neither can take the other down.
  const between = body.slice(seedAt, migrateAt);
  assert.match(between, /catch \(err\)/, "seeding is not isolated from migrations");
  assert.match(body.slice(0, seedAt), /try \{/);
});

test("both failures are reported to the GM, not just the console", () => {
  const body = readyHook();
  for (const key of ["LYRIAN.Seed.Failed", "LYRIAN.Migration.Interrupted"]) {
    assert.ok(body.includes(key), `${key} is never shown`);
    assert.ok(key in LANG, `${key} has no localization`);
  }
  // Permanent, because a half-loaded world is not something to miss in a
  // toast that fades.
  // To the semicolon: the call spans a nested `)` before its options object.
  const errors = [...body.matchAll(/ui\.notifications\.error\([\s\S]*?\);/g)];
  assert.equal(errors.length, 2);
  for (const [call] of errors) assert.match(call, /permanent: true/);
});

test("the migration run is guarded too", () => {
  const body = readyHook();
  const at = body.indexOf("await runMigrations(");
  assert.match(body.slice(at - 120, at), /try \{/);
});

/* -------------------------------------------- */
/*  A setting that used to do nothing            */
/* -------------------------------------------- */

test("turning off automatic Guard actually stops it being subtracted", () => {
  // autoApplyGuard has always been offered in the world options, with a name
  // and a hint, and nothing read it. Switching it off changed nothing.
  assert.match(ENTRY, /game\.settings\.register\(SYSTEM_ID, "autoApplyGuard"/);

  const at = ACTOR.indexOf("async #applyDamage");
  assert.notEqual(at, -1);
  const body = ACTOR.slice(at, ACTOR.indexOf("\n  /*", at));
  assert.match(body, /game\.settings\.get\("lyrian-chronicles", "autoApplyGuard"\)/);
  assert.match(body, /if \(!trueDamage && subtractGuard\)/);

  // The guard must be read before the branch that uses it.
  assert.ok(body.indexOf("subtractGuard =") < body.indexOf("if (!trueDamage && subtractGuard)"));
});

test("the setting still defaults to the behaviour tables already have", () => {
  const at = ENTRY.indexOf('"autoApplyGuard"');
  const registration = ENTRY.slice(at, ENTRY.indexOf("});", at));
  assert.match(registration, /default: true/,
    "changing the default would silently alter every existing world");
  assert.match(registration, /config: true/, "a setting nobody can reach is no better than a dead one");
  assert.match(registration, /scope: "world"/);
});

test("true damage still bypasses Guard regardless of the setting", () => {
  // The setting decides whether Guard applies at all; trueDamage already
  // meant "ignore Guard", and that must not become conditional on a toggle.
  const at = ACTOR.indexOf("async #applyDamage");
  const body = ACTOR.slice(at, ACTOR.indexOf("\n  /*", at));
  assert.match(body, /!trueDamage && subtractGuard/);
  assert.doesNotMatch(body, /subtractGuard && !trueDamage \|\|/);
});
