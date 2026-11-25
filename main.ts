// news-image-20261125 — "The World in One Day"
// Draws the world news of Wednesday 25 November 2026 as a single 1024x1024
// newspaper front-page image. Pure Node 22 stdlib: hand-written PNG encoder,
// an embedded 5x7 bitmap font, and a tiny vector rasterizer. No network,
// no external assets, no dates or randomness — two runs are byte-identical.

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const W = 1024;
const H = 1024;
const OUT = "/output/entry.png";

type RGB = [number, number, number];

// ---------------------------------------------------------------- palette
const NAVY: RGB = [13, 27, 46];
const INK: RGB = [16, 24, 38];
const PAPER: RGB = [246, 239, 223];
const CREAM: RGB = [251, 247, 236];
const RED: RGB = [163, 22, 33];
const GOLD: RGB = [232, 182, 76];
const WHITE: RGB = [255, 255, 255];
const SKY_DUSK_TOP: RGB = [20, 38, 62];
const SKY_DUSK_MID: RGB = [74, 58, 82];
const SKY_DUSK_LOW: RGB = [224, 123, 57];
const SEA: RGB = [12, 34, 51];
const SEA_LIGHT: RGB = [38, 84, 112];
const DARK: RGB = [8, 12, 20];
const GREY: RGB = [120, 128, 138];
const SMOKE: RGB = [150, 152, 158];
const FIRE_ORANGE: RGB = [240, 120, 30];
const FIRE_YELLOW: RGB = [255, 196, 60];
const FIRE_WHITE: RGB = [255, 232, 160];

// ---------------------------------------------------------------- framebuffer
const fb = new Uint8Array(W * H * 3);

function px(x: number, y: number, c: RGB): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  fb[i] = c[0];
  fb[i + 1] = c[1];
  fb[i + 2] = c[2];
}

function rect(x: number, y: number, w: number, h: number, c: RGB): void {
  // Floor every coordinate: a fractional y once shifted glyph pixels half a
  // row sideways (index wrap), so never let a fraction reach the buffer.
  x = Math.floor(x);
  y = Math.floor(y);
  w = Math.floor(w);
  h = Math.floor(h);
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(W, x + w);
  const y1 = Math.min(H, y + h);
  for (let yy = y0; yy < y1; yy++) {
    let i = (yy * W + x0) * 3;
    for (let xx = x0; xx < x1; xx++) {
      fb[i] = c[0];
      fb[i + 1] = c[1];
      fb[i + 2] = c[2];
      i += 3;
    }
  }
}

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function mix(c1: RGB, c2: RGB, t: number): RGB {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

// Vertical gradient through a list of [position 0..1, color] stops.
function vgrad(x: number, y: number, w: number, h: number, stops: Array<[number, RGB]>): void {
  for (let yy = 0; yy < h; yy++) {
    const t = h <= 1 ? 0 : yy / (h - 1);
    let c: RGB = stops[stops.length - 1][1];
    for (let s = 0; s < stops.length - 1; s++) {
      const t0 = stops[s][0];
      const t1 = stops[s + 1][0];
      if (t >= t0 && t <= t1) {
        const f = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
        c = mix(stops[s][1], stops[s + 1][1], f);
        break;
      }
    }
    rect(x, y + yy, w, 1, c);
  }
}

function line(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;
  for (;;) {
    px(x, y, c);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}

function ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB): void {
  for (let y = cy - ry; y <= cy + ry; y++) {
    for (let x = cx - rx; x <= cx + rx; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) px(x, y, c);
    }
  }
}

function circle(cx: number, cy: number, r: number, c: RGB): void {
  ellipse(cx, cy, r, r, c);
}

// Circle outline (for radar arcs, rings).
function ring(cx: number, cy: number, r: number, c: RGB): void {
  const steps = Math.max(24, r * 4);
  let px0 = cx + r;
  let py0 = cy;
  for (let i = 1; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const x = Math.round(cx + r * Math.cos(a));
    const y = Math.round(cy + r * Math.sin(a));
    line(px0, py0, x, y, c);
    px0 = x;
    py0 = y;
  }
}

