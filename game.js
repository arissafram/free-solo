// Free Solo — climb each wall to the flag with both hands. Rocks fall; one hit and
// you fall to the ground, get buried, game over. Sprites live in sprites.js.
// World y grows downward; the ground is y = 0 and the wall goes up into negative y.

// ---- Board size (not gameplay) ----
const MAX_WIDTH = 480;
const MAX_HEIGHT = 720;
const MIN_HEIGHT = 360;
const PAGE_PADDING = 32;       // 16px above + 16px below the board
const SWIPE_PX = 24;           // finger travel that counts as a swipe

// ---- Gameplay tuning: every gameplay number lives here ----
// Ranged knobs are [level 1, hardest level]. Difficulty d goes 0 -> 1 from level 1
// to level LEVELS_TO_HARDEST, then stays at 1.
const LEVELS_TO_HARDEST = 8;
const LEVEL_ROWS = 10;         // rows of holds to the flag on level 1...
const LEVEL_ROWS_PER_LEVEL = 3;// ...plus this many per level after
const CLEAR_MS = 1400;         // pause on "LEVEL CLEAR" before the next wall

// Wall
const COLS = 5;                // hold columns
const ROW_GAP = 70;            // px between hold rows
const ROW0_Y = -92;            // lowest hold row (start hold)
const JITTER_X = 22;           // px holds are nudged off the grid sideways...
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
const GRACE_MS = 2000;         // no rocks for this long after the first move of a level
const SPAWN_MS = [2000, 700];  // time between "!" warnings
const WARN_MS = [1100, 550];   // "!" shows this long before the rock drops
const ROCK_SPEED = [300, 600]; // px/s fall speed
const ROCK_CELL = [2, 4];      // rock pixel size (rock is 8x8 cells: 16px to 32px)
const AIM_CHANCE = [0.3, 0.7]; // chance a rock targets the climber's column (else random)

const GRAY = 0x535353;
const GRAY_CSS = '#535353';
const FONT = 'monospace';
const lerp = (range, d) => range[0] + (range[1] - range[0]) * d;
const snap = (v) => Math.round(v / CELL) * CELL;

const containerWidth = () =>
  Math.min(MAX_WIDTH, Math.floor(document.getElementById('game-container').clientWidth) || MAX_WIDTH);
const boardHeight = () =>
  Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.floor(window.innerHeight - PAGE_PADDING)));
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
    if (hands && !moving) hands.forEach((h) => Object.assign(h, holdXY(h.r, h.i)));
  }
});

// ---- State ----
// phase: 'ready' (start pose, waiting for first move) | 'climbing' | 'clear' |
//        'falling' (knocked off) | 'buried' (game over)
let scene, gfx, hudText, bestText, overText;
let phase, level, rows, topRow, pathCol, prevRoute;
let hands;         // two hands: { r, i, x, y } (hold + drawn position, tweened between holds)
let handPos;       // { x, y }: midpoint of the two hands — where the body hangs from
let lastMoved, moving, queued, pose;
let camY, spawnTimer, warnings, rocks, pile, puffs, canRestart;
let fall;          // { x, shoulderY, vy } while falling / buried
let best = 0;
try { best = Number(localStorage.getItem('freesolo-best-level')) || 0; } catch (e) {}

const difficulty = () => Phaser.Math.Clamp((level - 1) / (LEVELS_TO_HARDEST - 1), 0, 1);
const colX = (col) => 28 + (col + 0.5) * (WIDTH - 56) / COLS;
const rowY = (r) => ROW0_Y - r * ROW_GAP;
const holdXY = (r, i) => {
  const h = rows[r][i];
  return { x: colX(h.col) + h.jx, y: rowY(r) + h.jy };
};

// ---- Level building ----
function makeRow(r) {
  if (r === 0) {
    pathCol = Math.floor(COLS / 2);
    prevRoute = { r: 0, col: pathCol, jx: 0, jy: 0 };
    return [{ col: pathCol, jx: 0, jy: 0 }];
  }
  pathCol = Phaser.Math.Clamp(pathCol + Phaser.Math.Between(-1, 1), 0, COLS - 1);
  const row = [];
  for (let c = 0; c < COLS; c++) {
    const isTop = r === topRow;
    if (c === pathCol || (!isTop && Math.random() < lerp(EXTRA_HOLDS, difficulty()))) {
      const h = { col: c, jx: Phaser.Math.Between(-JITTER_X, JITTER_X), jy: Phaser.Math.Between(-JITTER_Y, JITTER_Y) };
      if (c === pathCol) {
        // Keep the route climbable on the widest board: pull the hold back onto the grid if it's out of span
        const gap = (a, b) => Math.hypot((b.col - a.col) * (MAX_WIDTH - 56) / COLS + b.jx - a.jx, (a.r - b.r) * ROW_GAP + b.jy - a.jy);
        if (gap(prevRoute, { r, ...h }) > MAX_SPAN - 4) { h.jx = 0; h.jy = 0; }
        prevRoute = { r, ...h };
        if (isTop) h.top = true;
      }
      row.push(h);
    }
  }
  return row;
}

