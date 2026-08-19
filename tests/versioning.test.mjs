import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import { compareVersions, pendingMigrationVersions } from "../module/rules/versioning.mjs";

test("numeric versions compare in release order", () => {
  assert.equal(compareVersions("0.6.10", "0.6.9"), 1);
  assert.equal(compareVersions("0.6.5", "0.6.5"), 0);
  assert.equal(compareVersions("0.5.9", "0.6.0"), -1);
  assert.equal(compareVersions("v0.7.0", "0.7.0"), 0);
});

test("prerelease identifiers follow semantic-version precedence", () => {
  assert.equal(compareVersions("0.7.0-beta", "0.7.0"), -1);
  assert.equal(compareVersions("0.7.0-beta.2", "0.7.0-beta.10"), -1);
  assert.equal(compareVersions("0.7.0-rc.1", "0.7.0-beta.9"), 1);
  assert.equal(compareVersions("0.7.0+build.2", "0.7.0+build.1"), 0);
});

test("an unlisted package version does not rerun old migrations", () => {
  const versions = ["0.3.1", "0.5.5", "0.7.0"];
  assert.deepEqual(pendingMigrationVersions("0.6.5", "0.7.0", versions), ["0.7.0"]);
});

/* -------------------------------------------- */
/*  The manifest and the migration list          */
/* -------------------------------------------- */

test("the manifest version, its download URL and the migration list agree", () => {
  const root = new URL("../", import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL("system.json", root), "utf8"));
  const listed = [...readFileSync(new URL("migrations/migrate.mjs", root), "utf8")
    .matchAll(/^\s*"(\d+\.\d+\.\d+[^"]*)",?$/gm)].map((match) => match[1]);

  // Written as a literal in two places, so they drift apart silently: a world
  // opened on the new version would skip the migration that version added.
  assert.ok(listed.length > 0, "no migration versions were found");
  assert.ok(
    manifest.download.includes(`/${manifest.version}/`),
    `download URL ${manifest.download} does not name version ${manifest.version}`
  );

  const newest = listed.at(-1);
  assert.ok(
    compareVersions(newest, manifest.version) <= 0,
    `migration ${newest} is newer than the manifest version ${manifest.version}`
  );

  // Every listed version needs a file, and every file needs listing — an
  // unlisted migration never runs.
  const files = readdirSync(new URL("migrations/", root))
    .filter((name) => /^\d+\.\d+\.\d+\.mjs$/.test(name))
    .map((name) => name.replace(/\.mjs$/, ""));
  assert.deepEqual([...listed].sort(), [...files].sort());
});
