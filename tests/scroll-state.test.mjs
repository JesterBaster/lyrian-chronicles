import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { captureScroll, restoreScroll } from "../module/rules/scroll-state.mjs";

/** Minimal stand-in for the application root and its scrolling child. */
function application(scrollTop = 0, { missing = false } = {}) {
  const content = { scrollTop };
  return {
    content,
    element: {
      querySelector: (selector) =>
        (!missing && selector === ".window-content") ? content : null
    }
  };
}

test("the window's scroll offset is captured", () => {
  const app = application(420);
  assert.equal(captureScroll(app.element), 420);
});

test("capturing tolerates an application that is not rendered", () => {
  assert.equal(captureScroll(null), 0);
  assert.equal(captureScroll(undefined), 0);
  assert.equal(captureScroll({}), 0);
  assert.equal(captureScroll(application(0, { missing: true }).element), 0);
});

test("a captured offset is written back after the swap", () => {
  const app = application(0);
  restoreScroll(app.element, 420);
  assert.equal(app.content.scrollTop, 420);
});

test("restoring never forces a jump to the top", () => {
  // Zero is both the default and what a collapsed container reports, so
  // writing it could only undo a legitimate position.
  const app = application(150);
  restoreScroll(app.element, 0);
  assert.equal(app.content.scrollTop, 150);
  restoreScroll(app.element, -20);
  assert.equal(app.content.scrollTop, 150);
  restoreScroll(app.element, "nonsense");
  assert.equal(app.content.scrollTop, 150);
});

test("restoring tolerates an application that is not rendered", () => {
  assert.doesNotThrow(() => restoreScroll(null, 100));
  assert.doesNotThrow(() => restoreScroll({}, 100));
  assert.doesNotThrow(() => restoreScroll(application(0, { missing: true }).element, 100));
});

test("both re-rendering applications preserve scroll across a part swap", () => {
  // The creation wizard re-renders on every skill +/-, and the actor sheet
  // re-renders on every document write, so both need the pair.
  for (const path of ["module/apps/character-creation.mjs", "module/sheets/actor-sheet.mjs"]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /_preSyncPartState\(partId, newElement, priorElement, state\)/, path);
    assert.match(source, /state\.lyrianScrollTop = captureScroll\(this\.element\)/, path);
    assert.match(source, /restoreScroll\(this\.element, state\.lyrianScrollTop\)/, path);
    // Dropping the super call would discard Foundry's own focus and
    // scrollable-element handling.
    assert.match(source, /super\._preSyncPartState\?\.\(/, path);
    assert.match(source, /super\._syncPartState\?\.\(/, path);
  }
});
