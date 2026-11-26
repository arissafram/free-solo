// Free Solo — an endless wall. Climb as high as you can; rocks fall faster and more
// often the longer you last. One hit and you fall to the ground, game over.
// Sprites live in sprites.js.
// World y grows downward; the ground is y = 0 and the wall goes up into negative y.
// World x: the wall runs from 0 to COLS * COL_W; the camera follows the climber sideways.

// ---- Board size (not gameplay) ----
const MIN_HEIGHT = 360;
const SWIPE_PX = 24;           // finger travel that counts as a swipe

// ---- Gameplay tuning: every gameplay number lives here ----
// Ranged knobs are [start, hardest]. Difficulty d goes 0 -> 1 over RAMP_MS of
// climbing (from the first move), then stays at 1.
const RAMP_MS = 90000;

// Wall
const COLS = 9;                // hold columns: the wall is wider than a phone, capped on desktop
const COL_W = 90;              // px per column
const WALL_EDGE = 24;          // px of bare wall past the outer columns before the camera stops
const ROW_GAP = 70;            // px between hold rows
const ROW0_Y = -92;            // lowest hold row (start hold)
const ROWS_AHEAD = 4;          // build holds this many rows above the top of the screen
const CAM_DEADZONE = 0.2;      // camera slides sideways once the climber is this far off screen centre (fraction of width)
const JITTER_X = 12;           // px holds are nudged off the grid sideways...
const JITTER_Y = 18;           // ...and up/down, so reach distances vary
const EXTRA_HOLDS = [0.6, 0.25];// chance of a hold in each non-route column (rest are gaps)

// Climber + camera
const MOVE_MS = 110;           // base reach time...
const MOVE_MS_PER_PX = 0.6;    // ...plus this per px of reach...
const LONG_REACH_PX = 90;      // ...and reaches longer than this...
const LONG_REACH_MS_PER_PX = 4;// ...cost this much extra per px beyond it
const MAX_SPAN = 150;          // px: hands share a hold or sit on holds at most this far apart
const DIR_CONE = 1.3;          // a hold is "in that direction" if its sideways offset <= this x forward distance
const MIN_STEP = 8;            // px: a target must be at least this far in the swipe direction
const SHOULDER_DROP = 42;      // px from the hands' midpoint down to the shoulders
const CLIMBER_FOCUS = 0.62;    // climber's hands sit this far down the screen
const FALL_GRAVITY = 1800;     // px/s² when knocked off

// Falling rocks
const GRACE_MS = 2000;         // no rocks for this long after the first move
const SPAWN_MS = [2000, 700];  // time between "!" warnings
const WARN_MS = [1100, 550];   // "!" shows this long before the rock drops
const ROCK_SPEED = [300, 600]; // px/s fall speed
const ROCK_CELL = [2, 4];      // rock pixel size (rock is 8x8 cells: 16px to 32px)
const AIM_CHANCE = [0.3, 0.7]; // chance a rock targets the climber's column (else random)

// Juice
const SHAKE_MS = 300;          // screen shake when a rock hits...
const SHAKE_AMT = 0.02;        // ...this strong (fraction of the board)
const VOLUME = 0.15;           // master volume for the chiptune sound effects

const GRAY = 0x535353;
const GRAY_CSS = '#535353';
const FONT = 'monospace';
const lerp = (range, d) => range[0] + (range[1] - range[0]) * d;
const snap = (v) => Math.round(v / CELL) * CELL;

// The board fills the window
const containerWidth = () => Math.floor(window.innerWidth);
const boardHeight = () => Math.max(MIN_HEIGHT, Math.floor(window.innerHeight));
let WIDTH = containerWidth();
let HEIGHT = boardHeight();
document.getElementById('game-container').style.height = HEIGHT + 'px';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  width: WIDTH,
  height: HEIGHT,
  parent: 'game-container',
  backgroundColor: '#ffffff',
  pixelArt: true,
  // All input is handled by page-wide listeners below
  input: { touch: false, mouse: false, keyboard: false },
  scale: { mode: Phaser.Scale.NONE },
  scene: { create, update }
});

window.addEventListener('resize', () => {
  const h = boardHeight();
  const w = containerWidth();
  if (h !== HEIGHT || w !== WIDTH) {
    HEIGHT = h;
    WIDTH = w;
    document.getElementById('game-container').style.height = HEIGHT + 'px';
    game.scale.resize(WIDTH, HEIGHT);
    if (scene) layoutHud();
  }
});