// Scanline polygon fill. pts: [x, y] pairs.
function poly(pts: Array<[number, number]>, c: RGB): void {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  for (let y = Math.max(0, minY); y <= Math.min(H - 1, maxY); y++) {
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
        const t = (y - a[1]) / (b[1] - a[1]);
        xs.push(Math.round(a[0] + t * (b[0] - a[0])));
      }
    }
    xs.sort((m, n) => m - n);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = xs[k]; x <= xs[k + 1]; x++) px(x, y, c);
    }
  }
}

function star(cx: number, cy: number, r: number, c: RGB): void {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    pts.push([Math.round(cx + rr * Math.cos(a)), Math.round(cy + rr * Math.sin(a))]);
  }
  poly(pts, c);
}

// ---------------------------------------------------------------- 5x7 font
// Each glyph: 7 rows, each a 5-bit number; bit 4 is the left column.
const FONT: Record<string, number[]> = {
  A: [14, 17, 17, 31, 17, 17, 17],
  B: [30, 17, 17, 30, 17, 17, 30],
  C: [14, 17, 16, 16, 16, 17, 14],
  D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 15],
  H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14],
  J: [7, 2, 2, 2, 2, 18, 12],
  K: [17, 18, 20, 24, 20, 18, 17],
  L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17],
  N: [17, 25, 21, 19, 17, 17, 17],
  O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13],
  R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30],
  T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4],
  W: [17, 17, 17, 21, 21, 27, 17],
  X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4],
  Z: [31, 1, 2, 4, 8, 16, 31],
  "0": [14, 17, 19, 21, 25, 17, 14],
  "1": [4, 12, 4, 4, 4, 4, 14],
  "2": [14, 17, 1, 6, 8, 16, 31],
  "3": [31, 2, 4, 2, 1, 17, 14],
  "4": [2, 6, 10, 18, 31, 2, 2],
  "5": [31, 16, 30, 1, 1, 17, 14],
  "6": [6, 8, 16, 30, 17, 17, 14],
  "7": [31, 1, 2, 4, 8, 8, 8],
  "8": [14, 17, 17, 14, 17, 17, 14],
  "9": [14, 17, 17, 15, 1, 2, 12],
  " ": [0, 0, 0, 0, 0, 0, 0],
  ".": [0, 0, 0, 0, 0, 12, 12],
  ",": [0, 0, 0, 0, 12, 4, 8],
  ":": [0, 12, 12, 0, 12, 12, 0],
  ";": [0, 12, 12, 0, 12, 4, 8],
  "-": [0, 0, 0, 14, 0, 0, 0],
  "'": [4, 4, 8, 0, 0, 0, 0],
  "!": [4, 4, 4, 4, 4, 0, 4],
  "?": [14, 17, 1, 2, 4, 0, 4],
  "(": [2, 4, 8, 8, 8, 4, 2],
  ")": [8, 4, 2, 2, 2, 4, 8],
  "/": [1, 2, 2, 4, 8, 8, 16],
  "&": [12, 18, 20, 8, 21, 18, 13],
  "%": [25, 26, 2, 4, 8, 11, 19],
  "+": [0, 4, 4, 14, 4, 4, 0],
  "=": [0, 0, 14, 0, 14, 0, 0],
  '"': [10, 10, 0, 0, 0, 0, 0],
  "#": [10, 10, 31, 10, 31, 10, 10],
  "*": [0, 4, 21, 14, 21, 4, 0],
  "\u2022": [0, 0, 12, 12, 12, 0, 0],
  "$": [4, 15, 20, 14, 5, 30, 4],
};

function clean(s: string): string {
  return s
    .toUpperCase()
    .replace(/\u2019/g, "'")
    .replace(/\u2014/g, "-")
    .replace(/\u2013/g, "-");
}

function textWidth(s: string, scale: number): number {
  const t = clean(s);
  if (t.length === 0) return 0;
  return t.length * 6 * scale - scale;
}

function drawText(s: string, x: number, y: number, scale: number, c: RGB): void {
  const t = clean(s);
  let cx = x;
  for (const ch of t) {
    const g = FONT[ch] ?? FONT["?"];
    for (let r = 0; r < 7; r++) {
      const row = g[r];
      for (let col = 0; col < 5; col++) {
        if (row & (1 << (4 - col))) {
          rect(cx + col * scale, y + r * scale, scale, scale, c);
        }
      }
    }
    cx += 6 * scale;
  }
}

