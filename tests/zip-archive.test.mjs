import assert from "node:assert/strict";
import test from "node:test";

import { crc32, readArchive, writeArchive } from "../module/rules/zip-archive.mjs";

const text = (value) => new TextEncoder().encode(value);
const read = (bytes) => new TextDecoder().decode(bytes);

test("CRC-32 matches the values a reader will check against", () => {
  // The published check values for the algorithm ZIP uses.
  assert.equal(crc32(text("")), 0x00000000);
  assert.equal(crc32(text("a")), 0xe8b7be43);
  assert.equal(crc32(text("123456789")), 0xcbf43926);
  assert.equal(crc32(text("The quick brown fox jumps over the lazy dog")), 0x414fa339);
});

test("what goes in comes out", async () => {
  const entries = new Map([
    ["[Content_Types].xml", text("<Types/>")],
    ["xl/workbook.xml", text("<workbook/>")],
    ["xl/media/image1.png", new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])]
  ]);
  const archive = await writeArchive(entries);
  const back = await readArchive(archive);

  assert.deepEqual([...back.keys()], [...entries.keys()], "order is preserved");
  assert.equal(read(back.get("xl/workbook.xml")), "<workbook/>");
  assert.deepEqual([...back.get("xl/media/image1.png")], [137, 80, 78, 71, 13, 10, 26, 10],
    "binary parts survive as bytes, not as mangled text");
});

test("text that compresses is deflated; bytes that would grow are stored", async () => {
  const compressible = text("A".repeat(5000));
  const incompressible = new Uint8Array(64);
  crypto.getRandomValues(incompressible);

  const archive = await writeArchive(new Map([
    ["big.txt", compressible], ["noise.bin", incompressible]
  ]));
  // Deflating 5000 identical bytes must beat storing them, or the whole
  // archive is pointless; 64 random bytes cannot be beaten, and inflating
  // something larger than the original is a waste both ways.
  assert.ok(archive.length < compressible.length, "the archive is smaller than its content");

  const back = await readArchive(archive);
  assert.equal(read(back.get("big.txt")).length, 5000);
  assert.deepEqual([...back.get("noise.bin")], [...incompressible]);
});

test("an empty entry is legal and reads back empty", async () => {
  const back = await readArchive(await writeArchive(new Map([["empty.xml", new Uint8Array(0)]])));
  assert.equal(back.get("empty.xml").length, 0);
});

test("unicode paths and contents survive", async () => {
  const entries = new Map([["xl/wörksheets/シート.xml", text("Kaelen — “Vos”")]]);
  const back = await readArchive(await writeArchive(entries));
  assert.equal(read(back.get("xl/wörksheets/シート.xml")), "Kaelen — “Vos”");
});

test("changing one part leaves every other byte alone", async () => {
  const original = new Map([
    ["a.xml", text("<a/>")], ["b.xml", text("<b/>")], ["c.xml", text("<c/>")]
  ]);
  const first = await readArchive(await writeArchive(original));
  first.set("b.xml", text("<b>changed</b>"));
  const second = await readArchive(await writeArchive(first));

  assert.equal(read(second.get("a.xml")), "<a/>");
  assert.equal(read(second.get("b.xml")), "<b>changed</b>");
  assert.equal(read(second.get("c.xml")), "<c/>");
});

test("something that is not a ZIP is refused, not misread", async () => {
  await assert.rejects(() => readArchive(text("this is a PDF, honest")),
    /no end-of-directory record/);
});

test("a trailing comment does not hide the directory", async () => {
  // The end record is found by scanning back, because a comment of unknown
  // length can sit behind it.
  const archive = await writeArchive(new Map([["a.xml", text("<a/>")]]));
  const withComment = new Uint8Array(archive.length + 5);
  withComment.set(archive);
  withComment.set(text("hello"), archive.length);
  // The comment length field must agree, or the archive is genuinely corrupt.
  new DataView(withComment.buffer).setUint16(archive.length - 2, 5, true);

  const back = await readArchive(withComment);
  assert.equal(read(back.get("a.xml")), "<a/>");
});

test("every entry carries a date that is actually a date", async () => {
  // Leaving the DOS fields at zero writes month 0 and day 0. `unzip` shrugs,
  // but anything that builds a real date from it does not.
  const archive = await writeArchive(new Map([["a.txt", new TextEncoder().encode("hello")]]));
  const view = new DataView(archive.buffer);

  const time = view.getUint16(10, true);
  const date = view.getUint16(12, true);
  assert.equal(time, 0);
  assert.equal(date & 0x1f, 1, "day of month");
  assert.equal((date >> 5) & 0x0f, 1, "month");
  assert.equal(date >>> 9, 0, "years since 1980");
});

test("a name that is not ASCII says so, and one that is stays quiet", async () => {
  const bytes = new TextEncoder().encode("x");
  const plain = await writeArchive(new Map([["a.txt", bytes]]));
  assert.equal(new DataView(plain.buffer).getUint16(6, true), 0,
    "an ASCII name needs no promise, and the header matches every other writer's");

  const unicode = await writeArchive(new Map([["café.txt", bytes]]));
  assert.equal(new DataView(unicode.buffer).getUint16(6, true) & 0x0800, 0x0800,
    "bit 11 is what tells a reader the name is UTF-8 before it decodes one");

  const back = await readArchive(unicode);
  assert.deepEqual([...back.keys()], ["café.txt"]);
});

test("the same content written twice gives the same bytes", async () => {
  // A fixed timestamp rather than the clock, so an export is reproducible.
  const entries = () => new Map([["a.txt", new TextEncoder().encode("hello")]]);
  const first = await writeArchive(entries());
  const second = await writeArchive(entries());
  assert.deepEqual([...first], [...second]);
});
