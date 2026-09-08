/**
 * Generates the desktop app icon (1024×1024 RGBA PNG) with zero
 * dependencies — hand-rolled PNG writer. Warm orange circle on a
 * transparent canvas, matching the UI accent.
 *
 * Usage: node scripts/gen-desktop-icon.mjs [out.png]
 */

import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const SIZE = 1024;

// CRC32 (PNG chunk checksums)
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// Palette
const OUTER = [0xc2, 0x41, 0x0c, 255]; // #C2410C accent
const INNER = [0xff, 0x9e, 0x73, 255]; // #FF9E73 lighter ring

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1)); // filter byte per row
const cx = SIZE / 2;
const cy = SIZE / 2;
const R = SIZE * 0.44;
const R2 = SIZE * 0.30;

for (let y = 0; y < SIZE; y++) {
  const row = y * (SIZE * 4 + 1);
  raw[row] = 0; // filter: none
  for (let x = 0; x < SIZE; x++) {
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    let color = [0, 0, 0, 0];
    if (d <= R2) {
      color = OUTER;
    } else if (d <= R) {
      // anti-aliased edge of the outer disk
      const a = Math.min(1, R - d + 0.5);
      color = [OUTER[0], OUTER[1], OUTER[2], Math.round(a * 255)];
    }
    const p = row + 1 + x * 4;
    raw[p] = color[0];
    raw[p + 1] = color[1];
    raw[p + 2] = color[2];
    raw[p + 3] = color[3];
  }
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", (() => {
    const h = Buffer.alloc(13);
    h.writeUInt32BE(SIZE, 0);
    h.writeUInt32BE(SIZE, 4);
    h[8] = 8; // bit depth
    h[9] = 6; // color type RGBA
    return h;
  })()),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const out = process.argv[2] ?? "scripts/desktop-icon.png";
writeFileSync(out, png);
console.log(`icon written: ${out} (${png.length} bytes)`);
