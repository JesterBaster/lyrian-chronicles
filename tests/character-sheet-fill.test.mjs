/**
 * The whole export, end to end, over a workbook built here.
 *
 * A 600KB copy of Angel's Sword's template is not ours to commit, so this
 * builds a small one with the same shape: the same labels in the same columns,
 * a formula where the real sheet has one, and the same ZIP container. What it
 * proves is the join — archive in, layout discovered, cells written, archive
 * out, and the result readable again.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { readArchive, writeArchive } from "../module/rules/zip-archive.mjs";
import { readCell } from "../module/rules/xlsx-cells.mjs";
import { CORE_SKILL_LABELS } from "../module/rules/character-sheet-export.mjs";
import {
  characterExportView,
  exportWarningMessages,
  fillCharacterSheet
} from "../module/rules/character-sheet-workbook.mjs";

const encoder = new TextEncoder();
const bytes = (text) => encoder.encode(text);

const MAIN_LABELS = ["Power", "Focus", "Agility", "Toughness"];
const SUB_LABELS = ["Fitness", "Cunning", "Reason", "Awareness", "Presence"];

/** A stand-in for the Core tab: same columns, same labels, far fewer rows. */
function coreSheetXml() {
  const cells = new Map();
  const put = (ref, xml) => cells.set(ref, xml);
  const label = (ref, text) =>
    put(ref, `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`);
  const number = (ref, value) => put(ref, `<c r="${ref}"><v>${value}</v></c>`);
  const blank = (ref) => put(ref, `<c r="${ref}" s="7"/>`);

  // Identity block, and one formula where the real sheet computes max HP.
  for (const ref of ["B2", "B3", "B4", "B5", "B6", "B7", "D2", "D3"]) blank(ref);
  put("F2", '<c r="F2"><f>20+(10*B12)</f><v>20</v></c>');

  // Skills: label in E, points in H, expertise in I.
  CORE_SKILL_LABELS.forEach((name, index) => {
    const row = 9 + index;
    label(`E${row}`, name);
    blank(`H${row}`);
    blank(`I${row}`);
  });

  // Crafting skills and classes are free lists of blank rows.
  for (let row = 9; row <= 14; row += 1) { blank(`N${row}`); blank(`P${row}`); }
  for (let row = 15; row <= 35; row += 1) { blank(`A${row}`); blank(`C${row}`); }

  // The creation arrays, their pick cells, their labels and their bonus cells.
  [5, 4, 4, 3].forEach((value, index) => {
    const row = 45 + index;
    number(`A${row}`, value);
    blank(`B${row}`);
    label(`E${row}`, MAIN_LABELS[index]);
    blank(`F${row}`);
  });
  [5, 4, 3, 2, 1].forEach((value, index) => {
    const row = 45 + index;
    number(`C${row}`, value);
    blank(`D${row}`);
    label(`G${row}`, SUB_LABELS[index]);
    blank(`H${row}`);
  });

  const rows = new Map();
  for (const [ref, xml] of cells) {
    const row = Number(ref.replace(/\D/g, ""));
    if (!rows.has(row)) rows.set(row, []);
    rows.get(row).push([ref, xml]);
  }
  const body = [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([row, entries]) => {
    const sorted = entries.sort((a, b) => a[0].localeCompare(b[0])).map(([, xml]) => xml);
    return `<row r="${row}">${sorted.join("")}</row>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8"?><worksheet><sheetData>${body}</sheetData></worksheet>`;
}

async function templateArchive() {
  return writeArchive(new Map([
    ["[Content_Types].xml", bytes('<?xml version="1.0"?><Types/>')],
    ["xl/workbook.xml", bytes(
      '<?xml version="1.0"?><workbook><sheets>' +
      '<sheet name="Core" sheetId="1" r:id="rId1"/>' +
      '<sheet name="Abilities" sheetId="2" r:id="rId2"/>' +
      "</sheets></workbook>"
    )],
    ["xl/_rels/workbook.xml.rels", bytes(
      '<?xml version="1.0"?><Relationships>' +
      '<Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="worksheet" Target="worksheets/sheet2.xml"/>' +
      "</Relationships>"
    )],
    ["xl/worksheets/sheet1.xml", bytes(coreSheetXml())],
    ["xl/worksheets/sheet2.xml", bytes('<?xml version="1.0"?><worksheet><sheetData/></worksheet>')],
    ["xl/media/image1.png", new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 9, 9, 9])]
  ]));
}

const stat = (value, bonus = 0) => ({ value, bonus });

const ACTOR = {
  name: "Kaelen Vos",
  system: {
    details: {
      race: "Human", subrace: "Skybound", gender: "Female",
      age: "24", height: "5'7\"", weight: "130 lb", worship: "Kari"
    },
    stats: { power: stat(4, 1), focus: stat(3), agility: stat(4), toughness: stat(5) },
    subStats: {
      fitness: stat(5, 2), cunning: stat(4), reason: stat(3),
      awareness: stat(2), presence: stat(1)
    },
    skills: {
      athletics: { rank: 3, expertises: [{ name: "Climbing" }] },
      magic: { rank: 5, expertises: [] }
    },
    artisan: { blacksmith: { rank: 4 } },
    gathering: { mining: { rank: 2 } }
  },
  items: [{ type: "class", name: "Fighter", system: { abilitiesUnlocked: 3 } }]
};

