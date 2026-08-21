import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ACTOR = readFileSync(new URL("../module/documents/actor.mjs", import.meta.url), "utf8");
const ENTRY = readFileSync(new URL("../module/lyrian.mjs", import.meta.url), "utf8");

test("the delete list is re-checked against the collection before it is used", () => {
  const sync = ACTOR.slice(ACTOR.indexOf("async #syncProgressionFeatures"));
  const body = sync.slice(0, sync.indexOf("\n  /*"));

  // The scan happens before several awaits — fromUuid reaches a compendium —
  // and deleting a class cascades, so an id collected there can be gone by
  // the time the delete runs. deleteEmbeddedDocuments throws on a missing id,
  // and one bad id rejects the whole call, taking update and create with it.
  assert.match(body, /const removeIds = remove\.map\(\(item\) => item\.id\)\.filter\(\(id\) => this\.items\.has\(id\)\)/);
  assert.match(body, /if \(removeIds\.length\) await this\.deleteEmbeddedDocuments\("Item", removeIds\)/);
  assert.doesNotMatch(body, /deleteEmbeddedDocuments\("Item", remove\.map/);

  // The filter is worthless if it runs before the awaits it guards against.
  assert.ok(
    body.indexOf("await fromUuid") < body.indexOf("const removeIds"),
    "the re-check must come after the awaits that make the scan stale"
  );
});

test("the progression hook cannot raise an uncaught rejection", () => {
  const start = ENTRY.indexOf('for (const hook of ["createItem", "updateItem", "deleteItem"])');
  assert.notEqual(start, -1, "the progression sync hook is missing");
  const block = ENTRY.slice(start, ENTRY.indexOf("\n}", start));

  // An async hook handler's rejection has nobody to catch it: it surfaced as
  // an uncaught error whose stack pointed at the hook rather than the cause.
  assert.match(block, /try \{/);
  assert.match(block, /await item\.actor\.syncProgressionFeatures\(\)/);
  assert.match(block, /catch \(err\)/);
  assert.match(block, /console\.error\(/);

  // Reported, not swallowed silently.
  assert.doesNotMatch(block, /catch \([a-z]+\) \{\s*\}/);
});

test("every await in the hook body is inside the guard", () => {
  const start = ENTRY.indexOf('for (const hook of ["createItem", "updateItem", "deleteItem"])');
  const block = ENTRY.slice(start, ENTRY.indexOf("\n}", start));
  const tryAt = block.indexOf("try {");
  const awaits = [...block.matchAll(/await /g)].map((match) => match.index);
  assert.ok(awaits.length > 0);
  for (const at of awaits) {
    assert.ok(at > tryAt, "an await outside the try would still reject uncaught");
  }
});
