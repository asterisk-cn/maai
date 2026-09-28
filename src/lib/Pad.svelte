<script lang="ts">
  import Icon from './Icon.svelte';

  type Action = 'left' | 'right' | 'short' | 'long';

  let { x, y, keys, color, down, onpress }: {
    x: number; // SVG position of the left direction button
    y: number;
    keys: Record<Action, string>; // code sent when the button is pressed
    color: string;
    down: Set<string>;
    onpress: (code: string, isDown: boolean) => void;
  } = $props();

  const R = 25;
  // leverless layout: two direction buttons, then the two attack buttons
  const LAYOUT: { a: Action; dx: number; dy: number; attack: boolean }[] = [
    { a: 'left', dx: 0, dy: 0, attack: false },
    { a: 'right', dx: 60, dy: 12, attack: false },
    { a: 'short', dx: 158, dy: 8, attack: true },
    { a: 'long', dx: 218, dy: -2, attack: true },
  ];

  function bind(code: string) {
    return {
      onpointerdown: (e: PointerEvent) => {
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        onpress(code, true);
      },
      onpointerup: () => onpress(code, false),
      onpointercancel: () => onpress(code, false),
    };
  }
</script>

<g transform="translate({x} {y})">
  {#each LAYOUT as b (b.a)}
    {@const on = down.has(keys[b.a])}
    <g class="btn" role="button" tabindex="-1" aria-label={b.a} {...bind(keys[b.a])}
      transform="translate({b.dx} {b.dy})">
      <circle cy="5" r={R} fill="#0b0e15" />
      <g transform="translate(0 {on ? 4 : 0})">
        <circle r={R} fill={b.attack ? color : '#3a4254'} stroke="#0b0e15" stroke-width="3"
          opacity={on ? 0.8 : 1} />
        <g class="icon"><Icon a={b.a} fill={b.attack ? '#0d1017' : '#e8ecf5'} /></g>
      </g>
    </g>
  {/each}
</g>

<style>
  .btn { cursor: pointer; touch-action: none; outline: none; }
  .icon { opacity: 0.6; pointer-events: none; }
</style>
