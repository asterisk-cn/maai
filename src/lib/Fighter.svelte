<script lang="ts">
  import { BODY_H, HALF_W, GROUND, DASH_SPEED, DASH_RECOVERY, BACKDASH_RECOVERY, WALL_L, WALL_R, MAX_HP, bodyRect, type Fighter } from './engine';
  import { CRACKS, makeShards, type Pt } from './breakage';

  let { f, color }: { f: Fighter; color: string } = $props();

  // `f` is a fresh snapshot every frame; go through `id` so the shards are built once
  const id = $derived(f.id);
  const SHARDS = $derived(makeShards(id * 104729 + 3));
  const GRAVITY = 0.5;

  const r = $derived(bodyRect(f));

  // cosmetic squash & stretch for non-attack states
  // dash: stretch with speed; recovery: a braking squash that eases out exactly
  // when the fighter can act again, so the dead frames read as dead
  const dashK = $derived(f.state === 'dash' ? Math.min(1, Math.abs(f.vx) / DASH_SPEED) : 0);
  const brake = $derived(
    f.state === 'dashRec' ? 1 - f.sf / (f.back ? BACKDASH_RECOVERY : DASH_RECOVERY) : 0,
  );

  const scale = $derived.by((): [number, number] => {
    if (f.state === 'dash') return [1 + 0.26 * dashK, 1 - 0.18 * dashK];
    if (f.state === 'dashRec') return [1 + 0.14 * brake, 1 - 0.16 * brake];
    if (f.state === 'hit' && f.sf < 8) return [0.85, 1.12];
    return [1, 1];
  });

  const spin = $derived(
    f.state === 'hit' && f.airborne ? -Math.min(160, f.sf * Math.hypot(f.vx, f.vy) * 0.9)
    : f.state === 'dash' ? (f.back ? -6 : 8) * (0.4 + 0.6 * dashK)
    : f.state === 'dashRec' ? (f.back ? 7 : -9) * brake // lean against the slide
    : 0,
  );

  // keep a spinning / squashed body visually inside the room (collision uses the upright square)
  const nudge = $derived.by((): [number, number] => {
    if (f.state !== 'hit') return [0, 0];
    const a = (spin * Math.PI) / 180;
    const hw = ((r.x1 - r.x0) / 2) * scale[0];
    const hh = (r.h / 2) * scale[1];
    const ex = hw * Math.abs(Math.cos(a)) + hh * Math.abs(Math.sin(a));
    const ey = hw * Math.abs(Math.sin(a)) + hh * Math.abs(Math.cos(a));
    const cx = f.x + ((r.x0 + r.x1) / 2) * f.facing;
    const cy = f.y - BODY_H / 2;
    const dx = Math.max(0, WALL_L - (cx - ex)) - Math.max(0, cx + ex - WALL_R);
    const dy = -Math.max(0, cy + ey - GROUND);
    return [dx * f.facing, dy]; // local x is mirrored by facing
  });

  const flash = $derived(f.state === 'hit' && f.sf < 6);
  const midY = -BODY_H / 2;
  const inset = $derived(Math.min(9, r.h / 4));

  // ---- cracks: one more stage appears at each third of HP lost
  const shown = $derived(Math.ceil((1 - f.hp / MAX_HP) * CRACKS.length));
  // point strings never change, only the anchor transforms do
  const CRACK_PTS = CRACKS.map((c) => c.bolt.map((p) => p.join(',')).join(' '));
  // cracks keep their shape; they only shrink uniformly when the body is squashed thin
  const cs = $derived(Math.max(0.5, Math.min(1, r.h / BODY_H)));
  const cracks = $derived.by(() =>
    CRACKS.slice(0, shown).map((c, i) => {
      const w = r.x1 - r.x0;
      // anchor on the outline; the bolt frame's +x points into the body
      const [ax, ay, rot] =
        c.side === 'top' ? [r.x0 + c.u * w, -r.h, 90]
        : c.side === 'bottom' ? [r.x0 + c.u * w, 0, -90]
        : c.side === 'left' ? [r.x0, -r.h + c.u * r.h, 0]
        : [r.x1, -r.h + c.u * r.h, 180];
      return {
        bolt: CRACK_PTS[i],
        boltT: `translate(${ax} ${ay}) rotate(${rot}) scale(${cs})`,
      };
    }),
  );

  // ---- shatter: each shard flies ballistically from where the body broke
  const toSquare = (p: Pt): Pt => [-HALF_W + p[0] * HALF_W * 2, -BODY_H + p[1] * BODY_H];
  const shards = $derived.by(() => {
    const s = f.shatter;
    if (!s) return [];
    const floor = GROUND - s.y;
    const minX = (f.facing === 1 ? WALL_L - s.x : s.x - WALL_R) + 8;
    const maxX = (f.facing === 1 ? WALL_R - s.x : s.x - WALL_L) - 8;
    const hvx = s.vx * f.facing; // local-forward velocity at the moment of KO
    return SHARDS.map((sh) => {
      const c = toSquare(sh.c);
      const ox = sh.c[0] - 0.5;
      const oy = sh.c[1] - 0.5;
      const vx = hvx * 0.55 + ox * 14 * sh.speed;
      const vy = Math.min(s.vy, 0) * 0.5 + oy * 8 * sh.speed - 3 - 5 * sh.lift;
      // time until this shard reaches the floor
      const land = (-vy + Math.sqrt(vy * vy + 2 * GRAVITY * Math.max(0, floor - c[1]))) / GRAVITY;
      const t = Math.min(s.t, land);
      const slide = Math.max(0, s.t - land);
      let x = c[0] + vx * t + vx * 0.25 * Math.min(slide, 8);
      const y = c[1] + vy * t + 0.5 * GRAVITY * t * t;
      // bounce off the walls instead of piling up against them
      if (x > maxX) x = maxX - Math.min(maxX - minX, (x - maxX) * 0.45);
      if (x < minX) x = minX + Math.min(maxX - minX, (minX - x) * 0.45);
      const rot = sh.spin * 40 * t;
      return {
        points: sh.pts.map((p) => toSquare(p).join(',')).join(' '),
        transform: `translate(${x - c[0]} ${y - c[1]}) rotate(${rot} ${c[0]} ${c[1]})`,
      };
    });
  });
