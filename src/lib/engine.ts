// 間合い — frame-based fighting engine (60 fps fixed step, no rendering here)

export const FPS = 60;
export const W = 1200;
export const H = 675;
export const GROUND = 520;
export const WALL_L = 70;
export const WALL_R = W - 70;
export const CEIL = 96;

const GRAVITY = 0.55;
const WALK_SPEED = 4.2;
export const HALF_W = 30;
export const BODY_H = 60;

const DASH_FRAMES = 12;
const DASH_SPEED = 24; // decays linearly → ~150px
const DASH_CANCEL = 4; // attacks allowed from this dash frame
const DASH_RECOVERY = 7;
const BACKDASH_RECOVERY = 11;
const BUFFER_FRAMES = 5;
const DOUBLE_TAP = 12;
const READY_FRAMES = 70;
const KO_FRAMES = 110;
const WALL_BOUNCE_SPEED = 5;
const WALL_DAMAGE = 3;

export const MAX_HP = 100;
export const ROUNDS_TO_WIN = 2;

// ---------------------------------------------------------------- moves

export type MoveId = 'short' | 'long';

export interface Box { x0: number; x1: number; y0: number; y1: number }

export interface Move {
  id: MoveId;
  startup: number; // frames before the first active frame
  active: number;
  recovery: number;
  hit: Box; // relative to feet; x forward-positive, y up-negative
  sweet?: number; // contact distance at/after which it's a tip hit (先端)
  thickness: number; // body height while stretched
  hold: number; // recovery frames the body stays fully stretched
  damage: number;
  kb: number;
  angle: number; // degrees
  hitstop: number;
  lunge: number;
}

export const MOVES: Record<MoveId, Move> = {
  short: {
    id: 'short',
    startup: 4, active: 3, recovery: 9,
    hit: { x0: 20, x1: 88, y0: -34, y1: 0 },
    thickness: 34, hold: 5,
    damage: 6, kb: 6, angle: 20, hitstop: 6, lunge: 1.5,
  },
  long: {
    id: 'long',
    startup: 14, active: 4, recovery: 22,
    hit: { x0: 32, x1: 213, y0: -18, y1: 0 },
    sweet: 173,
    thickness: 18, hold: 14,
    damage: 13, kb: 10, angle: 30, hitstop: 9, lunge: 0,
  },
};

export const totalFrames = (m: Move) => m.startup + m.active + m.recovery;

// ---------------------------------------------------------------- types

export type State = 'idle' | 'walk' | 'dash' | 'dashRec' | 'attack' | 'hit';
export type Phase = 'startup' | 'active' | 'recovery';

export interface Input {
  left: boolean;
  right: boolean;
  short: boolean; // pressed this frame
  long: boolean;
  dash: boolean;
}

export const NO_INPUT: Input = { left: false, right: false, short: false, long: false, dash: false };

export interface Fighter {
  id: 0 | 1;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  state: State;
  sf: number; // frames spent in current state (1 on the first frame)
  move: MoveId | null;
  hasHit: boolean;
  dashDir: 1 | -1;
  back: boolean;
  hitstun: number;
  airborne: boolean;
  recoil: boolean; // attacker being pushed back by its own hit
  wallBounced: boolean;
  hp: number;
  hpTrail: number; // cosmetic: lagging damage bar
  ko: boolean;
  shatter: { x: number; y: number; vx: number; vy: number; t: number } | null; // KO: body breaks apart here
  wins: number;
  buffer: { action: 'short' | 'long' | 'dash'; dir: number; age: number } | null;
  prevDir: number;
  lastTap: { dir: number; tick: number };
  trail: { x: number; y: number; facing: 1 | -1; body: BodyRect }[]; // afterimages keep the shape of that frame
}

export interface Effect {
  kind: 'burst' | 'dust';
  x: number;
  y: number;
  t: number;
  life: number;
  big: boolean;
  dir: 1 | -1; // direction the impact pushes along (x axis)
}

