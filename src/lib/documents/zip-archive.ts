import { deflateRawSync, inflateRawSync } from "node:zlib";

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const UTF8_FLAG = 0x0800;
const ENCRYPTED_FLAG = 0x0001;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

export type ZipArchiveEntry = {
  name: string;
  data: Uint8Array;
  compressionMethod: 0 | 8;
  modifiedTime: number;
  modifiedDate: number;
  internalAttributes: number;
  externalAttributes: number;
};

function findEndOfCentralDirectory(buffer: Buffer): number {
  const minimumOffset = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) return offset;
  }
  throw new Error("ZIP_END_OF_CENTRAL_DIRECTORY_NOT_FOUND");
}

function decodeEntryName(bytes: Buffer): string {
  return bytes.toString("utf8");
}

export function readZipArchive(input: Uint8Array): ZipArchiveEntry[] {
  const buffer = Buffer.from(input);
  const endOffset = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(endOffset + 16);

  if (entryCount === 0xffff || centralDirectoryOffset === 0xffffffff) {
    throw new Error("ZIP64_NOT_SUPPORTED");
  }

  const entries: ZipArchiveEntry[] = [];
  let cursor = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(cursor) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error("ZIP_CENTRAL_DIRECTORY_INVALID");
    }

    const flags = buffer.readUInt16LE(cursor + 8);
    if ((flags & ENCRYPTED_FLAG) !== 0) throw new Error("ZIP_ENCRYPTION_NOT_SUPPORTED");

    const compressionMethod = buffer.readUInt16LE(cursor + 10);
    if (compressionMethod !== METHOD_STORED && compressionMethod !== METHOD_DEFLATE) {
      throw new Error("ZIP_COMPRESSION_METHOD_NOT_SUPPORTED");
    }

    const modifiedTime = buffer.readUInt16LE(cursor + 12);
    const modifiedDate = buffer.readUInt16LE(cursor + 14);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const internalAttributes = buffer.readUInt16LE(cursor + 36);
    const externalAttributes = buffer.readUInt32LE(cursor + 38);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const nameStart = cursor + 46;
    const name = decodeEntryName(buffer.subarray(nameStart, nameStart + nameLength));

    if (buffer.readUInt32LE(localHeaderOffset) !== LOCAL_FILE_HEADER_SIGNATURE) {
      throw new Error("ZIP_LOCAL_HEADER_INVALID");
    }
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    const data =
      compressionMethod === METHOD_STORED
        ? Buffer.from(compressed)
        : inflateRawSync(Buffer.from(compressed));

    if (data.length !== uncompressedSize) throw new Error("ZIP_ENTRY_SIZE_MISMATCH");

    entries.push({
      name,
      data,
      compressionMethod,
      modifiedTime,
      modifiedDate,
      internalAttributes,
      externalAttributes,
    });

    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let value = 0; value < 256; value += 1) {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[value] = crc >>> 0;
  }
  return table;
})();

function crc32(input: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeLocalHeader(
  entry: ZipArchiveEntry,
  name: Buffer,
  compressed: Buffer,
  crc: number,
): Buffer {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(LOCAL_FILE_HEADER_SIGNATURE, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(UTF8_FLAG, 6);
  header.writeUInt16LE(entry.compressionMethod, 8);
  header.writeUInt16LE(entry.modifiedTime, 10);
  header.writeUInt16LE(entry.modifiedDate, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(entry.data.length, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  return header;
}

function makeCentralHeader(
  entry: ZipArchiveEntry,
  name: Buffer,
  compressed: Buffer,
  crc: number,
  localHeaderOffset: number,
): Buffer {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(CENTRAL_DIRECTORY_SIGNATURE, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(UTF8_FLAG, 8);
  header.writeUInt16LE(entry.compressionMethod, 10);
  header.writeUInt16LE(entry.modifiedTime, 12);
  header.writeUInt16LE(entry.modifiedDate, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(compressed.length, 20);
  header.writeUInt32LE(entry.data.length, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(entry.internalAttributes, 36);
  header.writeUInt32LE(entry.externalAttributes, 38);
  header.writeUInt32LE(localHeaderOffset, 42);
  return header;
}

export function writeZipArchive(entries: readonly ZipArchiveEntry[]): Uint8Array {
  if (entries.length > 0xffff) throw new Error("ZIP_ENTRY_COUNT_TOO_LARGE");

  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.from(entry.data);
    const compressed =
      entry.compressionMethod === METHOD_STORED ? data : deflateRawSync(data, { level: 6 });
    const crc = crc32(data);
    const localHeader = makeLocalHeader(entry, name, compressed, crc);
    const centralHeader = makeCentralHeader(entry, name, compressed, crc, localOffset);

    localParts.push(localHeader, name, compressed);
    centralParts.push(centralHeader, name);
    localOffset += localHeader.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

export function cloneZipEntryWithData(entry: ZipArchiveEntry, data: Uint8Array): ZipArchiveEntry {
  return {
    ...entry,
    data,
  };
}
