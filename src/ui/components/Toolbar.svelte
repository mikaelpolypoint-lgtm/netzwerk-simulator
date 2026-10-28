<script lang="ts">
  import { LOCALES, locale, setLocale, t, type Locale } from '../../i18n';
  import { editor, type Mode } from '../state/editor.svelte';
  import { ui } from '../state/ui.svelte';
  import AboutDialog from './AboutDialog.svelte';
  import SnapshotDialog from './SnapshotDialog.svelte';

  let { onopen, onsave }: { onopen: () => void; onsave: () => void } = $props();

  const modes: Mode[] = ['design', 'action', 'doc'];
  let about = $state(false);
  let snapshots = $state(false);
</script>

<header class="toolbar">
  <h1>{t('app.title')}</h1>

  <div class="group" role="group">
    <button disabled={!editor.editable} onclick={() => editor.clear()}>{t('toolbar.new')}</button>
    <button disabled={!editor.editable} onclick={onopen} title="{t('toolbar.open')} ({t('key.ctrl')}+O)">{t('toolbar.open')}</button>
    <button onclick={onsave} title="{t('toolbar.save')} ({t('key.ctrl')}+S)">{t('toolbar.save')}</button>
  </div>

  <div class="group" role="group">
    <button disabled={!editor.canUndo} onclick={() => editor.undo()} title="{t('toolbar.undo')} ({t('key.ctrl')}+Z)">
      {t('toolbar.undo')}
    </button>
    <button disabled={!editor.canRedo} onclick={() => editor.redo()} title="{t('toolbar.redo')} ({t('key.ctrl')}+Y)">
      {t('toolbar.redo')}
    </button>
  </div>

  <div class="group" role="group">
    <button aria-pressed={editor.tool === 'select'} onclick={() => editor.setTool('select')}>
      {t('toolbar.select')}
    </button>
    {#if editor.documenting}
      <button aria-pressed={editor.tool === 'area'} onclick={() => editor.setTool(editor.tool === 'area' ? 'select' : 'area')} title={t('toolbar.areaHint')}>
        {t('toolbar.area')}
      </button>
    {:else}
      <button
        aria-pressed={editor.tool === 'cable'}
        disabled={!editor.editable}
        onclick={() => editor.setTool(editor.tool === 'cable' ? 'select' : 'cable')}
        title="{t('toolbar.cable')} (K)"
      >
        {t('toolbar.cable')}
      </button>
    {/if}
  </div>

  <button onclick={() => (snapshots = true)} title={t('toolbar.snapshotsHint')}>
    {t('toolbar.snapshots')}{editor.snapshots.length ? ` (${editor.snapshots.length})` : ''}
  </button>

  <div class="group" role="group">
    <button onclick={() => editor.zoomAt(1 / 1.2)} aria-label={t('toolbar.zoomOut')} title="{t('toolbar.zoomOut')} (−)">−</button>
    <span class="zoom" aria-live="polite">{Math.round(editor.view.scale * 100)} %</span>
    <button onclick={() => editor.zoomAt(1.2)} aria-label={t('toolbar.zoomIn')} title="{t('toolbar.zoomIn')} (+)">+</button>
    <button onclick={() => editor.fit()} title="{t('toolbar.fit')} (0)">{t('toolbar.fit')}</button>
    <button disabled={!editor.selection} onclick={() => editor.centerSelection()}>{t('toolbar.center')}</button>
  </div>

  <div class="modes" role="radiogroup" aria-label={t('mode.label')}>
    {#each modes as mode (mode)}
      <button role="radio" aria-checked={editor.mode === mode} onclick={() => editor.setMode(mode)}>
        {t(`mode.${mode}`)}
      </button>
    {/each}
  </div>

  <div class="level" role="radiogroup" aria-label={t('level.label')} title={t('level.hint')}>
    <button role="radio" aria-checked={!ui.pro} onclick={() => ui.setLevel('basic')}>{t('level.basic')}</button>
    <button role="radio" aria-checked={ui.pro} onclick={() => ui.setLevel('pro')}>{t('level.pro')}</button>
  </div>

  <label class="language">
    <span class="visually-hidden">{t('toolbar.language')}</span>
    <select value={locale()} onchange={(e) => setLocale(e.currentTarget.value as Locale)} title={t('toolbar.language')}>
      {#each LOCALES as code (code)}
        <option value={code}>{code.toUpperCase()}</option>
      {/each}
    </select>
  </label>

  <button onclick={() => (about = true)}>{t('toolbar.about')}</button>
</header>

{#if about}
  <AboutDialog onclose={() => (about = false)} />
{/if}
{#if snapshots}
  <SnapshotDialog onclose={() => (snapshots = false)} />
{/if}

<style>
  .toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px 16px;
    padding: 8px 12px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }
  .language select {
    font: inherit;
    padding: 2px 4px;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
  }
  h1 {
    margin: 0 8px 0 0;
    font-size: 1.05rem;
    white-space: nowrap;
  }
  .group {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .zoom {
    min-width: 4.5ch;
    text-align: center;
    font-size: 0.85rem;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .level {
    display: flex;
    border: 1px solid var(--border);
    border-radius: 999px;
    overflow: hidden;
  }
  .level button {
    border: none;
    border-radius: 0;
    font-size: 0.8rem;
    padding: 4px 10px;
  }
  .level button[aria-checked='true'] {
    background: var(--text);
    color: var(--surface);
    font-weight: 600;
  }
  .modes {
    margin-left: auto;
    display: flex;
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
  }
  .modes button {
    border: none;
    border-radius: 0;
  }
  .modes button[aria-checked='true'] {
    background: var(--accent);
    color: var(--on-accent);
  }
</style>