const EN_LABELS = {
  "LYRIAN.Stat.Power": "Power", "LYRIAN.Stat.Focus": "Focus",
  "LYRIAN.Stat.Agility": "Agility", "LYRIAN.Stat.Toughness": "Toughness",
  "LYRIAN.Stat.Fitness": "Fitness", "LYRIAN.Stat.Cunning": "Cunning",
  "LYRIAN.Stat.Reason": "Reason", "LYRIAN.Stat.Awareness": "Awareness",
  "LYRIAN.Stat.Presence": "Presence", "LYRIAN.Skill.Athletics": "Athletics",
  "LYRIAN.Skill.Magic": "Magic", "LYRIAN.Artisan.Blacksmith": "Blacksmithing",
  "LYRIAN.Gathering.Mining": "Mining"
};
const localize = (key) => EN_LABELS[key] ?? key;

test("an actor comes back out of the workbook where a player would have typed them", async () => {
  const template = await templateArchive();
  const view = characterExportView(ACTOR, { localize });
  const result = await fillCharacterSheet(template, view);

  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.refused, []);

  const entries = await readArchive(result.bytes);
  const sheet = new TextDecoder().decode(entries.get("xl/worksheets/sheet1.xml"));
  const read = (ref) => readCell(sheet, ref).value;

  assert.equal(read("B2"), "Kaelen Vos");
  assert.equal(read("B7"), "Kari");
  assert.equal(read("D2"), "Human");
  assert.equal(read("D3"), "Skybound");

  // Stats as picks off the array, with the bonus in its own column.
  assert.deepEqual([read("B45"), read("B46"), read("B47"), read("B48")],
    ["Toughness", "Power", "Agility", "Focus"]);
  assert.deepEqual([read("D45"), read("D46")], ["Fitness", "Cunning"]);
  // The bonus columns are keyed to the sheet's own stat labels, which do not
  // run in the same order as the picks: row 45 holds Toughness's pick and
  // Power's bonus. Pairing them by position would put the +1 on the wrong stat.
  assert.equal(read("B45"), "Toughness");
  assert.equal(read("F45"), "1", "Power's +1, on the row labelled Power");
  assert.equal(read("F46"), "", "Focus has no bonus");
  assert.equal(read("H45"), "2", "Fitness's +2");

  assert.equal(read("H9"), "3", "Athletics is the sheet's first skill row");
  assert.equal(read("I9"), "Climbing");
  assert.equal(read("H17"), "5", "Magic, found by its label rather than counted to");
  assert.equal(read("H10"), "", "Riding has no points, so its row stays blank");

  assert.equal(read("N9"), "Blacksmithing");
  assert.equal(read("P9"), "4");
  assert.equal(read("N10"), "Mining");
  assert.equal(read("A15"), "Fighter");
  assert.equal(read("C15"), "3");
});

test("everything the export did not touch comes back byte for byte", async () => {
  const template = await templateArchive();
  const before = await readArchive(template);
  const result = await fillCharacterSheet(template, characterExportView(ACTOR, { localize }));
  const after = await readArchive(result.bytes);

  assert.deepEqual([...after.keys()], [...before.keys()], "no part added, dropped or reordered");
  const changed = [...before.keys()]
    .filter((name) => Buffer.compare(Buffer.from(before.get(name)), Buffer.from(after.get(name))));
  assert.deepEqual(changed, ["xl/worksheets/sheet1.xml"],
    "the drawings, the other tabs and the content types are all left alone");
});

test("the sheet keeps its own formulas", async () => {
  const template = await templateArchive();
  const result = await fillCharacterSheet(template, characterExportView(ACTOR, { localize }));
  const entries = await readArchive(result.bytes);
  const sheet = new TextDecoder().decode(entries.get("xl/worksheets/sheet1.xml"));

  assert.equal(readCell(sheet, "F2").formula, "20+(10*B12)",
    "a literal here would look right until the first edit and then disagree with itself");
});

test("a file that is not the template is refused by name", async () => {
  const notAWorkbook = await writeArchive(new Map([["notes.txt", bytes("hello")]]));
  await assert.rejects(
    () => fillCharacterSheet(notAWorkbook, {}),
    /NotAWorkbook/
  );

  const wrongTabs = await writeArchive(new Map([
    ["xl/workbook.xml", bytes('<?xml version="1.0"?><workbook><sheets>' +
      '<sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>')],
    ["xl/_rels/workbook.xml.rels", bytes('<?xml version="1.0"?><Relationships>' +
      '<Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>')],
    ["xl/worksheets/sheet1.xml", bytes("<worksheet><sheetData/></worksheet>")]
  ]));
  await assert.rejects(() => fillCharacterSheet(wrongTabs, {}), /MissingSheet/);
});

test("a character who does not fit the sheet is told what was left out", () => {
  const messages = exportWarningMessages({
    warnings: [
      { kind: "statArray", scope: "main", stats: [{ label: "Power" }, { label: "Focus" }] },
      { kind: "skillRow", label: "Piloting" },
      { kind: "classOverflow", label: "Ninth Class" }
    ],
    refused: [
      { ref: "B45", reason: "formula" },
      { ref: "Q99", reason: "missing" },
      { ref: "Q100", reason: "missing" }
    ]
  });

  assert.deepEqual(messages.map((m) => m.key), [
    "LYRIAN.Warn.ExportStatArray",
    "LYRIAN.Warn.ExportSkillRow",
    "LYRIAN.Warn.ExportOverflow",
    "LYRIAN.Warn.ExportFormulaCell",
    "LYRIAN.Warn.ExportMissingCells"
  ]);
  assert.equal(messages[0].data.stats, "Power, Focus");
  assert.equal(messages[4].data.count, 2, "one message for the lot, not one each");
  assert.deepEqual(exportWarningMessages({}), []);
});
