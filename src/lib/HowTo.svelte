<script lang="ts">
  import Icon from './Icon.svelte';

  let { color }: { color: string } = $props();

  type Btn = 'left' | 'right' | 'short' | 'long';
  // `twice`: tap the input two times in a row
  const ROWS: { buttons: Btn[]; twice?: boolean; name: string; keys: [string, string] }[] = [
    { buttons: ['left', 'right'], name: '移動', keys: ['A D', '← →'] },
    { buttons: ['right'], twice: true, name: 'ダッシュ', keys: ['D', '→'] },
    { buttons: ['short'], name: '短攻撃', keys: ['F', ','] },
    { buttons: ['long'], name: '長攻撃', keys: ['G', '.'] },
  ];
</script>

<div class="howto">
  <div class="head">
    <span></span>
    <span></span>
    <span class="player">1P</span>
    <span class="player">2P</span>
  </div>
  {#each ROWS as row (row.name)}
    <div class="row">
      <div class="buttons">
        {#each row.buttons as b, i (i)}
          {@const attack = b === 'short' || b === 'long'}
          <svg viewBox="-30 -30 60 66" aria-hidden="true">
            <circle cy="5" r="25" fill="#0b0e15" />
            <circle r="25" fill={attack ? color : '#3a4254'} stroke="#0b0e15" stroke-width="3" />
            <g opacity="0.6"><Icon a={b} fill={attack ? '#0d1017' : '#e8ecf5'} /></g>
          </svg>
        {/each}
        {#if row.twice}<span class="times">×2</span>{/if}
      </div>
      <div class="name">{row.name}</div>
      {#each row.keys as k, i (i)}
        <div class="keys">
          {#each k.split(' ') as c, j (j)}<kbd>{c}</kbd>{/each}
          {#if row.twice}<span class="times">×2</span>{/if}
        </div>
      {/each}
    </div>
  {/each}
</div>

<style>
  .howto { display: flex; flex-direction: column; align-items: center; gap: 1.4cqw; }
  .head, .row {
    display: grid; grid-template-columns: 14cqw 14cqw 9cqw 9cqw; align-items: center; column-gap: 2cqw;
  }
  .player { font: 800 1.4cqw ui-monospace, monospace; color: #8a93a8; text-align: center; letter-spacing: 0.1em; }
  .buttons { display: flex; justify-content: flex-end; gap: 0.6cqw; }
  .buttons svg { width: 4.6cqw; height: auto; }
  .buttons, .keys { align-items: center; }
  .times { font: 800 1.6cqw ui-monospace, monospace; color: #e8ecf5; margin-left: 0.4cqw; }
  .name { font: 800 2.2cqw system-ui, sans-serif; color: #fff; letter-spacing: 0.1em; }
  .keys { display: flex; justify-content: center; gap: 0.5cqw; }
  kbd {
    min-width: 2.6cqw; padding: 0.3cqw 0.6cqw; text-align: center;
    font: 800 1.4cqw ui-monospace, monospace; color: #e8ecf5;
    background: #1b2130; border: 0.15cqw solid #3a4254; border-bottom-width: 0.35cqw; border-radius: 0.5cqw;
  }
</style>
