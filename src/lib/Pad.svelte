<script lang="ts">
  type Action = 'left' | 'right' | 'short' | 'long' | 'dash';

  let { keys, labels, color, down, onpress }: {
    keys: Record<Action, string>; // code sent when the button is pressed
    labels: Record<Action, string>;
    color: string;
    down: Set<string>;
    onpress: (code: string, isDown: boolean) => void;
  } = $props();

  // leverless layout: two direction buttons for the left hand, three attack buttons in an arc
  const LEFT: { a: Action; dy: number }[] = [
    { a: 'left', dy: 0 },
    { a: 'right', dy: 14 },
  ];
  const RIGHT: { a: Action; dy: number }[] = [
    { a: 'short', dy: 10 },
    { a: 'long', dy: 0 },
    { a: 'dash', dy: 6 },
  ];

  function bind(code: string) {
    return {
      onpointerdown: (e: PointerEvent) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        onpress(code, true);
      },
      onpointerup: () => onpress(code, false),
      onpointercancel: () => onpress(code, false),
    };
  }
</script>

<div class="panel" style:--pc={color}>
  {#each [LEFT, RIGHT] as group, gi (gi)}
    <div class="group">
      {#each group as b (b.a)}
        <button
          class:attack={gi === 1}
          class:on={down.has(keys[b.a])}
          style:margin-top="{b.dy}px"
          aria-label={b.a}
          {...bind(keys[b.a])}
        >
          <span class="cap">{labels[b.a]}</span>
        </button>
      {/each}
    </div>
  {/each}
</div>

<style>
  .panel {
    display: flex; gap: 34px; align-items: flex-start; padding: 12px 18px 16px;
    background: #141924; border: 1px solid #262d3c; border-radius: 12px;
  }
  .group { display: flex; gap: 10px; }
  button {
    --face: #3a4254;
    width: 54px; height: 54px; padding: 0; border-radius: 50%; cursor: pointer;
    touch-action: none; user-select: none;
    background: var(--face);
    border: 3px solid #0b0e15;
    box-shadow: 0 4px 0 #0b0e15;
    transition: transform 30ms, box-shadow 30ms;
  }
  button.attack { --face: var(--pc); }
  button:focus { outline: none; }
  button.on {
    transform: translateY(3px);
    box-shadow: 0 1px 0 #0b0e15;
    background: color-mix(in srgb, var(--face) 80%, #000);
  }
  .cap { font: 800 14px ui-monospace, monospace; color: #0d1017; opacity: 0.5; }
  button:not(.attack) .cap { color: #e8ecf5; }
</style>
