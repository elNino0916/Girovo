// A ZIP archive of a few files, stored as they are — for the receipts that go
// with the Steuer-Jahresübersicht (lib/tax-year.ts).
//
// No compression and no library: the files are PDFs and photos, which are
// compressed already, and a stored archive is a few dozen lines of the
// format (PKWARE APPNOTE 4.3.6). Every ZIP reader opens it — Windows'
// Explorer, macOS, the Android file managers. Names are UTF-8 (general
// purpose flag bit 11), so "Beleg Bäckerei.pdf" survives.
//
// Pure and node-test-safe.

export type ZipEntry = { name: string; data: Uint8Array; modified?: Date };

let crcTable: Uint32Array | null = null;

function table(): Uint32Array {
  if (crcTable) return crcTable;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  crcTable = t;
  return t;
}

/** CRC-32 (IEEE 802.3), as ZIP stores it. */
export function crc32(data: Uint8Array): number {
  const t = table();
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = t[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** The MS-DOS time and date a ZIP entry carries: local time, two-second steps, from 1980. */
function dosTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/**
 * Names as an archive may hold them: no folders, no characters Windows
 * refuses, and no two alike ("Beleg.pdf", "Beleg (2).pdf").
 */
export function uniqueNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  return names.map((raw) => {
    const clean = String(raw).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^\.+/, '').trim() || '_';
    const dot = clean.lastIndexOf('.');
    const stem = dot > 0 ? clean.slice(0, dot) : clean;
    const ext = dot > 0 ? clean.slice(dot) : '';
    let name = clean;
    for (let n = 2; seen.has(name.toLowerCase()); n++) name = `${stem} (${n})${ext}`;
    seen.add(name.toLowerCase());
    return name;
  });
}

/** One archive holding `entries`, stored, in their order. */
export function zipStore(entries: readonly ZipEntry[], now = new Date()): Uint8Array {
  const enc = new TextEncoder();
  const names = uniqueNames(entries.map((e) => e.name)).map((n) => enc.encode(n));
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  entries.forEach((e, i) => {
    const name = names[i];
    const crc = crc32(e.data);
    const { time, date } = dosTime(e.modified ?? now);
    const size = e.data.length;

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // local file header
    lv.setUint16(4, 20, true); // version needed: 2.0
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); // central directory header
    cv.setUint16(4, 20, true); // made by: 2.0, MS-DOS
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);

    locals.push(local, e.data);
    centrals.push(central);
    offset += local.length + size;
  });

  const centralSize = centrals.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); // end of central directory
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const out = new Uint8Array(offset + centralSize + end.length);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
