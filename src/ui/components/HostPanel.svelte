<script lang="ts">
  import { tick } from 'svelte';
  import type { Device } from '../../core';
  import { t } from '../../i18n';
  import { simStore } from '../state/sim.svelte';
  import StateTables from './StateTables.svelte';

  let { device }: { device: Device } = $props();

  let target = $state('');
  let output: HTMLOListElement | undefined = $state();

  const deviceState = $derived((simStore.tick, simStore.sim?.getDeviceState(device.id)));
  const lines = $derived(deviceState?.console ?? []);
  const arp = $derived(deviceState?.arp ?? []);
  const now = $derived((simStore.tick, simStore.sim?.now ?? 0));
  const iface = $derived(device.interfaces[0]);

  $effect(() => {
    void lines.length;
    tick().then(() => output?.scrollTo({ top: output.scrollHeight }));
  });

  function ping(event: SubmitEvent) {
    event.preventDefault();
    if (!target.trim()) return;
    simStore.ping(device.id, target);
  }
</script>

<dl class="facts">
  <dt>{t('config.ip')}</dt>
  <dd class="mono">{iface?.ip ?? '–'}</dd>
  <dt>{t('config.mask')}</dt>
  <dd class="mono">{iface?.mask ?? '–'}</dd>
  <dt>{t('config.gateway')}</dt>
  <dd class="mono">{device.gateway ?? '–'}</dd>
</dl>

<form class="ping" onsubmit={ping}>
  <label for="ping-target">{t('actions.ping')}</label>
  <div class="row">
    <input
      id="ping-target"
      type="text"
      inputmode="decimal"
      autocomplete="off"
      spellcheck="false"
      placeholder={t('actions.target')}
      bind:value={target}
    />
    <button type="submit" disabled={!target.trim()}>{t('actions.send')}</button>
  </div>
</form>

<div class="heading">
  <h3>{t('actions.console')}</h3>
  <button class="small" onclick={() => simStore.clearConsole(device.id)} disabled={lines.length === 0}>
    {t('actions.clear')}
  </button>
</div>
<ol class="console" bind:this={output} aria-live="polite">
  {#each lines as line, i (i)}
    <li>{t(`console.${line.code}`, line.params)}</li>
  {:else}
    <li class="muted">{t('actions.consoleEmpty')}</li>
  {/each}
</ol>

<StateTables {device} {arp} {now} />

<style>
  .facts {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 12px;
    margin: 0 0 12px;
    font-size: 0.8rem;
  }
  .facts dt {
    color: var(--muted);
  }
  .facts dd {
    margin: 0;
  }
  .ping {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 4px;
    font-size: 0.85rem;
    font-weight: 600;
  }
  .row {
    display: flex;
    gap: 6px;
  }
  input {
    flex: 1;
    width: 0;
    min-width: 0;
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    font-size: 0.9rem;
    padding: 5px 8px;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
  }
  .heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 16px;
  }
  h3 {
    margin: 16px 0 6px;
    font-size: 0.85rem;
  }
  .heading h3 {
    margin: 0;
  }
  .small {
    font-size: 0.75rem;
    padding: 2px 8px;
  }
  .console {
    list-style: none;
    margin: 6px 0 0;
    padding: 8px;
    max-height: 220px;
    overflow-y: auto;
    border-radius: 6px;
    background: var(--console-bg);
    color: var(--console-text);
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    font-size: 0.75rem;
    line-height: 1.5;
  }
  .console .muted {
    color: inherit;
    opacity: 0.6;
  }
  .mono {
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  }
</style>
