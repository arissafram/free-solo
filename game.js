// Free Solo — an endless wall. Climb as high as you can; rocks fall faster and more
// often the longer you last. One hit and you fall to the ground, game over.
// Sprites live in sprites.js. createGame() runs one game inside a container element;
// the npm package (src/index.js) wraps it as mount(el) and <free-solo>.
// World y grows downward; the ground is y = 0 and the wall goes up into negative y.
// World x: the wall runs from 0 to COLS * COL_W; the camera follows the climber sideways.

import { CELL, POSES, BODY, HAND, HOLD, ROCK, PUFF } from './sprites.js';

// ---- Input (not gameplay) ----
const SWIPE_PX = 24;           // finger travel that counts as a swipe

// ---- Gameplay tuning: every gameplay number lives here ----
// Ranged knobs are [start, at RAMP_MS, limit]. Difficulty d goes 0 -> 1 over RAMP_MS
// of climbing (from the first move), then keeps rising AFTER_RAMP times as fast, with
// no end; each knob stops at its limit so the game never turns impossible.
// Two-value knobs ([start, at RAMP_MS]) just stop at RAMP_MS.
const RAMP_MS = 90000;
const AFTER_RAMP = 0.35;

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
const EXTRA_HOLDS = [0.35, 0.15];// chance of a hold in each non-route column (rest are gaps)

// Climber + camera
const MOVE_MS = 120;           // every reach takes this long, however far
const MAX_SPAN = 150;          // px: hands share a hold or sit on holds at most this far apart
const DIR_CONE = 1.3;          // a hold is "in that direction" if its sideways offset <= this x forward distance
const MIN_STEP = 8;            // px: a target must be at least this far in the swipe direction
const SHOULDER_DROP = 42;      // px from the hands' midpoint down to the shoulders
const CLIMBER_FOCUS = 0.62;    // climber's hands sit this far down the screen
const FALL_GRAVITY = 1800;     // px/s² when knocked off

// Falling rocks
const GRACE_MS = 2000;         // no rocks for this long after the first move
const SPAWN_MS = [2000, 700, 350];  // time between rock warnings
const WARN_MS = [1100, 550, 400];   // a rock flashes at the top this long before it drops
const ROCK_SPEED = [300, 600, 900]; // px/s fall speed
const ROCK_CELL = [2, 4];      // rock pixel size (rock is 8x8 cells: 16px to 32px)
const AIM_CHANCE = [0.3, 0.7, 0.85]; // chance a rock targets the climber's column (else random)

// Juice

const GRAY = 0x535353;
const SHIRT = 0x1f2d5c;         // navy
const PANTS = 0x3b6fd4;         // blue
const ROCK_FLASH = 0xe0533d;    // warning rock flashes between this and gray
const RESET_PAD = 12;            // reset button's distance from the top-left corner
const WARN_TOP = 10;             // px below the top edge where warning rocks wait
const GRAY_CSS = '#535353';
const FONT = 'monospace';
const lerp = (range, d) => {
  if (range.length < 3) return range[0] + (range[1] - range[0]) * Math.min(d, 1);
  const v = range[0] + (range[1] - range[0]) * d;
  return range[1] < range[0] ? Math.max(v, range[2]) : Math.min(v, range[2]);
};
const snap = (v) => Math.round(v / CELL) * CELL;

// ---- One game in one container ----
// createGame(Phaser, container, options) fills the container (and follows its size)
// and returns { destroy }. Options:
//   keys: 'focus' (default) - arrow keys only while the game has focus (click/tap it);
//         'window' - arrow keys page-wide, for a page that is only the game.
//   storageKey: localStorage key for the best height (default 'freesolo-best-m').
const DEFAULT_HEIGHT = 480;    // px, used when the container has no height of its own

