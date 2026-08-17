import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { matchesSearch, normalizeSearchQuery } from "../module/rules/search-filter.mjs";

test("search matches anywhere in the name, not just the start", () => {
  assert.equal(matchesSearch("Blood Drain", "drain"), true);
  assert.equal(matchesSearch("Blood Drain", "blood"), true);
  assert.equal(matchesSearch("Blood Drain", "ood dra"), true);
  assert.equal(matchesSearch("Blood Drain", "cleric"), false);
});

test("search ignores case and surrounding whitespace", () => {
  assert.equal(matchesSearch("Cure Touch", "CURE"), true);
  assert.equal(matchesSearch("Cure Touch", "  cure  "), true);
  assert.equal(normalizeSearchQuery("  MiXeD  "), "mixed");
});

test("an empty query restores the whole list", () => {
  assert.equal(matchesSearch("Anything", ""), true);
  assert.equal(matchesSearch("Anything", "   "), true);
  assert.equal(matchesSearch("Anything", undefined), true);
});

test("a nameless entry only survives an empty query", () => {
  assert.equal(matchesSearch(undefined, ""), true);
  assert.equal(matchesSearch(undefined, "x"), false);
});

test("the filter class beats the component display rules it must override", () => {
  const css = readFileSync("styles/lyrian.css", "utf8");
  const template = readFileSync("templates/apps/character-creation.hbs", "utf8");

  const rule = css.match(/\.lyrian \.is-filtered \{([^}]*)\}/);
  assert.ok(rule, "expected an .is-filtered rule");
  const important = /display:\s*none\s*!important/.test(rule[1]);

  // Every class that can carry is-filtered, taken from the markup rather than
  // hardcoded, so a new filtered element is covered automatically.
  const carriers = new Set();
  for (const [, attr] of template.matchAll(/class="([^"]*)"[^>]*data-search-(?:name|empty)/g)) {
    // Drop Handlebars expressions so only literal class names remain.
    for (const name of attr.replace(/\{\{[^}]*\}\}/g, " ").split(/\s+/)) {
      if (/^[a-z][\w-]*$/i.test(name) && name !== "is-filtered") carriers.add(name);
    }
  }
  assert.ok(carriers.size > 0, "expected to find filtered elements in the markup");

  // A component rule setting display at the same specificity, declared later,
  // silently wins over the utility — which is exactly how search broke.
  for (const carrier of carriers) {
    const competing = new RegExp(`\\.lyrian \\.${carrier} \\{[^}]*display:`).test(css);
    if (competing) {
      assert.ok(
        important,
        `.${carrier} sets display, so .is-filtered must be !important to override it`
      );
    }
  }
});