// ---- State ----
// phase: 'ready' (start pose, waiting for first move) | 'climbing' |
//        'falling' (knocked off) | 'over' (landed, game over)
let scene, gfx, hudText, overText;
let phase, rows, pathCol, prevRoute;
let height;        // score: highest row either hand has reached (1 row = 1m)
let elapsed;       // ms climbed since the first move (drives difficulty)
let hands;         // two hands: { r, i, x, y } (hold + drawn position, tweened between holds)
let handPos;       // { x, y }: midpoint of the two hands — where the body hangs from
let lastMoved, moving, queued, pose;
let camX, camY, spawnTimer, warnings, rocks, puffs, canRestart;
let fall;          // { x, shoulderY, vy } while falling / over
let best = 0;
try { best = Number(localStorage.getItem('freesolo-best-m')) || 0; } catch (e) {}
function saveBest() {
  if (height <= best) return false;
  best = height;
  try { localStorage.setItem('freesolo-best-m', String(best)); } catch (e) {}
  return true;
}

// ---- Sound: tiny square-wave blips through WebAudio, no files ----
let audio = null;
function unlockAudio() {
  try {
    if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch (e) { audio = null; }
}
// notes: [[freqStart, freqEnd, startSec, durSec], ...]
function blip(notes, type = 'square', vol = 1) {
  if (!audio || audio.state !== 'running') return;
  const t0 = audio.currentTime;
  notes.forEach(([f0, f1, at, dur]) => {
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0 + at);
    o.frequency.exponentialRampToValueAtTime(f1, t0 + at + dur);
    g.gain.setValueAtTime(VOLUME * vol, t0 + at);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
    o.connect(g).connect(audio.destination);
    o.start(t0 + at);
    o.stop(t0 + at + dur + 0.02);
  });
}
const SFX = {
  grab: () => blip([[880, 660, 0, 0.05]], 'square', 0.6),
  longReach: () => blip([[220, 520, 0, 0.22]], 'triangle', 1.2),
  warn: () => blip([[1320, 1320, 0, 0.05], [1320, 1320, 0.1, 0.05]], 'square', 0.5),
  hit: () => blip([[400, 60, 0, 0.35], [180, 40, 0, 0.3]], 'sawtooth', 1)
};

const WALL_W = COLS * COL_W;
const difficulty = () => Phaser.Math.Clamp(elapsed / RAMP_MS, 0, 1);
const colX = (col) => (col + 0.5) * COL_W;
const colOf = (x) => Phaser.Math.Clamp(Math.floor(x / COL_W), 0, COLS - 1);
const rowY = (r) => ROW0_Y - r * ROW_GAP;
const holdXY = (r, i) => {
  const h = rows[r][i];
  return { x: colX(h.col) + h.jx, y: rowY(r) + h.jy };
};

// ---- Wall building: rows are added as the camera climbs ----
function makeRow(r) {
  if (r === 0) {
    pathCol = Math.floor(COLS / 2);
    prevRoute = { r: 0, col: pathCol, jx: 0, jy: 0 };
    return [{ col: pathCol, jx: 0, jy: 0 }];
  }
  pathCol = Phaser.Math.Clamp(pathCol + Phaser.Math.Between(-1, 1), 0, COLS - 1);
  const row = [];
  for (let c = 0; c < COLS; c++) {
    if (c === pathCol || Math.random() < lerp(EXTRA_HOLDS, difficulty())) {
      const h = { col: c, jx: Phaser.Math.Between(-JITTER_X, JITTER_X), jy: Phaser.Math.Between(-JITTER_Y, JITTER_Y) };
      if (c === pathCol) {
        // Keep the route climbable: pull the hold back onto the grid if it's out of span
        const gap = (a, b) => Math.hypot((b.col - a.col) * COL_W + b.jx - a.jx, (a.r - b.r) * ROW_GAP + b.jy - a.jy);
        if (gap(prevRoute, { r, ...h }) > MAX_SPAN - 4) { h.jx = 0; h.jy = 0; }
        prevRoute = { r, ...h };
      }
      row.push(h);
    }
  }
  return row;
}

