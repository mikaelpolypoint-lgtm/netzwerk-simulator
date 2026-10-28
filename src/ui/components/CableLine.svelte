<script lang="ts">
  import type { Cable, Device } from '../../core';
  import { t } from '../../i18n';
  import { interfaceLabel } from '../labels';
  import { editor } from '../state/editor.svelte';

  let { cable, a, b }: { cable: Cable; a: Device; b: Device } = $props();

  /** Abstand der Port-Beschriftung vom Gerätemittelpunkt, ausserhalb des Gerätenamens. */
  const LABEL_DISTANCE = 76;

  const selected = $derived(editor.selection?.kind === 'cable' && editor.selection.id === cable.id);
  const labelA = $derived(interfaceLabel(a, cable.a.iface));
  const labelB = $derived(interfaceLabel(b, cable.b.iface));

  const geometry = $derived.by(() => {
    const dx = b.position.x - a.position.x;
    const dy = b.position.y - a.position.y;
    const length = Math.hypot(dx, dy);
    // Liegen die Geräte zu nah beieinander, hätten die Beschriftungen keinen Platz.
    if (length < LABEL_DISTANCE * 2.2) return { length, labels: null };
    const ux = dx / length;
    const uy = dy / length;
    return {
      length,
      labels: {
        a: { x: a.position.x + ux * LABEL_DISTANCE, y: a.position.y + uy * LABEL_DISTANCE },
        b: { x: b.position.x - ux * LABEL_DISTANCE, y: b.position.y - uy * LABEL_DISTANCE },
      },
    };
  });

  function select(event: Event) {
    event.stopPropagation();
    editor.select({ kind: 'cable', id: cable.id });
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      select(event);
    }
  }
</script>

<g
  class="cable"
  class:selected
  role="button"
  tabindex="0"
  aria-pressed={selected}
  aria-label={t('canvas.cable', { a: `${a.name} (${labelA})`, b: `${b.name} (${labelB})` })}
  onpointerdown={select}
  onfocus={() => editor.tool === 'select' && editor.select({ kind: 'cable', id: cable.id })}
  {onkeydown}
>
  <line class="hit" x1={a.position.x} y1={a.position.y} x2={b.position.x} y2={b.position.y} />
  <line class="wire" class:damaged={!!cable.loss} x1={a.position.x} y1={a.position.y} x2={b.position.x} y2={b.position.y} />
  {#if geometry.labels}
    <text class="port" x={geometry.labels.a.x} y={geometry.labels.a.y}>{labelA}</text>
    <text class="port" x={geometry.labels.b.x} y={geometry.labels.b.y}>{labelB}</text>
  {/if}
  {#if cable.loss}
    <text class="loss" x={(a.position.x + b.position.x) / 2} y={(a.position.y + b.position.y) / 2 - 8}>⚡ {cable.loss} %</text>
  {/if}
</g>

<style>
  .cable {
    cursor: pointer;
    outline: none;
  }
  .hit {
    stroke: transparent;
    stroke-width: 14;
  }
  .wire {
    stroke: var(--cable);
    stroke-width: 2.5;
    stroke-linecap: round;
  }
  /* Beschädigtes Kabel: gestrichelt und in Warnfarbe, damit es bei der Fehlersuche auffallen kann. */
  .wire.damaged {
    stroke: var(--danger);
    stroke-dasharray: 8 5;
  }
  .loss {
    font-size: 11px;
    font-weight: 600;
    text-anchor: middle;
    fill: var(--danger);
    paint-order: stroke;
    stroke: var(--bg);
    stroke-width: 4px;
    stroke-linejoin: round;
    pointer-events: none;
  }
  .cable:hover .wire {
    stroke-width: 3.5;
  }
  .selected .wire {
    stroke: var(--accent);
    stroke-width: 4;
  }
  .cable:focus-visible .hit {
    stroke: var(--focus-soft);
  }
  .port {
    font-size: 11px;
    text-anchor: middle;
    dominant-baseline: middle;
    fill: var(--muted);
    paint-order: stroke;
    stroke: var(--bg);
    stroke-width: 4px;
    stroke-linejoin: round;
    user-select: none;
    pointer-events: none;
  }
</style>
