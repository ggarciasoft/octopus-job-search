/**
 * A minimal, deterministic ZIP writer.
 *
 * Written here rather than pulled in as a dependency for three reasons, in
 * order of how much they matter:
 *
 *  1. **The export must be reproducible.** Two exports of the same workspace
 *     at the same instant should be byte-identical, so a checksum means
 *     something. Most libraries stamp the local time zone into every entry and
 *     vary their compression level between versions.
 *  2. **It is the archive a user's data leaves in.** Sixty lines that can be
 *     read in full beats a transitive dependency tree in the one place where
 *     the bytes are the product.
 *  3. Entries are *stored*, not deflated. The payload is JSON and PDFs; the
 *     saving would be real but so is the risk surface, and every unzip tool
 *     that exists reads a stored entry.
 *
 * The format is PKZIP's, with no ZIP64 and no data descriptors, which bounds
 * the archive at 4 GiB and 65 535 entries. `MAX_ENTRIES` and `MAX_TOTAL_BYTES`
 * refuse anything near that rather than writing a file that unzips wrong.
 */
import { crc32 } from 'node:zlib';

export interface ZipEntry {
  /** Forward-slash path inside the archive. */
  readonly path: string;
  readonly data: Buffer;
}

export const MAX_ENTRIES = 10_000;
export const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;

export class ZipTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipTooLargeError';
  }
}

/**
 * A fixed DOS timestamp, not the clock.
 *
 * Every entry claims 1980-01-01 00:00. ZIP stores local time with no zone, so
 * the real time would make an archive depend on the server's time zone and
 * make two otherwise identical exports differ. The true export time is in the
 * manifest, where it can be recorded unambiguously.
 */
const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1; // 1980-01-01

function localHeader(entry: ZipEntry, nameBytes: Buffer, checksum: number): Buffer {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4); // version needed
  header.writeUInt16LE(0, 6); // flags: none, so no data descriptor
  header.writeUInt16LE(0, 8); // method: stored
  header.writeUInt16LE(DOS_TIME, 10);
  header.writeUInt16LE(DOS_DATE, 12);
  header.writeUInt32LE(checksum, 14);
  header.writeUInt32LE(entry.data.length, 18);
  header.writeUInt32LE(entry.data.length, 22);
  header.writeUInt16LE(nameBytes.length, 26);
  header.writeUInt16LE(0, 28); // extra field length
  return header;
}

function centralHeader(
  entry: ZipEntry,
  nameBytes: Buffer,
  checksum: number,
  offset: number,
): Buffer {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4); // version made by
  header.writeUInt16LE(20, 6); // version needed
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10); // stored
  header.writeUInt16LE(DOS_TIME, 12);
  header.writeUInt16LE(DOS_DATE, 14);
  header.writeUInt32LE(checksum, 16);
  header.writeUInt32LE(entry.data.length, 20);
  header.writeUInt32LE(entry.data.length, 24);
  header.writeUInt16LE(nameBytes.length, 28);
  header.writeUInt16LE(0, 30); // extra
  header.writeUInt16LE(0, 32); // comment
  header.writeUInt16LE(0, 34); // disk number
  header.writeUInt16LE(0, 36); // internal attributes
  header.writeUInt32LE(0, 38); // external attributes
  header.writeUInt32LE(offset, 42);
  return header;
}

/** Builds the archive in memory. Bounded, because the caller holds the result. */
export function buildZip(entries: readonly ZipEntry[]): Buffer {
  if (entries.length > MAX_ENTRIES) {
    throw new ZipTooLargeError(`An archive may hold at most ${MAX_ENTRIES} entries.`);
  }
  const total = entries.reduce((sum, entry) => sum + entry.data.length, 0);
  if (total > MAX_TOTAL_BYTES) {
    throw new ZipTooLargeError(`An archive may hold at most ${MAX_TOTAL_BYTES} bytes.`);
  }

  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.path, 'utf8');
    const checksum = crc32(entry.data);
    const header = localHeader(entry, nameBytes, checksum);
    parts.push(header, nameBytes, entry.data);
    central.push(centralHeader(entry, nameBytes, checksum, offset));
    central.push(nameBytes);
    offset += header.length + nameBytes.length + entry.data.length;
  }

  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4); // this disk
  end.writeUInt16LE(0, 6); // disk with central directory
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...parts, centralBuffer, end]);
}