function buildLevel() {
  topRow = LEVEL_ROWS + LEVEL_ROWS_PER_LEVEL * (level - 1);
  rows = [];
  for (let r = 0; r <= topRow; r++) rows.push(makeRow(r));
  const start = holdXY(0, 0);
  hands = [{ r: 0, i: 0, x: start.x, y: start.y }, { r: 0, i: 0, x: start.x, y: start.y }];
  handPos = { x: 0, y: 0 };
  updateHandPos();
  lastMoved = 1;
  moving = false; queued = null;
  pose = Phaser.Utils.Array.GetRandom(POSES);
  phase = 'ready';
  if (warnings) warnings.forEach((w) => w.text.destroy());
  spawnTimer = GRACE_MS; warnings = []; rocks = []; puffs = []; pile = null; fall = null;
  camY = targetCamY();
  scene.cameras.main.scrollY = camY;
  overText.setText(`LEVEL ${level}`);
}

function newGame() {
  level = 1;
  canRestart = false;
  buildLevel();
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
  rows.forEach((row, r) => {
    if (Math.abs(r - h.r) > 4) return;
    row.forEach((_, i) => {
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
  });
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
      if (hands.every((hh) => rows[hh.r][hh.i].top)) return levelClear();
      if (queued) { const q = queued; queued = null; tryMove(q); }
    }
  });
}

function updateHandPos() {
  handPos.x = (hands[0].x + hands[1].x) / 2;
  handPos.y = (hands[0].y + hands[1].y) / 2;
}

function levelClear() {
  phase = 'clear';
  queued = null;
  warnings.forEach((w) => w.text.destroy());
  warnings = []; rocks = [];
  if (level > best) {
    best = level;
    try { localStorage.setItem('freesolo-best-level', String(best)); } catch (e) {}
  }
  for (let n = 0; n < 4; n++) addPuff(handPos.x + Phaser.Math.Between(-20, 20), handPos.y + Phaser.Math.Between(-20, 10), n * 120);
  overText.setText(`LEVEL ${level} CLEAR`);
  scene.time.delayedCall(CLEAR_MS, () => { level++; buildLevel(); });
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
  // Follow the hands (or the falling body); stop at the flag and at the ground
  const y = fall ? fall.shoulderY : handPos.y;
  return Phaser.Math.Clamp(y - HEIGHT * CLIMBER_FOCUS, rowY(topRow) - 80, 40 - HEIGHT);
}

// ---- Hazards ----
function spawnWarning() {
  const d = difficulty();
  const myCol = Phaser.Math.Clamp(Math.round((handPos.x - 28) / ((WIDTH - 56) / COLS) - 0.5), 0, COLS - 1);
  const col = Math.random() < lerp(AIM_CHANCE, d) ? myCol : Phaser.Math.Between(0, COLS - 1);
  const text = scene.add.text(colX(col), 6, '!', { fontFamily: FONT, fontSize: '22px', color: GRAY_CSS, fontStyle: 'bold' })
    .setOrigin(0.5, 0).setScrollFactor(0).setDepth(10);
  warnings.push({ col, t: lerp(WARN_MS, d), text });
}

function knockOff() {
  phase = 'falling';
  queued = null;
  scene.tweens.killTweensOf(hands);
  moving = false;
  warnings.forEach((w) => w.text.destroy());
  warnings = [];
  const b = bodyFrame();
  fall = { x: handPos.x, shoulderY: b.top + 8 * CELL, vy: -120 };
}

function bury() {
  phase = 'buried';
  rocks = [];
  // A mound of rocks drops onto him on the ground, one hand left sticking out
  const targets = [];
  const layers = 4, size = 8 * CELL;
  for (let l = 0; l < layers; l++) {
    const n = layers - l + 2;
    for (let k = 0; k < n; k++) {
      const x = fall.x + (k - (n - 1) / 2) * size + Phaser.Math.Between(-3, 3);
      targets.push({ x: snap(x), y: -(l + 1) * (size - 2) });
    }
  }
  pile = targets.map((t, idx) => ({ ...t, cy: camY - 30 - idx * 26, landed: false }));
}