export function createGame(Phaser, container, options = {}) {
  const keyMode = options.keys === 'window' ? 'window' : 'focus';
  const storageKey = options.storageKey || 'freesolo-best-m';

  // Container setup, undone by destroy()
  // (only the properties we set are put back, so the host's own style changes survive)
  const ownStyle = { overflow: 'hidden', touchAction: 'none', outline: 'none', lineHeight: '0', userSelect: 'none', webkitUserSelect: 'none' };
  if (container.clientHeight === 0) ownStyle.height = DEFAULT_HEIGHT + 'px';
  const prevStyle = {};
  for (const k in ownStyle) prevStyle[k] = container.style[k];  // read all first: some are aliases
  Object.assign(container.style, ownStyle);
  const addedTabIndex = keyMode === 'focus' && !container.hasAttribute('tabindex');
  if (addedTabIndex) container.setAttribute('tabindex', '0');

  // The board is the container's size
  const size = () => ({ w: Math.max(1, Math.floor(container.clientWidth)), h: Math.max(1, Math.floor(container.clientHeight)) });
  let { w: WIDTH, h: HEIGHT } = size();

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    width: WIDTH,
    height: HEIGHT,
    parent: container,
    backgroundColor: '#ffffff',
    pixelArt: true,
    banner: false,
    audio: { noAudio: true },
    // All input is handled by our own listeners below
    input: { touch: false, mouse: false, keyboard: false, gamepad: false },
    scale: { mode: Phaser.Scale.NONE },
    scene: { create, update }
  });

  let destroyed = false;
  const resizer = new ResizeObserver(() => {
    if (destroyed) return;
    const s = size();
    if (s.w === WIDTH && s.h === HEIGHT) return;
    WIDTH = s.w;
    HEIGHT = s.h;
    game.scale.resize(WIDTH, HEIGHT);
    if (scene) layoutHud();
  });
  resizer.observe(container);

  // ---- State ----
  // phase: 'ready' (start pose, waiting for first move) | 'climbing' |
  //        'falling' (knocked off) | 'over' (landed, game over)
  let scene, gfx, hudText, overText, overBtn, resetBtn;
  let phase, rows, pathCol, prevRoute;
  let height;        // score: highest row either hand has reached (1 row = 1m)
  let elapsed;       // ms climbed since the first move (drives difficulty)
  let hands;         // two hands: { r, i, x, y } (hold + drawn position, tweened between holds)
  let handPos;       // { x, y }: midpoint of the two hands — where the body hangs from
  let lastMoved, moving, queued, pose;
  let camX, camY, spawnTimer, warnings, rocks, puffs, canRestart;
  let fall;          // { x, shoulderY, vy } while falling / over
  let best = 0;
  try { best = Number(localStorage.getItem(storageKey)) || 0; } catch (e) {}
  function saveBest() {
    if (height <= best) return false;
    best = height;
    try { localStorage.setItem(storageKey, String(best)); } catch (e) {}
    return true;
  }

  const WALL_W = COLS * COL_W;
  const difficulty = () => {
    const t = elapsed / RAMP_MS;
    return t <= 1 ? t : 1 + (t - 1) * AFTER_RAMP;
  };
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
    pose = POSES.find((p) => p.name === 'sit start');  // always sit start, both hands on the start hold
    phase = 'ready';
    spawnTimer = GRACE_MS; warnings = []; rocks = []; puffs = []; fall = null;
    camX = targetCamX(handPos.x - WIDTH / 2);
    camY = targetCamY();
    scene.cameras.main.setScroll(Math.round(camX), Math.round(camY));
    extendWall();
    overText.setVisible(false); overBtn.setVisible(false);
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
    if (phase === 'ready') phase = 'climbing';
    let k = pickHand(dir);
    let next = findTarget(k, dir);
    if (!next) { k = 1 - k; next = findTarget(k, dir); }
    if (!next) return;
    const h = hands[k];
    const to = holdXY(next.r, next.i);
    moving = true;
    lastMoved = k;
    h.r = next.r; h.i = next.i;
    scene.tweens.add({
      targets: h,
      x: to.x,
      y: to.y,
      duration: MOVE_MS,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        moving = false;
        if (phase !== 'climbing') return;
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
    else if (phase === 'ready' && pose.sit) { shoulderY = -30; x = handPos.x - 16; }  // sitting on the ground, butt out from under the hands
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
    const cell = Phaser.Math.Between(ROCK_CELL[0], Math.round(lerp(ROCK_CELL, d)));
    warnings.push({ col, t: lerp(WARN_MS, d), cell });
  }

  function knockOff() {
    phase = 'falling';
    queued = null;
    scene.tweens.killTweensOf(hands);
    moving = false;
    warnings = [];
    const b = bodyFrame();
    fall = { x: handPos.x, shoulderY: b.top + 8 * CELL, vy: -120 };
  }

  function gameOver() {
    phase = 'over';
    rocks = [];
    saveBest();
    overText.setVisible(true); overBtn.setVisible(true);
    scene.time.delayedCall(400, () => { canRestart = true; });
  }

  function addPuff(x, y, delay = 0) {
    puffs.push({ x, y, t: -delay });
  }

  // ---- Game over art: same pixel "GAME OVER" and restart button as the dino game ----
  const OVER_PX = 2;
  const GLYPHS = {
    G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
    A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
    E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
    O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
    R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#']
  };
  const RESTART_ICON = ['....#...', '.#####..', '.#..#...', '.#....#.', '.#....#.', '.######.'];
  function bitmap(g, rows, ox, oy, color) {
    g.fillStyle(color, 1);
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) if (row[x] === '#') g.fillRect((ox + x) * OVER_PX, (oy + y) * OVER_PX, OVER_PX, OVER_PX);
    });
  }
  function makeGameOverTextures(sc) {
    if (sc.textures.exists('gameover-text')) return;
    const g = sc.make.graphics({ add: false });
    let x = 0;
    for (const ch of 'GAME OVER') {
      if (ch === ' ') { x += 5; continue; }
      bitmap(g, GLYPHS[ch], x, 0, GRAY);
      x += 8;
    }
    g.generateTexture('gameover-text', (x - 3) * OVER_PX, 7 * OVER_PX);
    g.destroy();
    const BW = 12, BH = 10, b = sc.make.graphics({ add: false });
    b.fillStyle(GRAY, 1);
    b.fillRect(OVER_PX, 0, (BW - 2) * OVER_PX, BH * OVER_PX);
    b.fillRect(0, OVER_PX, BW * OVER_PX, (BH - 2) * OVER_PX);
    bitmap(b, RESTART_ICON, (BW - 8) / 2, 2, 0xffffff);
    b.generateTexture('restart-btn', BW * OVER_PX, BH * OVER_PX);
    b.destroy();
  }

  // ---- Scene ----
  function create() {
    scene = this;
    this.game.canvas.style.display = 'block';
    gfx = this.add.graphics();
    const style = { fontFamily: FONT, fontSize: '16px', color: GRAY_CSS };
    hudText = this.add.text(0, 12, '', { ...style, backgroundColor: '#ffffff', padding: { x: 4, y: 2 } })
      .setScrollFactor(0).setOrigin(1, 0).setDepth(10);
    makeGameOverTextures(this);
    overText = this.add.image(0, 0, 'gameover-text').setScrollFactor(0).setDepth(10).setVisible(false);
    overBtn = this.add.image(0, 0, 'restart-btn').setScrollFactor(0).setDepth(10).setVisible(false)
      .setInteractive({ useHandCursor: true });
    // Always-on reset button, top left
    resetBtn = this.add.image(RESET_PAD, RESET_PAD, 'restart-btn').setOrigin(0, 0).setScrollFactor(0).setDepth(10);
    layoutHud();
    newGame();
  }

  function layoutHud() {
    hudText.setX(WIDTH - 12);
    overText.setPosition(WIDTH / 2, HEIGHT * 0.3);
    overBtn.setPosition(WIDTH / 2, HEIGHT * 0.3 + 32);
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
        if (w.t > 0) return true;
        const size = 8 * w.cell;   // drops from where it was flashing, at the top of the view
        rocks.push({ x: Math.round(colX(w.col) - size / 2), y: Math.round(camY) + WARN_TOP, size, cell: w.cell, speed: lerp(ROCK_SPEED, d) });
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

  function drawGrid(grid, x, y, cell = CELL, alpha = 1, ink = GRAY, exact = false) {
    if (!exact) { x = snap(x); y = snap(y); }
    runsOf(grid).forEach((r) => {
      gfx.fillStyle(r.ch === 'w' ? 0xffffff : r.ch === 's' ? SHIRT : r.ch === 'p' ? PANTS : ink, alpha);
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
    if (fall) grid = BODY.fall[0];
    else if (phase === 'ready') grid = pose.grid;
    else if (moving) grid = BODY.reach[lastMoved];
    else grid = BODY.hang[0];

    // Where each hand is drawn: on its hold, or off it for some poses / when falling
    const [lk, rk] = hands[0].x <= hands[1].x ? [0, 1] : [1, 0];
    const handAt = (k, shoulder, side) => {
      if (fall) return { x: shoulder.x + side * 10, y: shoulder.y - 22 };
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
    if (phase === 'ready' && pose.legs) drawGrid(pose.legs.rows, f.left, f.top + pose.legs.at * CELL);
    drawGrid(HAND, lh.x - 4, lh.y - 6);
    drawGrid(HAND, rh.x - 4, rh.y - 6);
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
    rocks.forEach((rk) => drawGrid(ROCK, Math.round(rk.x), Math.round(rk.y), rk.cell, 1, GRAY, true));
    // Warning rocks wait at the top of their column, flashing color <-> gray
    warnings.forEach((w) => {
      const size = 8 * w.cell;
      // Pinned to the screen (exact pixels, matching the rounded camera) so it doesn't jitter
      drawGrid(ROCK, Math.round(colX(w.col) - size / 2), Math.round(camY) + WARN_TOP, w.cell, 1, Math.floor(w.t / 120) % 2 ? ROCK_FLASH : GRAY, true);
    });

    // Chalk puffs
    puffs.forEach((p) => {
      if (p.t < 0) return;
      drawGrid(PUFF[p.t < 220 ? 0 : 1], p.x - 5, p.y - 5 - p.t / 40, CELL, 0.6);
    });
  }

  // ---- Input: arrows, swipes, taps ----
  const offs = [];
  const on = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    offs.push(() => target.removeEventListener(type, fn, opts));
  };
  const restartIfOver = () => { if (phase === 'over' && canRestart) newGame(); };
  const KEYS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
  on(keyMode === 'window' ? window : container, 'keydown', (e) => {
    if (KEYS[e.key]) {
      e.preventDefault();
      if (phase === 'over') restartIfOver(); else tryMove(KEYS[e.key]);
    } else if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      newGame();
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      restartIfOver();
    }
  });

  // Is this pointer on the top-left reset button? (in game px)
  const onResetBtn = (e) => {
    if (!resetBtn) return false;
    const r = scene.game.canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) * (WIDTH / r.width);
    const y = (e.clientY - r.top) * (HEIGHT / r.height);
    const slop = 8;  // a little extra so it's easy to hit with a finger
    return x <= RESET_PAD + resetBtn.width + slop && y <= RESET_PAD + resetBtn.height + slop;
  };
  let swipeStart = null;
  on(container, 'pointerdown', (e) => {
    if (!e.isPrimary) return;
    if (keyMode === 'focus') container.focus({ preventScroll: true });
    try { container.setPointerCapture(e.pointerId); } catch (err) {}  // keep the swipe if the finger leaves the box
    swipeStart = { x: e.clientX, y: e.clientY, used: false, reset: onResetBtn(e) };
  });
  on(container, 'pointermove', (e) => {
    if (!swipeStart || swipeStart.used || !e.isPrimary) return;
    const dx = e.clientX - swipeStart.x, dy = e.clientY - swipeStart.y;
    if (Math.hypot(dx, dy) < SWIPE_PX) return;
    swipeStart.used = true;  // one move per swipe
    tryMove(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
  });
  on(container, 'pointerup', () => {
    if (!swipeStart) return;
    const wasTap = !swipeStart.used, reset = swipeStart.reset;
    swipeStart = null;
    if (wasTap && reset) newGame();
    else if (wasTap) restartIfOver();
  });
  on(container, 'pointercancel', () => { swipeStart = null; });
  // Belt and braces for iOS: no page scroll / pull-to-refresh while swiping on the game
  on(container, 'touchmove', (e) => e.preventDefault(), { passive: false });

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    resizer.disconnect();
    offs.forEach((off) => off());
    game.destroy(true);
    for (const k in prevStyle) container.style[k] = prevStyle[k];
    if (container.getAttribute('style') === '') container.removeAttribute('style');
    if (addedTabIndex) container.removeAttribute('tabindex');
  }

  return { destroy };
}
