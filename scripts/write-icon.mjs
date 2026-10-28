import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const size = 128;

function crc32(buffer) {
  let crc = ~0;
  for (let index = 0; index < buffer.length; index += 1) {
    crc ^= buffer[index];
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function png(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    rgba.copy(raw, row + 1, y * width * 4, (y + 1) * width * 4);
  }
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const pixels = Buffer.alloc(size * size * 4);

function set(x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const offset = (y * size + x) * 4;
  const alpha = a / 255;
  pixels[offset] = Math.round(pixels[offset] * (1 - alpha) + r * alpha);
  pixels[offset + 1] = Math.round(pixels[offset + 1] * (1 - alpha) + g * alpha);
  pixels[offset + 2] = Math.round(pixels[offset + 2] * (1 - alpha) + b * alpha);
  pixels[offset + 3] = Math.min(255, pixels[offset + 3] + a);
}

function fillRoundRect(x, y, w, h, radius, color) {
  for (let py = y; py < y + h; py += 1) {
    for (let px = x; px < x + w; px += 1) {
      const dx = px < x + radius ? x + radius - px : px >= x + w - radius ? px - (x + w - radius - 1) : 0;
      const dy = py < y + radius ? y + radius - py : py >= y + h - radius ? py - (y + h - radius - 1) : 0;
      if (dx * dx + dy * dy <= radius * radius) set(px, py, color[0], color[1], color[2], color[3] ?? 255);
    }
  }
}

function strokeRoundRect(x, y, w, h, radius, width, color) {
  const inner = width;
  for (let py = y; py < y + h; py += 1) {
    for (let px = x; px < x + w; px += 1) {
      const dx = px < x + radius ? x + radius - px : px >= x + w - radius ? px - (x + w - radius - 1) : 0;
      const dy = py < y + radius ? y + radius - py : py >= y + h - radius ? py - (y + h - radius - 1) : 0;
      if (dx * dx + dy * dy > radius * radius) continue;
      const ix = px - x;
      const iy = py - y;
      const edge = ix < inner || iy < inner || ix >= w - inner || iy >= h - inner;
      if (edge) set(px, py, color[0], color[1], color[2], color[3] ?? 255);
    }
  }
}

function fillCircle(cx, cy, radius, color) {
  const r2 = radius * radius;
  for (let py = Math.floor(cy - radius); py <= cy + radius; py += 1) {
    for (let px = Math.floor(cx - radius); px <= cx + radius; px += 1) {
      const dx = px + 0.5 - cx;
      const dy = py + 0.5 - cy;
      if (dx * dx + dy * dy <= r2) set(px, py, color[0], color[1], color[2], color[3] ?? 255);
    }
  }
}

function line(x0, y0, x1, y1, width, color) {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
  const radius = width / 2;
  for (let step = 0; step <= steps; step += 1) {
    const t = steps === 0 ? 0 : step / steps;
    fillCircle(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, radius, color);
  }
}

fillRoundRect(0, 0, size, size, 28, [16, 24, 32, 255]);
strokeRoundRect(20, 24, 56, 56, 12, 4, [126, 224, 255, 255]);
line(36, 81, 64, 52, 5, [255, 90, 209, 255]);
line(64, 52, 76, 64, 5, [255, 90, 209, 255]);
line(76, 64, 96, 40, 5, [255, 90, 209, 255]);
fillCircle(88, 88, 16, [61, 255, 154, 255]);
line(88, 80, 88, 96, 3, [16, 32, 24, 255]);
line(80, 88, 96, 88, 3, [16, 32, 24, 255]);

writeFileSync('icon.png', png(size, size, pixels));
