/**
 * Reading and writing single cells inside an .xlsx, without rebuilding it.
 *
 * An .xlsx is a zip of XML. Every library that opens one and writes it back
 * reconstructs the whole workbook, and reconstruction is lossy: rewriting the
 * Angel's Sword character sheet with exceljs preserved its 12,678 formulas but
 * silently dropped all 17 of its embedded drawings and 15 cell styles.
 *
 * So nothing here rebuilds anything. A cell's XML is replaced in place and the
 * rest of the archive is handed back untouched, which is what makes an exported
 * sheet identical to the template it was filled from rather than merely similar.
 *
 * The zip itself is somebody else's problem — the caller unzips and rezips, so
 * this module stays pure and testable.
 */

/**
 * Match one cell by reference.
 *
 * `[^>/]*` and not `[^>]*` is the whole difference between working and quietly
 * wrong: a self-closing `<c r="B2" s="34"/>` is an empty cell, but a class that
 * admits `/` lets the greedy match run past it, take the `>` branch, and return
 * the *next* cell's value as this one's. Every blank cell would then read as its
 * right-hand neighbour.
 */
function cellPattern(ref) {
  return new RegExp(`<c r="${ref}"([^>/]*)(?:/>|>([\\s\\S]*?)</c>)`);
}

/** The `s="…"` style index a cell already carries, as an attribute string. */
function styleAttribute(attributes = "") {
  const style = /\ss="(\d+)"/.exec(attributes);
  return style ? ` s="${style[1]}"` : "";
}

