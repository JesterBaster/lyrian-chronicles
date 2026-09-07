/**
 * Merge a newer rulebook snapshot onto the approved one.
 *
 * A snapshot read out of the site's rendered pages is not uniformly better
 * than the one before it. It carries the new entries and the real rules edits,
 * but it also loses things the page never shows: internal GUIDs, relationship
 * links, and the pip glyphs that encode a class's tier and difficulty. Copying
 * it over wholesale would add 35 entries and silently blank the Action Point
 * cost of 138 others.
 *
 * So this takes each field on its merits rather than each file. Every rule
 * below is there because the 0.13.1 → 0.13.2 comparison showed it was needed;
 * `--report` prints what each one did so the next merge can check them again.
 *
 *   node tools/merge-rulebook-snapshot.mjs <base-dir> <incoming.json> <out-dir> [--report]
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Fields the incoming snapshot cannot see, and must never overwrite.
 *
 * The first group are GUIDs the page renders as display names — "SPELL
 * CHALLENGE" instead of 8f7ad9e9-…, which is a label, not a link. The second
 * are counted from filled pip glyphs, which came back as one constant for all
 * 185 classes. The third are slug ids whose separator differs from ours
 * (`chair_grab` here, `chair-grab` there). The last is never rendered at all.
 */
const NEVER_OVERWRITE = new Set([
  "keyAbility", "ability1", "ability2", "ability3", "ultimateAbility",
  "associatedAbility", "trait1", "trait2", "trait3",
  "abilities", "activeActions", "monsterAbilityId", "monsterActiveActionsId",
  "difficulty", "tier",
  "trueAbilityId", "abilityId", "breakthroughId",
  "imageAlignment",
  // Same asset, re-uploaded under a new GUID. The build renders local artwork
  // and keeps these only as a reference, so churning 519 documents buys
  // nothing and cannot be verified from here.
  "imageLgUrl", "imageSmUrl"
]);

/** Text as a reader sees it: no markup, no entities, no punctuation spacing. */
export function readerText(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-").replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?)])/g, "$1").replace(/([(])\s+/g, "$1")
    .trim().toLowerCase();
}

/**
 * Markup that belongs to the website, not to the rulebook.
 *
 * The rulebook and setting guide are captured as "original HTML", which for an
 * Angular site means the whole rendered component tree — `<router-outlet>`,
 * `_nghost` attributes and all. That is not rules text, and it carries markup
 * the compiler's own safety check refuses. Anything wearing it is a capture
 * artefact whatever else it contains.
 */
const APP_SCAFFOLDING = /<router-outlet|_ngcontent|_nghost|<app-[a-z-]+/i;

const isBlank = (value) =>
  value === undefined || value === null
  || (typeof value === "string" && !value.trim())
  || (Array.isArray(value) && !value.length)
  // An empty object counts. The capture reports `source_ids: {}` for every
  // entry because the API's internal ids are not in the rendered page; taking
  // that literally emptied the GUID map the build resolves Demon house
  // abilities and monster ability links through.
  || (typeof value === "object" && !Array.isArray(value) && !Object.keys(value).length);

/** How many relationship targets an entry actually names. */
function linkCount(relationships) {
  let count = 0;
  for (const value of Object.values(relationships ?? {})) {
    for (const target of [].concat(value)) if (typeof target === "string" && target) count += 1;
  }
  return count;
}

/**
 * Decide one field.
 *
 * @returns {{value: unknown, reason: string}}
 */
export function mergeField(field, base, incoming) {
  if (NEVER_OVERWRITE.has(field)) return { value: base, reason: "protected" };
  // Both empty is not a change, whichever way each spells "empty". Without
  // this, a field the approved copy omits and the capture reports as "" reads
  // as 253 updates that alter nothing.
  if (isBlank(base) && isBlank(incoming)) return { value: base, reason: "same" };
  if (isBlank(incoming) && !isBlank(base)) return { value: base, reason: "absent" };
  if (typeof incoming === "string" && APP_SCAFFOLDING.test(incoming)) {
    return { value: base, reason: "scaffolding" };
  }
  // A structure flattened to a label is a loss however new it is. The Demon
  // house fields are {text, ability} pairs the build reads both halves of;
  // the capture renders each as just the ability's name, which would leave
  // every Demon with no clan to choose. Naming the fields would fix this one
  // case — refusing the shape fixes the next one too.
  if (base !== null && typeof base === "object"
    && (incoming === null || typeof incoming !== "object")) {
    return { value: base, reason: "flattened" };
  }
  if (isBlank(base) && !isBlank(incoming)) return { value: incoming, reason: "filled" };
  if (typeof base === "string" && typeof incoming === "string"
    && readerText(base) === readerText(incoming)) {
    // Same words. Keep whatever markup the approved copy already had; the
    // rendered capture flattens emphasis, links and tables.
    return { value: base, reason: "cosmetic" };
  }
  if (JSON.stringify(base) === JSON.stringify(incoming)) return { value: base, reason: "same" };
  return { value: incoming, reason: "updated" };
}

