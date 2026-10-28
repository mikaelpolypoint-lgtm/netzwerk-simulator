<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { parseProject, serializeProject } from '../core';
  import { locale, t } from '../i18n';
  import Canvas from './components/Canvas.svelte';
  import CliWindow from './components/CliWindow.svelte';
  import FloorBar from './components/FloorBar.svelte';
  import Desktop from './components/Desktop.svelte';
  import SimControls from './components/SimControls.svelte';
  import Inspector from './components/Inspector.svelte';
  import PacketList from './components/PacketList.svelte';
  import Palette from './components/Palette.svelte';
  import TaskPanel from './components/TaskPanel.svelte';
  import Toast from './components/Toast.svelte';
  import Toolbar from './components/Toolbar.svelte';
  import { errorText } from './labels';
  import { downloadText, projectFilename } from './persist/files';
  import { loadAutosave, saveAutosave } from './persist/storage';
  import { editor } from './state/editor.svelte';
  import { closeDesktop } from './state/desktop.svelte';
  import { simStore } from './state/sim.svelte';
  import { ui, usesProFeatures } from './state/ui.svelte';
  import type { Topology } from '../core';

  /** Projekte mit VLANs, NAT usw. brauchen den Pro-Modus, sonst wären Einstellungen versteckt. */
  function ensureLevel(topology: Topology) {
    if (!ui.pro && usesProFeatures(topology)) {
      ui.setLevel('pro');
      editor.notify(t('level.switchedToPro'));
    }
  }

  let fileInput: HTMLInputElement;

  // Sprache der Seite für Vorlesehilfen und Silbentrennung.
  $effect(() => {
    document.documentElement.lang = locale();
    document.title = t('app.title');
  });

  // Im Aktionsmodus läuft die Simulation, beim Zurückwechseln pausiert sie (Zustände bleiben).
  $effect(() => {
    const { mode, topology, generation } = editor;
    untrack(() => {
      if (mode === 'action') return simStore.activate(topology, generation);
      simStore.deactivate();
      closeDesktop();
    });
  });
  let restored = $state(false);

  onMount(async () => {
    const text = await loadAutosave();
    const parsed = text ? parseProject(text) : null;
    if (parsed?.ok && (parsed.topology.devices.length > 0 || parsed.tasks || parsed.snapshots)) {
      editor.replace(parsed.topology, { undoable: false, tasks: parsed.tasks ?? null, snapshots: parsed.snapshots ?? [] });
      editor.notify(t('status.restored'));
      ensureLevel(parsed.topology);
    }
    restored = true;
  });

  // Erst nach dem Wiederherstellen speichern, sonst überschreibt das leere Startprojekt den alten Stand.
  let pendingSave: (() => void) | null = null;
  $effect(() => {
    const { topology, tasks, snapshots } = editor;
    if (!restored) return;
    const flush = () => {
      clearTimeout(timer);
      pendingSave = null;
      saveAutosave(serializeProject(topology, tasks, snapshots));
    };
    const timer = setTimeout(flush, 400);
    pendingSave = flush;
    return () => clearTimeout(timer);
  });

  // Beim Schliessen oder Neuladen nicht auf das Zeitfenster warten.
  function onpagehide() {
    pendingSave?.();
  }

  function onvisibilitychange() {
    if (document.visibilityState === 'hidden') pendingSave?.();
  }

  function save() {
    const filename = projectFilename();
    downloadText(filename, serializeProject(editor.topology, editor.tasks, editor.snapshots));
    editor.notify(t('status.saved', { file: filename }));
  }

  function open() {
    if (editor.editable) fileInput.click();
  }

  async function onFileChosen() {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    let text: string;
    try {
      text = await file.text();
    } catch {
      editor.notify(t('error.readFailed'), 'error');
      return;
    }
    const parsed = parseProject(text);
    if (!parsed.ok) {
      editor.notify(errorText(parsed.error), 'error');
      return;
    }
    editor.replace(parsed.topology, { undoable: true, tasks: parsed.tasks ?? null, snapshots: parsed.snapshots ?? [] });
    ensureLevel(parsed.topology);
    editor.notify(t(parsed.tasks ? 'status.loadedTask' : 'status.loaded', { file: file.name, title: parsed.tasks?.title ?? '' }));
  }

  const ARROWS: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };

  function onkeydown(event: KeyboardEvent) {
    if ((event.target as Element | null)?.closest('input, textarea, select, [contenteditable]')) return;
    const key = event.key.toLowerCase();
    if (event.ctrlKey || event.metaKey) {
      if (key === 'z' && event.shiftKey) editor.redo();
      else if (key === 'z') editor.undo();
      else if (key === 'y') editor.redo();
      else if (key === 's') save();
      else if (key === 'o') open();
      else return;
      event.preventDefault();
      return;
    }
    if (event.altKey) return;

    const arrow = ARROWS[event.key];
    if (arrow) {
      const device = editor.selectedDevice;
      if (!device) return;
      const step = event.shiftKey ? 50 : 10;
      editor.moveBy(device.id, arrow[0] * step, arrow[1] * step);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      editor.deleteSelection();
    } else if (event.key === 'Escape') {
      editor.cancel();
    } else if (key === 'k') {
      editor.setTool(editor.tool === 'cable' ? 'select' : 'cable');
    } else if (event.key === 'F2') {
      document.getElementById('inspector-name')?.focus();
    } else if (event.key === '+' || event.key === '=') {
      editor.zoomAt(1.2);
    } else if (event.key === '-') {
      editor.zoomAt(1 / 1.2);
    } else if (event.key === '0') {
      editor.fit();
    } else {
      return;
    }
    event.preventDefault();
  }
</script>

<svelte:window {onkeydown} {onpagehide} />
<svelte:document {onvisibilitychange} />

<div class="app">
  <Toolbar onopen={open} onsave={save} />
  <div class="left">
    <Palette />
    <TaskPanel />
  </div>
  <main>
    {#if editor.mode === 'action'}
      <SimControls />
    {/if}
    <FloorBar />
    <Canvas />
    <CliWindow />
    {#if editor.mode === 'action'}
      <div class="packet-panel">
        <PacketList />
      </div>
      <Desktop />
    {/if}
  </main>
  <Inspector />
</div>
<Toast />

<input
  bind:this={fileInput}
  type="file"
  accept=".json,application/json"
  hidden
  onchange={onFileChosen}
/>

<style>
  .app {
    display: grid;
    grid-template-columns: 220px minmax(0, 1fr) 300px;
    grid-template-rows: auto minmax(0, 1fr);
    height: 100vh;
  }
  .app > :global(header) {
    grid-column: 1 / -1;
  }
  .left,
  .app > :global(aside) {
    background: var(--surface);
  }
  .left {
    border-right: 1px solid var(--border);
    overflow-y: auto;
    min-height: 0;
  }
  .app > :global(aside) {
    border-left: 1px solid var(--border);
  }
  main {
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  main > :global(.canvas) {
    flex: 1;
    min-height: 0;
  }
  .packet-panel {
    height: 38%;
    min-height: 160px;
  }
  @media (max-width: 1100px) {
    .app {
      grid-template-columns: 180px minmax(0, 1fr) 250px;
    }
  }
</style>
