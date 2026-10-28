<script lang="ts">
  import { untrack } from 'svelte';
  import { getDevice, isDeviceType, type Device, type DocArea, type Point, type TagColor } from '../../core';
  import { t } from '../../i18n';
  import { DEVICE_MIME } from '../dnd';
  import { protocolOf } from '../packets';
  import { GRID, editor } from '../state/editor.svelte';
  import { simStore } from '../state/sim.svelte';
  import { ui } from '../state/ui.svelte';
  import { TAG_ORDER } from '../tags';
  import AreaShape from './AreaShape.svelte';
  import CableLine from './CableLine.svelte';
  import DeviceNode from './DeviceNode.svelte';

  let svg: SVGSVGElement;
  let width = $state(0);
  let height = $state(0);
  let pointer = $state<Point | null>(null);
  let panFrom = $state<Point | null>(null);
  /** Abstand Gerätemitte – Mauszeiger beim Greifen, damit das Gerät nicht springt. */
  let drag: { id: string; offset: Point } | null = null;
  /** Bereich verschieben oder in der Grösse ändern (Dokumentationsmodus). */
  let areaDrag: { id: string; kind: 'move' | 'resize'; start: Point; origin: DocArea } | null = null;
  /** Neuer Bereich, der gerade aufgezogen wird. */
  let drawing = $state<{ from: Point; to: Point } | null>(null);

  /** Liegt ein Gerät auf einem anderen als dem gewählten Stockwerk? */
  const offFloor = (d: Device) => ui.floor !== 'all' && (d.floor ?? 0) !== ui.floor;
  const areaOffFloor = (a: DocArea) => ui.floor !== 'all' && a.floor !== undefined && a.floor !== ui.floor;
  const areas = $derived(editor.topology.areas ?? []);

  // untrack: setCanvasSize liest und verschiebt die Ansicht, das darf diesen Effekt nicht erneut auslösen.
  $effect(() => {
    const size = { width, height };
    untrack(() => editor.setCanvasSize(size.width, size.height));
  });

  // Wheel-Listener müssen aktiv (nicht passiv) sein, damit die Seite nicht scrollt.
  $effect(() => {
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const p = local(event);
      editor.zoomAt(Math.exp(-event.deltaY * 0.0015), p.x, p.y);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  });

  const view = $derived(editor.view);
  const source = $derived(editor.cableSource ? getDevice(editor.topology, editor.cableSource) : undefined);
  const cables = $derived(
    editor.topology.cables.flatMap((cable) => {
      const a = getDevice(editor.topology, cable.a.device);
      const b = getDevice(editor.topology, cable.b.device);
      return a && b ? [{ cable, a, b }] : [];
    }),
  );

  /** Rahmen unterwegs als Punkte, die vom Sender zum Empfänger wandern. */
  const dots = $derived.by(() => {
    void simStore.tick;
    const sim = simStore.sim;
    if (!editor.acting || !sim) return [];
    return sim.getInFlight().flatMap((entry) => {
      const from = getDevice(editor.topology, entry.from.device);
      const to = getDevice(editor.topology, entry.to.device);
      if (!from || !to) return [];
      const progress = Math.min(1, Math.max(0, (sim.now - entry.sent) / (entry.arrives - entry.sent)));
      return [
        {
          id: entry.id,
          x: from.position.x + (to.position.x - from.position.x) * progress,
          y: from.position.y + (to.position.y - from.position.y) * progress,
          protocol: protocolOf(entry.frame).toLowerCase(),
        },
      ];
    });
  });

  function local(event: { clientX: number; clientY: number }): Point {
    const rect = svg.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function world(event: { clientX: number; clientY: number }): Point {
    const p = local(event);
    return editor.screenToWorld(p.x, p.y);
  }

  function onDevicePointerDown(event: PointerEvent, device: Device) {
    if (event.button !== 0) return;
    event.stopPropagation();
    if (offFloor(device)) return;
    if (editor.tool === 'cable') {
      editor.cableClick(device.id);
      return;
    }
    editor.select({ kind: 'device', id: device.id });
    if (!editor.editable) return;
    const p = world(event);
    drag = { id: device.id, offset: { x: device.position.x - p.x, y: device.position.y - p.y } };
    editor.beginDrag();
    svg.setPointerCapture(event.pointerId);
  }

  function onAreaPointerDown(event: PointerEvent, area: DocArea, kind: 'move' | 'resize') {
    if (event.button !== 0) return;
    event.stopPropagation();
    editor.select({ kind: 'area', id: area.id });
    areaDrag = { id: area.id, kind, start: world(event), origin: area };
    editor.beginDrag();
    svg.setPointerCapture(event.pointerId);
  }

  function onBackgroundPointerDown(event: PointerEvent) {
    if (event.button !== 0 && event.button !== 1) return;
    if (event.button === 0 && editor.tool === 'area') {
      const p = world(event);
      drawing = { from: p, to: p };
      svg.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button === 0) {
      if (editor.cableSource) editor.cancel();
      else editor.select(null);
    }
    panFrom = local(event);
    svg.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent) {
    const p = world(event);
    pointer = p;
    if (drawing) {
      drawing = { ...drawing, to: p };
    } else if (areaDrag) {
      const dx = Math.round((p.x - areaDrag.start.x) / GRID) * GRID;
      const dy = Math.round((p.y - areaDrag.start.y) / GRID) * GRID;
      const o = areaDrag.origin;
      if (areaDrag.kind === 'move') editor.dragArea(areaDrag.id, { x: o.x + dx, y: o.y + dy });
      else editor.dragArea(areaDrag.id, { width: Math.max(80, o.width + dx), height: Math.max(60, o.height + dy) });
    } else if (drag) {
      editor.dragTo(drag.id, { x: p.x + drag.offset.x, y: p.y + drag.offset.y });
    } else if (panFrom) {
      const now = local(event);
      editor.panBy(now.x - panFrom.x, now.y - panFrom.y);
      panFrom = now;
    }
  }

  function onPointerUp() {
    if (drawing) {
      const { from, to } = drawing;
      drawing = null;
      const x = Math.min(from.x, to.x);
      const y = Math.min(from.y, to.y);
      const width = Math.abs(to.x - from.x);
      const height = Math.abs(to.y - from.y);
      if (width >= 40 && height >= 40) {
        const color: TagColor = TAG_ORDER[areas.length % TAG_ORDER.length]!;
        editor.addArea({
          title: t('area.defaultTitle', { n: areas.length + 1 }),
          color,
          x: Math.round(x / GRID) * GRID,
          y: Math.round(y / GRID) * GRID,
          width: Math.round(width / GRID) * GRID,
          height: Math.round(height / GRID) * GRID,
          ...(ui.floor !== 'all' ? { floor: ui.floor } : {}),
        });
        editor.setTool('select');
      }
      return;
    }
    if (areaDrag) {
      editor.endDrag();
      areaDrag = null;
    }
    if (drag) {
      editor.endDrag();
      drag = null;
    }
    panFrom = null;
  }

  function onDragOver(event: DragEvent) {
    if (!editor.editable || !event.dataTransfer?.types.includes(DEVICE_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }

  function onDrop(event: DragEvent) {
    const type = event.dataTransfer?.getData(DEVICE_MIME);
    if (!isDeviceType(type)) return;
    event.preventDefault();
    editor.addDevice(type, world(event), ui.floor === 'all' ? 0 : ui.floor);
  }
</script>

<div class="canvas" bind:clientWidth={width} bind:clientHeight={height}>
  <svg
    bind:this={svg}
    class:panning={panFrom !== null}
    class:cable-tool={editor.tool === 'cable' || editor.tool === 'area'}
    role="application"
    aria-label={t('canvas.label')}
    onpointerdown={onBackgroundPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    onpointerleave={() => (pointer = null)}
    ondragover={onDragOver}
    ondrop={onDrop}
  >
    <defs>
      <pattern
        id="grid"
        width={GRID * 2}
        height={GRID * 2}
        patternUnits="userSpaceOnUse"
        patternTransform="translate({view.x} {view.y}) scale({view.scale})"
      >
        <circle class="dot" cx="1" cy="1" r="1" />
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#grid)" />

    <g transform="translate({view.x} {view.y}) scale({view.scale})">
      {#each areas as area (area.id)}
        <AreaShape
          {area}
          interactive={editor.documenting && editor.tool === 'select'}
          faded={areaOffFloor(area)}
          onmove={(e, a) => onAreaPointerDown(e, a, 'move')}
          onresize={(e, a) => onAreaPointerDown(e, a, 'resize')}
        />
      {/each}
      {#if drawing}
        <rect
          class="drawing"
          x={Math.min(drawing.from.x, drawing.to.x)}
          y={Math.min(drawing.from.y, drawing.to.y)}
          width={Math.abs(drawing.to.x - drawing.from.x)}
          height={Math.abs(drawing.to.y - drawing.from.y)}
          rx="12"
        />
      {/if}
      {#each cables as { cable, a, b } (cable.id)}
        <CableLine {cable} {a} {b} faded={offFloor(a) && offFloor(b)} />
      {/each}
      {#if source && pointer}
        <line class="rubber" x1={source.position.x} y1={source.position.y} x2={pointer.x} y2={pointer.y} />
      {/if}
      {#each editor.topology.devices as device (device.id)}
        <DeviceNode {device} onpointerdown={onDevicePointerDown} faded={offFloor(device)} />
      {/each}
      {#each dots as dot (dot.id)}
        <circle class="dot-packet proto-{dot.protocol}" cx={dot.x} cy={dot.y} r="7" />
      {/each}
    </g>
  </svg>

  {#if editor.topology.devices.length === 0}
    <p class="empty">{t('canvas.empty')}</p>
  {/if}
  {#if editor.tool === 'cable'}
    <p class="hint" role="status">
      {source ? t('canvas.cableTarget', { name: source.name }) : t(`canvas.cableStart.${editor.medium}`)}
    </p>
  {:else if editor.tool === 'area'}
    <p class="hint" role="status">{t('canvas.areaDraw')}</p>
  {:else if editor.documenting && areas.length === 0}
    <p class="hint" role="status">{t('canvas.docHint')}</p>
  {/if}
</div>

<style>
  .canvas {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--bg);
  }
  svg {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
    cursor: grab;
  }
  svg.panning {
    cursor: grabbing;
  }
  svg.cable-tool {
    cursor: crosshair;
  }
  .dot {
    fill: var(--grid);
  }
  .dot-packet {
    fill: var(--dot, var(--accent));
    stroke: var(--bg);
    stroke-width: 2;
    pointer-events: none;
  }
  .drawing {
    fill: var(--selected-soft);
    stroke: var(--accent);
    stroke-width: 2;
    stroke-dasharray: 8 5;
    pointer-events: none;
  }
  .rubber {
    stroke: var(--accent);
    stroke-width: 2;
    stroke-dasharray: 6 5;
    pointer-events: none;
  }
  .empty,
  .hint {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    margin: 0;
    pointer-events: none;
    text-align: center;
  }
  .empty {
    top: 45%;
    color: var(--muted);
    font-size: 1.1rem;
  }
  .hint {
    top: 12px;
    padding: 6px 12px;
    border-radius: 6px;
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
    max-width: calc(100% - 32px);
  }
</style>
