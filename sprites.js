// Text-grid sprites. '#' = gray, 'w' = white (cuts a gap into gray), '.' = empty.
// Each cell is drawn as a CELL x CELL block (chunky pixels).
// The climber is seen from behind and built from parts: head + torso + legs.
// Body grids are 16 wide, symmetric around the middle so legs can be mirrored.

const CELL = 2;

const HEAD = [
  '.......##.......', // pom
  '......####......',
  '.....######.....', // beanie
  '....########....',
  '....wwwwwwww....', // cuff seam
  '....########....',
  '.....######.....', // back of head
  '......####......'  // neck
];
const HEAD_UP = [     // staring up: head tilted back, beanie looks shorter
  '................',
  '................',
  '.......##.......',
  '.....######.....',
  '....########....',
  '....wwwwwwww....',
  '....########....',
  '......####......'
];
const TORSO = [
  '...##########...', // row 8: shoulders
  '..############..',
  '..############..',
  '...##########...',
  '...##########...',
  '...##########...',
  '...##########.#.', // chalk bag bump on the right hip
  '...##########w##',
  '...##########w##',
  '...##########.#.'
];

// Legs start at row 18 unless they say otherwise ({ at, rows })
const LEGS = {
  hangA: [
    '....########....',
    '....###..###....',
    '....###..###....',
    '....###..###....',
    '....###..###....',
    '....###..###....',
    '....###..###....',
    '....###..###....',
    '...####..####...',
    '.#####....#####.'  // pointy shoes
  ],
  hangB: [
    '....########....',
    '....###..###....',
    '....###..###....',
    '....###..###....',
    '....###..###....',
    '...###..###.....',
    '...###..###.....',
    '...###..###.....',
    '..####..####....',
    '#####....#####..'
  ],
  reachA: [
    '....########....',
    '...####..###....',
    '..###....###....',
    '.###.....###....',
    '.####....###....',
    '..####...###....',
    '.#####...###....',
    '.........###....',
    '.........####...',
    '.........#####..'
  ],
  fallA: [
    '....########....',
    '...###....###...',
    '..###......###..',
    '.###........###.',
    '###..........###',
    '##............##'
  ],
  fallB: [
    '....########....',
    '....###..###....',
    '...###....###...',
    '..####....####..',
    '.###........###.',
    '.##..........##.'
  ],
  sit: [
    '...##########...',
    '..############..',
    '.###.######.###.',
    '###..######..###',
    '##...######...##'
  ],
  dropKnee: [
    '....########....',
    '....###..###....',
    '....###..####...',
    '....###...####..',
    '....###....###..',
    '....###...###...',
    '....###..###....',
    '....###..###....',
    '...####.####....',
    '.#####.####.....'
  ],
  flag: [
    '....########....',
    '....###..###....',
    '....###...####..',
    '....###.....####',
    '....###.......##',
    '....###.........',
    '....###.........',
    '....###.........',
    '...####.........',
    '.#####..........'
  ],
  heelHook: { at: 12, rows: [
    '#...............',
    '##..............',
    '.##.............',
    '..##............',
    '...#............',
    '...##...........',
    '....########....',
    '.........###....',
    '.........###....',
    '.........###....',
    '.........###....',
    '.........###....',
    '.........###....',
    '.........###....',
    '.........####...',
    '.........#####..'
  ] }
};
LEGS.reachB = LEGS.reachA.map((r) => r.split('').reverse().join(''));

const mirror = (rows) => rows.map((r) => r.split('').reverse().join(''));

// Lay grids on top of each other (later parts win where they aren't '.')
function compose(parts) {
  const out = [];
  parts.forEach(({ at, rows }) => {
    rows.forEach((row, i) => {
      const prev = out[at + i] || '.'.repeat(row.length);
      out[at + i] = row.split('').map((ch, j) => (ch === '.' ? prev[j] : ch)).join('');
    });
  });
  for (let i = 0; i < out.length; i++) if (!out[i]) out[i] = '.'.repeat(16);
  return out;
}
function body(legs, head = HEAD) {
  const l = Array.isArray(legs) ? { at: 18, rows: legs } : legs;
  return compose([{ at: 0, rows: head }, { at: 8, rows: TORSO }, l]);
}

const BODY = {
  hang: [body(LEGS.hangA), body(LEGS.hangB)],
  reach: [body(LEGS.reachA), body(LEGS.reachB)],
  fall: [body(LEGS.fallA), body(LEGS.fallB)]
};

// Start poses. arm: which hand leaves the hold and where it goes ('bag' or 'stretch').
// sit: the body sits on the ground instead of hanging.
const POSES = [
  { name: 'sit start', grid: body(LEGS.sit), sit: true },
  { name: 'drop knee', grid: body(LEGS.dropKnee) },
  { name: 'flag', grid: body(LEGS.flag) },
  { name: 'heel hook', grid: body(LEGS.heelHook) },
  { name: 'chalking', grid: body(LEGS.hangA), arm: { hand: 1, to: 'bag' } },
  { name: 'staring up', grid: body(LEGS.hangA, HEAD_UP) },
  { name: 'stretching', grid: body(LEGS.hangB), arm: { hand: 0, to: 'stretch' } }
];

const HAND = [
  '#.#.',
  '####',
  '####'
];
const HOLD = [
  '..####..',
  '.######.',
  '########',
  '###..###'
];
const ROCK = [
  '..#####.',
  '.#######',
  '###w####',
  '####w###',
  '########',
  '#####w##',
  '.######.',
  '..####..'
];
const PUFF = [
  ['.....', '..#..', '.###.', '..#..', '.....'],
  ['.#.#.', '#...#', '.....', '#...#', '.#.#.']
];
const HI = [  // the "hi" inside the speech bubble
  '#...#',
  '#....',
  '###.#',
  '#.#.#',
  '#.#.#'
];
const FLAG = [ // marks the top hold of each level
  '#......',
  '####...',
  '######.',
  '#######',
  '####...',
  '#......',
  '#......',
  '#......',
  '#......'
];
