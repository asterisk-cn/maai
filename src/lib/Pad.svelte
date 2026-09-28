<script lang="ts">
  type Action = 'left' | 'right' | 'short' | 'long' | 'dash';

  let { x, y, keys, labels, color, down, onpress }: {
    x: number; // SVG position of the left direction button
    y: number;
    keys: Record<Action, string>; // code sent when the button is pressed
    labels: Record<Action, string>;
    color: string;
    down: Set<string>;
    onpress: (code: string, isDown: boolean) => void;
  } = $props();

  const R = 25;
  // leverless layout: two direction buttons, then three attack buttons in an arc
  const LAYOUT: { a: Action; dx: number; dy: number; attack: boolean }[] = [
    { a: 'left', dx: 0, dy: 0, attack: false },
    { a: 'right', dx: 60, dy: 12, attack: false },
    { a: 'short', dx: 158, dy: 8, attack: true },
    { a: 'long', dx: 218, dy: -2, attack: true },
    { a: 'dash', dx: 278, dy: 4, attack: true },
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
        <text y="5" text-anchor="middle" fill={b.attack ? '#0d1017' : '#e8ecf5'}>{labels[b.a]}</text>
      </g>
    </g>
  {/each}
</g>

<style>
  .btn { cursor: pointer; touch-action: none; outline: none; }
  text { font: 800 14px ui-monospace, monospace; opacity: 0.55; pointer-events: none; user-select: none; }
</style>