export function mergeEntry(base, incoming) {
  if (!base) return { entry: incoming, reasons: { added: 1 } };

  const data = {};
  const reasons = {};
  const fields = new Set([...Object.keys(base.data ?? {}), ...Object.keys(incoming.data ?? {})]);
  for (const field of fields) {
    const { value, reason } = mergeField(field, base.data?.[field], incoming.data?.[field]);
    if (value !== undefined) data[field] = value;
    if (reason === "updated" || reason === "filled" || reason === "scaffolding" || reason === "flattened") {
      reasons[`${reason}:${field}`] = (reasons[`${reason}:${field}`] ?? 0) + 1;
    }
  }

  // Relationships are what the build reads to wire a class to its abilities.
  // The capture drops or nulls most of them, so the approved links stand
  // unless the newer set genuinely names more.
  const keepLinks = linkCount(incoming.relationships) > linkCount(base.relationships);
  if (keepLinks) reasons["updated:relationships"] = 1;

  return {
    entry: {
      ...base,
      // Provenance moves to the new edition even where the data did not: this
      // entry was checked against 0.13.2 and found to say the same thing.
      source_url: incoming.source_url,
      rulebook_version: incoming.rulebook_version,
      retrieved_at: incoming.retrieved_at,
      // The capture cannot see the API's internal ids; the approved ones stand.
      source_ids: isBlank(incoming.source_ids) ? base.source_ids : incoming.source_ids,
      relationships: keepLinks ? incoming.relationships : base.relationships,
      data
    },
    reasons
  };
}

async function loadBase(dir) {
  const entries = [];
  for (const file of (await readdir(dir)).filter((f) => f.endsWith(".json") && f !== "manifest.json")) {
    entries.push(...JSON.parse(await readFile(path.join(dir, file), "utf8")));
  }
  const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8"));
  return { entries, manifest };
}

export function hashEntry(entry) {
  return createHash("sha256").update(JSON.stringify(entry.data)).digest("hex");
}

async function main() {
  const [baseDir, incomingPath, outDir] = process.argv.slice(2);
  const report = process.argv.includes("--report");
  if (!baseDir || !incomingPath || !outDir) {
    throw new Error("Usage: merge-rulebook-snapshot.mjs <base-dir> <incoming.json> <out-dir> [--report]");
  }

  const { entries: baseEntries, manifest } = await loadBase(baseDir);
  const incoming = JSON.parse(await readFile(incomingPath, "utf8"));
  const byId = new Map(baseEntries.map((entry) => [entry.stable_id, entry]));

  const merged = [];
  const tally = {};
  let added = 0;
  for (const entry of incoming.entries) {
    const result = mergeEntry(byId.get(entry.stable_id), entry);
    if (!byId.has(entry.stable_id)) added += 1;
    for (const [key, count] of Object.entries(result.reasons)) {
      tally[key] = (tally[key] ?? 0) + count;
    }
    merged.push({ ...result.entry, source_hash: hashEntry(result.entry) });
  }

  // A dropped entry is a decision, not a merge outcome. Refuse rather than
  // quietly shipping a smaller rulebook.
  const incomingIds = new Set(incoming.entries.map((e) => e.stable_id));
  const dropped = baseEntries.filter((e) => !incomingIds.has(e.stable_id));
  if (dropped.length) {
    throw new Error(`Incoming snapshot is missing ${dropped.length} approved entries: `
      + dropped.slice(0, 5).map((e) => e.stable_id).join(", "));
  }

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "snapshot.json"), `${JSON.stringify({
    ...manifest,
    schema_version: manifest.schema_version,
    rulebook_version: incoming.rulebook_version,
    retrieved_at: incoming.retrieved_at,
    source: incoming.source,
    unresolved_relationships: [],
    entry_count: merged.length,
    entries: merged
  }, null, 2)}\n`);

  console.log(`merged ${merged.length} entries (${added} added, 0 removed)`);
  if (report) {
    const rows = Object.entries(tally).sort((a, b) => b[1] - a[1]);
    console.log("\nchanges taken from the incoming snapshot:");
    for (const [key, count] of rows) console.log(`  ${String(count).padStart(5)}  ${key}`);
    if (!rows.length) console.log("  (none)");
  }
}

if (process.argv[1]?.endsWith("merge-rulebook-snapshot.mjs")) await main();
