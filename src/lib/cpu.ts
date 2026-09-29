import { MOVES, HALF_W, hurtboxes, movePhase, totalFrames, type Fighter, type Game, type Input } from './engine';

// CPU opponent. Each level learns one more tactic on top of the last:
//   Lv1  wanders and throws attacks at random
//   Lv2  + 間合い: attacks only when the move reaches, holds long range
//   Lv3  + 差し込み: sticks an attack out as the opponent steps or dashes in
//   Lv4  + 差し返し: answers a whiff with whichever attack still lands
//   Lv5  nothing new: every tactic at 90%
// A tactic is rough on the level that learns it and sharpens on the levels after.
export type CpuLevel = 1 | 2 | 3 | 4 | 5;

export interface CpuMemory {
  level: CpuLevel;
  plan: { at: number; input: Partial<Input> }[];
  walk: -1 | 0 | 1; // Lv1's current wandering direction (relative to the opponent)
  walkUntil: number;
  whiffSeen: number; // tick the opponent became punishable, -1 when not
  wasIn: boolean; // opponent was already inside long range last frame
  dashSeen: number; // tick the opponent's forward dash was first seen, -1 when not
  cooldown: number;
  error: number; // current distance misjudgement, re-rolled every half second
  drift: number; // current offset of the preferred spot
}

export const newCpuMemory = (level: CpuLevel = 2): CpuMemory => ({
  level, plan: [], walk: 1, walkUntil: 0, whiffSeen: -1, wasIn: false, dashSeen: -1, cooldown: 0, error: 0, drift: 0,
});

const SHORT = MOVES.short.hit.x1; // reach from my centre
const LONG = MOVES.long.hit.x1;
const DASH_SHORT = 190; // how far a dash into short covers, measured to the opponent's body
// 間合い: how far off its sense of distance is, and how much its preferred spot drifts (px)
const MISJUDGE: Record<CpuLevel, number> = { 1: 0, 2: 40, 3: 15, 4: 0, 5: 0 };
const DRIFT: Record<CpuLevel, number> = { 1: 0, 2: 50, 3: 20, 4: 5, 5: 3 };
// 差し込み: frames to recognise a dash in, and how often it follows through
const READ_DASH: Record<CpuLevel, number> = { 1: 0, 2: 0, 3: 8, 4: 4, 5: 3 };
const STICK: Record<CpuLevel, number> = { 1: 0, 2: 0, 3: 0.4, 4: 0.7, 5: 0.9 };
// 差し返し: frames to react to a whiff, and how often it follows through
const REACT: Record<CpuLevel, number> = { 1: 0, 2: 0, 3: 0, 4: 16, 5: 11 };
const PUNISH: Record<CpuLevel, number> = { 1: 0, 2: 0, 3: 0, 4: 0.7, 5: 0.9 };

// distance from my centre to the nearest part of the opponent's body, stretched parts included
function gapTo(me: Fighter, op: Fighter): number {
  const boxes = hurtboxes(op);
  if (!boxes.length) return Infinity;
  return op.x >= me.x
    ? Math.min(...boxes.map((b) => b.x0)) - me.x
    : me.x - Math.max(...boxes.map((b) => b.x1));
}

// frames until the opponent can act again
function recoveryLeft(op: Fighter): number {
  if (op.state === 'attack' && op.move) return totalFrames(MOVES[op.move]) - op.sf;
  if (op.state === 'dashRec') return (op.back ? 11 : 7) - op.sf;
  return 0;
}

