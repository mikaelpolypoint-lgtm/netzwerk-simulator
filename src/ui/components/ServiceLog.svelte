<script lang="ts">
  import type { Device } from '../../core';
  import { t } from '../../i18n';
  import { simStore } from '../state/sim.svelte';

  /** Desktop-Anwendung eines Server-Dienstes (DNS, Web, Mail): Konfiguration in Kurzform und Protokoll. */
  let { device, prefix, summary }: { device: Device; prefix: string | string[]; summary: string[] } = $props();

  const prefixes = $derived(Array.isArray(prefix) ? prefix : [prefix]);
  const log = $derived(
    ((simStore.tick, simStore.sim?.getDeviceState(device.id).console) ?? []).filter((l) => prefixes.some((p) => l.code.startsWith(p))),
  );
</script>

<div class="view">
  <ul class="summary">
    {#each summary as line, i (i)}
      <li>{line}</li>
    {/each}
  </ul>
  <h3>{t('dhcpServer.log')}</h3>
  <ol class="log">
    {#each log as line, i (i)}
      <li><span class="time">{(line.time / 1000).toFixed(3)}</span> {t(`console.${line.code}`, line.params)}</li>
    {:else}
      <li class="muted">{t('actions.consoleEmpty')}</li>
    {/each}
  </ol>
</div>

<style>
  .view {
    height: 100%;
    overflow-y: auto;
    padding: 10px 12px;
    font-size: 0.85rem;
  }
  .summary {
    margin: 0;
    padding-left: 18px;
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    font-size: 0.8rem;
  }
  h3 {
    margin: 12px 0 6px;
    font-size: 0.85rem;
  }
  .log {
    list-style: none;
    margin: 0;
    padding: 0;
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    font-size: 0.75rem;
  }
  .log li {
    padding: 2px 0;
  }
  .time,
  .muted {
    color: var(--muted);
  }
</style>