function extendWall() {
  while (rowY(rows.length - 1) > camY - ROWS_AHEAD * ROW_GAP) rows.push(makeRow(rows.length));
}

function newGame() {
  canRestart = false;
  height = 0; elapsed = 0;
  rows = [makeRow(0)];
  const start = holdXY(0, 0);
  hands = [{ r: 0, i: 0, x: start.x, y: start.y }, { r: 0, i: 0, x: start.x, y: start.y }];
  handPos = { x: 0, y: 0 };
  updateHandPos();
  lastMoved = 1;
  moving = false; queued = null;
  pose = Phaser.Utils.Array.GetRandom(POSES);
  phase = 'ready';
  if (warnings) warnings.forEach((w) => w.text.destroy());
  spawnTimer = GRACE_MS; warnings = []; rocks = []; puffs = []; fall = null;
  camX = targetCamX(handPos.x - WIDTH / 2);
  camY = targetCamY();
  scene.cameras.main.setScroll(Math.round(camX), Math.round(camY));
  extendWall();
  overText.setText('');
}

// ---- Moving ----
// Swipes move one hand to the next hold in that direction: up moves the lower hand,
// down the higher one, left the leftmost, right the rightmost (ties: the hand that
// didn't move last). If that hand has nowhere to go, the other hand tries.
// The moving hand must land within MAX_SPAN of the other hand (or on its hold).
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

function pickHand(dir) {
  const [a, b] = hands;
  const key = dir === 'up' ? (h) => h.y : dir === 'down' ? (h) => -h.y
    : dir === 'left' ? (h) => -h.x : (h) => h.x;
  const ka = key(a), kb = key(b);
  if (Math.abs(ka - kb) < 4) return 1 - lastMoved;
  return ka > kb ? 0 : 1;
}

function findTarget(k, dir) {
  const h = hands[k], o = hands[1 - k];
  const from = holdXY(h.r, h.i), anchor = holdXY(o.r, o.i);
  const [vx, vy] = DIRS[dir];
  let best = null, bestScore = Infinity;
  for (let r = Math.max(0, h.r - 4); r <= Math.min(rows.length - 1, h.r + 4); r++) {
    rows[r].forEach((_, i) => {
      if (r === h.r && i === h.i) return;
      const p = holdXY(r, i);
      const dx = p.x - from.x, dy = p.y - from.y;
      const fwd = dx * vx + dy * vy;
      const side = Math.abs(dx * vy - dy * vx);
      if (fwd < MIN_STEP || side > fwd * DIR_CONE) return;
      const same = r === o.r && i === o.i;
      if (!same && Phaser.Math.Distance.Between(p.x, p.y, anchor.x, anchor.y) > MAX_SPAN) return;
      const score = fwd + side * 1.5;  // nearest hold, favouring straight lines
      if (score < bestScore) { bestScore = score; best = { r, i }; }
    });
  }
  return best;
}

function tryMove(dir) {
  if (phase !== 'ready' && phase !== 'climbing') return;
  if (moving) { queued = dir; return; }
  if (phase === 'ready') { phase = 'climbing'; overText.setText(''); }
  let k = pickHand(dir);
  let next = findTarget(k, dir);
  if (!next) { k = 1 - k; next = findTarget(k, dir); }
  if (!next) return;
  const h = hands[k];
  const to = holdXY(next.r, next.i);
  const dist = Phaser.Math.Distance.Between(h.x, h.y, to.x, to.y);
  moving = true;
  lastMoved = k;
  if (dist > LONG_REACH_PX) SFX.longReach();
  h.r = next.r; h.i = next.i;
  scene.tweens.add({
    targets: h,
    x: to.x,
    y: to.y,
    duration: MOVE_MS + dist * MOVE_MS_PER_PX + Math.max(0, dist - LONG_REACH_PX) * LONG_REACH_MS_PER_PX,
    ease: 'Sine.easeInOut',
    onComplete: () => {
      moving = false;
      if (phase !== 'climbing') return;
      addPuff(h.x, h.y - 6);
      SFX.grab();
      height = Math.max(height, h.r);
      if (queued) { const q = queued; queued = null; tryMove(q); }
    }
  });
}

function updateHandPos() {
  handPos.x = (hands[0].x + hands[1].x) / 2;
  handPos.y = (hands[0].y + hands[1].y) / 2;
}