function drawTextCentered(s: string, cx: number, y: number, scale: number, c: RGB): void {
  drawText(s, cx - Math.floor(textWidth(s, scale) / 2), y, scale, c);
}

// ---------------------------------------------------------------- PNG encoder
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function encodePng(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0; // filter: none
    raw.set(fb.subarray(y * W * 3, (y + 1) * W * 3), y * (1 + W * 3) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- scene bits
function explosion(cx: number, cy: number, r: number): void {
  circle(cx, cy, r, FIRE_ORANGE);
  circle(cx, cy, Math.round(r * 0.68), FIRE_YELLOW);
  circle(cx, cy, Math.round(r * 0.38), FIRE_WHITE);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.4;
    line(
      cx + Math.round(Math.cos(a) * r * 0.5),
      cy + Math.round(Math.sin(a) * r * 0.5),
      cx + Math.round(Math.cos(a) * r * 1.35),
      cy + Math.round(Math.sin(a) * r * 1.35),
      FIRE_YELLOW
    );
  }
}

function smokePuffs(x: number, y: number, n: number): void {
  for (let i = 0; i < n; i++) {
    circle(x + (i % 2 === 0 ? -i * 5 : i * 5), y - i * 11, 12 - i, SMOKE);
  }
}

function waves(x: number, y: number, w: number, rows: number): void {
  for (let r = 0; r < rows; r++) {
    const yy = y + r * 9;
    for (let xx = x; xx < x + w; xx += 14) {
      const off = Math.round(Math.sin((xx + r * 37) * 0.05) * 2);
      rect(xx, yy + off, 9, 2, SEA_LIGHT);
    }
  }
}

function dateTag(x: number, y: number, label: string): void {
  const w = textWidth(label, 1) + 12;
  rect(x, y, w, 16, RED);
  drawText(label, x + 6, y + 5, 1, WHITE);
}

// ---------------------------------------------------------------- masthead
function drawMasthead(): void {
  rect(0, 0, W, H, PAPER);
  // frame
  rect(8, 8, W - 16, 2, NAVY);
  rect(8, H - 10, W - 16, 2, NAVY);
  rect(8, 8, 2, H - 16, NAVY);
  rect(W - 10, 8, 2, H - 16, NAVY);
  rect(14, 14, W - 28, 1, NAVY);
  rect(14, H - 15, W - 28, 1, NAVY);
  rect(14, 14, 1, H - 28, NAVY);
  rect(W - 15, 14, 1, H - 28, NAVY);

  drawTextCentered("THE WORLD IN ONE DAY", 512, 24, 5, NAVY);
  rect(24, 68, 976, 3, NAVY);
  drawTextCentered("WEDNESDAY 25 NOVEMBER 2026", 512, 78, 2, RED);
  rect(24, 102, 976, 2, NAVY);
  drawTextCentered("ONE IMAGE  \u2022  EVERY STORY THAT MATTERED  \u2022  THE DAY THE WORLD MOVED", 512, 110, 1, INK);
}

// ---------------------------------------------------------------- hero: war at sea
function drawHero(): void {
  const x = 24;
  const y = 132;
  const w = 976;
  const h = 322;
  vgrad(x, y, w, 168, [
    [0, SKY_DUSK_TOP],
    [0.55, SKY_DUSK_MID],
    [1, SKY_DUSK_LOW],
  ]);
  // low sun
  circle(150, 262, 46, [242, 193, 78]);
  circle(150, 262, 32, [250, 214, 130]);
  // sea
  rect(x, y + 168, w, h - 168, SEA);
  waves(x, y + 176, w, 8);
  // cargo ship Sparta II, burning
  poly(
    [
      [380, 318],
      [700, 318],
      [676, 356],
      [404, 356],
    ],
    DARK
  );
  rect(430, 292, 70, 26, [24, 30, 42]);
  rect(516, 300, 34, 18, [24, 30, 42]);
  rect(560, 296, 12, 22, [24, 30, 42]);
  line(566, 296, 566, 272, [200, 200, 200]);
  rect(384, 306, 34, 12, [176, 62, 32]);
  rect(424, 306, 34, 12, [42, 96, 122]);
  rect(464, 306, 34, 12, [176, 62, 32]);
  rect(612, 306, 34, 12, [42, 96, 122]);
  rect(652, 306, 34, 12, [176, 62, 32]);
  // fire on the deck
  explosion(560, 306, 26);
  smokePuffs(560, 262, 4);
  // listing lifeboat
  poly(
    [
      [716, 330],
      [748, 330],
      [740, 344],
      [724, 344],
    ],
    [200, 84, 40]
  );
  // drone above, diving in
  line(846, 178, 640, 292, [255, 255, 255]);
  rect(838, 170, 18, 8, DARK);
  rect(830, 166, 34, 3, DARK);
  circle(830, 166, 4, GREY);
  circle(864, 166, 4, GREY);
  line(847, 178, 847, 190, DARK);
  // second strike: sinking warship off Libya, far left
  poly(
    [
      [60, 340],
      [180, 340],
      [168, 360],
      [76, 360],
    ],
    [16, 20, 30]
  );
  rect(96, 322, 22, 18, [16, 20, 30]);
  explosion(150, 336, 14);
  // labels on the scene
  rect(x + 8, y + 8, textWidth("WAR AT SEA", 1) + 12, 16, RED);
  drawText("WAR AT SEA", x + 14, y + 13, 1, WHITE);
  dateTag(x + w - 66, y + 8, "24 NOV");
  // headline band
  rect(x, y + 252, w, 70, NAVY);
  drawTextCentered("UKRAINE HITS RUSSIAN SHIP AT SEA", 512, y + 260, 3, WHITE);
  drawTextCentered("ZELENSKIY CONFIRMS GULF OF FINLAND STRIKE - WARSHIP SUNK OFF LIBYA", 512, y + 290, 2, GOLD);
}

// ---------------------------------------------------------------- small panels
type Panel = {
  x: number;
  y: number;
  w: number;
  h: number;
  cat: string;
  catColor: RGB;
  date: string;
  lines: string[];
  sub: string;
  draw: (x: number, y: number, w: number, sceneH: number) => void;
};

function drawPanel(p: Panel): void {
  rect(p.x, p.y, p.w, p.h, CREAM);
  rect(p.x, p.y, p.w, 2, NAVY);
  rect(p.x, p.y + p.h - 2, p.w, 2, NAVY);
  rect(p.x, p.y, 2, p.h, NAVY);
  rect(p.x + p.w - 2, p.y, 2, p.h, NAVY);
  const headerH = p.h > 200 ? 22 : 18;
  rect(p.x, p.y, p.w, headerH, p.catColor);
  drawText(p.cat, p.x + 8, p.y + Math.floor((headerH - 7) / 2) + 1, 1, WHITE);
  const tagW = textWidth(p.date, 1) + 12;
  rect(p.x + p.w - tagW - 6, p.y + (headerH - 16) / 2, tagW, 16, RED);
  drawText(p.date, p.x + p.w - tagW, p.y + (headerH - 16) / 2 + 5, 1, WHITE);
  const sceneY = p.y + headerH;
  const sceneH = p.h > 200 ? 104 : 86;
  p.draw(p.x, sceneY, p.w, sceneH);
  let ty = sceneY + sceneH + 6;
  for (const ln of p.lines) {
    drawText(ln, p.x + 8, ty, 2, INK);
    ty += 18;
  }
  drawText(p.sub, p.x + 8, ty + 2, 1, RED);
}

// Riyadh: PIF tower struck
function sceneRiyadh(x: number, y: number, w: number, h: number): void {
  vgrad(x, y, w, h, [
    [0, [43, 30, 58]],
    [0.6, [120, 62, 70]],
    [1, [232, 130, 58]],
  ]);
  // skyline
  const heights = [26, 44, 18, 52, 30, 40, 22, 48, 34, 16];
  let bx = x;
  for (let i = 0; i < heights.length; i++) {
    const bw = Math.floor(w / heights.length);
    rect(bx, y + h - heights[i], bw - 3, heights[i], [18, 16, 28]);
    bx += bw;
  }
  // PIF tower: tall tapered slab, centre
  const cx = x + Math.floor(w / 2) + 20;
  poly(
    [
      [cx - 34, y + h],
      [cx - 12, y + 6],
      [cx + 12, y + 6],
      [cx + 34, y + h],
    ],
    [28, 26, 44]
  );
  for (let i = 0; i < 6; i++) {
    const yy = y + 14 + i * 14;
    line(cx - 26 + i * 2, yy, cx + 26 - i * 2, yy + 10, [70, 70, 100]);
  }
  explosion(cx, y + 52, 16);
  smokePuffs(cx, y + 30, 3);
  // ground
  rect(x, y + h - 6, w, 6, [14, 12, 22]);
}

// Hormuz: three tankers, mines
function sceneHormuz(x: number, y: number, w: number, h: number): void {
  vgrad(x, y, w, Math.floor(h * 0.45), [
    [0, [214, 164, 92]],
    [1, [232, 130, 58]],
  ]);
  circle(x + 52, y + 22, 16, [250, 214, 130]);
  rect(x, y + Math.floor(h * 0.45), w, h - Math.floor(h * 0.45), [16, 48, 70]);
  waves(x, y + Math.floor(h * 0.45) + 4, w, 3);
  const tankers: Array<[number, number, number]> = [
    [x + 12, y + h - 34, 86],
    [x + 112, y + h - 44, 104],
    [x + 228, y + h - 30, 76],
  ];
  for (const [tx, ty, tw] of tankers) {
    poly(
      [
        [tx, ty],
        [tx + tw, ty],
        [tx + tw - 8, ty + 16],
        [tx + 8, ty + 16],
      ],
      DARK
    );
    rect(tx + tw - 26, ty - 14, 18, 14, DARK);
    rect(tx + 8, ty - 8, 10, 8, [90, 30, 24]);
  }
  explosion(x + 160, y + h - 52, 15);
  // spiky naval mines
  const mine = (mx: number, my: number): void => {
    circle(mx, my, 7, DARK);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      line(mx, my, mx + Math.round(Math.cos(a) * 12), my + Math.round(Math.sin(a) * 12), DARK);
    }
  };
  mine(x + 258, y + h - 52);
  mine(x + 60, y + h - 58);
}

