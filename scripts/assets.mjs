import { writeFile, mkdir } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const content = Buffer.concat([Buffer.from(type), data]);
  const header = Buffer.alloc(4);
  const tail = Buffer.alloc(4);
  header.writeUInt32BE(data.length);
  tail.writeUInt32BE(crc32(content));
  return Buffer.concat([header, content, tail]);
}
const size = 512;
const scanlines = Buffer.alloc(size * (size * 4 + 1));
function insideRounded(x, y, left, top, right, bottom, radius) {
  const nx = Math.max(left + radius, Math.min(right - radius, x));
  const ny = Math.max(top + radius, Math.min(bottom - radius, y));
  return (x - nx) ** 2 + (y - ny) ** 2 <= radius ** 2;
}
function colorAt(x, y) {
  if (!insideRounded(x, y, 24, 24, 488, 488, 106)) return [0, 0, 0, 0];
  if (insideRounded(x, y, 144, 118, 368, 398, 18)) {
    if (!insideRounded(x, y, 154, 128, 358, 388, 9)) return [57, 60, 54, 255];
    if ((x >= 190 && x <= 321 && y >= 191 && y <= 201)
      || (x >= 190 && x <= 302 && y >= 245 && y <= 255)
      || (x >= 190 && x <= 267 && y >= 299 && y <= 309)) return [57, 60, 54, 255];
  }
  return [247, 246, 242, 255];
}
for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    const sum = [0, 0, 0, 0];
    for (const sy of [0.25, 0.75]) for (const sx of [0.25, 0.75]) {
      const rgba = colorAt(x + sx, y + sy);
      for (let c = 0; c < 4; c++) sum[c] += rgba[c];
    }
    for (let c = 0; c < 4; c++) scanlines[y * (size * 4 + 1) + x * 4 + c + 1] = Math.round(sum[c] / 4);
  }
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size, 0);
ihdr.writeUInt32BE(size, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0))]);
await mkdir(`${root}public`, { recursive: true });
await writeFile(`${root}public/app-icon.png`, png);
const iconSize = 256;
const iconPixels = Buffer.alloc(iconSize * (iconSize * 4 + 1));
for (let y = 0; y < iconSize; y++) for (let x = 0; x < iconSize; x++) for (let c = 0; c < 4; c++) {
  let sum = 0;
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) sum += scanlines[(y * 2 + dy) * (size * 4 + 1) + (x * 2 + dx) * 4 + c + 1];
  iconPixels[y * (iconSize * 4 + 1) + x * 4 + c + 1] = Math.round(sum / 4);
}
const iconHeader = Buffer.from(ihdr);
iconHeader.writeUInt32BE(iconSize, 0);
iconHeader.writeUInt32BE(iconSize, 4);
const iconPng = Buffer.concat([png.subarray(0, 8), chunk('IHDR', iconHeader), chunk('IDAT', deflateSync(iconPixels)), chunk('IEND', Buffer.alloc(0))]);
const ico = Buffer.alloc(22);
ico.writeUInt16LE(1, 2);
ico.writeUInt16LE(1, 4);
ico.writeUInt16LE(1, 10);
ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(iconPng.length, 14);
ico.writeUInt32LE(22, 18);
await writeFile(`${root}public/app-icon.ico`, Buffer.concat([ico, iconPng]));
const icns = Buffer.alloc(16);
icns.write('icns', 0);
icns.writeUInt32BE(png.length + 16, 4);
icns.write('ic09', 8);
icns.writeUInt32BE(png.length + 8, 12);
await writeFile(`${root}public/app-icon.icns`, Buffer.concat([icns, png]));
await writeFile(`${root}public/favicon.svg`, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="3" y="3" width="58" height="58" rx="13" fill="#f7f6f2"/><g stroke="#393c36" stroke-width="1.5" fill="none" stroke-linecap="round"><rect x="18" y="15" width="28" height="34" rx="2"/><path d="M24 25h16M24 32h14M24 39h9"/></g></svg>');
console.log('Application icons created.');
