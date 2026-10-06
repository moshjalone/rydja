'use strict';

// Minimal POSIX ustar writer — enough to produce an archive that `tar -xzf`
// and every GUI unarchiver can open. Avoids a dependency for the one thing we
// need it for: packing a backup into a single file.

const BLOCK = 512;

const pad = (str, len) => Buffer.concat([Buffer.from(str, 'utf8'), Buffer.alloc(len)], len);

/** Octal, NUL-terminated — how tar stores every numeric field. */
const octal = (num, len) => pad(num.toString(8).padStart(len - 1, '0'), len);

function header(name, size, mtime) {
  const buf = Buffer.alloc(BLOCK);

  // ustar splits long paths into prefix(155) + name(100).
  let prefix = '';
  let base = name;
  if (Buffer.byteLength(name) > 100) {
    const cut = name.lastIndexOf('/', 100);
    if (cut === -1) throw new Error(`Path too long for tar: ${name}`);
    prefix = name.slice(0, cut);
    base = name.slice(cut + 1);
  }

  pad(base, 100).copy(buf, 0);
  octal(0o644, 8).copy(buf, 100);       // mode
  octal(0, 8).copy(buf, 108);           // uid
  octal(0, 8).copy(buf, 116);           // gid
  octal(size, 12).copy(buf, 124);       // size
  octal(Math.floor(mtime / 1000), 12).copy(buf, 136); // mtime
  buf.write('        ', 148, 8);        // checksum placeholder: 8 spaces
  buf.write('0', 156);                  // typeflag: regular file
  buf.write('ustar\0', 257);
  buf.write('00', 263);
  pad(prefix, 155).copy(buf, 345);

  // Checksum is the sum of every byte with the checksum field read as spaces.
  let sum = 0;
  for (const byte of buf) sum += byte;
  buf.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);

  return buf;
}

/** Pad a payload out to the next 512-byte boundary. */
const padding = (size) => Buffer.alloc((BLOCK - (size % BLOCK)) % BLOCK);

/**
 * @param {Array<{name: string, data: Buffer, mtime?: number}>} entries
 * @returns {Buffer} a complete tar archive
 */
function create(entries) {
  const parts = [];
  for (const entry of entries) {
    parts.push(header(entry.name, entry.data.length, entry.mtime || Date.now()));
    parts.push(entry.data);
    parts.push(padding(entry.data.length));
  }
  parts.push(Buffer.alloc(BLOCK * 2)); // two empty blocks mark end of archive
  return Buffer.concat(parts);
}

module.exports = { create };
