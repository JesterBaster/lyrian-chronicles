import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const source = process.argv[2];
const output = process.argv[3];
const maximumBytes = Number(process.argv[4] || 500_000);
if (!source || !output) {
  throw new Error("Usage: node tools/split-approved-snapshot.mjs <snapshot.json> <output-directory> [maximum-bytes]");
}

const snapshot = JSON.parse(await readFile(source, "utf8"));
const { entries, ...metadata } = snapshot;
if (!Array.isArray(entries)) throw new Error("Snapshot must contain an entries array");

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function chunksFor(category, categoryEntries) {
  const chunks = [];
  let chunk = [];
  for (const entry of categoryEntries) {
    const candidate = [...chunk, entry];
    if (chunk.length && Buffer.byteLength(JSON.stringify(candidate)) > maximumBytes) {
      chunks.push(chunk);
      chunk = [entry];
    } else {
      chunk = candidate;
    }
  }
  if (chunk.length) chunks.push(chunk);
  return chunks.map((items, index) => ({
    file: `${slug(category)}-${String(index + 1).padStart(2, "0")}.json`,
    category,
    entries: items,
  }));
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const categories = Array.from(new Set(entries.map((entry) => entry.category)));
const parts = categories.flatMap((category) => chunksFor(
  category,
  entries.filter((entry) => entry.category === category)
));

for (const part of parts) {
  await writeFile(path.join(output, part.file), `${JSON.stringify(part.entries, null, 2)}\n`);
}

await writeFile(path.join(output, "manifest.json"), `${JSON.stringify({
  ...metadata,
  entry_count: entries.length,
  parts: parts.map(({ file, category, entries: items }) => ({ file, category, count: items.length })),
}, null, 2)}\n`);

console.log(`Split ${entries.length} entries into ${parts.length} files.`);
