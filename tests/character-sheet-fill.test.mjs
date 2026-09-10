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

/** The Abilities tab: two name blocks, each row looking the rest up. */
function abilitiesSheetXml() {
  const rows = [];
  const lookupRow = (row) => `<row r="${row}">` +
    ["B", "C", "D", "E", "F", "G"].map((col) =>
      `<c r="${col}${row}"><f>IF(A${row}="","",INDEX('All Abilities'!H:H,MATCH(A${row},` +
      `'All Abilities'!B:B,0)))</f><v></v></c>`).join("") +
    `<c r="A${row}" s="3"/></row>`;

  rows.push('<row r="1"><c r="A1" t="inlineStr"><is><t>Active Ability Name</t></is></c>' +
    '<c r="B1" t="inlineStr"><is><t>Cost</t></is></c></row>');
  for (let row = 2; row <= 4; row += 1) rows.push(lookupRow(row));
  rows.push('<row r="5"><c r="A5" t="inlineStr"><is><t>Passive Ability Name</t></is></c>' +
    '<c r="B5" t="inlineStr"><is><t>Cost</t></is></c></row>');
  for (let row = 6; row <= 7; row += 1) rows.push(lookupRow(row));
  // The real sheet stamps its version below the last block; the run must stop.
  rows.push('<row r="8"><c r="A8" t="inlineStr"><is><t>2.0</t></is></c></row>');

  return `<?xml version="1.0"?><worksheet><sheetData>${rows.join("")}</sheetData></worksheet>`;
}

function breakthroughSheetXml() {
  const rows = ['<row r="1"><c r="A1" t="inlineStr"><is><t>Breakthrough</t></is></c>' +
    '<c r="B1" t="inlineStr"><is><t>XP Spent</t></is></c></row>'];
  for (let row = 2; row <= 4; row += 1) {
    rows.push(`<row r="${row}"><c r="A${row}" s="3"/><c r="B${row}"><v>0</v></c>` +
      `<c r="C${row}"><f>IF(A${row}="","",INDEX(Breakthroughs!C:C,MATCH(TRUE,` +
      `ISNUMBER(SEARCH(Breakthroughs!A:A,A${row})),0)))</f><v></v></c></row>`);
  }
  return `<?xml version="1.0"?><worksheet><sheetData>${rows.join("")}</sheetData></worksheet>`;
}

function inventorySheetXml() {
  const rows = ['<row r="1"><c r="A1" t="inlineStr"><is><t>Expedition Inventory</t></is></c></row>'];
  for (let row = 2; row <= 4; row += 1) {
    const cells = ["A", "B", "C", "D", "E", "G"].map((col) => `<c r="${col}${row}" s="9"/>`).join("");
    // The burden total on row 2 is what tells a reader where the rows end.
    const total = row === 2 ? '<c r="H2"><f>SUM(D2:D4)</f><v>0</v></c>' : "";
    rows.push(`<row r="${row}">${cells}${total}</row>`);
  }
  return `<?xml version="1.0"?><worksheet><sheetData>${rows.join("")}</sheetData></worksheet>`;
}

/** A reference tab, as Google exports one: a dead function with a cached value. */
function referenceSheetXml(column, header, names) {
  const cached = (ref, value) =>
    `<c r="${ref}" t="str"><f>IFERROR(__xludf.DUMMYFUNCTION("COMPUTED_VALUE"),"${value}")</f>` +
    `<v>${value}</v></c>`;
  const rows = [`<row r="1">${cached(`${column}1`, header)}</row>`];
  names.forEach((name, index) => {
    const row = index + 2;
    rows.push(`<row r="${row}">${cached(`${column}${row}`, name)}</row>`);
  });
  return `<?xml version="1.0"?><worksheet><sheetData>${rows.join("")}</sheetData></worksheet>`;
}

const KNOWN_ABILITIES = ["Cleave", "Iron Skin", "Riposte"];
const KNOWN_BREAKTHROUGHS = ["Angelblooded (Human)", "Arachne (Spiderfolk)"];

