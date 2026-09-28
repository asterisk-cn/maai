// Damage cracks (a fixed pattern) and seeded shatter shards.
// Shards use unit-square coords (u: 0 = back → 1 = front, v: 0 = top → 1 = bottom)
// so they follow the body's proportions. Cracks are rigid pixel-space lines anchored to
// the outline, so they stay crisp when the body stretches.

export type Pt = [number, number];

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

// ---------------------------------------------------------------- cracks

// One damage stage: a lightning-bolt crack starting on the outline.
export type Side = 'top' | 'right' | 'bottom' | 'left';
export interface Crack {
  side: Side;
  u: number; // 0..1 along that side (left→right / top→bottom)
  // Polyline in the bolt frame: +x = inward normal of the anchor edge, +y = along it.
  bolt: Pt[];
}

// Fixed pattern, one crack per damage stage (bolt frame: +x into the body, +y along the side).
// Kept short and on separate parts of the outline so they never meet on the 60px body.
export const CRACKS: Crack[] = [
  { side: 'top', u: 0.82, bolt: [[0, 0], [5, -3], [10, 2]] },
  { side: 'right', u: 0.62, bolt: [[0, 0], [7, 4], [12, -2], [18, 3]] },
  { side: 'bottom', u: 0.28, bolt: [[0, 0], [7, -4], [13, 3], [20, -3], [28, 2]] },
];

// ---------------------------------------------------------------- shards

export interface Shard {
  pts: Pt[];
  c: Pt; // centroid
  speed: number;
  lift: number;
  spin: number;
}

export function makeShards(seed: number, n = 11): Shard[] {
  const r = rng(seed);
  const center: Pt = [0.5 + (r() - 0.5) * 0.2, 0.5 + (r() - 0.5) * 0.2];

  // perimeter walked clockwise from the top-left corner, length 4
  const at = (d: number): Pt => {
    d = ((d % 4) + 4) % 4;
    if (d < 1) return [d, 0];
    if (d < 2) return [1, d - 1];
    if (d < 3) return [3 - d, 1];
    return [0, 4 - d];
  };
  const splits = Array.from({ length: n }, (_, i) => ((i + 0.2 + r() * 0.6) / n) * 4);
  const ring = splits.map((d): Pt => {
    const p = at(d);
    const k = 0.35 + r() * 0.3;
    return [center[0] + (p[0] - center[0]) * k, center[1] + (p[1] - center[1]) * k];
  });

  const shards: Shard[] = [];
  const push = (pts: Pt[]) => {
    const c: Pt = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
    shards.push({ pts, c, speed: 0.6 + r() * 0.8, lift: r(), spin: (r() - 0.5) * 0.5 });
  };

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const d0 = splits[i];
    const d1 = j === 0 ? splits[0] + 4 : splits[j];
    push([center, ring[i], ring[j]]);
    const outer: Pt[] = [ring[i], at(d0)];
    for (let corner = Math.ceil(d0); corner < d1; corner++) outer.push(at(corner));
    outer.push(at(d1), ring[j]);
    push(outer);
  }
  return shards;
}