// NATO AWACS over Poland
function sceneAwacs(x: number, y: number, w: number, h: number): void {
  vgrad(x, y, w, h, [
    [0, [127, 178, 217]],
    [1, [220, 238, 251]],
  ]);
  ellipse(x + 60, y + 24, 34, 10, WHITE);
  ellipse(x + 250, y + 14, 28, 8, WHITE);
  ellipse(x + 200, y + 60, 24, 7, [240, 244, 248]);
  // ground strip
  rect(x, y + h - 14, w, 14, [96, 116, 78]);
  rect(x + 20, y + h - 26, 10, 12, [60, 72, 50]);
  rect(x + 280, y + h - 22, 8, 8, [60, 72, 50]);
  // radar arcs from the AWACS disc
  const cx = x + Math.floor(w / 2);
  const cy = y + 42;
  ring(cx, cy, 58, [255, 255, 255]);
  ring(cx, cy, 74, [230, 238, 244]);
  // AWACS: fuselage, radar disc, wings, tail fin, cockpit
  ellipse(cx - 4, cy + 26, 74, 11, [214, 220, 226]);
  rect(cx - 78, cy + 22, 150, 8, [188, 194, 202]);
  poly(
    [
      [cx - 70, cy + 24],
      [cx - 58, cy + 8],
      [cx - 44, cy + 24],
    ],
    [188, 194, 202]
  );
  poly(
    [
      [cx + 56, cy + 24],
      [cx + 78, cy + 40],
      [cx + 62, cy + 40],
    ],
    [188, 194, 202]
  );
  poly(
    [
      [cx - 72, cy + 24],
      [cx - 72, cy + 2],
      [cx - 58, cy + 24],
    ],
    [170, 176, 184]
  );
  ellipse(cx + 58, cy + 24, 12, 5, [40, 60, 90]);
  ellipse(cx, cy + 8, 34, 7, [176, 182, 190]);
  rect(cx - 3, cy + 12, 6, 10, [176, 182, 190]);
  circle(cx + 62, cy + 26, 3, [40, 60, 90]);
}

