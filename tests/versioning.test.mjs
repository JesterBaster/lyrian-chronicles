import assert from "node:assert/strict";
import test from "node:test";

import { compareVersions, pendingMigrationVersions } from "../module/rules/versioning.mjs";

test("numeric versions compare in release order", () => {
  assert.equal(compareVersions("0.6.10", "0.6.9"), 1);
  assert.equal(compareVersions("0.6.5", "0.6.5"), 0);
  assert.equal(compareVersions("0.5.9", "0.6.0"), -1);
});

test("an unlisted package version does not rerun old migrations", () => {
  const versions = ["0.3.1", "0.5.5", "0.7.0"];
  assert.deepEqual(pendingMigrationVersions("0.6.5", "0.7.0", versions), ["0.7.0"]);
});
