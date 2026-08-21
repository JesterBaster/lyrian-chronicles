import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

globalThis.game = {
  i18n: {
    format: (key, data) => (key === "LYRIAN.Roll.NamedCheck" ? `${data.name} Check` : key)
  }
};

const { buildCheckPayload, namedCheckTitle } = await import("../module/rules/check-card.mjs");

test("a bare stat or defence name becomes a named check", () => {
  assert.equal(namedCheckTitle("Power"), "Power Check");
  assert.equal(namedCheckTitle("Guard"), "Guard Check");
  assert.equal(namedCheckTitle("Evasion"), "Evasion Check");
});

test("an expertise suffix stays outside the word Check", () => {
  // "Athletics Check (Climbing)" reads correctly where the alternative,
  // "Athletics (Climbing) Check", does not.
  assert.equal(namedCheckTitle("Athletics", " (Climbing)"), "Athletics Check (Climbing)");
});

test("a missing label does not produce a stray Check", () => {
  assert.equal(namedCheckTitle(""), "");
  assert.equal(namedCheckTitle(undefined), "");
  assert.equal(namedCheckTitle("   "), "");
});

test("check payload records the outcome when a DC was set", () => {
  assert.deepEqual(buildCheckPayload({
    actorUuid: "Actor.abc",
    title: "Power Check",
    roll: { total: 17, formula: "1d20 + 4" },
    outcome: { dc: 15, success: true }
  }), {
    actorUuid: "Actor.abc",
    title: "Power Check",
    total: 17,
    formula: "1d20 + 4",
    dc: 15,
    success: true
  });
});

test("check payload leaves DC and success null for an untargeted roll", () => {
  const payload = buildCheckPayload({
    actorUuid: "Actor.abc",
    title: "Power Check",
    roll: { total: 9, formula: "1d20 + 4" },
    outcome: null
  });
  assert.equal(payload.dc, null);
  assert.equal(payload.success, null);
});

test("rolls that already read as a complete phrase are not renamed", () => {
  const source = readFileSync("module/documents/actor.mjs", "utf8");
  // Crafting Check, Gathering Check, Save and Initiative supply their own
  // wording; routing them through namedCheckTitle would say "Check" twice.
  for (const key of ["CraftingCheck", "GatheringCheck", "Roll.Save", "Roll.Initiative"]) {
    const line = source.split("\n").find((row) => row.includes(key) && row.includes("flavour"));
    assert.ok(line, `expected a flavour line for ${key}`);
    assert.ok(
      !line.includes("namedCheckTitle"),
      `${key} already reads as a check and must not be wrapped again`
    );
  }
  assert.match(source, /flavour: namedCheckTitle\(label\)/);
  assert.match(source, /flavour: namedCheckTitle\(label, suffix\)/);
});

test("the check card honours roll mode and ships its template", () => {
  const source = readFileSync("module/documents/actor.mjs", "utf8");
  // Rendering a custom card bypasses Roll#toMessage, which is what normally
  // applies a blind or whispered roll mode. Named by intent rather than by
  // the core method, which was renamed in v14 — tests/chat-mode.test.mjs
  // covers the helper that absorbs that.
  assert.match(source, /applyChatMode\(messageData, game\.settings\.get\("core", "rollMode"\)\)/);
  assert.match(source, /templates\/chat\/check-card\.hbs/);

  const boot = readFileSync("module/lyrian.mjs", "utf8");
  assert.match(boot, /"chat\/check-card"/);
});

test("chat cards declare every custom property they use", () => {
  const css = readFileSync("styles/lyrian.css", "utf8");
  const block = css.slice(css.indexOf(".lyrian-card {"));
  const declared = new Set(
    [...block.slice(0, block.indexOf("}")).matchAll(/(--lyr-[a-z-]+):/g)].map((m) => m[1])
  );
  // Cards render outside .application.lyrian, so they inherit none of the
  // sheet palette — an undeclared variable silently renders as nothing.
  const cardRules = [...css.matchAll(/\.lyrian-card[^{]*\{([^}]*)\}/g)].map((m) => m[1]).join(" ");
  for (const [, used] of cardRules.matchAll(/var\((--lyr-[a-z-]+)\)/g)) {
    assert.ok(declared.has(used), `${used} is used by a chat card but never declared on .lyrian-card`);
  }
});
