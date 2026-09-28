<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import {
    FPS, W, H, GROUND, WALL_L, WALL_R, CEIL, MAX_HP, ROUNDS_TO_WIN, MOVES, HALF_W, BODY_H,
    newGame, step, hitbox, hurtboxes, type Game, type Input, type Effect,
  } from './lib/engine';
  import { cpuInput, newCpuMemory } from './lib/cpu';
  import Fighter from './lib/Fighter.svelte';
  import Pad from './lib/Pad.svelte';

  const COLORS: [string, string] = ['#4cc9f0', '#ff6b5b'];
  const STEP_MS = 1000 / FPS;

  type Action = 'left' | 'right' | 'short' | 'long' | 'dash';
  const KEYS: Record<Action, string>[] = [
    { left: 'KeyA', right: 'KeyD', short: 'KeyF', long: 'KeyG', dash: 'KeyH' },
    { left: 'ArrowLeft', right: 'ArrowRight', short: 'Comma', long: 'Period', dash: 'Slash' },
  ];
  const LABELS: Record<Action, string>[] = [
    { left: 'A', right: 'D', short: 'F', long: 'G', dash: 'H' },
    { left: '←', right: '→', short: ',', long: '.', dash: '/' },
  ];

  type Mode = 'title' | 'cpu' | 'versus';
  let mode = $state<Mode>('title');
  let paused = $state(false);
  let showBoxes = $state(false);

  let game: Game = newGame();
  let view = $state.raw<Game>(structuredClone(game));
  let cpu = newCpuMemory();

  const held = new SvelteSet<string>();
  const pressed = new Set<string>();
  let stepOnce = false;

  function readPlayer(p: 0 | 1): Input {
    // solo play: 1P may also use the 2P keys
    const sets = mode === 'cpu' && p === 0 ? [KEYS[0], KEYS[1]] : [KEYS[p]];
    const h = (a: Action) => sets.some((k) => held.has(k[a]));
    const pr = (a: Action) => sets.some((k) => pressed.has(k[a]));
    return { left: h('left'), right: h('right'), short: pr('short'), long: pr('long'), dash: pr('dash') };
  }

  function tick() {
    const p1 = readPlayer(0);
    const p2 = mode === 'cpu' ? cpuInput(game, 1, cpu) : readPlayer(1);
    step(game, [p1, p2]);
    pressed.clear();
  }

  function start(m: Mode) {
    mode = m;
    game = newGame();
    cpu = newCpuMemory();
    paused = false;
    view = structuredClone(game);
  }

  function press(code: string, down: boolean) {
    if (!down) { held.delete(code); return; }
    held.add(code);
    pressed.add(code);
  }

  function onKey(e: KeyboardEvent, down: boolean) {
    if (mode === 'title') return;
    const bound = KEYS.some((k) => Object.values(k).includes(e.code));
    if (bound || ['Space', 'Enter', 'KeyP', 'Escape', 'BracketRight', 'Digit0'].includes(e.code)) e.preventDefault();
    if (down && e.repeat) return;
    press(e.code, down);
    if (!down) return;
    if (e.code === 'KeyP' || e.code === 'Escape') paused = !paused;
    if (e.code === 'BracketRight' && paused) stepOnce = true;
    if (e.code === 'Digit0') showBoxes = !showBoxes;
    if (game.phase === 'over' && e.code === 'Enter') start(mode);
  }

  onMount(() => {
    if (import.meta.env.DEV) {
      Object.assign(window, {
        __game: () => game,
        __step: (n = 1) => { for (let i = 0; i < n; i++) tick(); view = structuredClone(game); },
      });
    }
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const loop = (now: number) => {
      acc = Math.min(acc + (now - last), STEP_MS * 5); // don't spiral after a tab switch
      last = now;
      if (mode !== 'title') {
        if (paused) {
          acc = 0;
          if (stepOnce) { tick(); stepOnce = false; view = structuredClone(game); }
        } else {
          let n = 0;
          while (acc >= STEP_MS) { tick(); acc -= STEP_MS; n++; }
          if (n) view = structuredClone(game);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const kd = (e: KeyboardEvent) => onKey(e, true);
    const ku = (e: KeyboardEvent) => onKey(e, false);
    const blur = () => held.clear();
    addEventListener('keydown', kd);
    addEventListener('keyup', ku);
    addEventListener('blur', blur);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener('keydown', kd);
      removeEventListener('keyup', ku);
      removeEventListener('blur', blur);
    };
  });

  const shake = $derived(
    view.shake > 0
      ? `translate(${Math.sin(view.shake * 7.3) * view.shake * 0.5} ${Math.cos(view.shake * 5.1) * view.shake * 0.35})`
      : '',
  );

  // --- impact spark -------------------------------------------------------
  // A hit is a sharp 4-point spark skewed along the hit direction, plus thin
  // shards thrown the same way. It pops at full size for 2 frames, snaps down,
  // holds briefly and cuts out; the shards shoot out fast and shorten as they go.
  const SPARK_FRAMES = 12; // spark body is gone after this many frames
  const SHARD_FRAMES = 15; // shards are gone after this many frames

  // stable per-effect variation (no randomness: derived from spawn position)
  function sparkSeed(e: Effect) {
    return ((Math.abs(e.x * 7 + e.y * 13) | 0) % 5) - 2; // -2..2
  }

  function sparkScale(t: number) {
    if (t < 2) return 1.15; // flash frames
    const u = (t - 2) / (SPARK_FRAMES - 2);
    if (u >= 1) return 0;
    return 0.72 * (1 - u * u * u); // hold, then quick collapse
  }

  // asymmetric 4-point star: long leading spike along dir, short trailing spike
  function sparkPoints(e: Effect, r: number) {
    const rot = sparkSeed(e) * 0.06;
    const radii = [1, 0.13, 0.62, 0.13, 0.5, 0.13, 0.62, 0.13];
    const pts: string[] = [];
    for (let i = 0; i < 8; i++) {
      const a = rot + (i * Math.PI) / 4;
      const rr = r * radii[i];
      pts.push(`${e.x + Math.cos(a) * rr * e.dir},${e.y + Math.sin(a) * rr}`);
    }
    return pts.join(' ');
  }

  // shard i of n: a thin wedge flying outward, ease-out, shrinking to nothing
  function shardPoints(e: Effect, i: number, n: number, r: number) {
    const u = Math.min(1, e.t / SHARD_FRAMES);
    const ease = 1 - (1 - u) * (1 - u) * (1 - u);
    const spread = (i / (n - 1) - 0.5) * 1.6 + sparkSeed(e) * 0.05 + ((i * 7) % 3 - 1) * 0.12;
    const ca = Math.cos(spread) * e.dir;
    const sa = Math.sin(spread);
    const d = r * (0.6 + 2.4 * ease);
    const len = r * (0.9 + 0.3 * ((i * 5) % 3)) * (1 - u);
    const w = (e.big ? 3 : 2) * (1 - u * 0.5);
    const bx = e.x + ca * d, by = e.y + sa * d;
    const tx = bx + ca * len, ty = by + sa * len;
    return `${bx - sa * w},${by + ca * w} ${tx},${ty} ${bx + sa * w},${by - ca * w}`;
  }
</script>

<main>
  {#if mode !== 'title'}
    <header>
      {#each view.fighters as f (f.id)}
        <div class="hud" class:right={f.id === 1} style:--pc={COLORS[f.id]}>
          <div class="bar">
            <div class="trail" style:width="{(f.hpTrail / MAX_HP) * 100}%"></div>
            <div class="hp" class:low={f.hp <= 30} style:width="{(f.hp / MAX_HP) * 100}%"></div>
          </div>
          <div class="wins">
            {#each Array(ROUNDS_TO_WIN) as _, i (i)}
              <span class:won={i < f.wins}></span>
            {/each}
          </div>
        </div>
      {/each}
    </header>
  {/if}

  <div class="stage-wrap">
    <svg viewBox="0 0 {W} {H}" class="stage">
      <defs>
        <linearGradient id="shade" x1="0" x2="1">
          <stop offset="0" stop-color="#000" stop-opacity="0" />
          <stop offset="1" stop-color="#000" stop-opacity="0.28" />
        </linearGradient>
        <linearGradient id="back" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#141824" />
          <stop offset="1" stop-color="#1d2332" />
        </linearGradient>
        <pattern id="tiles" width="60" height="60" patternUnits="userSpaceOnUse">
          <path d="M60 0H0V60" fill="none" stroke="#ffffff" stroke-opacity="0.04" />
        </pattern>
        <clipPath id="room">
          <rect x={WALL_L} y={CEIL} width={WALL_R - WALL_L} height={H - CEIL} />
        </clipPath>
      </defs>

      <g transform={shake}>
        <!-- room -->
        <rect x={-40} y={-40} width={W + 80} height={H + 80} fill="#0b0e15" />
        <rect x={WALL_L} y={CEIL} width={WALL_R - WALL_L} height={GROUND - CEIL} fill="url(#back)" />
        <rect x={WALL_L} y={CEIL} width={WALL_R - WALL_L} height={GROUND - CEIL} fill="url(#tiles)" />
        {#each [0.25, 0.5, 0.75] as t (t)}
          <line x1={WALL_L + (WALL_R - WALL_L) * t} y1={CEIL} x2={WALL_L + (WALL_R - WALL_L) * t} y2={GROUND}
            stroke="#ffffff" stroke-opacity="0.05" stroke-width="3" />
        {/each}
        <polygon points="{WALL_L},{GROUND} {WALL_R},{GROUND} {W + 40},{H + 40} {-40},{H + 40}" fill="#252c3d" />
        <rect x={WALL_L} y={GROUND} width={WALL_R - WALL_L} height="4" fill="#e8ecf5" />
        <polygon points="{-40},{-40} {WALL_L},{CEIL} {WALL_L},{GROUND} {-40},{H + 40}" fill="#1a1f2c" />
        <polygon points="{W + 40},{-40} {WALL_R},{CEIL} {WALL_R},{GROUND} {W + 40},{H + 40}" fill="#1a1f2c" />
        <rect x={WALL_L - 3} y={CEIL} width="3" height={GROUND - CEIL} fill="#e8ecf5" opacity="0.6" />
        <rect x={WALL_R} y={CEIL} width="3" height={GROUND - CEIL} fill="#e8ecf5" opacity="0.6" />
        <polygon points="{-40},{-40} {W + 40},{-40} {WALL_R},{CEIL} {WALL_L},{CEIL}" fill="#10141d" />

        {#if showBoxes}
          <!-- 間合い: reach bands on the floor -->
          {#each view.fighters as f (f.id)}
            {#if !f.ko && !f.airborne}
              {@const y = GROUND + 20 + f.id * 8}
              <g opacity="0.6">
                <line x1={f.x} y1={y} x2={f.x + MOVES.long.hit.x1 * f.facing} y2={y}
                  stroke={COLORS[f.id]} stroke-width="3" opacity="0.4" />
                <line x1={f.x + MOVES.long.sweet! * f.facing} y1={y} x2={f.x + MOVES.long.hit.x1 * f.facing} y2={y}
                  stroke={COLORS[f.id]} stroke-width="5" />
                <line x1={f.x} y1={y} x2={f.x + MOVES.short.hit.x1 * f.facing} y2={y}
                  stroke="#fff" stroke-width="3" opacity="0.7" />
              </g>
            {/if}
          {/each}
        {/if}

        <!-- dash afterimages -->
        {#each view.fighters as f (f.id)}
          {#each f.trail as t, i (i)}
            <rect x={t.body.x0} y={-t.body.h} width={t.body.x1 - t.body.x0} height={t.body.h} rx="6"
              transform="translate({t.x} {t.y}) scale({t.facing} 1)" fill={COLORS[f.id]} opacity={0.25 - i * 0.045} />
          {/each}
        {/each}

        {#each view.fighters as f (f.id)}
          <Fighter {f} color={COLORS[f.id]} />
        {/each}

        {#if showBoxes}
          {#each view.fighters as f (f.id)}
            {#each hurtboxes(f) as b, i (i)}
              <rect x={b.x0} y={b.y0} width={b.x1 - b.x0} height={b.y1 - b.y0}
                fill="#3b82f6" fill-opacity="0.12" stroke="#60a5fa" stroke-width="1.5" />
            {/each}
            {@const hb = hitbox(f)}
            {#if hb}
              <rect x={hb.x0} y={hb.y0} width={hb.x1 - hb.x0} height={hb.y1 - hb.y0}
                fill="#ef4444" fill-opacity="0.3" stroke="#f87171" stroke-width="2" />
            {/if}
          {/each}
        {/if}

        <!-- effects (kept inside the room) -->
        <g clip-path="url(#room)">
        {#each view.effects as e, i (i)}
          {@const k = e.t / e.life}
          {#if e.kind === 'burst'}
            {@const r = e.big ? 46 : 26}
            {@const s = sparkScale(e.t)}
            {@const n = e.big ? 6 : 3}
            {#if s > 0}
              <polygon points={sparkPoints(e, r * s)} fill="#fff" />
              {#if e.big && e.t < 2}
                <polygon points={sparkPoints(e, r * s * 0.3)} fill="#0d1017" />
              {/if}
            {/if}
            {#if e.t < SHARD_FRAMES}
              {#each { length: n } as _, j (j)}
                <polygon points={shardPoints(e, j, n, r)} fill="#fff" />
              {/each}
            {/if}
          {:else if e.kind === 'dust'}
            <circle cx={e.x} cy={e.y - 4} r={6 + 20 * k} fill="none" stroke="#e8ecf5" stroke-width="2" opacity={0.5 * (1 - k)} />
          {/if}
        {/each}
        </g>
      </g>

      {#if mode !== 'title'}
        {#if view.phase === 'ready'}
          <text x={W / 2} y={H / 2 - 50} text-anchor="middle" class="big">
            {view.phaseTimer > 25 ? `ROUND ${view.round}` : 'FIGHT'}
          </text>
        {:else if view.phase === 'ko'}
          <text x={W / 2} y={H / 2 - 50} text-anchor="middle" class="big ko">KO</text>
        {/if}
        {#if paused}
          <text x={W / 2} y={CEIL + 50} text-anchor="middle" class="paused">PAUSE</text>
        {/if}
      {/if}
    </svg>

    {#if mode === 'title'}
      <div class="overlay">
        <h1>間合い</h1>
        <div class="menu">
          <button onclick={() => start('cpu')}>VS CPU</button>
          <button onclick={() => start('versus')}>2P 対戦</button>
        </div>
      </div>
    {:else if view.phase === 'over'}
      <div class="overlay">
        <h1 style:color={view.winner !== null ? COLORS[view.winner] : '#fff'}>
          {view.winner !== null ? `${view.winner + 1}P WIN` : 'DRAW'}
        </h1>
        <div class="menu">
          <button onclick={() => start(mode)}>再戦</button>
          <button onclick={() => (mode = 'title')}>タイトル</button>
        </div>
      </div>
    {/if}
  </div>

  {#if mode !== 'title'}
    <div class="pads">
      <Pad keys={KEYS[0]} labels={LABELS[0]} color={COLORS[0]} down={held} onpress={press} />
      {#if mode === 'versus'}
        <Pad keys={KEYS[1]} labels={LABELS[1]} color={COLORS[1]} down={held} onpress={press} />
      {/if}
    </div>
  {/if}
</main>

<style>
  main { max-width: 1200px; margin: 0 auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
  header { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
  .hud { display: flex; flex-direction: column; gap: 6px; }
  .hud.right { align-items: flex-end; }
  .bar {
    position: relative; width: 100%; height: 22px; background: #1b2130;
    border: 2px solid #2c3445; border-radius: 3px; overflow: hidden;
  }
  .bar > div { position: absolute; top: 0; bottom: 0; left: 0; }
  .hud.right .bar > div { left: auto; right: 0; }
  .trail { background: #e8ecf5; }
  .hp { background: var(--pc); transition: width 60ms linear; }
  .hp.low { background: #ffd23b; }
  .wins { display: flex; gap: 6px; }
  .wins span { width: 12px; height: 12px; transform: rotate(45deg); outline: 2px solid #3a4152; outline-offset: -2px; }
  .wins span.won { background: var(--pc); outline-color: var(--pc); }

  .stage-wrap { position: relative; }
  .stage { width: 100%; display: block; border-radius: 6px; }
  .big { font: 900 84px system-ui, sans-serif; fill: #fff; letter-spacing: 0.08em; }
  .big.ko { fill: #ffd23b; }
  .paused { font: 700 22px ui-monospace, monospace; fill: #ffd23b; }

  .overlay {
    position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
    background: rgba(10, 12, 18, 0.72); border-radius: 6px; gap: 28px;
  }
  .overlay h1 { font-size: clamp(48px, 10vw, 110px); margin: 0; letter-spacing: 0.25em; margin-right: -0.25em; }
  .menu { display: flex; gap: 16px; }
  .menu button {
    font: 700 18px system-ui, sans-serif; color: #fff; background: #232a3b; border: 2px solid #3a4152;
    padding: 12px 28px; border-radius: 6px; cursor: pointer;
  }
  .menu button:hover, .menu button:focus-visible { border-color: #4cc9f0; outline: none; }

  .pads { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
</style>
