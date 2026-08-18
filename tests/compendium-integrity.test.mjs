import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const manifest = JSON.parse(readFileSync("system.json", "utf8"));
const index = JSON.parse(readFileSync("content/compendium-index.json", "utf8"));
const seed = readFileSync("module/content/seed-packs.mjs", "utf8");

const declared = Object.fromEntries(manifest.packs.map((pack) => [pack.name, pack.type]));
const indexed = index.packs ?? {};

const ITEM_TYPES = new Set([
  "keyword", "weapon", "armor", "ability", "class", "breakthrough",
  "race", "equipment", "monsterAbility", "gear", "injury"
]);
const ACTOR_TYPES = new Set(["character", "npc", "monster"]);

/** Every shipped document, with the pack it is seeded into. */
function everyDocument() {
  const documents = [];
  for (const [pack, config] of Object.entries(indexed)) {
    for (const file of config.files ?? []) {
      const parsed = JSON.parse(readFileSync(`content/${file}`, "utf8"));
      const entries = Array.isArray(parsed) ? parsed : (parsed.entries ?? parsed.items ?? []);
      for (const entry of entries) documents.push({ pack, file, entry });
    }
  }
  return documents;
}

const documents = everyDocument();

test("the manifest, the index and the seeder agree on the pack list", () => {
  const seeded = [...seed.matchAll(/^\s*"([a-z-]+)",?$/gm)].map((match) => match[1]);
  for (const pack of Object.keys(declared)) {
    assert.ok(indexed[pack], `${pack} is declared but has no content index entry`);
    assert.ok(seeded.includes(pack), `${pack} is declared but never seeded`);
  }
  for (const pack of Object.keys(indexed)) {
    assert.ok(declared[pack], `${pack} is indexed but not declared in system.json`);
  }
});

test("every declared pack has a directory to seed into", () => {
  const directories = new Set(readdirSync("packs"));
  for (const pack of manifest.packs) {
    const name = pack.path.replace(/^packs\//, "");
    assert.ok(directories.has(name), `${pack.name} declares ${pack.path}, which is missing`);
  }
});

test("every indexed content file exists and every content file is indexed", () => {
  const referenced = new Set(Object.values(indexed).flatMap((config) => config.files ?? []));
  const onDisk = readdirSync("content")
    .filter((file) => file.endsWith(".json") && file !== "compendium-index.json");

  for (const file of referenced) {
    assert.ok(onDisk.includes(file), `${file} is indexed but not on disk`);
  }
  for (const file of onDisk) {
    assert.ok(referenced.has(file), `${file} exists but no pack loads it`);
  }
});

test("every document has an id and a name", () => {
  for (const { pack, entry } of documents) {
    assert.ok(entry._id, `a document in ${pack} has no _id`);
    assert.ok(entry.name, `${entry._id} in ${pack} has no name`);
  }
});

test("ids are unique, within a pack and across all of them", () => {
  // A collision would make one document overwrite the other on seed.
  const owner = new Map();
  for (const { pack, entry } of documents) {
    const previous = owner.get(entry._id);
    assert.equal(previous, undefined,
      `_id ${entry._id} is used by both ${previous} and ${pack}.${entry.name}`);
    owner.set(entry._id, `${pack}.${entry.name}`);
  }
});

test("stable ids are unique within their pack", () => {
  // Relationships resolve by stableId, so a duplicate makes a link ambiguous.
  const perPack = new Map();
  for (const { pack, entry } of documents) {
    const stableId = entry.system?.stableId;
    if (!stableId) continue;
    const key = `${pack}:${stableId}`;
    assert.equal(perPack.get(key), undefined,
      `stableId ${stableId} appears twice in ${pack}`);
    perPack.set(key, entry.name);
  }
});

test("each document's type suits the pack it is seeded into", () => {
  for (const { pack, entry } of documents) {
    const kind = declared[pack];
    if (kind === "Item") assert.ok(ITEM_TYPES.has(entry.type), `${entry.name} is "${entry.type}" in Item pack ${pack}`);
    if (kind === "Actor") assert.ok(ACTOR_TYPES.has(entry.type), `${entry.name} is "${entry.type}" in Actor pack ${pack}`);
  }
});

test("every relationship link points at a document that exists", () => {
  // A link that does not resolve is an ability that silently never grants.
  const idsByPack = new Map();
  for (const { pack, entry } of documents) {
    if (!idsByPack.has(pack)) idsByPack.set(pack, new Set());
    idsByPack.get(pack).add(entry._id);
  }

  let checked = 0;
  for (const { entry } of documents) {
    for (const link of entry.system?.relationships?._links ?? []) {
      checked += 1;
      const parsed = /^Compendium\.lyrian-chronicles\.([^.]+)\.(?:Item|Actor|JournalEntry)\.(.+)$/
        .exec(link.uuid ?? "");
      assert.ok(parsed, `${entry.name} has a malformed link uuid: ${link.uuid}`);

      const [, pack, id] = parsed;
      assert.ok(idsByPack.has(pack), `${entry.name} links into unknown pack ${pack}`);
      assert.ok(idsByPack.get(pack).has(id),
        `${entry.name} links to ${pack}.${id}, which does not exist`);
      if (link.pack) {
        assert.equal(link.pack, pack, `${entry.name} link disagrees with its own uuid`);
      }
    }
  }
  assert.ok(checked > 1000, "expected the shipped relationship graph to be substantial");
});

test("every stable id a class or race grants from has a link to follow", () => {
  // syncProgressionFeatures resolves grants through _links and gives up
  // silently when one is absent, so a missing link means a feature that never
  // appears on the sheet.
  let checked = 0;
  for (const { entry } of documents) {
    if (!["class", "race"].includes(entry.type)) continue;
    const relationships = entry.system?.relationships ?? {};
    const linked = new Set((relationships._links ?? []).map((link) => link.stableId));

    const referenced = [
      ...(relationships.abilities ?? []),
      ...(relationships.traits ?? []),
      relationships.key_ability,
      relationships.ultimate_ability,
      ...(entry.system?.variants ?? []).map((variant) => variant.abilityStableId)
    ].filter(Boolean);

    for (const stableId of referenced) {
      checked += 1;
      assert.ok(linked.has(stableId),
        `${entry.name} grants ${stableId} but carries no link for it`);
    }
  }
  assert.ok(checked > 500, "expected classes and races to reference many grants");
});
