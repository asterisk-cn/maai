<script lang="ts">
  // Function icon drawn inside a round button, centred on (0, 0).
  let { a, fill }: { a: 'left' | 'right' | 'short' | 'long'; fill: string } = $props();
</script>

<g {fill}>
  {#if a === 'left'}
    <polygon points="-8,0 6,-9 6,9" />
  {:else if a === 'right'}
    <polygon points="8,0 -6,-9 -6,9" />
  {:else if a === 'short'}
    <rect x="-9" y="-6" width="18" height="12" rx="2" />
  {:else}
    <rect x="-14" y="-2.5" width="28" height="5" rx="1.5" />
  {/if}
</g>
