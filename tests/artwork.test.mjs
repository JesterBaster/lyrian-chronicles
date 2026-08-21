import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import {
  BLOCKED_IMAGE_HOSTS,
  FALLBACK_ARTWORK,
  fallbackArtwork,
  isBlockedImage,
  repairArtwork
} from "../module/rules/artwork.mjs";

const BLOCKED = "https://cdn.angelssword.com/ttrpg/assets/abc-Wolf_raw.sm.webp";

/* -------------------------------------------- */
/*  Recognising what a canvas cannot load        */
/* -------------------------------------------- */

test("the blocked host is recognised, and nothing else is", () => {
  assert.equal(isBlockedImage(BLOCKED), true);
  assert.equal(isBlockedImage("http://cdn.angelssword.com/x.webp"), true);

  // Local paths are what we replace it with, so they must never match.
  assert.equal(isBlockedImage("icons/svg/mystery-man.svg"), false);
  assert.equal(isBlockedImage("worlds/mine/tokens/wolf.webp"), false);
  assert.equal(isBlockedImage(""), false);
  assert.equal(isBlockedImage(null), false);
  assert.equal(isBlockedImage(undefined), false);

  // A GM's own remote art on any other host is theirs and stays.
  assert.equal(isBlockedImage("https://i.imgur.com/wolf.png"), false);
  assert.equal(isBlockedImage("https://rpg.angelssword.com/page"), false,
    "only the asset CDN blocks CORS, not the rulebook site");
});

test("a lookalike host in the path or query does not count", () => {
  // Matched on hostname, not as a substring: the real URLs carry UUIDs, and a
  // substring test would catch these too.
  assert.equal(isBlockedImage("https://example.com/cdn.angelssword.com/x.webp"), false);
  assert.equal(isBlockedImage("https://example.com/x.webp?from=cdn.angelssword.com"), false);
  assert.equal(isBlockedImage("https://cdn.angelssword.com.evil.test/x.webp"), false);
});

test("the fallback matches the type, with a sane default", () => {
  assert.equal(fallbackArtwork("monster"), "icons/svg/mystery-man.svg");
  assert.equal(fallbackArtwork("class"), "icons/svg/book.svg");
  assert.equal(fallbackArtwork("equipment"), "icons/svg/item-bag.svg");
  assert.equal(fallbackArtwork("weapon"), "icons/svg/mystery-man.svg");
  assert.equal(fallbackArtwork(undefined, "icons/svg/item-bag.svg"), "icons/svg/item-bag.svg");

  // Every fallback is a bundled core path, never another remote URL.
  for (const value of Object.values(FALLBACK_ARTWORK)) {
    assert.match(value, /^icons\/svg\/[a-z-]+\.svg$/, value);
    assert.equal(isBlockedImage(value), false);
  }
  assert.deepEqual(BLOCKED_IMAGE_HOSTS, ["cdn.angelssword.com"]);
});

/* -------------------------------------------- */
/*  Repairing a document already in a world      */
/* -------------------------------------------- */

test("a blocked portrait and token are both replaced", () => {
  const update = repairArtwork({
    type: "monster",
    img: BLOCKED,
    prototypeToken: { texture: { src: BLOCKED } }
  });
  assert.equal(update.img, "icons/svg/mystery-man.svg");
  assert.equal(update["prototypeToken.texture.src"], "icons/svg/mystery-man.svg");
  // The original is kept, not thrown away.
  assert.equal(update["flags.lyrian-chronicles.remoteImage"], BLOCKED);
});

test("a document with nothing blocked is left completely alone", () => {
  assert.equal(repairArtwork({ type: "monster", img: "icons/svg/mystery-man.svg" }), null);
  assert.equal(repairArtwork({ type: "class", img: "worlds/mine/art.webp" }), null);
  assert.equal(repairArtwork({}), null);
  assert.equal(repairArtwork(undefined), null);
});

test("a GM's own artwork is never overwritten", () => {
  // Only the blocked half is repaired: a custom token over a stock portrait,
  // and the reverse, both keep the part the GM chose.
  const customToken = repairArtwork({
    type: "monster",
    img: BLOCKED,
    prototypeToken: { texture: { src: "worlds/mine/wolf.webp" } }
  });
  assert.equal(customToken.img, "icons/svg/mystery-man.svg");
  assert.equal("prototypeToken.texture.src" in customToken, false);

  const customPortrait = repairArtwork({
    type: "monster",
    img: "worlds/mine/wolf.webp",
    prototypeToken: { texture: { src: BLOCKED } }
  });
  assert.equal("img" in customPortrait, false);
  assert.equal(customPortrait["prototypeToken.texture.src"], "icons/svg/mystery-man.svg");
  assert.equal(customPortrait["flags.lyrian-chronicles.remoteImage"], BLOCKED);
});

test("a remote URL already recorded is not overwritten", () => {
  const update = repairArtwork({
    type: "monster",
    img: BLOCKED,
    flags: { "lyrian-chronicles": { remoteImage: "https://cdn.angelssword.com/original.webp" } }
  });
  assert.equal(update.img, "icons/svg/mystery-man.svg");
  assert.equal("flags.lyrian-chronicles.remoteImage" in update, false,
    "the first recorded original is the real one");
});