async function templateArchive() {
  return writeArchive(new Map([
    ["[Content_Types].xml", bytes('<?xml version="1.0"?><Types/>')],
    ["xl/workbook.xml", bytes(
      '<?xml version="1.0"?><workbook><sheets>' +
      ["Core", "Abilities", "Breakthrough", "Inventory", "All Abilities", "Breakthroughs"]
        .map((name, index) =>
          `<sheet name="${name}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("") +
      "</sheets></workbook>"
    )],
    ["xl/_rels/workbook.xml.rels", bytes(
      '<?xml version="1.0"?><Relationships>' +
      Array.from({ length: 6 }, (_, index) =>
        `<Relationship Id="rId${index + 1}" Type="worksheet" ` +
        `Target="worksheets/sheet${index + 1}.xml"/>`).join("") +
      "</Relationships>"
    )],
    ["xl/worksheets/sheet1.xml", bytes(coreSheetXml())],
    ["xl/worksheets/sheet2.xml", bytes(abilitiesSheetXml())],
    ["xl/worksheets/sheet3.xml", bytes(breakthroughSheetXml())],
    ["xl/worksheets/sheet4.xml", bytes(inventorySheetXml())],
    ["xl/worksheets/sheet5.xml", bytes(referenceSheetXml("B", "Name", KNOWN_ABILITIES))],
    ["xl/worksheets/sheet6.xml", bytes(referenceSheetXml("A", "Name", KNOWN_BREAKTHROUGHS))],
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
  items: [
    { type: "class", name: "Fighter", system: { abilitiesUnlocked: 3 } },
    { type: "ability", name: "Cleave", system: { timing: "action" } },
    { type: "ability", name: "Riposte", system: { timing: "reaction" } },
    { type: "ability", name: "Iron Skin", system: { timing: "passive" } },
    { type: "ability", name: "Homebrew Smash", system: { timing: "action" } },
    { type: "breakthrough", name: "Angelblooded (Human) — level 3", system: { expCost: 100 } },
    { type: "breakthrough", name: "Totally Made Up", system: { expCost: 250 } },
    {
      type: "weapon", name: "Longsword",
      system: { burden: 2, value: 150, equipped: true, description: "<p>A <b>sturdy</b> blade.</p>" }
    },
    {
      type: "gear", name: "Iron Ingot",
      system: { quantity: 5, burden: 1, value: 20, combatItem: true, totalBurden: 5 }
    },
    {
      type: "equipment", name: "Alchemy Rig",
      system: { quantity: 1, burden: "2 (4 assembled)", cost: "1,200 Clim" }
    }
  ]
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

  assert.deepEqual(result.refused, []);
  assert.deepEqual(result.warnings.map((entry) => entry.label),
    ["Homebrew Smash", "Totally Made Up"],
    "the two names the reference tabs do not carry, and nothing else");

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

test("the other three tabs come back filled, each in its own block", async () => {
  const template = await templateArchive();
  const result = await fillCharacterSheet(template, characterExportView(ACTOR, { localize }));
  const entries = await readArchive(result.bytes);
  const decode = new TextDecoder();
  const on = (part) => {
    const xml = decode.decode(entries.get(part));
    return (ref) => readCell(xml, ref).value;
  };

  const abilities = on("xl/worksheets/sheet2.xml");
  assert.deepEqual([abilities("A2"), abilities("A3"), abilities("A4")],
    ["Cleave", "Riposte", "Homebrew Smash"], "a reaction is still something you do");
  assert.equal(abilities("A5"), "Passive Ability Name", "the header is not an ability row");
  assert.equal(abilities("A6"), "Iron Skin", "the only passive, below the divide");
  assert.equal(abilities("A8"), "2.0", "the version stamp survives the run ending");

  const breakthroughs = on("xl/worksheets/sheet3.xml");
  assert.equal(breakthroughs("A2"), "Angelblooded (Human) — level 3");
  assert.equal(breakthroughs("B2"), "100", "the EXP actually spent");

  const inventory = on("xl/worksheets/sheet4.xml");
  assert.deepEqual([inventory("A2"), inventory("B2"), inventory("C2"), inventory("D2"),
    inventory("E2"), inventory("G2")],
    ["Longsword", "Combat Loadout", "1", "2", "150", "A sturdy blade."]);
  assert.deepEqual([inventory("A3"), inventory("B3"), inventory("C3"), inventory("D3")],
    ["Iron Ingot", "Backpack", "5", "5"], "the stack's burden, not one ingot's");
  // Free-text cost and burden on equipment: the leading number is what is meant.
  assert.deepEqual([inventory("A4"), inventory("D4"), inventory("E4")],
    ["Alchemy Rig", "2", "1200"]);

  // The tab breakdown names each sheet, since four tabs share a coordinate space.
  assert.deepEqual(result.tabs.map((tab) => tab.tab),
    ["Core", "Abilities", "Breakthrough", "Inventory"]);
  assert.equal(result.written.every((ref) => ref.includes("!")), true);
});

test("a template missing the newer tabs still exports its Core", async () => {
  const full = await readArchive(await templateArchive());
  const trimmed = new Map([...full].filter(([name]) =>
    !["xl/worksheets/sheet3.xml", "xl/worksheets/sheet4.xml"].includes(name)));
  trimmed.set("xl/workbook.xml", bytes('<?xml version="1.0"?><workbook><sheets>' +
    '<sheet name="Core" sheetId="1" r:id="rId1"/>' +
    '<sheet name="Abilities" sheetId="2" r:id="rId2"/></sheets></workbook>'));

  const result = await fillCharacterSheet(await writeArchive(trimmed),
    characterExportView(ACTOR, { localize }));

  const byTab = Object.fromEntries(result.tabs.map((tab) => [tab.tab, tab]));
  assert.equal(byTab.Core.present, true);
  assert.equal(byTab.Core.written.length > 0, true);
  assert.equal(byTab.Breakthrough.present, false, "absent, not fatal");
  assert.equal(byTab.Inventory.present, false);

  // With no reference tab to check against, names are written unchecked rather
  // than every one of them reported as unknown.
  assert.equal(result.warnings.some((entry) => entry.kind === "unknownAbility"), false);
});

test("everything the export did not touch comes back byte for byte", async () => {
  const template = await templateArchive();
  const before = await readArchive(template);
  const result = await fillCharacterSheet(template, characterExportView(ACTOR, { localize }));
  const after = await readArchive(result.bytes);

  assert.deepEqual([...after.keys()], [...before.keys()], "no part added, dropped or reordered");
  const changed = [...before.keys()]
    .filter((name) => Buffer.compare(Buffer.from(before.get(name)), Buffer.from(after.get(name))));
  assert.deepEqual(changed, [
    "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml",
    "xl/worksheets/sheet3.xml", "xl/worksheets/sheet4.xml"
  ], "the drawings, the reference tabs and the content types are all left alone");
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
