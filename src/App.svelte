<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import {
    FPS, W, H, GROUND, WALL_L, WALL_R, CEIL, MAX_HP, ROUNDS_TO_WIN, MOVES, HALF_W, BODY_H,
    newGame, step, hitbox, hurtboxes, type Game, type Input, type Effect,
  } from './lib/engine';
  import { cpuInput, newCpuMemory, type CpuLevel } from './lib/cpu';
  import Fighter from './lib/Fighter.svelte';
  import Pad from './lib/Pad.svelte';
  import HowTo from './lib/HowTo.svelte';
  import TouchPad from './lib/TouchPad.svelte';
  import { Rollback, type Packet } from './lib/rollback';
  import { connect, newRoomCode, type Peer } from './lib/net';

  const COLORS: [string, string] = ['#4cc9f0', '#ff6b5b'];
  const STEP_MS = 1000 / FPS;

  // HUD layout (SVG units): life bars in the ceiling band, buttons on the floor
  const BAR_OUT = 40;
  const BAR_GAP = 40;
  const BAR_W = W / 2 - BAR_OUT - BAR_GAP;
  const BAR_Y = 22;
  const BAR_H = 18;
  const WIN_Y = BAR_Y + BAR_H + 22; // centre of the round-win marks
  const PAD_X = 100;
  const PAD_Y = 598;
  const PAD_SPAN = 218; // left button centre → last button centre

  // dash has no button: it's a double tap on a direction
  type Action = 'left' | 'right' | 'short' | 'long';
  const KEYS: Record<Action, string>[] = [
    { left: 'KeyA', right: 'KeyD', short: 'KeyF', long: 'KeyG' },
    { left: 'ArrowLeft', right: 'ArrowRight', short: 'Comma', long: 'Period' },
  ];

  type Mode = 'title' | 'cpu' | 'versus' | 'online';
  let mode = $state<Mode>('title');
  // title-screen pages
  let menu = $state<'main' | 'cpu' | 'online' | 'host' | 'join' | 'connecting' | 'howto'>('main');
  let cpuLevel: CpuLevel = 2;
  let paused = $state(false);
  let showBoxes = $state(false);
  let touch = $state(false); // coarse pointer: finger-sized buttons instead of the in-screen ones

  let game: Game = newGame();
  let view = $state.raw<Game>(structuredClone(game));
  let cpu = newCpuMemory();

  // online play
  let rb: Rollback | null = null;
  let peer: Peer | null = null;
  let hangUp: (() => void) | null = null;
  let me = $state<0 | 1>(0);
  let roomCode = $state('');
  let joinCode = $state('');
  let netError = $state('');
  let wantRematch = $state(false);
  let peerRematch = false;
  const CLOSE_TEXT = { full: '満室です', unreachable: '接続できません', failed: '接続できません', left: '切断されました' };

  const held = new SvelteSet<string>();
  const pressed = new Set<string>();
  let stepOnce = false;

  function readPlayer(p: 0 | 1): Input {
    // playing alone (CPU / online): either key set works
    const sets = (mode === 'cpu' && p === 0) || mode === 'online' ? [KEYS[0], KEYS[1]] : [KEYS[p]];
    const h = (a: Action) => sets.some((k) => held.has(k[a]));
    const pr = (a: Action) => sets.some((k) => pressed.has(k[a]));
    return { left: h('left'), right: h('right'), short: pr('short'), long: pr('long'), dash: false };
  }

  function tick() {
    if (mode === 'online') {
      if (!rb) return;
      // a stalled frame keeps this frame's presses for the next attempt
      if (rb.tick(readPlayer(0))) pressed.clear();
      game = rb.game;
      return;
    }
    const p1 = readPlayer(0);
    const p2 = mode === 'cpu' ? cpuInput(game, 1, cpu) : readPlayer(1);
    step(game, [p1, p2]);
    pressed.clear();
  }

  function start(m: Mode, level: CpuLevel = cpuLevel) {
    mode = m;
    cpuLevel = level;
    game = newGame();
    cpu = newCpuMemory(level);
    paused = false;
    view = structuredClone(game);
  }

  // ---- online session
  function openRoom(code: string) {
    netError = '';
    hangUp = connect(code, {
      onOpen(p) {
        peer = p;
        startOnline();
      },
      onGame: (m) => rb?.receive(m as Packet),
      onCtl(m) {
        if ((m as { t: string }).t === 'rematch') {
          peerRematch = true;
          maybeRematch();
        }
      },
      onClose(reason) {
        rb = null;
        peer = null;
        hangUp = null;
        if (mode === 'online' || menu !== 'main') netError = CLOSE_TEXT[reason];
        mode = 'title';
        menu = 'main';
      },
    });
  }

  function hostRoom() {
    roomCode = newRoomCode();
    menu = 'host';
    openRoom(roomCode);
  }

  function joinRoom() {
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 4) return;
    roomCode = code;
    menu = 'connecting';
    openRoom(code);
  }

  function startOnline() {
    rb = new Rollback(peer!.role, (p) => peer?.sendGame(p));
    me = peer!.role;
    game = rb.game;
    mode = 'online';
    menu = 'main';
    paused = false;
    wantRematch = false;
    peerRematch = false;
    view = structuredClone(game);
  }

  function rematch() {
    if (mode !== 'online') return start(mode);
    wantRematch = true;
    peer?.sendCtl({ t: 'rematch' });
    maybeRematch();
  }

  function maybeRematch() {
    if (wantRematch && peerRematch) startOnline();
  }

  function toTitle() {
    const h = hangUp;
    hangUp = null;
    rb = null;
    peer = null;
    mode = 'title';
    menu = 'main';
    h?.();
    netError = '';
  }

  const focus = (el: HTMLElement) => el.focus();

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
    const offline = mode !== 'online'; // no pausing a live match
    if (offline && (e.code === 'KeyP' || e.code === 'Escape')) paused = !paused;
    if (offline && e.code === 'BracketRight' && paused) stepOnce = true;
    if (e.code === 'Digit0') showBoxes = !showBoxes;
    if (game.phase === 'over' && e.code === 'Enter') rematch();
  }

  onMount(() => {
    const coarse = matchMedia('(pointer: coarse)');
    touch = coarse.matches;
    coarse.onchange = () => (touch = coarse.matches);
    if (import.meta.env.DEV) {
      Object.assign(window, {
        __game: () => game,
        __mode: () => mode,
        __rb: () => rb,
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
  <div class="screen">
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
                  stroke={COLORS[f.id]} stroke-width="3" />
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
        <!-- HUD: slanted life bars, lost life drains toward the centre -->
        {#each view.fighters as f (f.id)}
          {@const x0 = f.id === 0 ? BAR_OUT : W / 2 + BAR_GAP}
          {@const s = f.id === 0 ? -1 : 1}
          {@const cx = x0 + BAR_W / 2}
          <g transform="translate({cx} {BAR_Y + BAR_H / 2}) skewX({s * 24}) translate({-cx} {-(BAR_Y + BAR_H / 2)})">
            <rect x={x0 - 3} y={BAR_Y - 3} width={BAR_W + 6} height={BAR_H + 6} fill="#0b0e15" />
            <rect x={x0} y={BAR_Y} width={BAR_W} height={BAR_H} fill="#262d3c" />
            <rect x={f.id === 0 ? x0 : x0 + BAR_W * (1 - f.hpTrail / MAX_HP)} y={BAR_Y}
              width={BAR_W * (f.hpTrail / MAX_HP)} height={BAR_H} fill="#e8ecf5" />
            <rect x={f.id === 0 ? x0 : x0 + BAR_W * (1 - f.hp / MAX_HP)} y={BAR_Y}
              width={BAR_W * (f.hp / MAX_HP)} height={BAR_H} fill={f.hp <= 30 ? '#ffd23b' : COLORS[f.id]} />
          </g>
          {#each Array(ROUNDS_TO_WIN) as _, i (i)}
            {@const wx = f.id === 0 ? BAR_OUT + 8 + i * 22 : W - BAR_OUT - 8 - i * 22}
            <rect x={wx - 6} y={WIN_Y - 6} width="12" height="12"
              transform="rotate(45 {wx} {WIN_Y})"
              fill={i < f.wins ? COLORS[f.id] : '#0b0e15'} stroke={i < f.wins ? COLORS[f.id] : '#3a4254'} stroke-width="2" />
          {/each}
        {/each}

        {#if touch}
          <!-- drawn outside the scaled screen: see TouchPad below -->
        {:else if mode === 'online'}
          <Pad x={me === 0 ? PAD_X : W - PAD_X - PAD_SPAN} y={PAD_Y} keys={KEYS[0]} color={COLORS[me]} down={held} onpress={press} />
        {:else}
          <Pad x={PAD_X} y={PAD_Y} keys={KEYS[0]} color={COLORS[0]} down={held} onpress={press} />
        {/if}
        {#if mode === 'versus' && !touch}
          <Pad x={W - PAD_X - PAD_SPAN} y={PAD_Y} keys={KEYS[1]} color={COLORS[1]} down={held} onpress={press} />
        {/if}

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
        {#if menu === 'howto'}
          <HowTo color={COLORS[0]} keys={!touch} />
        {:else}
          <h1>間合い</h1>
        {/if}
        <div class="menu">
          {#if menu === 'howto'}
            <button onclick={() => (menu = 'main')}>戻る</button>
          {:else if menu === 'main'}
            <button onclick={() => (menu = 'cpu')}>VS CPU</button>
            {#if !touch}<button onclick={() => start('versus')}>オフライン</button>{/if}
            <button onclick={() => { netError = ''; menu = 'online'; }}>オンライン</button>
            <button onclick={() => (menu = 'howto')}>操作説明</button>
            {#if netError}<p class="note">{netError}</p>{/if}
          {:else if menu === 'cpu'}
            {#each [1, 2, 3, 4, 5] as const as lv (lv)}
              <button onclick={() => start('cpu', lv)}>Lv{lv}</button>
            {/each}
            <button onclick={() => (menu = 'main')}>戻る</button>
          {:else if menu === 'online'}
            <button onclick={hostRoom}>部屋を作る</button>
            <button onclick={() => { joinCode = ''; menu = 'join'; }}>部屋に入る</button>
            <button onclick={() => (menu = 'main')}>戻る</button>
          {:else if menu === 'host'}
            <div class="code">{roomCode}</div>
            <p class="note">待機中</p>
            <button onclick={toTitle}>戻る</button>
          {:else if menu === 'join'}
            <form onsubmit={(e) => { e.preventDefault(); joinRoom(); }}>
              <input class="code" maxlength="4" bind:value={joinCode} use:focus
                oninput={() => (joinCode = joinCode.toUpperCase())} aria-label="room code" />
            </form>
            <button onclick={joinRoom} disabled={joinCode.trim().length !== 4}>入る</button>
            <button onclick={() => (menu = 'online')}>戻る</button>
          {:else}
            <div class="code">{roomCode}</div>
            <p class="note">接続中</p>
            <button onclick={toTitle}>戻る</button>
          {/if}
        </div>
      </div>
    {:else if view.phase === 'over'}
      <div class="overlay">
        <h1 style:color={view.winner !== null ? COLORS[view.winner] : '#fff'}>
          {view.winner !== null ? `${view.winner + 1}P WIN` : 'DRAW'}
        </h1>
        <div class="menu">
          <button onclick={rematch} disabled={wantRematch}>{wantRematch ? '待機中' : '再戦'}</button>
          <button onclick={toTitle}>タイトル</button>
        </div>
      </div>
    {/if}
  </div>

  {#if touch && mode !== 'title' && view.phase !== 'over'}
    <TouchPad keys={KEYS[0]} color={COLORS[mode === 'online' ? me : 0]} down={held} onpress={press} />
  {/if}
</main>

<style>
  main { min-height: 100vh; display: grid; place-items: center; }
  /* portrait phone: screen on top, the rest is for thumbs */
  @media (orientation: portrait) { main { place-items: start center; padding-top: env(safe-area-inset-top); } }
  .screen {
    position: relative; container-type: inline-size;
    width: min(100vw, calc(100vh * 16 / 9)); aspect-ratio: 16 / 9;
  }
  .stage { width: 100%; height: 100%; display: block; }
  .big { font: 900 84px system-ui, sans-serif; fill: #fff; letter-spacing: 0.08em; }
  .big.ko { fill: #ffd23b; }
  .paused { font: 700 22px ui-monospace, monospace; fill: #ffd23b; }

  .overlay {
    position: fixed; inset: 0; z-index: 3; container-type: size; display: flex; flex-direction: column; align-items: center; justify-content: center;
    background: rgba(8, 10, 15, 0.7); gap: 7.11cqmin;
  }
  .overlay h1 { font-size: 16.0cqmin; margin: 0; letter-spacing: 0.25em; margin-right: -0.25em; }
  .menu { display: flex; flex-direction: column; align-items: center; gap: 2.13cqmin; }
  .menu button {
    position: relative; font: 800 4.27cqmin system-ui, sans-serif; letter-spacing: 0.15em;
    color: #8a93a8; background: none; border: none; padding: 0.71cqmin 3.56cqmin; cursor: pointer;
  }
  .menu button:hover:not(:disabled), .menu button:focus-visible { color: #fff; outline: none; }
  .menu button:disabled { opacity: 0.4; cursor: default; }
  .menu button:disabled::before { display: none; }
  .code {
    font: 800 8.89cqmin ui-monospace, monospace; letter-spacing: 0.3em; margin-right: -0.3em; color: #fff;
    width: 5.2ch; text-align: center; background: none; border: none;
    padding: 0; outline: none; text-transform: uppercase;
  }
  input.code { border-bottom: 0.53cqmin solid #3a4254; }
  input.code:focus { border-bottom-color: #4cc9f0; }
  .note { margin: 0 0 1.78cqmin; font: 700 2.84cqmin system-ui, sans-serif; letter-spacing: 0.15em; color: #8a93a8; }
  .menu button:hover::before, .menu button:focus-visible::before {
    content: ''; position: absolute; left: 0; top: 50%; translate: 0 -50%;
    border: 1.07cqmin solid transparent; border-left: 1.6cqmin solid #4cc9f0; border-right: 0;
  }
</style>
