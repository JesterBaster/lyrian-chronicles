import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import { queueDocumentWrite } from "../module/rules/action-transactions.mjs";
import { withCollapsed } from "../module/rules/collapsible.mjs";

/** A document whose stored value is read and rewritten whole, as flags are. */
function store(initial = {}) {
  const doc = {
    value: initial,
    async read() { return doc.value; },
    async write(next) {
      // A round trip to the server, which is the window the race lived in.
      await new Promise((resolve) => setTimeout(resolve, 1));
      doc.value = next;
    }
  };
  return doc;
}

test("overlapping read-modify-write loses an edit when unserialized", async () => {
  const doc = store({});
  // Demonstrates the bug being fixed: both handlers read {} before either writes.
  await Promise.all([
    (async () => doc.write(withCollapsed(await doc.read(), "skills", "fitness", true)))(),
    (async () => doc.write(withCollapsed(await doc.read(), "skills", "might", true)))()
  ]);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(Object.keys(doc.value).length, 1, "one of the two folds is dropped");
});

test("queueing makes each write see the previous result", async () => {
  const doc = store({});
  await Promise.all([
    queueDocumentWrite(doc, async () =>
      doc.write(withCollapsed(await doc.read(), "skills", "fitness", true))),
    queueDocumentWrite(doc, async () =>
      doc.write(withCollapsed(await doc.read(), "skills", "might", true)))
  ]);
  assert.deepEqual(doc.value, { "skills:fitness": true, "skills:might": true });
});

test("queues are per document, so unrelated writes still run together", async () => {
  const first = store({});
  const second = store({});
  await Promise.all([
    queueDocumentWrite(first, async () =>
      first.write(withCollapsed(await first.read(), "skills", "fitness", true))),
    queueDocumentWrite(second, async () =>
      second.write(withCollapsed(await second.read(), "abilities", "racial", true)))
  ]);
  assert.deepEqual(first.value, { "skills:fitness": true });
  assert.deepEqual(second.value, { "abilities:racial": true });
});

test("a failing write does not wedge the queue behind it", async () => {
  const doc = store({});
  await assert.rejects(
    queueDocumentWrite(doc, async () => { throw new Error("denied"); })
  );
  await queueDocumentWrite(doc, async () =>
    doc.write(withCollapsed(await doc.read(), "skills", "fitness", true)));
  assert.deepEqual(doc.value, { "skills:fitness": true });
});

test("both stored maps on the sheet are written through the queue", () => {
  const source = readFileSync("module/sheets/actor-sheet.mjs", "utf8");

  // Fold state: reads the whole flag and writes it back.
  const fold = source.slice(source.indexOf("details[data-collapse-scope] > summary"));
  assert.match(fold.slice(0, 1400), /queueDocumentWrite\(game\.user/);

  // Proficiency choices: reads the whole selection map and writes it back.
  // Anchored on the definition: the name also appears at its call site.
  const choice = source.slice(source.indexOf("static async #onSaveProficiencyChoice"));
  assert.match(choice.slice(0, 600), /queueDocumentWrite\(this\.document/);
});

test("no handler is registered as an action without a template using it", () => {
  const source = readFileSync("module/sheets/actor-sheet.mjs", "utf8");
  const block = source.match(/actions:\s*\{([\s\S]*?)\n\s{4}\}/)[1];
  const registered = [...block.matchAll(/^\s*(\w+)\s*:/gm)].map((m) => m[1]);

  const markup = readdirSync("templates/actor")
    .filter((name) => name.endsWith(".hbs"))
    .map((name) => readFileSync(`templates/actor/${name}`, "utf8"))
    .join("\n");

  for (const action of registered) {
    assert.ok(
      markup.includes(`data-action="${action}"`),
      `${action} is registered but no template triggers it`
    );
  }
});
