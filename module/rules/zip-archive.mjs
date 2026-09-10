/**
 * Just enough ZIP to open a workbook, change one part, and put it back.
 *
 * An .xlsx is a ZIP. Reading and rewriting one is the only thing standing
 * between an actor and a filled character sheet, and every library that does it
 * brings 90KB and a dependency to a system that has none. Browsers deflate
 * natively now, so this is the container format and nothing else: no ZIP64, no
 * encryption, no spanning — none of which a spreadsheet uses.
 *
 * Entries come back and go out as raw bytes. What is inside them is somebody
 * else's problem, which keeps this testable without a spreadsheet in sight.
 */

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_DIRECTORY = 0x06054b50;
const STORED = 0;
const DEFLATED = 8;

/**
 * 1980-01-01 00:00, in the packed DOS fields a ZIP header carries.
 *
 * Leaving the fields at zero writes month 0 and day 0, which is not a date at
 * all — `unzip` shrugs but anything that builds a real date from it does not.
 * A fixed one rather than the clock also makes an export reproducible: the same
 * character written twice gives the same bytes.
 */
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

/** Bit 11 promises the name is UTF-8, which a reader needs before it decodes one. */
const UTF8_NAME = 0x0800;

/** CRC-32, which every entry carries and a reader will check. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function inflateRaw(bytes) {
  if (!bytes.length) return bytes;
  const stream = new DecompressionStream("deflate-raw");
  const response = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await response.arrayBuffer());
}

async function deflateRaw(bytes) {
  const stream = new CompressionStream("deflate-raw");
  const response = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Read every entry.
 *
 * The central directory is walked rather than the local headers: an entry
 * written with a streaming data descriptor leaves its sizes as zero in the
 * local header, and only the directory is reliable.
 *
 * @param {Uint8Array} archive
 * @returns {Promise<Map<string, Uint8Array>>}  path → contents
 */
export async function readArchive(archive) {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const decoder = new TextDecoder();

  // The end record sits at the back, behind a comment of unknown length.
  let end = -1;
  for (let i = archive.length - 22; i >= 0; i -= 1) {
    if (view.getUint32(i, true) === END_OF_DIRECTORY) { end = i; break; }
  }
  if (end === -1) throw new Error("Not a ZIP archive: no end-of-directory record");

  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const entries = new Map();

  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(offset, true) !== CENTRAL_HEADER) {
      throw new Error(`Corrupt ZIP directory at entry ${i}`);
    }
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(archive.subarray(offset + 46, offset + 46 + nameLength));

    // The local header's own name and extra fields decide where the data starts;
    // its extra field is often a different length from the directory's.
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = archive.subarray(dataStart, dataStart + compressedSize);

    entries.set(name, method === DEFLATED ? await inflateRaw(raw) : new Uint8Array(raw));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * Write entries back out.
 *
 * Order is preserved because a reader is entitled to expect `[Content_Types].xml`
 * first, and a workbook that opens in Excel but not in Sheets is a bug nobody
 * enjoys finding.
 *
 * @param {Map<string, Uint8Array>} entries
 * @returns {Promise<Uint8Array>}
 */
export async function writeArchive(entries) {
  const encoder = new TextEncoder();
  const parts = [];
  const directory = [];
  let offset = 0;

  for (const [name, contents] of entries) {
    const nameBytes = encoder.encode(name);
    // Pure ASCII needs no promise, and not making one keeps the header
    // identical to what every other writer produces for the same name.
    const flags = /^[\x20-\x7e]*$/.test(name) ? 0 : UTF8_NAME;
    const body = contents ?? new Uint8Array(0);
    const deflated = await deflateRaw(body);
    // Compression that makes a part bigger is not compression.
    const useDeflate = deflated.length < body.length;
    const payload = useDeflate ? deflated : body;
    const method = useDeflate ? DEFLATED : STORED;
    const checksum = crc32(body);

    const header = new Uint8Array(30 + nameBytes.length);
    const headerView = new DataView(header.buffer);
    headerView.setUint32(0, LOCAL_HEADER, true);
    headerView.setUint16(4, 20, true);            // version needed
    headerView.setUint16(6, flags, true);          // no data descriptor
    headerView.setUint16(8, method, true);
    headerView.setUint16(10, DOS_TIME, true);
    headerView.setUint16(12, DOS_DATE, true);
    headerView.setUint32(14, checksum, true);
    headerView.setUint32(18, payload.length, true);
    headerView.setUint32(22, body.length, true);
    headerView.setUint16(26, nameBytes.length, true);
    header.set(nameBytes, 30);

    parts.push(header, payload);
    directory.push({ nameBytes, flags, method, checksum, payload, body, offset });
    offset += header.length + payload.length;
  }

  const directoryStart = offset;
  for (const entry of directory) {
    const record = new Uint8Array(46 + entry.nameBytes.length);
    const recordView = new DataView(record.buffer);
    recordView.setUint32(0, CENTRAL_HEADER, true);
    recordView.setUint16(4, 20, true);            // version made by
    recordView.setUint16(6, 20, true);            // version needed
    recordView.setUint16(8, entry.flags, true);
    recordView.setUint16(10, entry.method, true);
    recordView.setUint16(12, DOS_TIME, true);
    recordView.setUint16(14, DOS_DATE, true);
    recordView.setUint32(16, entry.checksum, true);
    recordView.setUint32(20, entry.payload.length, true);
    recordView.setUint32(24, entry.body.length, true);
    recordView.setUint16(28, entry.nameBytes.length, true);
    recordView.setUint32(42, entry.offset, true);
    record.set(entry.nameBytes, 46);
    parts.push(record);
    offset += record.length;
  }

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, END_OF_DIRECTORY, true);
  endView.setUint16(8, directory.length, true);
  endView.setUint16(10, directory.length, true);
  endView.setUint32(12, offset - directoryStart, true);
  endView.setUint32(16, directoryStart, true);
  parts.push(end);

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const archive = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) { archive.set(part, cursor); cursor += part.length; }
  return archive;
}
