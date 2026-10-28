<script lang="ts">
  import { getDevice } from '../../core';
  import { t } from '../../i18n';
  import { cliWindow, closeCli } from '../state/cli.svelte';
  import { editor } from '../state/editor.svelte';
  import CliTerminal from './CliTerminal.svelte';

  /** Konsolenfenster eines Routers oder Switches (wie mit dem Konsolenkabel angeschlossen). */
  const device = $derived(cliWindow.deviceId ? getDevice(editor.topology, cliWindow.deviceId) : undefined);

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closeCli();
    }
  }
</script>

{#if device}
  <div class="window" role="dialog" aria-labelledby="cli-title" tabindex="-1" {onkeydown}>
    <header>
      <h2 id="cli-title">{t('cli.title', { name: device.name })}</h2>
      <span class="hint">{t('cli.hint')}</span>
      <button class="close" onclick={closeCli} aria-label={t('desktop.close')}>✕</button>
    </header>
    <div class="content">
      {#key cliWindow.generation}
        <CliTerminal deviceId={device.id} onclose={closeCli} />
      {/key}
    </div>
  </div>
{/if}

<style>
  .window {
    position: absolute;
    top: 52px;
    left: 16px;
    width: min(680px, calc(100% - 32px));
    height: min(440px, calc(100% - 72px));
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 10px 30px rgba(15, 23, 42, 0.25);
    overflow: hidden;
    z-index: 6;
  }
  header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px 6px 12px;
    background: #2b3440;
    color: #e6ebf1;
  }
  h2 {
    margin: 0;
    font-size: 0.9rem;
    white-space: nowrap;
  }
  .hint {
    flex: 1;
    font-size: 0.75rem;
    opacity: 0.75;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .close {
    padding: 2px 8px;
    color: inherit;
    background: transparent;
    border-color: transparent;
  }
  .content {
    flex: 1;
    min-height: 0;
  }
</style>
