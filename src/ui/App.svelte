<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { parseProject, serializeProject } from '../core';
  import { locale, t } from '../i18n';
  import { ensureProjectFeatures } from './actions';
  import { handleShortcut } from './commands.svelte';
  import Canvas from './components/Canvas.svelte';
  import CliWindow from './components/CliWindow.svelte';
  import Desktop from './components/Desktop.svelte';
  import DialogHost from './components/DialogHost.svelte';
  import FloorBar from './components/FloorBar.svelte';
  import HelpPanel from './components/HelpPanel.svelte';
  import Inspector from './components/Inspector.svelte';
  import MenuBar from './components/MenuBar.svelte';
  import PacketList from './components/PacketList.svelte';
  import Palette from './components/Palette.svelte';
  import ShopFlyout from './components/ShopFlyout.svelte';
  import SimControls from './components/SimControls.svelte';
  import StormBanner from './components/StormBanner.svelte';
  import TaskPanel from './components/TaskPanel.svelte';
  import Toast from './components/Toast.svelte';
  import ToolBar from './components/ToolBar.svelte';
  import { loadAutosave, saveAutosave } from './persist/storage';
  import { closeDesktop } from './state/desktop.svelte';
  import { dialogs } from './state/dialogs.svelte';
  import { editor } from './state/editor.svelte';
  import { session } from './state/session.svelte';
  import { simStore } from './state/sim.svelte';
  import { normalizePolicy, ui } from './state/ui.svelte';

  /** Alle paar Minuten automatisch einen Zwischenstand sichern (nur bei Änderungen). */
  const AUTO_SNAPSHOT_MS = 5 * 60_000;

  // Hell/Dunkel: «auto» folgt dem System.
  $effect(() => {
    const root = document.documentElement;
    if (ui.theme === 'auto') delete root.dataset.theme;
    else root.dataset.theme = ui.theme;
  });

  // Vom Admin gesperrte Modi verlassen (Webversion).
  $effect(() => {
    const mode = editor.mode;
    if (!ui.allowed(mode)) {
      const fallback = (['design', 'simulation'] as const).find((m) => ui.allowed(m));
      if (fallback) untrack(() => editor.setMode(fallback));
    }
  });

  // Sprache der Seite für Vorlesehilfen und Silbentrennung.
  $effect(() => {
    document.documentElement.lang = locale();
    document.title = t('app.title');
  });

  // In der Simulation läuft die Zeit, im Entwurf pausiert sie (Zustände bleiben).
  $effect(() => {
    const { mode, topology, generation } = editor;
    untrack(() => {
      if (mode === 'simulation') return simStore.activate(topology, generation);
      simStore.deactivate();
      closeDesktop();
    });
  });

  let restored = $state(false);

  onMount(() => {
    void restore();
    // Nur wenn sich seit dem letzten automatischen Snapshot etwas geändert hat.
    let last = editor.topology;
    const timer = setInterval(() => {
      if (editor.topology === last) return;
      last = editor.topology;
      if (ui.has('tool.snapshots') && editor.topology.devices.length > 0) editor.createSnapshot(t('snapshot.autoTimer', { time: new Date().toLocaleTimeString().slice(0, 5) }), true);
    }, AUTO_SNAPSHOT_MS);
    return () => clearInterval(timer);
  });

  async function restore() {
    // Webversion: Regeln des Admins laden und eine laufende Session fortsetzen.
    // Ohne Session beginnt die Webversion leer (keine Reste aus dem Browser).
    if (ui.online) {
      const config = await session.loadConfig();
      if (config) ui.setPolicy(normalizePolicy(config.policy));
      const remote = await session.restore();
      if (remote) {
        editor.replace(remote.topology, { undoable: false, tasks: remote.tasks ?? null, snapshots: remote.snapshots ?? [] });
        editor.notify(t('session.restored', { code: session.code ?? '' }));
        ensureProjectFeatures();
      }
      restored = true;
      return;
    }
    const text = await loadAutosave();
    const parsed = text ? parseProject(text) : null;
    if (parsed?.ok && (parsed.topology.devices.length > 0 || parsed.tasks || parsed.snapshots)) {
      editor.replace(parsed.topology, { undoable: false, tasks: parsed.tasks ?? null, snapshots: parsed.snapshots ?? [] });
      editor.notify(t('status.restored'));
      ensureProjectFeatures();
    }
    restored = true;
  }

  // Erst nach dem Wiederherstellen speichern, sonst überschreibt das leere Startprojekt den alten Stand.
  let pendingSave: (() => void) | null = null;
  $effect(() => {
    const { topology, tasks, snapshots } = editor;
    if (!restored) return;
    const flush = () => {
      clearTimeout(timer);
      pendingSave = null;
      const json = serializeProject(topology, tasks, snapshots);
      if (!ui.online) saveAutosave(json);
      else session.schedule(json, topology.devices.length > 0);
    };
    const timer = setTimeout(flush, 400);
    pendingSave = flush;
    return () => clearTimeout(timer);
  });

  // Beim Schliessen oder Neuladen nicht auf das Zeitfenster warten.
  function onpagehide() {
    pendingSave?.();
    void session.flush();
  }

  function onvisibilitychange() {
    if (document.visibilityState === 'hidden') pendingSave?.();
  }

  const ARROWS: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };

  function onkeydown(event: KeyboardEvent) {
    // Offene Dialoge behandeln ihre Tasten selbst.
    if (document.querySelector('dialog[open]')) return;
    if (handleShortcut(event)) {
      event.preventDefault();
      return;
    }
    if ((event.target as Element | null)?.closest('input, textarea, select, [contenteditable], [role="menu"], [role="menubar"]')) return;
    const arrow = ARROWS[event.key];
    const device = editor.selectedDevice;
    if (arrow && device && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const step = event.shiftKey ? 50 : 10;
      editor.moveBy(device.id, arrow[0] * step, arrow[1] * step);
      event.preventDefault();
    }
  }
</script>

<svelte:window {onkeydown} {onpagehide} />
<svelte:document {onvisibilitychange} />

<div class="app" class:help-open={dialogs.help !== null}>
  <MenuBar />
  <ToolBar />
  <div class="body">
    <div class="left">
      <div class="left-scroll">
        <Palette />
        <TaskPanel />
      </div>
      <ShopFlyout />
    </div>
    <main>
      {#if editor.acting}
        <SimControls />
        <StormBanner />
      {/if}
      <FloorBar />
      <Canvas />
      <CliWindow />
      {#if editor.acting && ui.has('tool.sniffer')}
        <div class="packet-panel">
          <PacketList />
        </div>
      {/if}
      {#if editor.acting}
        <Desktop />
      {/if}
    </main>
    <Inspector />
  </div>
</div>
<DialogHost />
{#if dialogs.help !== null}
  <HelpPanel />
{/if}
<Toast />

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }
  .body {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 210px minmax(0, 1fr) 310px;
  }
  .left {
    position: relative;
    background: var(--surface);
    border-right: 1px solid var(--border);
    min-height: 0;
    z-index: 5;
  }
  .left-scroll {
    height: 100%;
    overflow-y: auto;
  }
  .body > :global(aside) {
    background: var(--surface);
    border-left: 1px solid var(--border);
    min-height: 0;
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
    height: 40%;
    min-height: 180px;
  }
  @media (max-width: 1100px) {
    .body {
      grid-template-columns: 180px minmax(0, 1fr) 260px;
    }
  }
</style>