function decodeXml(value) {
  return String(value ?? "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#10;/g, "\n")
    .replace(/&amp;/g, "&");   // last, or an &amp;lt; decodes twice
}

/**
 * Escape a value for an XML text node, and drop what XML cannot hold at all.
 *
 * The control characters go first and without ceremony: XML 1.0 forbids them
 * outright, there is no escape that makes them legal, and one of them anywhere
 * in the file makes the whole workbook unopenable. They arrive by ordinary
 * means — an item name pasted out of a PDF or a Word document — and the export
 * would otherwise report success and hand back a file Excel refuses, with
 * nothing to say why. Tab, newline and carriage return are the three XML keeps.
 */
export function encodeXml(value) {
  return String(value ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/&/g, "&amp;")    // first, for the same reason
    .replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** The strings a sheet refers to by index, in order. */
export function readSharedStrings(xml) {
  return [...String(xml ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((entry) =>
    // A single string can be split across runs; a cell shows them joined.
    decodeXml([...entry[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""))
  );
}

/**
 * Read one cell.
 *
 * @returns {{value: string, formula: string, empty: boolean}}
 *          `formula` is set when the cell computes its own value, which is the
 *          signal never to write to it.
 */
function decodeCell(attributes = "", body = "", sharedStrings = []) {
  const formula = /<f[^>]*>([\s\S]*?)<\/f>/.exec(body)?.[1] ?? "";
  const type = /\st="([^"]+)"/.exec(attributes)?.[1] ?? "";

  let value = "";
  if (type === "inlineStr") value = /<t[^>]*>([\s\S]*?)<\/t>/.exec(body)?.[1] ?? "";
  else value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "";

  if (type === "s") {
    const index = Number(value);
    value = Number.isInteger(index) ? sharedStrings[index] ?? "" : "";
  } else {
    value = decodeXml(value);
  }

  return { value, formula: decodeXml(formula), empty: !body.trim() };
}

export function readCell(sheetXml, ref, sharedStrings = []) {
  const match = cellPattern(ref).exec(String(sheetXml ?? ""));
  if (!match) return { value: "", formula: "", empty: true };
  const [, attributes, body = ""] = match;
  return decodeCell(attributes, body, sharedStrings);
}

/**
 * Read a whole column in one pass.
 *
 * `readCell` rescans the sheet from the start for every reference, which is
 * fine for the thirty-odd cells an export writes and hopeless for the 1,138
 * ability names the template keeps on a reference tab — that would be a
 * thousand scans of a megabyte. This makes one.
 *
 * A cell absent from the XML is absent from the Map, which is the one thing
 * `readCell` cannot tell you: it reports a missing cell and an existing blank
 * one identically. Knowing the difference is how a caller finds where a block
 * of rows actually ends.
 *
 * @param {string} sheetXml
 * @param {string} column   "A", "AB", …
 * @param {string[]} [sharedStrings]
 * @returns {Map<number, {value: string, formula: string, empty: boolean}>}  row → cell
 */
export function readColumn(sheetXml, column, sharedStrings = []) {
  // The digits must follow the column letters immediately, so scanning for "A"
  // never matches "AA1" — the `\d+` fails on the second letter.
  const pattern = new RegExp(`<c r="${column}(\\d+)"([^>/]*)(?:/>|>([\\s\\S]*?)</c>)`, "g");
  const cells = new Map();
  for (const [, row, attributes, body = ""] of String(sheetXml ?? "").matchAll(pattern)) {
    cells.set(Number(row), decodeCell(attributes, body, sharedStrings));
  }
  return cells;
}

/**
 * Write one cell, keeping its formatting.
 *
 * Strings are written inline rather than added to the shared-string table:
 * appending there means renumbering nothing but still rewriting a file every
 * other sheet points into, and the aim is to touch as little as possible.
 *
 * A cell that computes itself is left alone. Overwriting a formula with a
 * literal would give a sheet that looks right until the first edit and then
 * disagrees with itself — on this template that is 12,678 opportunities.
 *
 * @returns {{xml: string, written: boolean, reason: string}}
 */
export function writeCell(sheetXml, ref, value, { allowFormulaOverwrite = false } = {}) {
  const xml = String(sheetXml ?? "");
  const match = cellPattern(ref).exec(xml);
  if (!match) return { xml, written: false, reason: "missing" };

  const [whole, attributes, body = ""] = match;
  if (!allowFormulaOverwrite && /<f[ >]/.test(body)) {
    return { xml, written: false, reason: "formula" };
  }

  const style = styleAttribute(attributes);
  const replacement = value === null || value === undefined || value === ""
    ? `<c r="${ref}"${style}/>`
    : typeof value === "number" && Number.isFinite(value)
      ? `<c r="${ref}"${style}><v>${value}</v></c>`
      : `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${encodeXml(value)}</t></is></c>`;

  return {
    xml: xml.slice(0, match.index) + replacement + xml.slice(match.index + whole.length),
    written: true,
    reason: ""
  };
}

/**
 * Write many cells in one pass.
 *
 * Refusals are returned rather than thrown: a template whose layout has shifted
 * should report which cells it could not fill, not abandon the export.
 *
 * @param {string} sheetXml
 * @param {Array<[string, string|number]>|object} cells
 * @returns {{xml: string, written: string[], refused: Array<{ref: string, reason: string}>}}
 */
export function writeCells(sheetXml, cells, options = {}) {
  const entries = Array.isArray(cells) ? cells : Object.entries(cells ?? {});
  let xml = String(sheetXml ?? "");
  const written = [];
  const refused = [];
  for (const [ref, value] of entries) {
    const result = writeCell(xml, ref, value, options);
    xml = result.xml;
    if (result.written) written.push(ref);
    else refused.push({ ref, reason: result.reason });
  }
  return { xml, written, refused };
}

/** Map a sheet's display name to the part inside the archive that holds it. */
export function sheetPathsByName(workbookXml, relsXml) {
  const targets = new Map(
    [...String(relsXml ?? "").matchAll(/Id="(rId\d+)"[^>]*Target="([^"]+)"/g)]
      .map(([, id, target]) => [id, target.replace(/^\/?xl\//, "")])
  );
  const paths = new Map();
  for (const [, name, id] of String(workbookXml ?? "")
    .matchAll(/<sheet[^>]*name="([^"]*)"[^>]*r:id="(rId\d+)"/g)) {
    const target = targets.get(id);
    if (target) paths.set(decodeXml(name), `xl/${target}`);
  }
  return paths;
}
