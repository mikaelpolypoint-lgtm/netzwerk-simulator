<script lang="ts">
  import { t } from '../../i18n';
  import { editor, type Mode } from '../state/editor.svelte';

  let { onopen, onsave }: { onopen: () => void; onsave: () => void } = $props();

  const modes: Mode[] = ['design', 'action'];
</script>

<header class="toolbar">
  <h1>{t('app.title')}</h1>

  <div class="group" role="group">
    <button disabled={!editor.editable} onclick={() => editor.clear()}>{t('toolbar.new')}</button>
    <button disabled={!editor.editable} onclick={onopen} title="{t('toolbar.open')} (Strg+O)">{t('toolbar.open')}</button>
    <button onclick={onsave} title="{t('toolbar.save')} (Strg+S)">{t('toolbar.save')}</button>
  </div>

  <div class="group" role="group">
    <button disabled={!editor.canUndo} onclick={() => editor.undo()} title="{t('toolbar.undo')} (Strg+Z)">
      {t('toolbar.undo')}
    </button>
    <button disabled={!editor.canRedo} onclick={() => editor.redo()} title="{t('toolbar.redo')} (Strg+Y)">
      {t('toolbar.redo')}
    </button>
  </div>

  <div class="group" role="group">
    <button aria-pressed={editor.tool === 'select'} onclick={() => editor.setTool('select')}>
      {t('toolbar.select')}
    </button>
    <button
      aria-pressed={editor.tool === 'cable'}
      disabled={!editor.editable}
      onclick={() => editor.setTool(editor.tool === 'cable' ? 'select' : 'cable')}
      title="{t('toolbar.cable')} (K)"
    >
      {t('toolbar.cable')}
    </button>
  </div>

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
</header>

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
