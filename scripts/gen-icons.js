/**
 * Generates eco-tracker PNG icons (16×16, 48×48, 128×128) without any
 * external dependencies — uses only Node's built-in zlib module.
 *
 * Design: dark green circle with a white leaf silhouette.
 */

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = path.join(__dirname, '..', 'src', 'icons');
fs.mkdirSync(OUT_DIR, { recursive: true });

// ── PNG writer ────────────────────────────────────────────────────────────────

function u32be(n) {
  const b = Buffer.allocUnsafe(4);
  b.writeUInt32BE(n, 0);
  return b;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const payload   = Buffer.concat([typeBytes, data]);
  return Buffer.concat([u32be(data.length), payload, u32be(crc32(payload))]);
}

function makePng(width, height, pixels) {
  // pixels: flat Uint8Array of RGBA values, row-major

  // Build raw scanlines (filter byte 0 = None before each row)
  const rowBytes = width * 4;
  const raw = Buffer.allocUnsafe(height * (1 + rowBytes));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + rowBytes)] = 0; // filter byte
    for (let x = 0; x < width; x++) {
      const si = (y * width + x) * 4;
      const di = y * (1 + rowBytes) + 1 + x * 4;
      raw[di]     = pixels[si];
      raw[di + 1] = pixels[si + 1];
      raw[di + 2] = pixels[si + 2];
      raw[di + 3] = pixels[si + 3];
    }
  }

  const deflated = zlib.deflateSync(raw, { level: 9 });

  const sig  = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = chunk('IHDR', Buffer.concat([
    u32be(width), u32be(height),
    Buffer.from([8, 6, 0, 0, 0]), // 8-bit RGBA, deflate, no interlace
  ]));
  const idat = chunk('IDAT', deflated);
  const iend = chunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, ihdr, idat, iend]);
}

// ── Drawing helpers ───────────────────────────────────────────────────────────

function setPixel(pixels, width, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= width || y >= width) return;
  const i = (y * width + x) * 4;
  pixels[i]     = r;
  pixels[i + 1] = g;
  pixels[i + 2] = b;
  pixels[i + 3] = a;
}

function fillCircle(pixels, w, cx, cy, radius, r, g, b, a) {
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= radius * radius) {
        setPixel(pixels, w, x, y, r, g, b, a);
      }
    }
  }
}

// Leaf: bezier-like approximation using filled ellipses
function drawLeaf(pixels, w, r, g, b) {
  const cx   = w / 2;
  const cy   = w / 2;
  const size = w * 0.34;

  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      // Normalise to [-1, 1] relative to centre
      const nx = (x - cx) / size;
      const ny = (y - cy) / size;

      // Leaf shape: rotated ellipse clipped to two arcs
      // Rotate 45°
      const rx =  nx * 0.707 + ny * 0.707;
      const ry = -nx * 0.707 + ny * 0.707;

      const inLeaf =
        (rx * rx) / 1.0 + (ry * ry) / 0.28 <= 1 &&
        (rx * rx) / 0.28 + (ry * ry) / 1.0 <= 1;

      if (inLeaf) setPixel(pixels, w, x, y, r, g, b, 255);
    }
  }

  // Stem: a small vertical bar below centre
  const stemW = Math.max(1, Math.round(w * 0.06));
  const stemH = Math.round(w * 0.18);
  for (let dy = 0; dy < stemH; dy++) {
    for (let dx = -stemW; dx <= stemW; dx++) {
      setPixel(pixels, w, Math.round(cx) + dx, Math.round(cy + size * 0.45) + dy, r, g, b, 255);
    }
  }
}

// ── Generate each size ────────────────────────────────────────────────────────

const SIZES = [16, 48, 128];

for (const size of SIZES) {
  const pixels = new Uint8Array(size * size * 4); // all transparent

  const cx = size / 2 - 0.5;
  const cy = size / 2 - 0.5;
  const r  = size / 2 - 0.5;

  // Dark green background circle
  fillCircle(pixels, size, cx, cy, r, 15, 42, 24, 255);

  // White leaf
  drawLeaf(pixels, size, 255, 255, 255);

  const png = makePng(size, size, pixels);
  const outPath = path.join(OUT_DIR, `icon${size}.png`);
  fs.writeFileSync(outPath, png);
  console.log(`Generated ${outPath} (${png.length} bytes)`);
}
