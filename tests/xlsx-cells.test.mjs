import assert from "node:assert/strict";
import test from "node:test";

import {
  encodeXml, readCell, readSharedStrings, sheetPathsByName, writeCell, writeCells
} from "../module/rules/xlsx-cells.mjs";

/** A row shaped exactly like the Angel's Sword sheet's own XML. */
const ROW = '<row r="2">'
  + '<c r="A2" s="33" t="s"><v>23</v></c>'
  + '<c r="B2" s="34"/>'
  + '<c r="C2" s="33" t="s"><v>24</v></c>'
  + '<c r="D2" s="34"/>'
  + '<c r="F2" s="37"><f>20+(10*B12)+M6</f><v>70</v></c>'
  + '<c r="G2" s="35" t="inlineStr"><is><t>Evasion</t></is></c>'
  + '</row>';
const STRINGS = ["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "",
  "", "", "", "", "", "", "Name", "Race"];

test("an empty cell reads as empty, not as its neighbour", () => {
  // <c r="B2" s="34"/> is self-closing. An attribute class that admits "/"
  // runs past it, takes the ">" branch, and returns C2's value as B2's —
  // which would have given every blank cell its right-hand neighbour's data.
  assert.deepEqual(readCell(ROW, "B2", STRINGS), { value: "", formula: "", empty: true });
  assert.equal(readCell(ROW, "C2", STRINGS).value, "Race");
  assert.equal(readCell(ROW, "A2", STRINGS).value, "Name");
});

test("a formula cell reports its formula, which is the signal to leave it alone", () => {
  const hp = readCell(ROW, "F2", STRINGS);
  assert.equal(hp.formula, "20+(10*B12)+M6");
  assert.equal(hp.value, "70", "the cached result is still readable");
});

test("a cell that is not in the sheet is missing, not blank", () => {
  assert.deepEqual(readCell(ROW, "Z99", STRINGS), { value: "", formula: "", empty: true });
  assert.equal(writeCell(ROW, "Z99", "x").reason, "missing");
});

test("inline strings read back", () => {
  assert.equal(readCell(ROW, "G2", STRINGS).value, "Evasion");
});

/* -------------------------------------------- */

test("writing a cell keeps the formatting it had", () => {
  // s="34" is the cell's style. Dropping it on write is how a filled sheet
  // ends up looking subtly unlike the template it came from.
  const { xml, written } = writeCell(ROW, "B2", "Kaelen");
  assert.equal(written, true);
  assert.match(xml, /<c r="B2" s="34" t="inlineStr"><is><t xml:space="preserve">Kaelen<\/t><\/is><\/c>/);
  assert.equal(readCell(xml, "B2").value, "Kaelen");
  // and no neighbour moved
  assert.equal(readCell(xml, "C2", STRINGS).value, "Race");
});

test("a formula is never overwritten by accident", () => {
  const refused = writeCell(ROW, "F2", 999);
  assert.equal(refused.written, false);
  assert.equal(refused.reason, "formula");
  assert.equal(refused.xml, ROW, "the sheet is returned untouched");

  // The sheet computes HP from the stats; writing a literal would give a
  // workbook that looks right until its first edit and then disagrees with
  // itself. Overriding is possible, but only on purpose.
  const forced = writeCell(ROW, "F2", 999, { allowFormulaOverwrite: true });
  assert.equal(forced.written, true);
  assert.equal(readCell(forced.xml, "F2").formula, "", "the formula is gone once overridden");
});

test("numbers are written as numbers and blanks clear the cell", () => {
  const numeric = writeCell(ROW, "B2", 4000);
  assert.match(numeric.xml, /<c r="B2" s="34"><v>4000<\/v><\/c>/);

  const cleared = writeCell(numeric.xml, "B2", "");
  assert.match(cleared.xml, /<c r="B2" s="34"\/>/);
  assert.equal(readCell(cleared.xml, "B2").empty, true);
});

test("text that would break the XML is escaped, and survives the round trip", () => {
  for (const value of ['Bob & "Ace" <the> Knife', "a'postrophe", "line\nbreak"]) {
    const { xml } = writeCell(ROW, "B2", value);
    assert.doesNotMatch(xml.replace(/&(amp|lt|gt|quot|apos|#10);/g, ""), /[<>&]B2/);
    assert.equal(readCell(xml, "B2").value, value, value);
  }
  assert.equal(encodeXml("a & b"), "a &amp; b");
});

test("many cells in one pass, reporting what it could not fill", () => {
  const { xml, written, refused } = writeCells(ROW, [
    ["B2", "Kaelen"],
    ["D2", "Human"],
    ["F2", 999],        // formula
    ["Z99", "nowhere"]  // absent
  ]);
  assert.deepEqual(written, ["B2", "D2"]);
  assert.deepEqual(refused, [
    { ref: "F2", reason: "formula" },
    { ref: "Z99", reason: "missing" }
  ]);
  assert.equal(readCell(xml, "B2").value, "Kaelen");
  assert.equal(readCell(xml, "D2").value, "Human");
  assert.equal(readCell(xml, "F2").formula, "20+(10*B12)+M6", "still computing");
});

/* -------------------------------------------- */

test("shared strings join their runs and decode their entities", () => {
  const xml = "<sst>"
    + "<si><t>Plain</t></si>"
    + "<si><r><t>Split </t></r><r><t>across runs</t></r></si>"
    + "<si><t>EXP &amp; Transactions</t></si>"
    + "</sst>";
  assert.deepEqual(readSharedStrings(xml), ["Plain", "Split across runs", "EXP & Transactions"]);
});

test("a sheet's name resolves to the part that holds it", () => {
  const workbook = '<workbook><sheets>'
    + '<sheet name="Core" sheetId="1" r:id="rId1"/>'
    + '<sheet name="EXP &amp; Transactions" sheetId="7" r:id="rId7"/>'
    + '</sheets></workbook>';
  const rels = '<Relationships>'
    + '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/>'
    + '<Relationship Id="rId7" Target="worksheets/sheet7.xml"/>'
    + '</Relationships>';
  const paths = sheetPathsByName(workbook, rels);
  assert.equal(paths.get("Core"), "xl/worksheets/sheet1.xml");
  assert.equal(paths.get("EXP & Transactions"), "xl/worksheets/sheet7.xml",
    "the tab name is what a caller knows it by, entities and all");
});

test("characters XML cannot hold are dropped, not escaped", () => {
  // There is no escape that makes a control character legal in XML 1.0, and one
  // anywhere in the file makes the whole workbook unopenable — with nothing in
  // the export to say why. They arrive by ordinary means: an item name pasted
  // out of a PDF.
  const nul = String.fromCharCode(0);
  const bell = String.fromCharCode(7);
  const formFeed = String.fromCharCode(12);
  assert.equal(encodeXml(`Rope${bell} (coiled)`), "Rope (coiled)");
  assert.equal(encodeXml(`a${nul}b${formFeed}c`), "abc");

  // The three XML does keep, because a description legitimately holds them.
  assert.equal(encodeXml("a\tb\nc\rd"), "a\tb\nc\rd");

  // And the ordinary escaping still happens.
  assert.equal(encodeXml(`Tom${bell} & "Jerry"`), "Tom &amp; &quot;Jerry&quot;");

  const sheet = '<row r="1"><c r="A1" s="2"/></row>';
  const { xml } = writeCell(sheet, "A1", `Rope${nul}`);
  assert.match(xml, /<t xml:space="preserve">Rope<\/t>/);
});