export interface Game {
  tick: number; // wall steps (input clock)
  frame: number; // simulation frames
  hitstop: number;
  phase: 'ready' | 'fight' | 'ko' | 'over';
  phaseTimer: number;
  round: number;
  fighters: [Fighter, Fighter];
  effects: Effect[];
  winner: 0 | 1 | null;
  roundWinner: 0 | 1 | null;
  shake: number;
}

// ---------------------------------------------------------------- setup

const START_X: [number, number] = [W / 2 - 170, W / 2 + 170];

function newFighter(id: 0 | 1): Fighter {
  const f = { id, wins: 0, prevDir: 0, lastTap: { dir: 0, tick: -99 } } as Fighter;
  resetFighter(f);
  return f;
}

function resetFighter(f: Fighter) {
  Object.assign(f, {
    x: START_X[f.id], y: GROUND, vx: 0, vy: 0,
    facing: f.id === 0 ? 1 : -1, state: 'idle', sf: 0, move: null,
    hasHit: false, dashDir: 1, back: false, hitstun: 0, airborne: false, recoil: false, wallBounced: false,
    hp: MAX_HP, hpTrail: MAX_HP, ko: false, shatter: null, buffer: null, trail: [],
  });
}

export function newGame(): Game {
  return {
    tick: 0, frame: 0, hitstop: 0, phase: 'ready', phaseTimer: READY_FRAMES, round: 1,
    fighters: [newFighter(0), newFighter(1)],
    effects: [], winner: null, roundWinner: null, shake: 0,
  };
}

// ---------------------------------------------------------------- queries

export function movePhase(f: Fighter): Phase | null {
  if (f.state !== 'attack' || !f.move) return null;
  const m = MOVES[f.move];
  if (f.sf <= m.startup) return 'startup';
  if (f.sf <= m.startup + m.active) return 'active';
  return 'recovery';
}

const isNeutral = (f: Fighter) => (f.state === 'idle' || f.state === 'walk') && !f.airborne && !f.recoil;

function toWorld(f: Fighter, b: Box): Box {
  const a = f.x + b.x0 * f.facing;
  const c = f.x + b.x1 * f.facing;
  return { x0: Math.min(a, c), x1: Math.max(a, c), y0: f.y + b.y0, y1: f.y + b.y1 };
}

export function hitbox(f: Fighter): Box | null {
  if (movePhase(f) !== 'active' || f.hasHit) return null;
  return toWorld(f, MOVES[f.move!].hit);
}

// The body is always a rectangle standing on its feet; attacks only change its proportions.
// Returned in local space (x forward-positive), bottom at y = 0.
export interface BodyRect { x0: number; x1: number; h: number }

const SQUARE: BodyRect = { x0: -HALF_W, x1: HALF_W, h: BODY_H };
const mix = (a: BodyRect, b: BodyRect, t: number): BodyRect => ({
  x0: a.x0 + (b.x0 - a.x0) * t, x1: a.x1 + (b.x1 - a.x1) * t, h: a.h + (b.h - a.h) * t,
});

export function bodyRect(f: Fighter): BodyRect {
  const p = movePhase(f);
  if (!p) return SQUARE;
  const m = MOVES[f.move!];
  const k = m.id === 'long' ? 1 : 0.5;
  const windup = { x0: -HALF_W - 8 * k, x1: HALF_W - 18 * k, h: BODY_H + 16 * k };
  const stretched = { x0: -HALF_W, x1: m.hit.x1, h: m.thickness };
  if (p === 'startup') {
    const t = f.sf / m.startup;
    return mix(SQUARE, windup, 1 - (1 - t) * (1 - t));
  }
  if (p === 'active') return stretched;
  const r = f.sf - m.startup - m.active;
  if (r <= m.hold) return stretched;
  const t = (r - m.hold) / (m.recovery - m.hold);
  return mix(stretched, SQUARE, 1 - (1 - t) ** 3);
}

export function hurtboxes(f: Fighter): Box[] {
  if (f.ko) return [];
  const r = bodyRect(f);
  return [toWorld(f, { x0: r.x0, x1: r.x1, y0: -r.h, y1: 0 })];
}

