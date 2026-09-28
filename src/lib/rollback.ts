// Rollback netcode (GGPO-style) over the deterministic engine.
// Only inputs cross the wire. Missing remote inputs are predicted; when the real
// ones arrive and differ, the game is restored to the snapshot before that frame
// and re-simulated up to the present.
import { newGame, step, type Game, type Input } from './engine';

export const INPUT_DELAY = 2; // local inputs apply this many frames later
const MAX_ROLLBACK = 8; // never predict further ahead than this
const HASH_EVERY = 30; // desync check interval (frames)
const MAX_RESEND = 16;

const HELD = 1 | 2; // left/right carry over when predicting; button presses don't

export const encode = (i: Input) =>
  (i.left ? 1 : 0) | (i.right ? 2 : 0) | (i.short ? 4 : 0) | (i.long ? 8 : 0) | (i.dash ? 16 : 0);
const decode = (b: number): Input => ({
  left: !!(b & 1), right: !!(b & 2), short: !!(b & 4), long: !!(b & 8), dash: !!(b & 16),
});

export type Packet =
  | { t: 'in'; s: number; b: number[]; f: number; adv: number; ack: number } // inputs for frames s.., sender frame, advantage, confirmed
  | { t: 'h'; f: number; h: number }; // state hash after frame f

function hash(g: Game): number {
  // FNV-1a over the gameplay-relevant state
  const s = JSON.stringify(g.fighters.map((f) => [f.x, f.y, f.vx, f.vy, f.hp, f.state, f.sf, f.move, f.wins]));
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

export class Rollback {
  game: Game = newGame();
  frame = 0; // next frame to simulate
  desynced = false;

  private inputs: [Map<number, number>, Map<number, number>] = [new Map(), new Map()];
  private used = new Map<number, number>(); // remote input actually used for frame f
  private snaps = new Map<number, Game>(); // state before frame f
  private confirmed = INPUT_DELAY - 1; // remote inputs known for every frame up to here
  private rollbackFrom: number | null = null;
  private remoteFrame = 0;
  private remoteAdv = 0;
  private remoteAck = -1; // remote has our inputs up to here
  private nextHash = HASH_EVERY;
  private hashes = new Map<number, number>();
  private remoteHashes = new Map<number, number>();

  readonly me: 0 | 1;
  private send: (p: Packet) => void;

  constructor(me: 0 | 1, send: (p: Packet) => void) {
    this.me = me;
    this.send = send;
    // the first INPUT_DELAY frames are empty for both sides
    for (let f = 0; f < INPUT_DELAY; f++) {
      this.inputs[0].set(f, 0);
      this.inputs[1].set(f, 0);
    }
  }

  private get them(): 0 | 1 {
    return this.me === 0 ? 1 : 0;
  }

  /** Advance one frame with the local input. Returns false when waiting on the peer. */
  tick(local: Input): boolean {
    const adv = this.frame - this.remoteFrame;
    const stall =
      this.frame - this.confirmed > MAX_ROLLBACK || // too far ahead of what we know
      ((adv - this.remoteAdv) / 2 >= 1 && this.frame % 8 === 0); // we're running ahead: let them catch up
    if (stall) {
      this.sendInputs();
      return false;
    }

    this.inputs[this.me].set(this.frame + INPUT_DELAY, encode(local));
    this.sendInputs();
    this.resolveRollback();
    this.simulate(this.frame);
    this.frame++;
    this.checkHashes();
    this.prune();
    return true;
  }

  receive(p: Packet) {
    if (p.t === 'h') {
      this.remoteHashes.set(p.f, p.h);
      this.compare(p.f);
      return;
    }
    const theirs = this.inputs[this.them];
    p.b.forEach((bits, i) => {
      const f = p.s + i;
      if (theirs.has(f)) return;
      theirs.set(f, bits);
      const guess = this.used.get(f);
      if (guess !== undefined && guess !== bits) {
        this.rollbackFrom = this.rollbackFrom === null ? f : Math.min(this.rollbackFrom, f);
      }
    });
    while (theirs.has(this.confirmed + 1)) this.confirmed++;
    this.remoteFrame = Math.max(this.remoteFrame, p.f);
    this.remoteAdv = p.adv;
    this.remoteAck = Math.max(this.remoteAck, p.ack);
  }

  private inputsAt(f: number): [Input, Input] {
    const mine = this.inputs[this.me].get(f) ?? 0;
    let theirs = this.inputs[this.them].get(f);
    if (theirs === undefined) theirs = (this.inputs[this.them].get(this.confirmed) ?? 0) & HELD;
    this.used.set(f, theirs);
    return this.me === 0 ? [decode(mine), decode(theirs)] : [decode(theirs), decode(mine)];
  }

  private simulate(f: number) {
    this.snaps.set(f, structuredClone(this.game));
    step(this.game, this.inputsAt(f));
  }

  private resolveRollback() {
    const from = this.rollbackFrom;
    this.rollbackFrom = null;
    if (from === null || from >= this.frame) return;
    const snap = this.snaps.get(from);
    if (!snap) return; // older than we keep; can't happen while MAX_ROLLBACK holds
    this.game = structuredClone(snap);
    for (let f = from; f < this.frame; f++) this.simulate(f);
  }

  private sendInputs() {
    const mine = this.inputs[this.me];
    const last = this.frame + INPUT_DELAY - 1;
    const s = Math.max(this.remoteAck + 1, last - MAX_RESEND + 1, 0);
    const b: number[] = [];
    for (let f = s; f <= last; f++) b.push(mine.get(f) ?? 0);
    this.send({ t: 'in', s, b, f: this.frame, adv: this.frame - this.remoteFrame, ack: this.confirmed });
  }

  private checkHashes() {
    // every frame up to `confirmed` has been simulated with real inputs on both sides
    while (this.nextHash <= this.confirmed && this.nextHash < this.frame) {
      const f = this.nextHash;
      this.nextHash += HASH_EVERY;
      const after = f + 1 === this.frame ? this.game : this.snaps.get(f + 1);
      if (!after) continue;
      const h = hash(after);
      this.hashes.set(f, h);
      this.send({ t: 'h', f, h });
      this.compare(f);
    }
  }

  private compare(f: number) {
    const a = this.hashes.get(f);
    const b = this.remoteHashes.get(f);
    if (a === undefined || b === undefined) return;
    if (a !== b && !this.desynced) {
      this.desynced = true;
      console.warn(`desync at frame ${f}`);
    }
    this.hashes.delete(f);
    this.remoteHashes.delete(f);
  }

  private prune() {
    const keep = Math.min(this.confirmed, this.remoteAck) - 2;
    for (const m of [this.snaps, this.used, this.inputs[0], this.inputs[1]]) {
      for (const f of m.keys()) if (f < keep) m.delete(f);
    }
  }
}