// ---- Climber geometry ----
// The body grid's top-left corner, its shoulders, and the hitbox.
function bodyFrame() {
  let shoulderY, x;
  if (fall) { shoulderY = fall.shoulderY; x = fall.x; }
  else if (phase === 'ready' && pose.sit) { shoulderY = -30; x = handPos.x; }  // sitting on the ground
  else { shoulderY = handPos.y + SHOULDER_DROP; x = handPos.x; }
  const left = snap(x) - 8 * CELL;
  const top = snap(shoulderY) - 8 * CELL;
  return {
    left, top,
    shoulderL: { x: left + 3 * CELL + 1, y: top + 8 * CELL + 3 },
    shoulderR: { x: left + 12 * CELL + 1, y: top + 8 * CELL + 3 },
    bag: { x: left + 14 * CELL + 1, y: top + 15 * CELL },
    hit: { x: left + 4, y: top + 2, w: 16 * CELL - 8, h: 28 * CELL - 4 }
  };
}
const handRect = (h) => ({ x: h.x - 6, y: h.y - 6, w: 12, h: 8 });
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

function targetCamY() {
  // Follow the hands (or the falling body); stop at the ground
  const y = fall ? fall.shoulderY : handPos.y;
  return Math.min(y - HEIGHT * CLIMBER_FOCUS, 40 - HEIGHT);
}

function targetCamX(from) {
  // Leave the camera alone while the climber is near screen centre; slide it once he
  // drifts CAM_DEADZONE off centre. Stop just past the wall's edges, or centre the
  // wall when the window is wider than it.
  const lo = -WALL_EDGE, hi = WALL_W + WALL_EDGE - WIDTH;
  if (hi <= lo) return (WALL_W - WIDTH) / 2;
  const x = fall ? fall.x : handPos.x;
  const slack = WIDTH * CAM_DEADZONE;
  const centred = x - WIDTH / 2;
  const next = Phaser.Math.Clamp(from, centred - slack, centred + slack);
  return Phaser.Math.Clamp(next, lo, hi);
}

// ---- Hazards ----
function spawnWarning() {
  const d = difficulty();
  // Only columns you can see drop rocks
  const first = colOf(camX + COL_W * 0.3), last = colOf(camX + WIDTH - COL_W * 0.3);
  const myCol = colOf(handPos.x);
  const col = Math.random() < lerp(AIM_CHANCE, d) ? myCol : Phaser.Math.Between(first, last);
  const text = scene.add.text(colX(col), 6, '!', { fontFamily: FONT, fontSize: '22px', color: GRAY_CSS, fontStyle: 'bold' })
    .setOrigin(0.5, 0).setScrollFactor(1, 0).setDepth(10);
  warnings.push({ col, t: lerp(WARN_MS, d), text });
  SFX.warn();
}

function knockOff() {
  phase = 'falling';
  queued = null;
  scene.tweens.killTweensOf(hands);
  moving = false;
  warnings.forEach((w) => w.text.destroy());
  warnings = [];
  scene.cameras.main.shake(SHAKE_MS, SHAKE_AMT);
  SFX.hit();
  const b = bodyFrame();
  fall = { x: handPos.x, shoulderY: b.top + 8 * CELL, vy: -120 };
}

function gameOver() {
  phase = 'over';
  rocks = [];
  const isBest = saveBest() && height > 0;
  overText.setText(`GAME OVER\n\n${height}m${isBest ? ' - new best!' : ''}\n\ntap to climb again`);
  scene.time.delayedCall(400, () => { canRestart = true; });
}

function addPuff(x, y, delay = 0) {
  puffs.push({ x, y, t: -delay });
}

// ---- Scene ----
function create() {
  scene = this;
  gfx = this.add.graphics();
  const style = { fontFamily: FONT, fontSize: '16px', color: GRAY_CSS };
  hudText = this.add.text(0, 12, '', { ...style, backgroundColor: '#ffffff', padding: { x: 4, y: 2 } })
    .setScrollFactor(0).setOrigin(1, 0).setDepth(10);
  overText = this.add.text(0, 0, '', { ...style, fontSize: '20px', align: 'center', backgroundColor: '#ffffff', padding: { x: 8, y: 6 } })
    .setScrollFactor(0).setOrigin(0.5).setDepth(10);
  layoutHud();
  newGame();
}

