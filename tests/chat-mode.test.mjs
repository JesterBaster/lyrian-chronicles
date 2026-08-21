import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { applyChatMode } from "../module/rules/chat-content.mjs";

test("the current core method is preferred", () => {
  const calls = [];
  const ChatMessage = {
    applyMode(data, mode) { calls.push(["applyMode", data, mode]); },
    applyRollMode(data, mode) { calls.push(["applyRollMode", data, mode]); }
  };
  const data = { content: "x" };
  const returned = applyChatMode(data, "gmroll", ChatMessage);

  assert.deepEqual(calls, [["applyMode", data, "gmroll"]]);
  assert.equal(returned, data, "the core method mutates in place; so must this");
});

test("a core that predates the v14 rename still works", () => {
  const calls = [];
  const ChatMessage = {
    applyRollMode(data, mode) { calls.push([data, mode]); }
  };
  applyChatMode({ content: "x" }, "blindroll", ChatMessage);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], "blindroll");
});

test("a core with neither method is survived, not thrown through", () => {
  const data = { content: "x" };
  assert.equal(applyChatMode(data, "publicroll", {}), data);
  assert.equal(applyChatMode(data, "publicroll", undefined), data);
});

test("nothing calls the deprecated method directly any more", () => {
  // Deprecated in v14, removed in v16. One helper names the core API so the
  // next rename is a single edit rather than a hunt through the documents.
  for (const file of ["../module/documents/actor.mjs", "../module/documents/item.mjs"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /ChatMessage\.applyRollMode/, file);
    assert.match(source, /applyChatMode\(/, `${file} should route through the helper`);
  }
});
