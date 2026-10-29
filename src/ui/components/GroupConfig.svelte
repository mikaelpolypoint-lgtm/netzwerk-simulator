<script lang="ts">
  import { MAX_GROUP_SIZE, prefixForHosts, type Device } from '../../core';
  import { t } from '../../i18n';
  import { editor } from '../state/editor.svelte';
  import { simStore } from '../state/sim.svelte';

  /**
   * Client-Gruppe: viele gleiche Rechner (z.B. ein Büro mit 50 PCs) an einem
   * Anschluss. Alle beziehen ihre Adresse per DHCP – der Bereich des Servers
   * muss gross genug sein.
   */
  let { device }: { device: Device } = $props();
  const size = $derived(device.groupSize ?? 0);
  const prefix = $derived(prefixForHosts(size + 2));
  const members = $derived((simStore.tick, editor.acting ? (simStore.sim?.getDeviceState(device.id).group ?? []) : []));
  const withIp = $derived(members.filter((m) => m.ip).length);
</script>

<h3>{t('group.title')}</h3>
<label class="field">
  <span>{t('group.size')}</span>
  <input type="number" min="2" max={MAX_GROUP_SIZE} value={size} disabled={!editor.editable} onchange={(e) => editor.setGroupSize(device.id, Number(e.currentTarget.value))} />
</label>
<p class="muted">{t('group.dhcp')}</p>
{#if prefix}
  <p class="need">{t('group.need', { n: size, prefix, hosts: 2 ** (32 - prefix) - 2 })}</p>
{/if}
{#if editor.acting}
  <p class:ok={withIp === members.length} class:warn={withIp < members.length}>{t('group.status', { n: withIp, total: members.length })}</p>
  <details>
    <summary>{t('group.members')}</summary>
    <table>
      <thead><tr><th>#</th><th>MAC</th><th>IP</th></tr></thead>
      <tbody>
        {#each members.slice(0, 100) as m (m.member)}
          <tr><td>{m.member}</td><td class="mono">{m.mac}</td><td class="mono">{m.ip ?? t(`dhcpState.${m.dhcpState ?? 'idle'}`)}</td></tr>
        {/each}
      </tbody>
    </table>
  </details>
{/if}

<style>
  h3 {
    margin: 12px 0 6px;
    font-size: 0.85rem;
  }
  .field {
    display: grid;
    gap: 2px;
    font-size: 0.8rem;
  }
  input {
    font: inherit;
    padding: 5px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
    color: var(--text);
    width: 7rem;
  }
  .muted {
    color: var(--muted);
    font-size: 0.78rem;
  }
  .need {
    font-size: 0.8rem;
    padding: 6px 8px;
    border-radius: 6px;
    background: var(--surface-2);
  }
  .ok {
    color: #16a34a;
    font-size: 0.8rem;
  }
  .warn {
    color: var(--danger);
    font-size: 0.8rem;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.75rem;
  }
  td,
  th {
    text-align: left;
    padding: 1px 4px;
    border-bottom: 1px solid var(--border);
  }
  .mono {
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  }
  summary {
    cursor: pointer;
    font-size: 0.8rem;
  }
</style>
