// Builds favicon.ico, apple-touch-icon.png and og-image.png from the sprites in sprites.js.
//   node tools/make_icons.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const P = require('./png');

const root = path.join(__dirname, '..');
const S = {};
vm.runInNewContext(fs.readFileSync(path.join(root, 'sprites.js'), 'utf8') +
  ';Object.assign(S, { BODY, HAND, HOLD, ROCK, FLAG });', { S });

const GRAY = [0x53, 0x53, 0x53, 255], WHITE = [255, 255, 255, 255];

function canvas(w, h, bg = WHITE) {
  const c = { w, h, d: Buffer.alloc(w * h * 4) };
  for (let i = 0; i < w * h; i++) Buffer.from(bg).copy(c.d, i * 4);
  return c;
}
function rect(c, x, y, w, h, col = GRAY) {
  x = Math.round(x); y = Math.round(y);
  for (let yy = Math.max(0, y); yy < Math.min(c.h, y + h); yy++)
    for (let xx = Math.max(0, x); xx < Math.min(c.w, x + w); xx++) Buffer.from(col).copy(c.d, (yy * c.w + xx) * 4);
}
function grid(c, g, x, y, cell) {
  g.forEach((row, gy) => [...row].forEach((ch, gx) => {
    if (ch !== '.') rect(c, x + gx * cell, y + gy * cell, cell, cell, ch === 'w' ? WHITE : GRAY);
  }));
}
function arm(c, a, b, t) {
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y));
  for (let s = 0; s <= steps; s++) rect(c, a.x + (b.x - a.x) * s / steps - t / 2, a.y + (b.y - a.y) * s / steps - t / 2, t, t);
}
// Hanging climber: body top-left at (x, y), hands at hl / hr (hand centers)
function climber(c, x, y, cell, hl, hr) {
  const sl = { x: x + 3.5 * cell, y: y + 9.5 * cell }, sr = { x: x + 12.5 * cell, y: y + 9.5 * cell };
  arm(c, sl, hl, 2 * cell); arm(c, sr, hr, 2 * cell);
  grid(c, S.BODY.hang[0], x, y, cell);
  grid(c, S.HAND, hl.x - 2 * cell, hl.y - 2 * cell, cell);
  grid(c, S.HAND, hr.x - 2 * cell, hr.y - 2 * cell, cell);
}

// 5x7 pixel letters for the title
const FONT = {
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....']
};
function text(c, str, x, y, cell) {
  [...str].forEach((ch, i) => grid(c, FONT[ch], x + i * 6 * cell, y, cell));
}

// ---- favicon: climber hanging from two hands, 1 cell = 1px at 32 ----
function icon(n, cell, pad, holds) {
  const c = canvas(n, n);
  const x = Math.round((n - 16 * cell) / 2), y = n - 28 * cell - pad;
  const hy = y + 1 * cell, dx = 7 * cell;         // hands up beside the head, pull-up style
  const hl = { x: n / 2 - dx, y: hy }, hr = { x: n / 2 + dx, y: hy };
  if (holds) [hl, hr].forEach((h) => grid(c, S.HOLD, h.x - 4 * cell, h.y, cell));
  climber(c, x, y, cell, hl, hr);
  return c;
}
const ico32 = P.encode(icon(32, 1, 1));
// 16px: head + shoulders only, so it stays readable
const c16 = canvas(16, 16);
grid(c16, S.BODY.hang[0].slice(0, 16), 0, 0, 1);
const ico16 = P.encode(c16);
const pngs = [[16, ico16], [32, ico32]];
const header = Buffer.alloc(6); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
let offset = 6 + 16 * pngs.length;
const entries = pngs.map(([size, data]) => {
  const e = Buffer.alloc(16);
  e[0] = size; e[1] = size;
  e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
  e.writeUInt32LE(data.length, 8); e.writeUInt32LE(offset, 12);
  offset += data.length;
  return e;
});
fs.writeFileSync(path.join(root, 'favicon.ico'), Buffer.concat([header, ...entries, ...pngs.map((p) => p[1])]));

// ---- apple-touch-icon: same climber, 5px cells on 180 ----
fs.writeFileSync(path.join(root, 'apple-touch-icon.png'), P.encode(icon(180, 5, 22)));

// ---- og-image: title left, a slice of wall with the climber right ----
const W = 1200, H = 630, og = canvas(W, H);
text(og, 'FREE SOLO', 80, 230, 12);
const cell = 6;
const hold = (x, y) => grid(og, S.HOLD, x - 4 * cell, y - 2 * cell, cell);
// Holds; the climber hangs from the middle pair
const hl = { x: 830, y: 250 }, hr = { x: 950, y: 236 };
[[860, 100], [1020, 80], hl, hr, [1100, 330], [760, 420], [1060, 520]]
  .forEach((h) => (Array.isArray(h) ? hold(h[0], h[1]) : hold(h.x, h.y)));
grid(og, S.FLAG, 1020 + 3 * cell, 80 - 2 * cell - S.FLAG.length * cell, cell);
climber(og, 890 - 8 * cell, 243 + 126 - 9.5 * cell, cell, { x: hl.x, y: hl.y - 3 * cell }, { x: hr.x, y: hr.y - 3 * cell });
// Rock falling and a "!" warning
grid(og, S.ROCK, 1060, 130, cell);
rect(og, 700, 40, 12, 44); rect(og, 700, 92, 12, 12);
// Ground
rect(og, 0, H - 30, W, 6);
for (let x = 12; x < W; x += 74) rect(og, x, H - 18 + (x % 5), 8, 4);
fs.writeFileSync(path.join(root, 'og-image.png'), P.encode(og));
console.log('favicon.ico, apple-touch-icon.png, og-image.png');
