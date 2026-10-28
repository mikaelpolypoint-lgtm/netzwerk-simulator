<script lang="ts">
  import type { DeviceType } from '../../core';

  // Eigene, schlichte Symbole (keine Grafiken aus dem Vorbild, siehe Konzept 7.6).
  let { type }: { type: DeviceType } = $props();
</script>

<g class="icon" aria-hidden="true">
  {#if type === 'notebook'}
    <rect x="-17" y="-18" width="34" height="23" rx="2" />
    <path d="M-24 8 H24 L20 15 H-20 Z" />
  {:else if type === 'pc'}
    <rect x="-24" y="-18" width="30" height="22" rx="2" />
    <path class="line" d="M-9 4 V10 M-15 11 H-3" />
    <rect x="11" y="-18" width="13" height="30" rx="2" />
    <path class="line" d="M14 -12 H21 M14 -7 H21" />
  {:else if type === 'switch'}
    <rect x="-25" y="-12" width="50" height="24" rx="4" />
    <path class="line" d="M-14 -5 H14 M9 -8 L14 -5 L9 -2 M14 5 H-14 M-9 2 L-14 5 L-9 8" />
  {:else if type === 'l3switch'}
    <rect x="-25" y="-12" width="50" height="24" rx="4" />
    <path class="line" d="M-14 -5 H6 M1 -8 L6 -5 L1 -2 M6 5 H-14 M-9 2 L-14 5 L-9 8" />
    <circle cx="16" cy="0" r="6" />
    <path class="line" d="M13 0 H19 M16 -3 V3" />
  {:else if type === 'accesspoint'}
    <rect x="-20" y="2" width="40" height="13" rx="4" />
    <path class="line" d="M-11 -7 Q0 -17 11 -7 M-6.5 -3 Q0 -9 6.5 -3" />
    <circle class="fill" cx="0" cy="1" r="2" />
    <path class="line" d="M-12 9 H-10 M-6 9 H-4" />
  {:else if type === 'router'}
    <circle r="20" />
    <path
      class="line"
      d="M-5 -5 L-12 -12 M-12 -7 V-12 H-7 M5 5 L12 12 M12 7 V12 H7 M5 -5 L12 -12 M7 -12 H12 V-7 M-5 5 L-12 12 M-7 12 H-12 V7"
    />
  {:else if type === 'internet'}
    <path d="M-16 12 H16 A10 10 0 0 0 15 -7 A13 13 0 0 0 -9 -11 A11 11 0 0 0 -16 12 Z" />
    <path class="line" d="M-9 3 H9 M0 -6 V12 M-6 -3 Q0 3 -6 9 M6 -3 Q0 3 6 9" />
  {:else}
    <rect x="-23" y="-6" width="46" height="18" rx="4" />
    <path class="line" d="M-9 -12 Q0 -20 9 -12 M-5 -10 Q0 -14 5 -10" />
    <path class="line" d="M-14 3 H-12 M-7 3 H-5 M0 3 H2" />
  {/if}
</g>

<style>
  .icon :global(rect),
  .icon :global(circle),
  .icon :global(path:not(.line)) {
    fill: var(--role-soft);
    stroke: var(--role);
    stroke-width: 2;
  }
  .icon :global(circle.fill) {
    fill: var(--role);
  }
  .icon :global(.line) {
    fill: none;
    stroke: var(--role);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
