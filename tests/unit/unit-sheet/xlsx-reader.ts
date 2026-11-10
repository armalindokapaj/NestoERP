import { inflateRawSync } from "node:zlib";

import { crc32 } from "@/lib/modules/unit-sheet/unit-sheet.xlsx";

/**
 * Just enough of a ZIP reader to check what "Download for Google Sheets"
 * writes: the central directory, each entry's local header, its deflated
 * bytes and their CRC. Throws on anything a spreadsheet would refuse.
 */
export function readZip(bytes: Uint8Array): Map<string, string> {
  const buffer = Buffer.from(bytes);
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error("no end of central directory");
  const count = buffer.readUInt16LE(end + 10);
  const size = buffer.readUInt32LE(end + 12);
  let at = buffer.readUInt32LE(end + 16);
  if (at + size !== end) throw new Error("central directory is not where the end record says");
  const files = new Map<string, string>();
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(at) !== 0x02014b50) throw new Error("bad central header");
    const method = buffer.readUInt16LE(at + 10);
    const crc = buffer.readUInt32LE(at + 16);
    const compressed = buffer.readUInt32LE(at + 20);
    const plain = buffer.readUInt32LE(at + 24);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extra = buffer.readUInt16LE(at + 30);
    const comment = buffer.readUInt16LE(at + 32);
    const local = buffer.readUInt32LE(at + 42);
    const name = buffer.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    if (buffer.readUInt32LE(local) !== 0x04034b50) throw new Error(`bad local header for ${name}`);
    const localName = buffer.readUInt16LE(local + 26);
    const localExtra = buffer.readUInt16LE(local + 28);
    const data = buffer.subarray(local + 30 + localName + localExtra, local + 30 + localName + localExtra + compressed);
    const content = method === 8 ? inflateRawSync(data) : data;
    if (content.length !== plain) throw new Error(`${name}: size ${content.length}, header says ${plain}`);
    if (crc32(new Uint8Array(content)) !== crc) throw new Error(`${name}: CRC mismatch`);
    files.set(name, content.toString("utf8"));
    at += 46 + nameLength + extra + comment;
  }
  return files;
}

export type ReadCell = { ref: string; type: string | null; style: string | null; value: string };

/** The cells of a worksheet's XML, in order: their reference, type, style and value (inline text or number). */
export function sheetCells(xml: string): ReadCell[] {
  const cells: ReadCell[] = [];
  for (const match of xml.matchAll(/<c r="([A-Z]+\d+)"(?: t="([^"]+)")?(?: s="(\d+)")?>(.*?)<\/c>/g)) {
    const inner = match[4]!;
    const text = /<t[^>]*>([\s\S]*?)<\/t>/.exec(inner)?.[1];
    const number = /<v>([^<]*)<\/v>/.exec(inner)?.[1];
    const decode = (value: string) => value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
    cells.push({ ref: match[1]!, type: match[2] ?? null, style: match[3] ?? null, value: decode(text ?? number ?? "") });
  }
  return cells;
}
