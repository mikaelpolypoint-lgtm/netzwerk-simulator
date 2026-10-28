<script lang="ts">
  import { networkInfo, type DocArea } from '../../core';
  import { t } from '../../i18n';
  import { editor } from '../state/editor.svelte';
  import { TAG_HEX } from '../tags';

  /** Farbiger Bereich im Dokumentationsmodus, z.B. ein Subnetz mit Titel und Netzinfos. */
  let {
    area,
    interactive,
    faded = false,
    onmove,
    onresize,
  }: {
    area: DocArea;
    interactive: boolean;
    faded?: boolean;
    onmove: (event: PointerEvent, area: DocArea) => void;
    onresize: (event: PointerEvent, area: DocArea) => void;
  } = $props();

  const selected = $derived(editor.selection?.kind === 'area' && editor.selection.id === area.id);
  const color = $derived(TAG_HEX[area.color]);
  const info = $derived(area.network ? networkInfo(area.network) : null);

  const details = $derived(
    [
      info ? info.network : area.network,
      area.vlan ? `VLAN ${area.vlan}` : '',
      info ? t('area.hostsShort', { n: info.hosts, first: info.first, last: info.last }) : '',
    ].filter(Boolean),
  );

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      editor.select({ kind: 'area', id: area.id });
    }
  }
</script>

<g class="area" class:selected class:interactive class:faded class:rack={area.kind === 'rack'} style:--area={color}>
  <rect
    class="body"
    x={area.x}
    y={area.y}
    width={area.width}
    height={area.height}
    rx="12"
    role="button"
    tabindex={interactive ? 0 : -1}
    aria-label={interactive ? t('area.label', { title: area.title }) : undefined}
    onpointerdown={(e) => interactive && onmove(e, area)}
    {onkeydown}
  />
  {#if area.kind === 'rack'}
    <!-- 19-Zoll-Schrank: Seitenschienen mit Lochreihe, Titel oben. -->
    <rect class="rail" x={area.x + 6} y={area.y + 34} width="8" height={area.height - 42} />
    <rect class="rail" x={area.x + area.width - 14} y={area.y + 34} width="8" height={area.height - 42} />
    <text class="rack-title" x={area.x + area.width / 2} y={area.y + 22}>{area.title}</text>
  {:else}
    <text class="title" x={area.x + 14} y={area.y + 22}>{area.title}</text>
    {#each details as line, i (i)}
      <text class="info" x={area.x + 14} y={area.y + 40 + i * 15}>{line}</text>
    {/each}
  {/if}
  {#if interactive && selected}
    <rect
      class="handle"
      x={area.x + area.width - 12}
      y={area.y + area.height - 12}
      width="16"
      height="16"
      rx="3"
      role="presentation"
      onpointerdown={(e) => onresize(e, area)}
    />
  {/if}
</g>

<style>
  .area {
    pointer-events: none;
  }
  .area.interactive .body,
  .area.interactive .handle {
    pointer-events: all;
    cursor: move;
  }
  .handle {
    cursor: nwse-resize !important;
    fill: var(--surface);
    stroke: var(--area);
    stroke-width: 2;
  }
  .body {
    fill: color-mix(in srgb, var(--area) 10%, transparent);
    stroke: var(--area);
    stroke-width: 2;
    stroke-dasharray: 10 6;
    outline: none;
  }
  .rack .body {
    fill: #111827;
    stroke: #475569;
    stroke-dasharray: none;
    stroke-width: 3;
  }
  .rack.selected .body {
    stroke: var(--accent);
  }
  .rail {
    fill: none;
    stroke: #4b5563;
    stroke-width: 1.5;
    stroke-dasharray: 2 4;
    pointer-events: none;
  }
  .rack-title {
    font-size: 13px;
    font-weight: 700;
    fill: #e5e7eb;
    text-anchor: middle;
    user-select: none;
  }
  .selected .body {
    stroke-width: 3.5;
    stroke-dasharray: none;
  }
  .body:focus-visible {
    stroke: var(--focus);
  }
  .faded {
    opacity: 0.25;
  }
  .title {
    font-size: 15px;
    font-weight: 700;
    fill: var(--area);
    user-select: none;
  }
  .info {
    font-size: 11.5px;
    fill: var(--muted);
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    user-select: none;
  }
</style>