const overlap = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const MIN_X = WALL_L + HALF_W;
const MAX_X = WALL_R - HALF_W;
const clampX = (x: number) => Math.max(MIN_X, Math.min(MAX_X, x));

// ---------------------------------------------------------------- step

export function step(g: Game, inputs: [Input, Input]) {
  g.tick++;
  // Inputs are always read so presses during hitstop still buffer.
  for (const f of g.fighters) readInput(g, f, inputs[f.id]);

  if (g.shake > 0) g.shake--;
  tickCosmetics(g);

  if (g.phase === 'over') return;

  if (g.phase === 'ready') {
    if (--g.phaseTimer <= 0) g.phase = 'fight';
    return;
  }

  if (g.hitstop > 0) {
    g.hitstop--;
    return;
  }

  if (g.phase === 'ko') {
    for (const f of g.fighters) {
      if (f.shatter) { f.shatter.t++; continue; }
      if (f.state === 'hit') f.hitstun--;
      physics(g, f);
    }
    if (--g.phaseTimer <= 0) afterKo(g);
    return;
  }

  g.frame++;
  const [a, b] = g.fighters;
  for (const f of g.fighters) act(g, f, f === a ? b : a, inputs[f.id]);
  for (const f of g.fighters) physics(g, f);
  pushApart(a, b);
  resolveHits(g);
  checkKo(g);
}

function readInput(g: Game, f: Fighter, input: Input) {
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  let dash = input.dash;
  // double-tap dash
  if (dir !== 0 && dir !== f.prevDir) {
    if (f.lastTap.dir === dir && g.tick - f.lastTap.tick <= DOUBLE_TAP) {
      dash = true;
      f.lastTap = { dir: 0, tick: -99 };
    } else {
      f.lastTap = { dir, tick: g.tick };
    }
  }
  f.prevDir = dir;

  if (f.buffer) f.buffer.age++;
  if (f.buffer && f.buffer.age > BUFFER_FRAMES) f.buffer = null;
  if (input.long) f.buffer = { action: 'long', dir, age: 0 };
  else if (input.short) f.buffer = { action: 'short', dir, age: 0 };
  else if (dash) f.buffer = { action: 'dash', dir, age: 0 };
}

function setState(f: Fighter, s: State) {
  f.state = s;
  f.sf = 0;
}

function act(g: Game, f: Fighter, o: Fighter, input: Input) {
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);

  // ---- state expiry
  if (f.state === 'attack' && f.move && f.sf >= totalFrames(MOVES[f.move])) setState(f, 'idle');
  if (f.state === 'dash' && f.sf >= DASH_FRAMES) setState(f, 'dashRec');
  if (f.state === 'dashRec' && f.sf >= (f.back ? BACKDASH_RECOVERY : DASH_RECOVERY)) setState(f, 'idle');
  if (f.state === 'hit' && f.hitstun <= 0 && !f.airborne) setState(f, 'idle');
  if (f.state === 'hit') f.hitstun--;

  // ---- consume buffered actions
  const b = f.buffer;
  const dashCancel = f.state === 'dash' && !f.back && f.sf >= DASH_CANCEL;
  if (b && (isNeutral(f) || dashCancel)) {
    if (b.action === 'short' || b.action === 'long') {
      if (isNeutral(f)) f.facing = o.x >= f.x ? 1 : -1;
      setState(f, 'attack');
      f.move = b.action;
      f.hasHit = false;
      f.vx *= dashCancel ? 0.6 : 0.2;
      f.buffer = null;
    } else if (b.action === 'dash' && isNeutral(f)) {
      f.facing = o.x >= f.x ? 1 : -1;
      const d = (b.dir || dir || f.facing) as 1 | -1;
      f.dashDir = d;
      f.back = d !== f.facing;
      setState(f, 'dash');
      f.buffer = null;
      g.effects.push({ kind: 'dust', x: f.x, y: f.y, t: 0, life: 14, big: false, dir: 1 });
    }
  }

  // ---- per-state behaviour
  switch (f.state) {
    case 'idle':
    case 'walk': {
      if (f.airborne || f.recoil) break; // being pushed back: no control
      f.facing = o.x >= f.x ? 1 : -1;
      if (dir !== 0) {
        if (f.state !== 'walk') setState(f, 'walk');
        f.vx = dir * WALK_SPEED * (dir === f.facing ? 1 : 0.8);
      } else {
        if (f.state !== 'idle') setState(f, 'idle');
        f.vx = 0;
      }
      break;
    }
    case 'dash': {
      const t = f.sf / DASH_FRAMES;
      f.vx = f.dashDir * DASH_SPEED * (1 - t) * (f.back ? 0.85 : 1);
      break;
    }
    case 'dashRec':
      f.vx *= 0.5;
      break;
    case 'attack': {
      const m = MOVES[f.move!];
      if (f.sf === m.startup && m.lunge) f.vx += m.lunge * f.facing;
      if (!f.airborne && !f.recoil) f.vx *= 0.8;
      break;
    }
  }

  f.sf++;

  // afterimages
  if (f.state === 'dash' || (f.state === 'attack' && Math.abs(f.vx) > 3)) {
    f.trail.unshift({ x: f.x, y: f.y, facing: f.facing, body: bodyRect(f) });
    if (f.trail.length > 5) f.trail.pop();
  } else if (f.trail.length) {
    f.trail.pop();
  }
}

