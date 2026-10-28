<script lang="ts">
  import { DEFAULT_DNS_TTL, type Device, type DnsType } from '../../core';
  import { t } from '../../i18n';
  import { editor } from '../state/editor.svelte';

  /** Entwurfsmodus, Rechner: DNS-Server mit seiner Zone (Namen → Adressen). */
  let { device }: { device: Device } = $props();

  let record = $state({ name: '', type: 'A' as DnsType, value: '', ttl: String(DEFAULT_DNS_TTL) });
  let error = $state<{ field?: string; text: string } | null>(null);
  const records = $derived(device.dnsServer?.records ?? []);

  function add(event: SubmitEvent) {
    event.preventDefault();
    const failure = editor.addDnsRecord(device.id, { ...record, ttl: Number(record.ttl) });
    error = failure ? { field: failure.field, text: t(`error.${failure.code}`, failure.params) } : null;
    if (!failure) record = { ...record, name: '', value: '' };
  }
</script>

<label class="toggle">
  <input type="checkbox" checked={!!device.dnsServer} onchange={(e) => editor.setDnsServerEnabled(device.id, e.currentTarget.checked)} />
  {t('dnsServer.enable')}
</label>

{#if device.dnsServer}
  {#if records.length === 0}
    <p class="muted">{t('dnsServer.noRecords')}</p>
  {:else}
    <table>
      <thead>
        <tr>
          <th scope="col">{t('dnsServer.name')}</th>
          <th scope="col">{t('dnsServer.type')}</th>
          <th scope="col">{t('dnsServer.value')}</th>
          <th scope="col">TTL</th>
          <th scope="col"><span class="visually-hidden">{t('dnsServer.remove')}</span></th>
        </tr>
      </thead>
      <tbody>
        {#each records as r, i (i)}
          <tr>
            <td class="mono">{r.name}</td>
            <td>{r.type}</td>
            <td class="mono">{r.value}</td>
            <td>{r.ttl}</td>
            <td>
              <button class="small" aria-label={t('dnsServer.removeRecord', { name: r.name })} onclick={() => editor.removeDnsRecord(device.id, i)}>
                ✕
              </button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}

  <form class="add" onsubmit={add}>
    <div class="grid">
      <label>
        <span>{t('dnsServer.name')}</span>
        <input bind:value={record.name} placeholder="webserver1" autocomplete="off" spellcheck="false" aria-invalid={error?.field === 'name'} />
      </label>
      <label>
        <span>{t('dnsServer.type')}</span>
        <select bind:value={record.type}>
          <option value="A">{t('dnsServer.typeA')}</option>
          <option value="MX">{t('dnsServer.typeMX')}</option>
        </select>
      </label>
      <label>
        <span>{record.type === 'A' ? t('config.ip') : t('dnsServer.mailHost')}</span>
        <input
          bind:value={record.value}
          placeholder={record.type === 'A' ? '192.168.0.3' : 'mail.schule.ch'}
          autocomplete="off"
          spellcheck="false"
          aria-invalid={error?.field === 'value'}
        />
      </label>
      <label>
        <span>{t('dnsServer.ttl')}</span>
        <input bind:value={record.ttl} inputmode="numeric" aria-invalid={error?.field === 'ttl'} />
      </label>
    </div>
    {#if error}
      <p class="error" role="alert">{error.text}</p>
    {/if}
    <button type="submit" disabled={!record.name.trim() || !record.value.trim()}>{t('dnsServer.add')}</button>
  </form>
  <p class="muted">{t('dnsServer.explain')}</p>
{/if}

<style>
  .toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.85rem;
    margin-bottom: 8px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.75rem;
    margin-bottom: 8px;
  }
  th,
  td {
    text-align: left;
    padding: 3px 4px;
    border-bottom: 1px solid var(--border);
  }
  th {
    color: var(--muted);
    font-weight: normal;
  }
  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 6px;
    margin-bottom: 6px;
  }
  .grid label {
    display: grid;
    gap: 2px;
    font-size: 0.75rem;
  }
  input,
  select {
    width: 100%;
    min-width: 0;
    font-size: 0.8rem;
    padding: 4px 6px;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
  }
  input {
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  }
  input[aria-invalid='true'] {
    border-color: var(--danger);
  }
  .small {
    font-size: 0.7rem;
    padding: 1px 6px;
  }
  .mono {
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  }
  .error {
    margin: 4px 0;
    font-size: 0.8rem;
    color: var(--danger);
  }
  .muted {
    margin: 6px 0 0;
    font-size: 0.75rem;
    color: var(--muted);
  }
</style>