// Trump: White House, medal, turkey
function sceneTrump(x: number, y: number, w: number, h: number): void {
  vgrad(x, y, w, h, [
    [0, [242, 227, 192]],
    [1, [214, 186, 140]],
  ]);
  // flag
  line(x + 26, y + 8, x + 26, y + 34, [90, 90, 90]);
  poly(
    [
      [x + 26, y + 8],
      [x + 48, y + 12],
      [x + 26, y + 17],
    ],
    RED
  );
  // White House
  rect(x + 66, y + h - 34, 150, 34, WHITE);
  rect(x + 66, y + h - 44, 150, 10, [232, 228, 218]);
  for (let i = 0; i < 5; i++) {
    rect(x + 78 + i * 28, y + h - 34, 8, 34, [210, 206, 196]);
  }
  poly(
    [
      [x + 60, y + h - 44],
      [x + 141, y + h - 62],
      [x + 222, y + h - 44],
    ],
    [232, 228, 218]
  );
  // medal with ribbon, right
  poly(
    [
      [x + 268, y + 12],
      [x + 284, y + 12],
      [x + 276, y + 34],
    ],
    RED
  );
  poly(
    [
      [x + 284, y + 12],
      [x + 300, y + 12],
      [x + 292, y + 34],
    ],
    [40, 60, 120]
  );
  circle(x + 284, y + 48, 15, GOLD);
  circle(x + 284, y + 48, 10, [240, 200, 90]);
  star(x + 284, y + 48, 6, [160, 110, 20]);
  // turkey, left bottom
  ellipse(x + 46, y + h - 12, 14, 9, [120, 76, 40]);
  circle(x + 58, y + h - 24, 6, [140, 92, 50]);
  for (let i = -2; i <= 2; i++) {
    line(x + 34, y + h - 14, x + 30 + i * 6, y + h - 34, [90, 56, 28]);
  }
}