</script>

<g transform="translate({f.x} {f.y}) scale({f.facing} 1)">
  {#if f.shatter}
    {#each shards as s, i (i)}
      <polygon points={s.points} transform={s.transform} fill={color}
        stroke="#0d1017" stroke-width="3" stroke-linejoin="round" />
    {/each}
  {:else}
    <ellipse cx={(r.x0 + r.x1) / 2} cy="2"
      rx={(r.x1 - r.x0) / 2 + 6 - Math.min(20, (GROUND - f.y) / 10)} ry="5" fill="#000" opacity="0.35" />

    <g transform="translate({nudge[0]} {nudge[1]}) rotate({spin} 0 {midY}) scale({scale[0]} {scale[1]})">
      <rect x={r.x0} y={-r.h} width={r.x1 - r.x0} height={r.h} rx="6" fill={flash ? '#ffffff' : color} />
      <rect x={r.x0} y={-r.h} width={r.x1 - r.x0} height={r.h} rx="6" fill="url(#shade)" />
      <rect x={r.x0 + inset} y={-r.h + inset} width={r.x1 - r.x0 - inset * 2} height={r.h - inset * 2} rx="3"
        fill="none" stroke="#0d1017" stroke-opacity="0.3" stroke-width="2" />
      {#if cracks.length}
        <clipPath id="crack-clip-{id}">
          <rect x={r.x0} y={-r.h} width={r.x1 - r.x0} height={r.h} rx="6" />
        </clipPath>
        <g clip-path="url(#crack-clip-{id})">
          {#each cracks as c, i (i)}
            <g transform={c.boltT} fill="none" stroke-linejoin="round" stroke-linecap="round">
              <polyline points={c.bolt} stroke="#0d1017" stroke-width="3.5" />
            </g>
          {/each}
        </g>
      {/if}
    </g>
  {/if}
</g>
