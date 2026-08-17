import assert from "node:assert/strict";
import test from "node:test";

import {
  escapeChatText,
  prepareItemChatContent
} from "../module/rules/chat-content.mjs";

test("plain chat fields escape stored markup", () => {
  const payload = '<img src=x onerror="globalThis.pwned=true"><script>alert(1)</script>';

  assert.equal(
    escapeChatText(payload),
    "&lt;img src=x onerror=&quot;globalThis.pwned=true&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"
  );
});

test("item chat content is cleaned after enrichment", async () => {
  const calls = [];
  const result = await prepareItemChatContent({
    description: '<p onclick="attack()">Safe text</p>',
    requirement: '<img src=x onerror="attack()">@UUID[Item.safe]{Safe Link}',
    enrichOptions: { relativeTo: "item" },
    enrichHTML: async (content, options) => {
      calls.push({ type: "enrich", content, options });
      return `<enriched>${content}</enriched>`;
    },
    cleanHTML: (content) => {
      calls.push({ type: "clean", content });
      return content.replace(/ onclick="[^"]*"/g, "");
    }
  });

  assert.equal(
    calls[1].content,
    "&lt;img src=x onerror=&quot;attack()&quot;&gt;@UUID[Item.safe]{Safe Link}"
  );
  assert.deepEqual(calls.map(({ type }) => type), ["enrich", "enrich", "clean", "clean"]);
  assert.equal(result.enrichedDescription, "<enriched><p>Safe text</p></enriched>");
  assert.match(result.enrichedRequirement, /&lt;img/);
  assert.match(result.enrichedRequirement, /@UUID\[Item\.safe\]/);
});