// Huawei guilty stamp + laptop
function sceneHuawei(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, [18, 28, 48]);
  // laptop
  rect(x + 22, y + 22, 120, 74, [30, 40, 62]);
  rect(x + 30, y + 30, 104, 58, [120, 200, 220]);
  for (let i = 0; i < 5; i++) {
    rect(x + 36, y + 36 + i * 10, 60 - i * 8, 4, [20, 60, 90]);
  }
  poly(
    [
      [x + 14, y + 96],
      [x + 150, y + 96],
      [x + 158, y + h - 2],
      [x + 6, y + h - 2],
    ],
    [44, 56, 80]
  );
  // red GUILTY stamp, top right; lock icon below it, clear of the stamp
  const sx = x + 168;
  const sy = y + 18;
  for (let i = 0; i < 3; i++) {
    rect(sx + i, sy + i, 128 - 2 * i, 2, RED);
    rect(sx + i, sy + 38 - i, 128 - 2 * i, 2, RED);
    rect(sx + i, sy + i, 2, 40 - 2 * i, RED);
    rect(sx + 126 - i, sy + i, 2, 40 - 2 * i, RED);
  }
  drawText("GUILTY", sx + 16, sy + 13, 2, RED);
  // lock icon
  circle(x + 292, y + 70, 9, GOLD);
  rect(x + 287, y + 68, 10, 5, GOLD);
  rect(x + 290, y + 70, 4, 7, NAVY);
}

// Gaza globe + EU stars
function sceneGaza(x: number, y: number, w: number, h: number): void {
  vgrad(x, y, w, h, [
    [0, [168, 204, 232]],
    [1, [226, 238, 246]],
  ]);
  const cx = x + Math.floor(w / 2);
  const cy = y + Math.floor(h / 2) + 2;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    star(Math.round(cx + 62 * Math.cos(a)), Math.round(cy + 62 * Math.sin(a)), 6, GOLD);
  }
  circle(cx, cy, 34, [44, 110, 180]);
  ellipse(cx - 10, cy - 8, 12, 8, [84, 160, 90]);
  ellipse(cx + 12, cy + 10, 10, 7, [84, 160, 90]);
  ellipse(cx + 4, cy - 18, 7, 5, [84, 160, 90]);
  ring(cx, cy, 34, WHITE);
  line(cx - 34, cy, cx + 34, cy, [220, 235, 245]);
  // olive branch
  line(x + 14, y + h - 10, x + 70, y + h - 34, [60, 110, 70]);
  ellipse(x + 30, y + h - 22, 8, 4, [84, 160, 90]);
  ellipse(x + 48, y + h - 28, 8, 4, [84, 160, 90]);
}