export function cpuInput(g: Game, id: 0 | 1, mem: CpuMemory): Input {
  const me = g.fighters[id];
  const op = g.fighters[1 - id];
  const input: Input = { left: false, right: false, short: false, long: false, dash: false };
  if (g.phase !== 'fight') return input;

  // scripted follow-ups (the short attack after a dash)
  const due = mem.plan.filter((p) => p.at <= g.tick);
  mem.plan = mem.plan.filter((p) => p.at > g.tick);
  if (due.length) {
    for (const p of due) Object.assign(input, p.input);
    return input;
  }
  if (mem.plan.length) return input;

  const toward = op.x >= me.x ? 1 : -1;
  const hold = (d: number): Partial<Input> => (d > 0 ? { right: true } : d < 0 ? { left: true } : {});
  const free = (me.state === 'idle' || me.state === 'walk') && !me.airborne && !me.recoil;
  const gap = Math.abs(op.x - me.x) - HALF_W; // to the opponent's body proper
  const dashIn = (): Input => {
    mem.plan.push({ at: g.tick + 5, input: { short: true } });
    return { ...input, ...hold(toward), dash: true };
  };

  // --- Lv4: 差し返し — punish whiffs
  const vulnerable = movePhase(op) === 'recovery' || op.state === 'dashRec';
  if (!vulnerable) mem.whiffSeen = -1;
  else if (mem.whiffSeen < 0) mem.whiffSeen = g.tick;
  if (mem.level >= 4 && free && vulnerable && g.tick - mem.whiffSeen === REACT[mem.level] && Math.random() < PUNISH[mem.level]) {
    const reach = gapTo(me, op);
    const left = recoveryLeft(op);
    if (reach < SHORT - 4 && left >= 5) return { ...input, short: true };
    if (reach < DASH_SHORT && left >= 10) return dashIn();
    if (reach < LONG - 4 && left >= 17) return { ...input, long: true };
  }

  // --- Lv3: 差し込み — hit the opponent as they come into range
  const dashingIn = op.state === 'dash' && !op.back;
  if (!dashingIn) mem.dashSeen = -1;
  else if (mem.dashSeen < 0) mem.dashSeen = g.tick;
  const inLong = gap >= SHORT - 4 && gap < LONG - 4;
  const steppedIn = inLong && !mem.wasIn && op.state === 'walk' && Math.sign(op.vx) === -toward;
  mem.wasIn = inLong;
  if (mem.level >= 3 && free) {
    // their dash covers ~160: long started now is out as they arrive
    if (dashingIn && g.tick - mem.dashSeen === READ_DASH[mem.level] && gap < LONG + 160 && Math.random() < STICK[mem.level]) {
      return { ...input, long: true };
    }
    if (steppedIn && Math.random() < STICK[mem.level]) return { ...input, long: true };
  }

  if (!free) return input;
  if (mem.cooldown > 0) mem.cooldown--;

  // --- Lv1: wander, attack at random
  if (mem.level === 1) {
    if (g.tick >= mem.walkUntil) {
      const r = Math.random();
      mem.walk = r < 0.55 ? 1 : r < 0.8 ? 0 : -1;
      mem.walkUntil = g.tick + 20 + Math.floor(Math.random() * 50);
    }
    if (mem.cooldown <= 0 && Math.random() < 0.03) {
      mem.cooldown = 20;
      return { ...input, [Math.random() < 0.5 ? 'short' : 'long']: true };
    }
    if (mem.cooldown <= 0 && Math.random() < 0.004) {
      mem.cooldown = 20;
      return { ...input, ...hold(toward), dash: true };
    }
    return { ...input, ...hold(mem.walk * toward) };
  }

  // --- Lv2+: spacing — attack only with a move that (it thinks) reaches, hold long range
  if (g.tick % 30 === 0) {
    mem.error = (Math.random() * 2 - 1) * MISJUDGE[mem.level];
    mem.drift = (Math.random() * 2 - 1) * DRIFT[mem.level];
  }
  const seen = gap + mem.error;
  if (seen < SHORT - 4 && mem.cooldown <= 0 && Math.random() < 0.3) {
    mem.cooldown = 10;
    return { ...input, short: true };
  }
  if (seen >= SHORT && seen < LONG && mem.cooldown <= 0 && Math.random() < 0.12) {
    mem.cooldown = 30;
    return { ...input, long: true };
  }
  if (gap > SHORT + 20 && gap < DASH_SHORT && mem.cooldown <= 0 && Math.random() < 0.01) {
    mem.cooldown = 40;
    return dashIn();
  }
  // stand where long reaches but a dash into short doesn't; don't stall there forever
  const want = 200 + mem.drift;
  if (me.state === 'idle' && me.sf > 60) return { ...input, ...hold(toward) };
  if (gap > want + 6) return { ...input, ...hold(toward) };
  if (gap < want - 6) return { ...input, ...hold(-toward) };
  return input;
}
