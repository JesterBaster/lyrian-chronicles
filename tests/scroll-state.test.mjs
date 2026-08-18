import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { captureScroll, restoreScroll } from "../module/rules/scroll-state.mjs";

/** Stand-in for an application root, given selector -> scrollTop values. */
function application(map = {}) {
  const nodes = {};
  for (const [selector, tops] of Object.entries(map)) {
    nodes[selector] = tops.map((scrollTop) => ({ scrollTop }));
  }
  return { nodes, element: { querySelectorAll: (selector) => nodes[selector] ?? [] } };
}

test("offsets are captured per element and keyed by position", () => {
  const app = application({ ".window-content": [420] });
  assert.deepEqual(captureScroll(app.element), { ".window-content|0": 420 });
});

test("a scroller inside the replaced part is captured too", () => {
  // The creation wizard scrolls .lyr-creation-step, not .window-content. Only
  // looking at the window meant the wizard's offset was never saved at all.
  const app = application({ ".window-content": [0], ".lyr-creation-step": [260] });
  assert.deepEqual(captureScroll(app.element), { ".lyr-creation-step|0": 260 });
});

test("resting offsets are not recorded", () => {
  const app = application({ ".window-content": [0], ".lyr-tab": [0, 0] });
  assert.deepEqual(captureScroll(app.element), {});
});

test("capturing tolerates an application that is not rendered", () => {
  assert.deepEqual(captureScroll(null), {});
  assert.deepEqual(captureScroll(undefined), {});
  assert.deepEqual(captureScroll({}), {});
});

test("offsets are written back onto whatever now holds the same position", () => {
  const app = application({ ".window-content": [0], ".lyr-creation-step": [0] });
  restoreScroll(app.element, { ".window-content|0": 420, ".lyr-creation-step|0": 260 });
  assert.equal(app.nodes[".window-content"][0].scrollTop, 420);
  assert.equal(app.nodes[".lyr-creation-step"][0].scrollTop, 260);
});

test("several scrollers of one kind keep their own offsets", () => {
  const app = application({ ".lyr-tab": [0, 0, 0] });
  restoreScroll(app.element, { ".lyr-tab|0": 10, ".lyr-tab|2": 30 });
  assert.deepEqual(app.nodes[".lyr-tab"].map((n) => n.scrollTop), [10, 0, 30]);
});

test("restoring never forces a jump to the top", () => {
  const app = application({ ".window-content": [150] });
  for (const bad of [0, -20, "nonsense", null]) {
    restoreScroll(app.element, { ".window-content|0": bad });
    assert.equal(app.nodes[".window-content"][0].scrollTop, 150);
  }
});

test("restoring tolerates missing elements and malformed state", () => {
  const app = application({ ".window-content": [0] });
  assert.doesNotThrow(() => restoreScroll(null, { ".window-content|0": 10 }));
  assert.doesNotThrow(() => restoreScroll(app.element, null));
  assert.doesNotThrow(() => restoreScroll(app.element, { "no-divider": 10 }));
  assert.doesNotThrow(() => restoreScroll(app.element, { ".missing|0": 10 }));
});

test("both re-rendering applications capture early and restore after render", () => {
  for (const path of ["module/apps/character-creation.mjs", "module/sheets/actor-sheet.mjs"]) {
    const source = readFileSync(path, "utf8");
    // Captured once before the first part is swapped, since a scroller inside
    // the part no longer exists by the time the replacement is in place.
    assert.match(source, /#scrollOffsets \?\?= captureScroll\(this\.element\)/, path);
    // Restored from _onRender rather than _syncPartState, so every part is
    // present and the page is its final height before the offset is written.
    assert.match(source, /restoreScroll\(this\.element, this\.#scrollOffsets\)/, path);
    assert.match(source, /this\.#scrollOffsets = null/, path);
  }
});
