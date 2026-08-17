import assert from "node:assert/strict";
import test from "node:test";

import { LyrianAPI, LYRIAN_HOOKS } from "../module/api.mjs";

test("public API exposes stable crafting chat data", () => {
  const craft = { projectName: "Greaves", success: true };
  const message = { flags: { "lyrian-chronicles": { craft } } };

  assert.equal(LyrianAPI.getCraftData(message), craft);
  assert.equal(LyrianAPI.getCraftData({}), null);
  assert.equal(LYRIAN_HOOKS.craft, "lyrianCraft");
});
