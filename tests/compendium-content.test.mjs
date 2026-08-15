import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "..");
const MANIFEST = JSON.parse(await readFile(path.join(ROOT, "system.json"), "utf8"));
const SNAPSHOT_DIRECTORY = path.join(ROOT, "content-source", "approved", "0.13.1");
const SNAPSHOT_MANIFEST = JSON.parse(await readFile(path.join(SNAPSHOT_DIRECTORY, "manifest.json"), "utf8"));
const SNAPSHOT = {
  ...SNAPSHOT_MANIFEST,
  entries: (await Promise.all(SNAPSHOT_MANIFEST.parts.map(async (part) =>
    JSON.parse(await readFile(path.join(SNAPSHOT_DIRECTORY, part.file), "utf8"))
  ))).flat(),
};

const PACKS = {
  "rules-setting-guide": 2,
  keywords: 87,
  breakthroughs: 89,
  "player-abilities": 1112,
  races: 48,
  classes: 181,
  weapons: 45,
  "armor-shields": 9,
  consumables: 58,
  "gear-kits": 31,
  artifices: 47,
  monsters: 84,
  "monster-abilities": 307,
};
const CRAFTING_PACKS = {
  materials: 149,
  mods: 391,
  "crafting-guide": 11,
};

const CONTENT_INDEX = JSON.parse(await readFile(path.join(ROOT, "content", "compendium-index.json"), "utf8"));
const content = {};
for (const pack of Object.keys(PACKS)) {
  content[pack] = (await Promise.all(CONTENT_INDEX.packs[pack].files.map(async (file) =>
    JSON.parse(await readFile(path.join(ROOT, "content", file), "utf8"))
  ))).flat();
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("manifest declares reviewed rules plus focused equipment and crafting packs", () => {
  assert.deepEqual(MANIFEST.packs.map((pack) => pack.name), [
    "rules-setting-guide", "keywords", "breakthroughs", "player-abilities", "races", "classes",
    "weapons", "armor-shields", "consumables", "gear-kits", "artifices", "materials", "mods", "crafting-guide",
    "monsters", "monster-abilities"
  ]);
  assert.equal(MANIFEST.version, "0.6.8");
  assert.equal(MANIFEST.compatibility.minimum, "14");
  assert.equal(MANIFEST.compatibility.verified, "14");
  const foldered = MANIFEST.packFolders.flatMap((folder) => folder.packs);
  assert.equal(foldered.length, MANIFEST.packs.length);
  assert.equal(new Set(foldered).size, MANIFEST.packs.length);
  assert.deepEqual(new Set(foldered), new Set(MANIFEST.packs.map((pack) => pack.name)));
  for (const pack of MANIFEST.packs) assert.ok(CONTENT_INDEX.packs[pack.name], `${pack.name} missing content index`);
});

test("approved snapshot is complete and has no unresolved relationships", () => {
  assert.equal(SNAPSHOT.rulebook_version, "0.13.1");
  assert.equal(SNAPSHOT.entries.length, 2116);
  assert.deepEqual(SNAPSHOT.unresolved_relationships, []);
  assert.match(SNAPSHOT.attribution, /Angel's Sword Studios/);
});

test("compiled packs have reviewed counts and stable unique IDs", () => {
  for (const [pack, expected] of Object.entries(PACKS)) {
    const documents = content[pack];
    assert.equal(documents.length, expected, pack);
    const ids = new Set();
    const seedKeys = new Set();
    for (const document of documents) {
      assert.match(document._id, /^[a-f0-9]{16}$/, `${pack}:${document.name}`);
      assert.ok(document.name, `${pack} has a blank name`);
      assert.ok(!ids.has(document._id), `${pack} duplicate ID ${document._id}`);
      ids.add(document._id);
      const flags = document.flags?.["lyrian-chronicles"];
      assert.ok(flags?.seedKey, `${pack}:${document.name} missing seedKey`);
      assert.ok(!seedKeys.has(flags.seedKey), `${pack} duplicate seedKey ${flags.seedKey}`);
      seedKeys.add(flags.seedKey);
      assert.equal(flags.rulebookVersion, "0.13.1");
      assert.equal(flags.contentBuild, pack === "races" ? "0.5.1" : "0.5.0");
      assert.match(flags.sourceUrl, /^https:\/\/rpg\.angelssword\.com\/game\/0\.13\.1\//);
      assert.match(flags.sourceHash, /^[a-f0-9]{64}$/);
    }
  }
});

test("focused equipment and Flo's Madness packs have reviewed counts", async () => {
  for (const [pack, expected] of Object.entries(CRAFTING_PACKS)) {
    const documents = (await Promise.all(CONTENT_INDEX.packs[pack].files.map(async (file) =>
      JSON.parse(await readFile(path.join(ROOT, "content", file), "utf8"))
    ))).flat();
    assert.equal(documents.length, expected, pack);
    assert.equal(new Set(documents.map((document) => document._id)).size, expected, `${pack} IDs`);
    assert.equal(new Set(documents.map((document) => document.flags?.["lyrian-chronicles"]?.seedKey)).size, expected, `${pack} seed keys`);
  }

  const loadPack = async (pack) => (await Promise.all(CONTENT_INDEX.packs[pack].files.map(async (file) =>
    JSON.parse(await readFile(path.join(ROOT, "content", file), "utf8"))
  ))).flat();
  const materials = await loadPack("materials");
  const mods = await loadPack("mods");
  assert.ok(materials.some((item) => item.system.unitCost === "500 units"));
  assert.ok(materials.some((item) => item.system.cost === "1,000 Clim"));
  assert.ok(mods.some((item) => item.system.modSlot === "Frame"));
  assert.ok(mods.some((item) => item.system.polarityUnits === 4000));
  const singleEdge = mods.find((item) => item.system.stableId.startsWith("mods--item-specific--single-edge--"));
  assert.ok(singleEdge, "Single Edge item-specific mod is missing");
  assert.deepEqual(singleEdge.system.compatibleTargets, ["Light Sword (One-Handed)"]);
  const reinforcedLanget = mods.find((item) => item.system.stableId.startsWith("mods--item-specific--reinforced-langet--"));
  assert.ok(reinforcedLanget, "Reinforced Langet item-specific mod is missing");
  assert.ok(reinforcedLanget.system.compatibleTargets.includes("Pickaxe (Two-Handed)"));
  assert.equal(mods.filter((item) => item.system.craftingType === "Item-specific").length, 298);
  for (const missingCost of ["Holographic Optic", "Wide Targeting", "Wing Outlining"]) {
    assert.ok(!mods.some((item) => item.name === missingCost), `${missingCost} should remain excluded until it has a cost`);
  }
  for (const item of [...materials, ...mods]) {
    assert.match(item.system.sourceUrl, /^https:\/\/docs\.google\.com\/spreadsheets\/d\/1S7ygwpW8p6rqOjf7bfmfylhzx9R3uFfP3ZYBFGlDeLs\/edit#gid=\d+$/);
    assert.match(item.system.sourceHash, /^[a-f0-9]{64}$/);
  }
});

test("every compiled relationship UUID resolves to a real document", () => {
  const targets = new Set();
  for (const [pack, documents] of Object.entries(content)) {
    for (const document of documents) {
      targets.add(`Compendium.lyrian-chronicles.${pack}.${pack === "monsters" ? "Actor" : pack === "rules-setting-guide" ? "JournalEntry" : "Item"}.${document._id}`);
    }
  }

  let links = 0;
  for (const documents of Object.values(content)) {
    for (const document of documents) {
      for (const link of document.system?.relationships?._links ?? []) {
        links += 1;
        assert.ok(targets.has(link.uuid), `${document.name} -> ${link.uuid}`);
      }
    }
  }
  assert.ok(links > 1000, `expected rich cross-link graph, got ${links}`);
});

test("monsters are encounter-ready with official stats and embedded actions", () => {
  let embedded = 0;
  for (const monster of content.monsters) {
    assert.equal(monster.type, "monster");
    assert.equal(monster.system.official.enabled, true);
    assert.ok(monster.system.hp.max > 0, monster.name);
    assert.ok(monster.prototypeToken?.texture?.src, monster.name);
    for (const item of monster.items ?? []) {
      embedded += 1;
      assert.equal(item.type, "monsterAbility");
      assert.match(
        item.flags?.["lyrian-chronicles"]?.compendiumSource ?? "",
        /^Compendium\.lyrian-chronicles\.monster-abilities\.Item\.[a-f0-9]{16}$/
      );
    }
  }
  assert.equal(embedded, 385);
});

test("normalized rich text excludes executable markup", () => {
  const serialized = JSON.stringify(content);
  assert.doesNotMatch(serialized, /<\s*(script|iframe|object|embed)\b/i);
  assert.doesNotMatch(serialized, /\son[a-z]+\s*=/i);
  assert.doesNotMatch(serialized, /javascript\s*:/i);
  assert.doesNotMatch(serialized, /unresolved:/i);
});

test("compiler output is deterministic", async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), "lyrian-compendiums-"));
  await run(process.execPath, [
    path.join(ROOT, "tools", "build-compendiums.mjs"),
    SNAPSHOT_DIRECTORY,
    output,
  ]);
  const files = Object.keys(PACKS).flatMap((pack) => CONTENT_INDEX.packs[pack].files);
  for (const file of files) {
    const expected = await readFile(path.join(ROOT, "content", file));
    const actual = await readFile(path.join(output, file));
    assert.equal(digest(actual), digest(expected), file);
  }
});

test("Handlebars templates have balanced block helpers", async () => {
  async function templates(directory) {
    const found = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) found.push(...await templates(target));
      else if (entry.name.endsWith(".hbs")) found.push(target);
    }
    return found;
  }

  for (const file of await templates(path.join(ROOT, "templates"))) {
    const source = await readFile(file, "utf8");
    const stack = [];
    for (const match of source.matchAll(/{{([#/]\*?[a-zA-Z][a-zA-Z0-9_-]*)\b[^}]*}}/g)) {
      const token = match[1];
      if (token.startsWith("#")) stack.push(token.slice(1).replace(/^\*/, ""));
      else {
        const closing = token.slice(1);
        assert.equal(closing, stack.pop(), `${path.relative(ROOT, file)} near ${match[0]}`);
      }
    }
    assert.deepEqual(stack, [], path.relative(ROOT, file));
  }
});