// ---------------------------------------------------------------- sport + ticker
function drawSport(): void {
  const y = 878;
  rect(24, y, 976, 60, [16, 35, 58]);
  drawText("SPORT", 36, y + 8, 2, GOLD);
  drawText(
    "CHESS: GUKESH HOLDS SINDAROV, GAME 1 DRAW  \u2022  CRICKET: SOORYAVANSHI 204 OFF 53 - FASTEST LIST A DOUBLE TON",
    36,
    y + 28,
    1,
    WHITE
  );
  drawText(
    "T20I: ENGLAND BEAT AUSTRALIA BY 8 WICKETS, SERIES 1-1  \u2022  GAME 2 IN GENEVA ON WEDNESDAY",
    36,
    y + 42,
    1,
    WHITE
  );
  dateTag(24 + 976 - 66, y + 6, "24 NOV");
}

function drawTicker(): void {
  const y = 950;
  rect(24, y, 976, 50, RED);
  drawTextCentered(
    "GTA 6 OUT SINCE 19 NOV  \u2022  COP31 COLLAPSED 22 NOV - NO PACT  \u2022  TRUMP'S 28-POINT UKRAINE PEACE PLAN DIVIDES ALLIES  \u2022  DOW CLOSES ABOVE 50,000",
    512,
    y + 22,
    1,
    WHITE
  );
}

// ---------------------------------------------------------------- build
function main(): void {
  drawMasthead();
  drawHero();

  const panels: Panel[] = [
    {
      x: 24, y: 466, w: 317, h: 204, cat: "MIDDLE EAST", catColor: [122, 31, 43],
      date: "24 NOV",
      lines: ["HOUTHI DRONE HITS", "RIYADH'S TALLEST", "TOWER, 11 HURT"],
      sub: "SECOND STRIKE IN A WEEK",
      draw: sceneRiyadh,
    },
    {
      x: 353, y: 466, w: 317, h: 204, cat: "MIDDLE EAST", catColor: [15, 76, 92],
      date: "24 NOV",
      lines: ["IRGC CLAIMS 3 TANKERS", "HIT BY MINES IN", "STRAIT OF HORMUZ"],
      sub: "CENTCOM REJECTS CLAIM",
      draw: sceneHormuz,
    },
    {
      x: 682, y: 466, w: 318, h: 204, cat: "EUROPE", catColor: [29, 53, 87],
      date: "23 NOV",
      lines: ["NATO SENDS AWACS", "TO POLAND AFTER", "MISSILES LAND THERE"],
      sub: "RUSSIAN KH-101 DEBRIS",
      draw: sceneAwacs,
    },
    {
      x: 24, y: 682, w: 317, h: 184, cat: "USA", catColor: [107, 79, 29],
      date: "24 NOV",
      lines: ["TRUMP HONOURS", "GIULIANI WITH TOP", "MEDAL OF FREEDOM"],
      sub: "TURKEYS PARDONED TOO",
      draw: sceneTrump,
    },
    {
      x: 353, y: 682, w: 317, h: 184, cat: "TECH & SECURITY", catColor: [163, 22, 33],
      date: "24 NOV",
      lines: ["HUAWEI GUILTY IN", "US TRADE-SECRETS", "TRIAL"],
      sub: "CIA & ODNI BREACHED",
      draw: sceneHuawei,
    },
    {
      x: 682, y: 682, w: 318, h: 184, cat: "DIPLOMACY", catColor: [42, 111, 79],
      date: "24 NOV",
      lines: ["UN: NO EXCUSE FOR", "INACTION AS GAZA", "SUFFERS"],
      sub: "EU 22ND SANCTIONS PACKAGE",
      draw: sceneGaza,
    },
  ];
  for (const p of panels) drawPanel(p);

  drawSport();
  drawTicker();

  const png = encodePng();
  mkdirSync("/output", { recursive: true });
  writeFileSync(OUT, png);
  console.log(`wrote ${OUT} (${png.length} bytes, ${W}x${H})`);
}

main();