function gameOver() {
  overText.setText(`GAME OVER\n\nlevel ${level}\n\ntap to climb again`);
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
  hudText = this.add.text(0, 12, '', style).setScrollFactor(0).setOrigin(1, 0).setDepth(10);
  bestText = this.add.text(0, 32, '', style).setScrollFactor(0).setOrigin(1, 0).setDepth(10);
  overText = this.add.text(0, 0, '', { ...style, fontSize: '20px', align: 'center', backgroundColor: '#ffffff', padding: { x: 8, y: 6 } })
    .setScrollFactor(0).setOrigin(0.5).setDepth(10);
  layoutHud();
  newGame();
}

function layoutHud() {
  hudText.setX(WIDTH - 12);
  bestText.setX(WIDTH - 12);
  overText.setPosition(WIDTH / 2, HEIGHT * 0.3);
}

function update(time, deltaMs) {
  const dt = Math.min(deltaMs, 50) / 1000;
  if (!fall) updateHandPos();

  camY += (targetCamY() - camY) * Math.min(1, dt * 6);
  scene.cameras.main.scrollY = Math.round(camY);
  const camBottom = camY + HEIGHT;
  const d = difficulty();

  if (phase === 'climbing') {
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
      bury();
    }
  }

  if (pile) {
    let allLanded = true;
    pile.forEach((p) => {
      if (p.landed) return;
      p.cy = Math.min(p.y, p.cy + ROCK_SPEED[1] * 1.2 * dt);
      if (p.cy >= p.y) p.landed = true; else allLanded = false;
    });
    if (allLanded && !overText.text) gameOver();
  }

  // Chalking pose keeps puffing
  if (phase === 'ready' && pose.arm && pose.arm.to === 'bag' && Math.floor(time / 600) !== Math.floor((time - deltaMs) / 600)) {
    const b = bodyFrame().bag;
    addPuff(b.x, b.y - 4);
  }
  puffs.forEach((p) => { p.t += deltaMs; });
  puffs = puffs.filter((p) => p.t < 500);

  hudText.setText(`level ${level}`);
  bestText.setText(best ? `best ${best}` : '');
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

  // Ground
  gfx.fillStyle(GRAY, 1);
  gfx.fillRect(0, 0, WIDTH, 3);
  for (let x = 6; x < WIDTH; x += 37) gfx.fillRect(x, 6 + (x % 5), 4, 2);

  // Holds, with a flag on the top one
  rows.forEach((row, r) => {
    const y0 = rowY(r);
    if (y0 < top - 40 || y0 > bottom + 20) return;
    row.forEach((h, i) => {
      const p = holdXY(r, i);
      drawGrid(HOLD, p.x - 8, p.y - 4);
      if (h.top) drawGrid(FLAG, p.x + 6, p.y - 4 - FLAG.length * CELL);
    });
  });

  if (!pile || !pile.every((p) => p.landed)) drawClimber(time);

  // Falling rocks
  rocks.forEach((rk) => drawGrid(ROCK, rk.x, rk.y, rk.cell));

  // Burial pile, plus the hand sticking out
  if (pile) {
    const landed = pile.every((p) => p.landed);
    if (landed) {
      const topY = Math.min(...pile.map((p) => p.y));
      drawGrid(BURIED_HAND, fall.x - 6, topY - BURIED_HAND.length * CELL + 4);
    }
    pile.forEach((p) => drawGrid(ROCK, p.x - 8, p.cy));
  }

  // Chalk puffs
  puffs.forEach((p) => {
    if (p.t < 0) return;
    drawGrid(PUFF[p.t < 220 ? 0 : 1], p.x - 5, p.y - 5 - p.t / 40, CELL, 0.6);
  });
}

// ---- Input: arrows, swipes, taps ----
const restartIfOver = () => { if (phase === 'buried' && canRestart) newGame(); };
const KEYS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
window.addEventListener('keydown', (e) => {
  if (KEYS[e.key]) {
    e.preventDefault();
    if (phase === 'buried') restartIfOver(); else tryMove(KEYS[e.key]);
  } else if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    restartIfOver();
  }
});

let swipeStart = null;
window.addEventListener('pointerdown', (e) => {
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
document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