function physics(g: Game, f: Fighter) {
  f.x += f.vx;
  if (f.airborne || f.y < GROUND) {
    f.vy += GRAVITY;
    f.y += f.vy;
    f.vx *= 0.99;
    if (f.y < CEIL + BODY_H + 40) {
      f.y = CEIL + BODY_H + 40;
      f.vy = Math.abs(f.vy) * 0.3;
    }
    if (f.y >= GROUND) {
      f.y = GROUND;
      f.vy = 0;
      f.airborne = false;
    }
  } else if (f.state === 'hit' || f.recoil) {
    f.vx *= 0.82;
    if (f.recoil && Math.abs(f.vx) < 0.5) {
      f.recoil = false;
      f.vx = 0;
    }
  }

  const cx = clampX(f.x);
  if (cx !== f.x) {
    // wall: a launched fighter bounces off once per hit
    if (f.state === 'hit' && !f.wallBounced && Math.abs(f.vx) > WALL_BOUNCE_SPEED) {
      f.wallBounced = true;
      // same impact as a hit, where the body meets the wall
      const hs = MOVES.long.hitstop;
      const left = f.x < W / 2;
      g.effects.push({ kind: 'burst', x: left ? WALL_L : WALL_R, y: f.y - BODY_H / 2, t: 0, life: 16 + hs, big: true, dir: left ? 1 : -1 });
      f.vx = -f.vx * 0.35;
      f.vy = Math.min(f.vy, -5);
      f.airborne = true;
      f.hitstun += 12;
      if (!f.ko) f.hp = Math.max(1, f.hp - WALL_DAMAGE);
      g.hitstop = Math.max(g.hitstop, hs);
      g.shake = Math.max(g.shake, hs);
    } else {
      f.vx = 0;
    }
    f.x = cx;
  }
}

function pushApart(a: Fighter, b: Fighter) {
  if (a.airborne || b.airborne || a.ko || b.ko) return;
  const min = HALF_W * 2;
  const d = b.x - a.x;
  if (Math.abs(d) >= min) return;
  const s = d === 0 ? a.facing : Math.sign(d);
  const mid = Math.max(MIN_X + HALF_W, Math.min(MAX_X - HALF_W, (a.x + b.x) / 2));
  a.x = mid - HALF_W * s;
  b.x = mid + HALF_W * s;
}

function resolveHits(g: Game) {
  const [a, b] = g.fighters;
  const pending: { att: Fighter; def: Fighter; hb: Box; move: Move; hurt: Box[]; counter: boolean }[] = [];
  for (const [att, def] of [[a, b], [b, a]] as const) {
    const hb = hitbox(att);
    if (!hb || def.ko) continue;
    if (hurtboxes(def).some((h) => overlap(hb, h))) {
      pending.push({
        att, def, hb, move: MOVES[att.move!], hurt: hurtboxes(def),
        counter: movePhase(def) !== null || def.state === 'dashRec',
      });
    }
  }
  // simultaneous → trade; everything is classified before any mutation
  for (const p of pending) applyHit(g, p.att, p.def, p.hb, p.move, p.hurt, p.counter);
}

