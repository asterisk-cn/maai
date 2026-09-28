import { MOVES, HALF_W, WALL_L, WALL_R, movePhase, type Game, type Input } from './engine';

// Simple spacing CPU: hovers just outside long range, whiff-punishes with a human-ish delay.
export interface CpuMemory {
  plan: { at: number; input: Partial<Input> }[];
  whiffSeen: number; // tick the opponent's recovery was first seen
  cooldown: number;
  jitter: number;
}

export const newCpuMemory = (): CpuMemory => ({ plan: [], whiffSeen: -1, cooldown: 0, jitter: 0 });

const REACTION = 11;
const LONG_REACH = MOVES.long.hit.x1 + HALF_W;

export function cpuInput(g: Game, id: 0 | 1, mem: CpuMemory): Input {
  const me = g.fighters[id];
  const op = g.fighters[1 - id];
  const input: Input = { left: false, right: false, short: false, long: false, dash: false };
  if (g.phase !== 'fight') return input;

  const due = mem.plan.filter((p) => p.at <= g.tick);
  mem.plan = mem.plan.filter((p) => p.at > g.tick);
  for (const p of due) Object.assign(input, p.input);
  if (due.length) return input;
  if (mem.plan.length || g.hitstop > 0) return input;

  const toward = op.x >= me.x ? 1 : -1;
  const dist = Math.abs(op.x - me.x);
  const hold = (d: number) => (d > 0 ? { right: true } : d < 0 ? { left: true } : {});
  const free = me.state === 'idle' || me.state === 'walk';

  // --- whiff punish
  const opPhase = movePhase(op);
  const vulnerable = opPhase === 'recovery' || op.state === 'dashRec';
  if (vulnerable) {
    if (mem.whiffSeen < 0) mem.whiffSeen = g.tick;
  } else {
    mem.whiffSeen = -1;
  }
  if (free && vulnerable && g.tick - mem.whiffSeen >= REACTION && Math.random() < 0.7) {
    mem.whiffSeen = Number.POSITIVE_INFINITY; // one decision per whiff
    if (dist < 100) return { ...input, short: true };
    if (dist < LONG_REACH - 10) return { ...input, long: true };
    if (dist < 280) {
      mem.plan.push({ at: g.tick + 5, input: { short: true } });
      return { ...input, ...hold(toward), dash: true };
    }
  }

  if (!free) return input;
  if (mem.cooldown > 0) mem.cooldown--;

  // --- danger: opponent winding up the long poke near us → step back
  if (opPhase === 'startup' && op.move === 'long' && dist < LONG_REACH + 20 && Math.random() < 0.25) {
    if (dist < 90) return { ...input, short: true }; // mash through slow startup
    return { ...input, ...hold(-toward) };
  }

  // --- close range
  if (dist < 100 && mem.cooldown <= 0) {
    mem.cooldown = 12;
    const r = Math.random();
    if (r < 0.5) return { ...input, short: true };
    if (r < 0.7) return { ...input, ...hold(-toward), dash: true };
  }

  // --- tip poke
  if (dist > MOVES.long.sweet! && dist < LONG_REACH && mem.cooldown <= 0 && Math.random() < 0.06) {
    mem.cooldown = 30;
    return { ...input, long: true };
  }

  // --- occasional dash-in from mid range
  if (dist > 200 && dist < 300 && mem.cooldown <= 0 && Math.random() < 0.012) {
    mem.cooldown = 40;
    mem.plan.push({ at: g.tick + 5, input: { short: true } });
    return { ...input, ...hold(toward), dash: true };
  }

  // --- spacing
  if (g.tick % 40 === 0) mem.jitter = (Math.random() - 0.5) * 70;
  const want = LONG_REACH + 15 + mem.jitter;
  const cornered = me.x < WALL_L + 110 || me.x > WALL_R - 110;
  if (cornered && dist > 130) return { ...input, ...hold(toward) };
  if (dist > want + 20) return { ...input, ...hold(toward) };
  if (dist < want - 20 && !cornered) return { ...input, ...hold(-toward) };
  return input;
}