test("the repair is idempotent", () => {
  const source = { type: "monster", img: BLOCKED, prototypeToken: { texture: { src: BLOCKED } } };
  const update = repairArtwork(source);
  const repaired = {
    type: "monster",
    img: update.img,
    prototypeToken: { texture: { src: update["prototypeToken.texture.src"] } },
    flags: { "lyrian-chronicles": { remoteImage: update["flags.lyrian-chronicles.remoteImage"] } }
  };
  assert.equal(repairArtwork(repaired), null, "a second pass must find nothing to do");
});

/* -------------------------------------------- */
/*  The shipped content                          */
/* -------------------------------------------- */

test("no shipped document points its artwork at a blocked host", () => {
  const root = new URL("../content/", import.meta.url);
  const offenders = [];
  let carried = 0;
  let documents = 0;

  for (const file of readdirSync(root).filter((name) => name.endsWith(".json"))) {
    const data = JSON.parse(readFileSync(new URL(file, root), "utf8"));
    for (const doc of Array.isArray(data) ? data : [data]) {
      if (!doc || typeof doc !== "object") continue;
      documents += 1;
      if (isBlockedImage(doc.img)) offenders.push(`${file}: ${doc.name} img`);
      if (isBlockedImage(doc.prototypeToken?.texture?.src)) {
        offenders.push(`${file}: ${doc.name} token`);
      }
      if (doc.flags?.["lyrian-chronicles"]?.remoteImage) carried += 1;
    }
  }

  assert.deepEqual(offenders, []);
  assert.ok(documents > 2000, `only ${documents} documents were scanned`);
  // The official URLs are kept rather than discarded, so the art is
  // recoverable if the CDN ever sends the CORS header.
  assert.ok(carried > 400, `only ${carried} documents kept their remote URL`);
});

test("the generator prefers the bundled icon over the remote URL", () => {
  const tool = readFileSync(
    new URL("../tools/build-compendiums.mjs", import.meta.url), "utf8");

  // Regenerating must not undo the fix, so the reach for the CDN is gone from
  // the builder rather than only from its output.
  assert.doesNotMatch(tool, /data\.imageSmUrl \|\| data\.imageLgUrl \|\| fallbackIcons/);
  assert.match(tool, /function artwork\(data, fallback\)/);
  assert.match(tool, /return \{ img: fallback, remoteImage: String\(remote\) \}/);

  // Every type that used to reach for it now goes through the helper.
  for (const type of ["race", "class", "equipment", "monster"]) {
    assert.match(tool, new RegExp(`baseDocument\\(entry, "${type}", art\\.img`), type);
  }
  assert.match(tool, /texture: \{ src: art\.img \}/);
});

test("worlds pick the change up: content version and migration both move", () => {
  const seed = readFileSync(
    new URL("../module/content/seed-packs.mjs", import.meta.url), "utf8");
  assert.match(seed, /CONTENT_VERSION = "0\.6\.3-/,
    "an unchanged content version leaves existing worlds on the old artwork");

  const migration = readFileSync(
    new URL("../migrations/0.6.30.mjs", import.meta.url), "utf8");
  assert.match(migration, /repairArtwork/);
  // Documents already imported into a world are not reseeded, so both an
  // Actor and an Item pass are needed.
  assert.match(migration, /\["Actor", "Item"\]/);
  const versions = readFileSync(new URL("../migrations/migrate.mjs", import.meta.url), "utf8");
  assert.match(versions, /"0\.6\.30"/);
});

/* -------------------------------------------- */
/*  Rebuilding must not destroy what it does not build */
/* -------------------------------------------- */

test("a rebuild carries over the packs the generator does not produce", () => {
  const tool = readFileSync(
    new URL("../tools/build-compendiums.mjs", import.meta.url), "utf8");

  // materials, mods and crafting-guide have no builder in this tool at all.
  for (const pack of ["materials", "mods", "crafting-guide"]) {
    assert.equal(tool.includes(`"${pack}"`), false,
      `${pack} is not generated here, so the index must preserve it rather than rewrite it`);
  }

  // Writing a fresh index containing only what was just built dropped those
  // three, and the runtime then stopped seeding 551 documents.
  assert.match(tool, /packs: \{ \.\.\.\(previousIndex\.packs \?\? \{\}\) \}/);
  assert.doesNotMatch(tool, /^\s*packs: \{\},$/m);
});

test("the index still names every pack, including the unbuilt ones", () => {
  const index = JSON.parse(readFileSync(
    new URL("../content/compendium-index.json", import.meta.url), "utf8"));
  for (const pack of ["materials", "mods", "crafting-guide"]) {
    assert.ok(index.packs[pack], `${pack} is missing from the content index`);
    assert.ok(index.packs[pack].files.length > 0, `${pack} lists no files`);
  }
  assert.equal(Object.keys(index.packs).length, 16);
});