function layoutHud() {
  hudText.setX(WIDTH - 12);
  overText.setPosition(WIDTH / 2, HEIGHT * 0.3);
}

function update(time, deltaMs) {
  const dt = Math.min(deltaMs, 50) / 1000;
  if (!fall) updateHandPos();

  camY += (targetCamY() - camY) * Math.min(1, dt * 6);
  camX += (targetCamX(camX) - camX) * Math.min(1, dt * 6);
  scene.cameras.main.setScroll(Math.round(camX), Math.round(camY));
  extendWall();
  const camBottom = camY + HEIGHT;
  const d = difficulty();

  if (phase === 'climbing') {
    elapsed += deltaMs;
    spawnTimer -= deltaMs;
    if (spawnTimer <= 0) { spawnTimer = lerp(SPAWN_MS, d); spawnWarning(); }
    warnings = warnings.filter((w) => {
      w.t -= deltaMs;
      w.text.setVisible(Math.floor(w.t / 120) % 2 === 0);
      if (w.t > 0) return true;
      w.text.destroy();
      const cell = Phaser.Math.Between(ROCK_CELL[0], Math.round(lerp(ROCK_CELL, d)));
      const size = 8 * cell;
      rocks.push({ x: colX(w.col) - size / 2, y: camY - size, size, cell, speed: lerp(ROCK_SPEED, d) });
      return false;
    });
  }
  if (phase === 'climbing' || phase === 'falling') {
    rocks.forEach((rk) => { rk.y += rk.speed * dt; });
    rocks = rocks.filter((rk) => rk.y < camBottom + 40);
  }
  if (phase === 'climbing') {
    const parts = [bodyFrame().hit, handRect(hands[0]), handRect(hands[1])];
    if (rocks.some((rk) => parts.some((p) => overlap(p, { x: rk.x + 2, y: rk.y + 2, w: rk.size - 4, h: rk.size - 4 })))) knockOff();
  }

  if (phase === 'falling') {
    fall.vy += FALL_GRAVITY * dt;
    fall.shoulderY += fall.vy * dt;
    const landed = -16 * CELL;           // fall grid bottom (row 24) on the ground
    if (fall.shoulderY >= landed) {
      fall.shoulderY = landed;
      for (let n = 0; n < 3; n++) addPuff(fall.x + Phaser.Math.Between(-20, 20), -6, n * 80);
      gameOver();
    }
  }

  // Chalking pose keeps puffing
  if (phase === 'ready' && pose.arm && pose.arm.to === 'bag' && Math.floor(time / 600) !== Math.floor((time - deltaMs) / 600)) {
    const b = bodyFrame().bag;
    addPuff(b.x, b.y - 4);
  }
  puffs.forEach((p) => { p.t += deltaMs; });
  puffs = puffs.filter((p) => p.t < 500);

  hudText.setText(`${best ? `HI ${best}m  ` : ''}${height}m`);
  draw(time);
}

// ---- Drawing ----
const runCache = new Map();
function runsOf(grid) {
  let runs = runCache.get(grid);
  if (runs) return runs;
  runs = [];
  grid.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      let w = 1;
      while (row[x + w] === ch) w++;
      if (ch !== '.') runs.push({ x, y, w, ch });
      x += w;
    }
  });
  runCache.set(grid, runs);
  return runs;
}

function drawGrid(grid, x, y, cell = CELL, alpha = 1) {
  x = snap(x); y = snap(y);
  runsOf(grid).forEach((r) => {
    gfx.fillStyle(r.ch === 'w' ? 0xffffff : GRAY, alpha);
    gfx.fillRect(x + r.x * cell, y + r.y * cell, r.w * cell, cell);
  });
}

function drawArm(a, b) {
  // Chunky stepped arm: 4px blocks every 2px from shoulder to hand
  gfx.fillStyle(GRAY, 1);
  const steps = Math.max(1, Math.ceil(Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y) / CELL));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    gfx.fillRect(snap(a.x + (b.x - a.x) * t) - 2, snap(a.y + (b.y - a.y) * t) - 2, 4, 4);
  }
}

