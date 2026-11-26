// Free Solo — phase 1 gray box. Boxes for holds, climber and rocks.
// World y grows downward; the ground is y = 0 and the wall goes up into negative y.

// ---- Tuning (phase 2 will tune these) ----
const MAX_WIDTH = 480;
const MAX_HEIGHT = 720;
const MIN_HEIGHT = 360;
const PAGE_PADDING = 32;       // 16px above + 16px below the board
const COLS = 5;
const ROW_GAP = 70;            // px between hold rows
const ROW0_Y = -60;            // lowest hold row (start hold)
const PX_PER_M = 35;           // 2 m per row
const EXTRA_HOLD_CHANCE = 0.4; // chance of a hold in each non-path column
const JITTER = 10;             // px holds are nudged off the grid
const MOVE_MS = 110;           // base reach time...
const MOVE_MS_PER_PX = 0.6;    // ...plus this per px of reach
const CLIMBER_FOCUS = 0.62;    // climber's hands sit this far down the screen
const CRUMBLE_SPEED = 12;      // px/s the crumble rises on its own
const CRUMBLE_LAG = 60;        // crumble never trails more than this below the screen
const SPAWN_MS = 1500;         // time between hazards
const WARN_MS = 900;           // "!" shows this long before the rock drops
const ROCK_SPEED = 420;        // px/s
const SWIPE_PX = 24;           // finger travel that counts as a swipe

const GRAY = 0x535353;
const GRAY_CSS = '#535353';
const FONT = 'monospace';

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
  }
});

// ---- State ----
let scene, gfx, hudText, bestText, hiText, overText;
let rows;          // rows[r] = [{ col, jx, jy }]
let pathCol;       // column of the guaranteed route, random-walks upward
let hand;          // { r, i } current hold
let handPos;       // { x, y } drawn hand position (tweens between holds)
let moving, queued;
let started, dead, canRestart;
let crumbleY, camY, spawnTimer, warnings, rocks, pile, maxClimb;
let best = 0;
try { best = Number(localStorage.getItem('freesolo-best')) || 0; } catch (e) {}

const colX = (col) => {
  const margin = 28;
  return margin + (col + 0.5) * (WIDTH - margin * 2) / COLS;
};
const rowY = (r) => ROW0_Y - r * ROW_GAP;
const holdXY = (r, i) => {
  const h = rows[r][i];
  return { x: colX(h.col) + h.jx, y: rowY(r) + h.jy };
};

function makeRow(r) {
  if (r === 0) {
    pathCol = Math.floor(COLS / 2);
    return [{ col: pathCol, jx: 0, jy: 0 }];
  }
  pathCol = Phaser.Math.Clamp(pathCol + Phaser.Math.Between(-1, 1), 0, COLS - 1);
  const row = [];
  for (let c = 0; c < COLS; c++) {
    if (c === pathCol || Math.random() < EXTRA_HOLD_CHANCE) {
      row.push({ col: c, jx: Phaser.Math.Between(-JITTER, JITTER), jy: Phaser.Math.Between(-JITTER, JITTER) });
    }
  }
  return row;
}

function ensureRows(topY) {
  while (rowY(rows.length - 1) > topY - ROW_GAP * 2) rows.push(makeRow(rows.length));
}

const holdAlive = (r, i) => holdXY(r, i).y < crumbleY - 6;

// Next hold in a direction: up/down looks 1-2 rows away within one column;
// left/right looks along the row (up to 2 columns), then one row up/down.
function findNext(dir) {
  const { r, i } = hand;
  const c = rows[r][i].col;
  const pick = (rr, test) => {
    if (rr < 0 || !rows[rr]) return null;
    let bestI = -1, bestD = Infinity;
    rows[rr].forEach((h, j) => {
      if (!test(h) || !holdAlive(rr, j)) return;
      const d = Math.abs(h.col - c);
      if (d < bestD) { bestD = d; bestI = j; }
    });
    return bestI >= 0 ? { r: rr, i: bestI } : null;
  };
  const near = (h) => Math.abs(h.col - c) <= 1;
  if (dir === 'up') return pick(r + 1, near) || pick(r + 2, (h) => h.col === c);
  if (dir === 'down') return pick(r - 1, near) || pick(r - 2, (h) => h.col === c);
  const s = dir === 'left' ? -1 : 1;
  const side = (h) => (h.col - c) * s >= 1 && (h.col - c) * s <= 2;
  const diag = (h) => h.col - c === s;
  return pick(r, side) || pick(r + 1, diag) || pick(r - 1, diag);
}

