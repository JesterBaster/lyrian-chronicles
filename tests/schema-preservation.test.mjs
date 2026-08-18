import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  isSystemPackDocument,
  schemaPreservationReporter
} from "../module/rules/schema-versioning.mjs";

/** Capture console output for the duration of one call. */
function captured(run) {
  const warn = console.warn;
  const log = console.log;
  const lines = { warn: [], log: [] };
  console.warn = (message) => lines.warn.push(message);
  console.log = (message) => lines.log.push(message);
  try { run(); } finally { console.warn = warn; console.log = log; }
  return lines;
}

test("documents in the system's own packs are recognised", () => {
  assert.equal(isSystemPackDocument({ pack: "lyrian-chronicles.monsters" }), true);
  assert.equal(isSystemPackDocument({ pack: "world.my-homebrew" }), false);
  assert.equal(isSystemPackDocument({ pack: "dnd5e.monsters" }), false);
  // A world document has no pack at all.
  assert.equal(isSystemPackDocument({}), false);
  assert.equal(isSystemPackDocument(null), false);
});

test("shipped pack content is summarized, not listed one line at a time", () => {
  const lines = captured(() => {
    const report = schemaPreservationReporter("0.6.14");
    for (let i = 0; i < 70; i += 1) {
      report.preserve("Actor", { pack: "lyrian-chronicles.monsters", uuid: `A.${i}` }, 2);
    }
    report.summarize();
  });

  // Seventy monsters used to mean seventy warnings, each with a stack trace.
  assert.equal(lines.warn.length, 0);
  assert.equal(lines.log.length, 1);
  assert.match(lines.log[0], /0\.6\.14: left 70 shipped compendium documents/);
});

test("a world document ahead of the migration still warns individually", () => {
  // This one means the system was rolled back, which is worth seeing.
  const lines = captured(() => {
    const report = schemaPreservationReporter("0.6.14");
    report.preserve("Actor", { uuid: "Actor.homebrew" }, 3);
    report.summarize();
  });

  assert.equal(lines.warn.length, 1);
  assert.match(lines.warn[0], /Preserving future Actor schema 3 on Actor\.homebrew/);
  assert.equal(lines.log.length, 0);
});

test("nothing is logged when nothing was preserved", () => {
  const lines = captured(() => schemaPreservationReporter("0.6.14").summarize());
  assert.equal(lines.warn.length, 0);
  assert.equal(lines.log.length, 0);
});

test("both migrations report through the collector", () => {
  for (const version of ["0.6.14", "0.6.25"]) {
    const source = readFileSync(`migrations/${version}.mjs`, "utf8");
    assert.match(source, /schemaPreservationReporter\("/, version);
    assert.match(source, /report\.preserve\(/, version);
    assert.match(source, /report\.summarize\(\)/, version);
    // Only the reporting changed. A migration that already shipped must keep
    // leaving an ahead-of-baseline document exactly as it found it.
    assert.match(source, /return;/, version);
    assert.ok(!/console\.warn/.test(source), `${version} should not warn directly`);
  }
});
