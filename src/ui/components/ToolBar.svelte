<script lang="ts">
  import { convert, costOf } from '../../core';
  import { t } from '../../i18n';
  import { command, keyLabel } from '../commands.svelte';
  import { dialogs } from '../state/dialogs.svelte';
  import { editor } from '../state/editor.svelte';
  import { session } from '../state/session.svelte';
  import { ui } from '../state/ui.svelte';
  import Icon from './Icon.svelte';

  /** Werkzeugleiste: die häufigsten Befehle als Symbole, rechts Modus, Kosten und Session. */
  const cost = $derived(ui.has('tool.costs') ? costOf(editor.topology).total : 0);
  const money = (chf: number) => new Intl.NumberFormat('de-CH', { maximumFractionDigits: 0 }).format(convert(chf, ui.currency));

  function tip(id: string): string {
    const c = command(id);
    if (!c) return '';
    return c.keys?.[0] ? `${c.label()} (${keyLabel(c.keys[0])})` : c.label();
  }

  function run(id: string) {
    command(id)?.run();
  }

  function enabled(id: string) {
    return command(id)?.enabled?.() ?? true;
  }

  function shown(id: string) {
    return command(id)?.visible?.() ?? true;
  }
</script>

<div class="toolbar" role="toolbar" aria-label={t('toolbar.label')}>
  <div class="group">
    <button class="icon" onclick={() => run('edit.undo')} disabled={!enabled('edit.undo')} title={tip('edit.undo')} aria-label={t('menu.edit.undo')}><Icon name="undo" /></button>
    <button class="icon" onclick={() => run('edit.redo')} disabled={!enabled('edit.redo')} title={tip('edit.redo')} aria-label={t('menu.edit.redo')}><Icon name="redo" /></button>
  </div>
  <div class="group" role="radiogroup" aria-label={t('toolbar.tools')}>
    <button class="icon" role="radio" aria-checked={editor.tool === 'select'} onclick={() => editor.setTool('select')} title={tip('edit.select')} aria-label={t('menu.edit.select')}><Icon name="pointer" /></button>
    <button class="icon" role="radio" aria-checked={editor.tool === 'cable'} disabled={!editor.editable} onclick={() => run('edit.cable')} title={tip('edit.cable')} aria-label={t('menu.edit.cable')}>
      <Icon name="cable" />
    </button>
    {#if shown('edit.area')}
      <button class="icon" role="radio" aria-checked={editor.tool === 'area'} disabled={!editor.editable} onclick={() => run('edit.area')} title={tip('edit.area')} aria-label={t('menu.edit.area')}><Icon name="area" /></button>
    {/if}
  </div>
  <div class="group">
    <button class="icon" onclick={() => run('view.zoomOut')} title={tip('view.zoomOut')} aria-label={t('menu.view.zoomOut')}><Icon name="zoomOut" /></button>
    <span class="zoom" aria-live="polite">{Math.round(editor.view.scale * 100)} %</span>
    <button class="icon" onclick={() => run('view.zoomIn')} title={tip('view.zoomIn')} aria-label={t('menu.view.zoomIn')}><Icon name="zoomIn" /></button>
    <button class="icon" onclick={() => run('view.fit')} title={tip('view.fit')} aria-label={t('menu.view.fit')}><Icon name="fit" /></button>
  </div>
  <div class="group">
    {#if shown('view.rack')}
      <button class="icon" onclick={() => run('view.rack')} title={tip('view.rack')} aria-label={t('menu.view.rack')}><Icon name="rack" /></button>
    {/if}
    {#if shown('file.snapshots')}
      <button class="icon badge-host" onclick={() => run('file.snapshots')} title={tip('file.snapshots')} aria-label={t('menu.file.snapshots')}>
        <Icon name="snapshot" />
        {#if editor.snapshots.length}<span class="badge">{editor.snapshots.length}</span>{/if}
      </button>
    {/if}
    {#if shown('tool.ipcalc')}
      <button class="icon" onclick={() => run('tool.ipcalc')} title={tip('tool.ipcalc')} aria-label={t('menu.tool.ipcalc')}><Icon name="calc" /></button>
    {/if}
    {#if shown('sim.cli')}
      <button class="icon" onclick={() => run('sim.cli')} disabled={!enabled('sim.cli')} title={tip('sim.cli')} aria-label={t('cli.open')}><Icon name="terminal" /></button>
    {/if}
    <button class="icon" onclick={() => run('help.help')} title={tip('help.help')} aria-label={t('menu.help.help')}><Icon name="help" /></button>
  </div>

  <span class="spacer"></span>

  {#if ui.has('tool.costs')}
    <button class="chip cost" onclick={() => dialogs.show('costs')} title={t('costs.hint')}>
      <Icon name="coins" size={16} />
      {ui.currency} {money(cost)}
    </button>
  {/if}
  <button class="chip" onclick={() => dialogs.show('features')} title={t('features.chipHint')}>
    <Icon name={ui.locked ? 'lock' : 'layers'} size={16} />
    {ui.profile === 'custom' ? t('profile.custom') : t(`profile.short.${ui.profile}`)}
  </button>
  {#if ui.online}
    <button class="chip session" onclick={() => dialogs.show('session')} title={t('session.buttonHint')}>
      {session.code ? t('session.button', { code: session.code }) : t('session.buttonNone')}
    </button>
  {/if}
  <div class="modes" role="radiogroup" aria-label={t('mode.label')}>
    {#if ui.allowed('design')}
      <button role="radio" aria-checked={editor.mode === 'design'} onclick={() => editor.setMode('design')} title="{t('mode.design.hint')} ({keyLabel('M')})">
        <Icon name="pointer" size={15} />
        {t('mode.design')}
      </button>
    {/if}
    {#if ui.allowed('simulation')}
      <button role="radio" aria-checked={editor.mode === 'simulation'} onclick={() => editor.setMode('simulation')} title="{t('mode.simulation.hint')} ({keyLabel('M')})">
        <Icon name="play" size={15} />
        {t('mode.simulation')}
      </button>
    {/if}
  </div>
</div>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px 10px;
    padding: 6px 10px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }
  .group {
    display: flex;
    align-items: center;
    gap: 2px;
    padding-right: 10px;
    border-right: 1px solid var(--border);
  }
  .group:last-of-type {
    border-right: none;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 32px;
    height: 30px;
    padding: 0;
    border: 1px solid transparent;
    background: none;
    border-radius: 7px;
    color: var(--text);
    position: relative;
  }
  .icon:hover:not(:disabled) {
    background: var(--surface-2);
    border-color: var(--border);
  }
  .icon[aria-checked='true'] {
    background: var(--selected-soft);
    border-color: var(--accent);
    color: var(--accent);
  }
  .icon:disabled {
    opacity: 0.35;
  }
  .badge {
    position: absolute;
    top: -3px;
    right: -3px;
    min-width: 15px;
    height: 15px;
    padding: 0 3px;
    border-radius: 8px;
    background: var(--accent);
    color: var(--on-accent);
    font-size: 0.62rem;
    line-height: 15px;
  }
  .zoom {
    min-width: 4.5ch;
    text-align: center;
    font-size: 0.8rem;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .spacer {
    flex: 1;
  }
  .chip {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 0.8rem;
    white-space: nowrap;
  }
  .cost {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }
  .session {
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  }
  .modes {
    display: flex;
    padding: 2px;
    gap: 2px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 9px;
  }
  .modes button {
    display: flex;
    align-items: center;
    gap: 6px;
    border: none;
    border-radius: 7px;
    padding: 5px 12px;
    background: none;
    font-weight: 600;
  }
  .modes button[aria-checked='true'] {
    background: var(--accent);
    color: var(--on-accent);
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.2);
  }
</style>