function applyHit(g: Game, att: Fighter, def: Fighter, hb: Box, m: Move, hurt: Box[], counter: boolean) {
  att.hasHit = true;

  // first point of contact, measured forward from the attacker
  const contact = Math.min(
    ...hurt
      .filter((h) => overlap(hb, h))
      .map((h) => (att.facing === 1 ? Math.max(hb.x0, h.x0) - att.x : att.x - Math.min(hb.x1, h.x1))),
  );
  const sweet = m.sweet !== undefined && contact >= m.sweet;

  const dmg = Math.round(m.damage * (sweet ? 1.35 : 1) * (counter ? 1.2 : 1));
  def.hp = Math.max(0, def.hp - dmg);
  const kb = m.kb * (sweet ? 1.3 : 1) * (counter ? 1.1 : 1);

  const dir = att.facing;
  const ang = (m.angle * Math.PI) / 180;
  def.vx = Math.cos(ang) * kb * dir;
  def.vy = -Math.sin(ang) * kb;
  def.airborne = true;
  def.recoil = false;
  def.wallBounced = false;
  def.move = null;
  def.buffer = null;
  def.hitstun = Math.floor(kb * 2.4) + 6 + (counter ? 6 : 0);
  def.trail = [];
  setState(def, 'hit');
  def.facing = (-dir) as 1 | -1;

  // equal and opposite: the attacker is knocked back just as far
  att.vx = -def.vx;
  att.vy = def.vy;
  att.airborne = true;
  att.recoil = true;
  att.trail = [];

  if (def.hp <= 0) {
    // finishing blow launches harder
    def.vx *= 1.6;
    def.vy = Math.min(def.vy * 1.6, -8);
  }

  const hs = m.hitstop + (sweet ? 5 : 0) + (counter ? 3 : 0) + (def.hp <= 0 ? 20 : 0);
  g.hitstop = Math.max(g.hitstop, hs);
  g.shake = Math.max(g.shake, hs + (sweet ? 6 : 0));

  g.effects.push({
    kind: 'burst',
    x: att.x + (contact + 6) * dir,
    y: att.y + (m.hit.y0 + m.hit.y1) / 2,
    t: 0, life: 16 + hs, big: sweet || counter || m.id === 'long', dir,
  });
}

function checkKo(g: Game) {
  const down = g.fighters.filter((f) => f.hp <= 0 && !f.ko);
  if (!down.length) return;
  for (const f of down) {
    f.ko = true;
    f.shatter = { x: f.x, y: f.y, vx: f.vx, vy: f.vy, t: 0 };
    f.trail = [];
  }
  g.phase = 'ko';
  g.phaseTimer = KO_FRAMES;
  const alive = g.fighters.filter((f) => !f.ko);
  g.roundWinner = alive.length === 1 ? alive[0].id : null;
  if (g.roundWinner !== null) g.fighters[g.roundWinner].wins++;
}

function afterKo(g: Game) {
  const [a, b] = g.fighters;
  if (a.wins >= ROUNDS_TO_WIN || b.wins >= ROUNDS_TO_WIN) {
    g.phase = 'over';
    g.winner = a.wins > b.wins ? 0 : 1;
    return;
  }
  for (const f of g.fighters) resetFighter(f);
  g.round++;
  g.roundWinner = null;
  g.phase = 'ready';
  g.phaseTimer = READY_FRAMES;
}

function tickCosmetics(g: Game) {
  for (const e of g.effects) e.t++;
  g.effects = g.effects.filter((e) => e.t < e.life);
  if (g.hitstop > 0) return;
  for (const f of g.fighters) {
    if (f.hpTrail > f.hp) f.hpTrail = Math.max(f.hp, f.hpTrail - 0.7);
  }
}
