<script lang="ts">
  // Big on-screen buttons for touch devices, sized to the finger rather than to the
  // (possibly tiny) scaled game screen.
  import Icon from './Icon.svelte';

  type Action = 'left' | 'right' | 'short' | 'long';

  // one player per device: directions bottom-left, attacks bottom-right
  let { keys, color, down, onpress }: {
    keys: Record<Action, string>;
    color: string;
    down: Set<string>;
    onpress: (code: string, isDown: boolean) => void;
  } = $props();

  function button(code: string) {
    return {
      onpointerdown: (e: PointerEvent) => {
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        onpress(code, true);
      },
      onpointerup: () => onpress(code, false),
      onpointercancel: () => onpress(code, false),
    };
  }
</script>

{#snippet face(a: Action, attack: boolean, on: boolean)}
  <svg viewBox="-30 -30 60 66" class:on aria-hidden="true">
    <circle cy="5" r="26" fill="#0b0e15" />
    <g transform="translate(0 {on ? 4 : 0})">
      <circle r="26" fill={attack ? color : '#3a4254'} stroke="#0b0e15" stroke-width="3" opacity={on ? 0.8 : 1} />
      <g opacity="0.6"><Icon {a} fill={attack ? '#0d1017' : '#e8ecf5'} /></g>
    </g>
  </svg>
{/snippet}

<div class="pad">
  <div class="cluster">
    {#each ['left', 'right'] as const as a (a)}
      <button aria-label={a} {...button(keys[a])}>{@render face(a, false, down.has(keys[a]))}</button>
    {/each}
  </div>
  <div class="cluster">
    {#each ['short', 'long'] as const as a (a)}
      <button aria-label={a} {...button(keys[a])}>{@render face(a, true, down.has(keys[a]))}</button>
    {/each}
  </div>
</div>

<style>
  .pad {
    --b: clamp(56px, 16vmin, 96px);
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 2;
    display: flex; justify-content: space-between; align-items: flex-end;
    padding: 0 max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
    pointer-events: none;
  }
  .cluster { display: flex; align-items: flex-end; gap: calc(var(--b) * 0.15); pointer-events: auto; }
  button { padding: 0; border: none; background: none; touch-action: none; }
  /* the outer button of each pair sits a little higher, like an arcade layout */
  .cluster:first-child button:first-child, .cluster:last-child button:last-child { margin-bottom: calc(var(--b) * 0.25); }
  svg { width: var(--b); height: auto; display: block; }
  .pad, .pad * { user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }
</style>