function tryMove(dir) {
  if (dead) return;
  if (moving) { queued = dir; return; }
  if (!started) {
    started = true;
    if (hiText) { hiText.destroy(); hiText = null; }
  }
  const next = findNext(dir);
  if (!next) return;
  const from = { ...handPos };
  const to = holdXY(next.r, next.i);
  const dist = Phaser.Math.Distance.Between(from.x, from.y, to.x, to.y);
  moving = true;
  hand = next;
  scene.tweens.add({
    targets: handPos,
    x: to.x,
    y: to.y,
    duration: MOVE_MS + dist * MOVE_MS_PER_PX,
    ease: 'Sine.easeInOut',
    onComplete: () => {
      moving = false;
      if (queued) { const q = queued; queued = null; tryMove(q); }
    }
  });
}

function climberRect() {
  // Hands at handPos; body hangs below
  return { x: handPos.x - 11, y: handPos.y + 4, w: 22, h: 40 };
}

const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

function create() {
  scene = this;
  gfx = this.add.graphics();
  const style = { fontFamily: FONT, fontSize: '16px', color: GRAY_CSS };
  hudText = this.add.text(0, 12, '', style).setScrollFactor(0).setOrigin(1, 0).setDepth(10);
  bestText = this.add.text(0, 32, '', style).setScrollFactor(0).setOrigin(1, 0).setDepth(10);
  overText = this.add.text(0, 0, '', { ...style, fontSize: '20px', align: 'center', backgroundColor: '#ffffff', padding: { x: 8, y: 6 } })
    .setScrollFactor(0).setOrigin(0.5).setDepth(10);
  layoutHud();
  reset();
}

function layoutHud() {
  hudText.setX(WIDTH - 12);
  bestText.setX(WIDTH - 12);
  overText.setPosition(WIDTH / 2, HEIGHT * 0.35);
}

function reset() {
  rows = [];
  pathCol = 0;
  crumbleY = 40;
  ensureRows(-MAX_HEIGHT * 2);
  hand = { r: 0, i: 0 };
  handPos = holdXY(0, 0);
  moving = false; queued = null;
  started = false; dead = false; canRestart = false;
  if (warnings) warnings.forEach((w) => w.text.destroy());
  spawnTimer = SPAWN_MS; warnings = []; rocks = []; pile = null; maxClimb = 0;
  camY = targetCamY();
  scene.cameras.main.scrollY = camY;
  overText.setText('');
  if (hiText) hiText.destroy();
  hiText = scene.add.text(handPos.x + 18, handPos.y - 4, 'hi', { fontFamily: FONT, fontSize: '14px', color: GRAY_CSS });
}

function targetCamY() {
  // Follow the hands, but never show more than 40px below the ground
  return Math.min(handPos.y - HEIGHT * CLIMBER_FOCUS, 40 - HEIGHT);
}

function spawnWarning() {
  // Half the time aim at the climber's column, otherwise random
  const col = Math.random() < 0.5 ? rows[hand.r][hand.i].col : Phaser.Math.Between(0, COLS - 1);
  const text = scene.add.text(colX(col), 6, '!', { fontFamily: FONT, fontSize: '22px', color: GRAY_CSS, fontStyle: 'bold' })
    .setOrigin(0.5, 0).setScrollFactor(0).setDepth(10);
  warnings.push({ col, t: WARN_MS, text });
}

function die() {
  if (dead) return;
  dead = true;
  scene.tweens.killTweensOf(handPos);
  warnings.forEach((w) => w.text.destroy());
  warnings = [];
  rocks = [];
  // Burial: a mound of rocks drops onto him, one hand left sticking out
  const c = climberRect();
  const baseY = c.y + c.h + 4;
  const targets = [];
  const layers = 4;
  for (let l = 0; l < layers; l++) {
    const n = layers - l + 2;
    const size = 16;
    for (let k = 0; k < n; k++) {
      const x = handPos.x + (k - (n - 1) / 2) * size + Phaser.Math.Between(-3, 3);
      targets.push({ x, y: baseY - (l + 1) * size + 2, size: size + Phaser.Math.Between(-2, 2) });
    }
  }
  pile = targets.map((t, idx) => ({
    ...t,
    cy: camY - 30 - idx * 26,   // staggered start above the screen
    landed: false
  }));
}

function finishGameOver() {
  const m = Math.floor(maxClimb);
  if (m > best) {
    best = m;
    try { localStorage.setItem('freesolo-best', String(best)); } catch (e) {}
  }
  overText.setText(`GAME OVER\n\n${m} m\n\ntap to climb again`);
  scene.time.delayedCall(400, () => { canRestart = true; });
}