function drawClimber(time) {
  const f = bodyFrame();
  let grid;
  if (fall) grid = BODY.fall[Math.floor(time / 100) % 2];
  else if (phase === 'ready') grid = pose.grid;
  else if (moving) grid = BODY.reach[lastMoved];
  else grid = BODY.hang[Math.floor(time / 500) % 2];

  // Where each hand is drawn: on its hold, or off it for some poses / when falling
  const [lk, rk] = hands[0].x <= hands[1].x ? [0, 1] : [1, 0];
  const handAt = (k, shoulder, side) => {
    if (fall) {
      const flap = Math.floor(time / 100) % 2 ? 4 : -4;
      return { x: shoulder.x + side * 10, y: shoulder.y - 22 + flap * side };
    }
    if (phase === 'ready' && pose.arm && pose.arm.hand === k) {
      return pose.arm.to === 'bag' ? { x: f.bag.x, y: f.bag.y + 4 } : { x: shoulder.x + side * 30, y: shoulder.y - 18 };
    }
    return hands[k];
  };
  const lh = handAt(lk, f.shoulderL, -1);
  const rh = handAt(rk, f.shoulderR, 1);
  drawArm(f.shoulderL, lh);
  drawArm(f.shoulderR, rh);
  drawGrid(grid, f.left, f.top);
  drawGrid(HAND, lh.x - 4, lh.y - 6);
  drawGrid(HAND, rh.x - 4, rh.y - 6);

  // "hi" speech bubble on the start pose
  if (phase === 'ready') {
    const bx = snap(f.left + 16 * CELL + 2), by = snap(f.top - 14);
    gfx.fillStyle(GRAY, 1);
    gfx.fillRect(bx, by, 18, 16);
    gfx.fillRect(bx - 2, by + 14, 4, 4);
    gfx.fillStyle(0xffffff, 1);
    gfx.fillRect(bx + 2, by + 2, 14, 12);
    drawGrid(HI, bx + 4, by + 3);
  }
}

function draw(time) {
  gfx.clear();
  const top = camY - 10, bottom = camY + HEIGHT + 10;

  // Ground, across the whole view
  const left = Math.floor(camX) - 40, right = Math.ceil(camX + WIDTH) + 40;
  gfx.fillStyle(GRAY, 1);
  gfx.fillRect(left, 0, right - left, 3);
  for (let x = left - (((left % 37) + 37) % 37) + 6; x < right; x += 37) gfx.fillRect(x, 6 + (((x % 5) + 5) % 5), 4, 2);

  // Holds
  for (let r = 0; r < rows.length; r++) {
    const y0 = rowY(r);
    if (y0 < top - 40 || y0 > bottom + 20) continue;
    rows[r].forEach((h, i) => {
      const p = holdXY(r, i);
      drawGrid(HOLD, p.x - 8, p.y - 4);
    });
  }

  drawClimber(time);

  // Falling rocks
  rocks.forEach((rk) => drawGrid(ROCK, rk.x, rk.y, rk.cell));

  // Chalk puffs
  puffs.forEach((p) => {
    if (p.t < 0) return;
    drawGrid(PUFF[p.t < 220 ? 0 : 1], p.x - 5, p.y - 5 - p.t / 40, CELL, 0.6);
  });
}

// ---- Input: arrows, swipes, taps ----
const restartIfOver = () => { if (phase === 'over' && canRestart) newGame(); };
const KEYS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
window.addEventListener('keydown', (e) => {
  unlockAudio();
  if (KEYS[e.key]) {
    e.preventDefault();
    if (phase === 'over') restartIfOver(); else tryMove(KEYS[e.key]);
  } else if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    restartIfOver();
  }
});

let swipeStart = null;
window.addEventListener('pointerdown', (e) => {
  unlockAudio();
  if (!e.isPrimary) return;
  swipeStart = { x: e.clientX, y: e.clientY, used: false };
});
window.addEventListener('pointermove', (e) => {
  if (!swipeStart || swipeStart.used || !e.isPrimary) return;
  const dx = e.clientX - swipeStart.x, dy = e.clientY - swipeStart.y;
  if (Math.hypot(dx, dy) < SWIPE_PX) return;
  swipeStart.used = true;  // one move per swipe
  tryMove(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
});
window.addEventListener('pointerup', () => {
  if (!swipeStart) return;
  const wasTap = !swipeStart.used;
  swipeStart = null;
  if (wasTap) restartIfOver();
});
window.addEventListener('pointercancel', () => { swipeStart = null; });
// Belt and braces for iOS: no page scroll / pull-to-refresh while swiping
window.addEventListener('touchend', unlockAudio);
document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
