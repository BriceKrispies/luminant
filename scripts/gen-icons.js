/**
 * Generate PWA icons — simple "L" glyph on dark background.
 * Uses Node canvas-free approach: writes raw PNG via minimal encoder.
 * Output: public/icons/icon-192.png, icon-512.png, icon-512-maskable.png
 */

import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { deflateSync } from 'zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, '..', 'public', 'icons');

function createIcon(size, maskable = false) {
  // RGBA pixel buffer
  const pixels = new Uint8Array(size * size * 4);

  // Background: #0a0a0e
  for (let i = 0; i < size * size; i++) {
    pixels[i * 4] = 10;
    pixels[i * 4 + 1] = 10;
    pixels[i * 4 + 2] = 14;
    pixels[i * 4 + 3] = 255;
  }

  function setPixel(x, y, r, g, b, a = 255) {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const i = (y * size + x) * 4;
    // Alpha blend
    const aa = a / 255;
    pixels[i] = Math.round(pixels[i] * (1 - aa) + r * aa);
    pixels[i + 1] = Math.round(pixels[i + 1] * (1 - aa) + g * aa);
    pixels[i + 2] = Math.round(pixels[i + 2] * (1 - aa) + b * aa);
    pixels[i + 3] = 255;
  }

  function fillCircle(cx, cy, radius, r, g, b, a = 255) {
    const r2 = radius * radius;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= r2) {
          setPixel(Math.round(cx + dx), Math.round(cy + dy), r, g, b, a);
        }
      }
    }
  }

  function fillRect(x, y, w, h, r, g, b, a = 255) {
    for (let py = y; py < y + h; py++) {
      for (let px = x; px < x + w; px++) {
        setPixel(Math.round(px), Math.round(py), r, g, b, a);
      }
    }
  }

  const cx = size / 2;
  const cy = size / 2;
  const unit = size / 16;

  // Outer glow circle
  fillCircle(cx, cy, unit * 6.5, 60, 120, 200, 25);
  fillCircle(cx, cy, unit * 5.5, 60, 120, 200, 40);

  // "L" shape — the Luminant mark
  const lx = cx - unit * 2.5;
  const ly = cy - unit * 3;
  const thickness = unit * 1.6;
  // Vertical stroke
  fillRect(lx, ly, thickness, unit * 6, 200, 220, 255);
  // Horizontal stroke
  fillRect(lx, ly + unit * 6 - thickness, unit * 5, thickness, 200, 220, 255);

  // Bright center dot (the "light" in luminant)
  fillCircle(cx + unit * 0.5, cy - unit * 0.5, unit * 0.8, 255, 255, 255, 180);

  return pixels;
}

function encodePNG(pixels, width, height) {
  // Minimal PNG encoder
  // Filter: none (0) prepended to each row
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter byte
    raw.set(
      pixels.subarray(y * width * 4, (y + 1) * width * 4),
      y * (width * 4 + 1) + 1
    );
  }

  const compressed = deflateSync(Buffer.from(raw), { level: 9 });

  const chunks = [];

  // Signature
  chunks.push(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  chunks.push(makeChunk('IHDR', ihdr));

  // IDAT
  chunks.push(makeChunk('IDAT', compressed));

  // IEND
  chunks.push(makeChunk('IEND', Buffer.alloc(0)));

  return Buffer.concat(chunks);
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeB = Buffer.from(type, 'ascii');
  const crc = crc32(Buffer.concat([typeB, data]));
  const crcB = Buffer.alloc(4);
  crcB.writeUInt32BE(crc >>> 0, 0);
  return Buffer.concat([len, typeB, data, crcB]);
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Generate icons
for (const [size, name, maskable] of [
  [192, 'icon-192.png', false],
  [512, 'icon-512.png', false],
  [512, 'icon-512-maskable.png', true],
]) {
  const pixels = createIcon(size, maskable);
  const png = encodePNG(pixels, size, size);
  const path = resolve(outDir, name);
  writeFileSync(path, png);
  console.log(`  ${name} (${size}x${size}, ${png.length} bytes)`);
}

console.log('Icons generated.');