function update(time, deltaMs) {
  const dt = Math.min(deltaMs, 50) / 1000;
  ensureRows(camY);

  // Camera
  camY += (targetCamY() - camY) * Math.min(1, dt * 6);
  scene.cameras.main.scrollY = Math.round(camY);
  const camBottom = camY + HEIGHT;

  if (started && !dead) {
    maxClimb = Math.max(maxClimb, (ROW0_Y - handPos.y) / PX_PER_M);

    // Crumble rises, and never lags far below the screen
    crumbleY = Math.min(crumbleY - CRUMBLE_SPEED * dt, camBottom + CRUMBLE_LAG);
    if (handPos.y + 8 >= crumbleY) die();

    // Hazards
    spawnTimer -= deltaMs;
    if (spawnTimer <= 0) { spawnTimer = SPAWN_MS; spawnWarning(); }
    warnings = warnings.filter((w) => {
      w.t -= deltaMs;
      w.text.setVisible(Math.floor(w.t / 120) % 2 === 0);
      if (w.t > 0) return true;
      w.text.destroy();
      const size = Phaser.Math.Between(16, 26);
      rocks.push({ x: colX(w.col) - size / 2, y: camY - size, size });
      return false;
    });
    const body = climberRect();
    rocks.forEach((rk) => { rk.y += ROCK_SPEED * dt; });
    rocks = rocks.filter((rk) => rk.y < camBottom + 40);
    if (rocks.some((rk) => overlap(body, { x: rk.x, y: rk.y, w: rk.size, h: rk.size }))) die();
  }

  if (pile) {
    let allLanded = true;
    pile.forEach((p) => {
      if (p.landed) return;
      p.cy = Math.min(p.y, p.cy + ROCK_SPEED * 1.6 * dt);
      if (p.cy >= p.y) p.landed = true; else allLanded = false;
    });
    if (allLanded && !overText.text) finishGameOver();
  }

  hudText.setText(`${Math.floor(maxClimb)} m`);
  bestText.setText(best ? `best ${best} m` : '');
  draw();
}

function draw() {
  gfx.clear();
  gfx.fillStyle(GRAY, 1);
  const top = camY - 10, bottom = camY + HEIGHT + 10;

  // Ground
  gfx.fillRect(0, 0, WIDTH, 3);

  // Holds
  rows.forEach((row, r) => {
    const y0 = rowY(r);
    if (y0 < top - 20 || y0 > bottom + 20) return;
    row.forEach((h, i) => {
      if (!holdAlive(r, i)) return;
      const p = holdXY(r, i);
      gfx.fillRect(p.x - 8, p.y - 4, 16, 8);
    });
  });

  // Crumble: jagged band from crumbleY down
  if (crumbleY < bottom) {
    const step = 8;
    for (let x = 0; x < WIDTH; x += step) {
      const jag = ((x * 7919) % 13) - 6;
      gfx.fillRect(x, crumbleY + jag, step, bottom - crumbleY - jag);
    }
    for (let x = 4; x < WIDTH; x += 23) {
      gfx.fillRect(x, crumbleY - 14 - ((x * 31) % 9), 4, 4); // loose debris
    }
  }

  // Climber: two hands on the hold, body hanging below, cosmetic feet
  const c = climberRect();
  gfx.fillRect(handPos.x - 7, handPos.y - 6, 5, 6);
  gfx.fillRect(handPos.x + 2, handPos.y - 6, 5, 6);
  gfx.fillRect(c.x + 4, c.y - 2, 2, 6);
  gfx.fillRect(c.x + c.w - 6, c.y - 2, 2, 6);
  gfx.fillRect(c.x, c.y + 4, c.w, c.h - 4);

  // Falling rocks
  rocks.forEach((rk) => gfx.fillRect(rk.x, rk.y, rk.size, rk.size));

  // Burial pile, plus the hand sticking out
  if (pile) {
    pile.forEach((p) => {
      gfx.fillStyle(0xffffff, 1);
      gfx.fillRect(p.x - p.size / 2 - 1, p.cy - 1, p.size + 2, p.size + 2);
      gfx.fillStyle(GRAY, 1);
      gfx.fillRect(p.x - p.size / 2, p.cy, p.size, p.size);
    });
    if (pile.every((p) => p.landed)) {
      const topY = Math.min(...pile.map((p) => p.y));
      gfx.fillRect(handPos.x - 3, topY - 14, 6, 14);
      gfx.fillRect(handPos.x - 5, topY - 18, 10, 6);
    }
  }

}

// ---- Input: arrows, swipes, taps ----
const KEYS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
window.addEventListener('keydown', (e) => {
  if (KEYS[e.key]) {
    e.preventDefault();
    if (dead) { if (canRestart) reset(); return; }
    tryMove(KEYS[e.key]);
  } else if ((e.key === ' ' || e.key === 'Enter') && dead && canRestart) {
    e.preventDefault();
    reset();
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
  if (dead) return;
  tryMove(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
});
window.addEventListener('pointerup', (e) => {
  if (!swipeStart) return;
  const wasTap = !swipeStart.used;
  swipeStart = null;
  if (wasTap && dead && canRestart) reset();
});
window.addEventListener('pointercancel', () => { swipeStart = null; });
// Belt and braces for iOS: no page scroll / pull-to-refresh while swiping
document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
