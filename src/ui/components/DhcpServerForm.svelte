<script lang="ts">
  import { DEFAULT_LEASE_TIME, type Device, type DhcpServerConfig } from '../../core';
  import { t } from '../../i18n';
  import { editor } from '../state/editor.svelte';

  /** Entwurfsmodus, Rechner: DHCP-Server-Dienst einrichten. */
  let { device }: { device: Device } = $props();

  type Field = 'start' | 'end' | 'gateway' | 'dns' | 'leaseTime';
  const fields: Field[] = ['start', 'end', 'gateway', 'dns', 'leaseTime'];

  let enabled = $state(false);
  let draft = $state<Record<Field, string>>({ start: '', end: '', gateway: '', dns: '', leaseTime: '' });
  let error = $state<{ field?: string; text: string } | null>(null);

  $effect(() => {
    const s = device.dhcpServer;
    enabled = !!s;
    draft = {
      start: s?.start ?? '',
      end: s?.end ?? '',
      gateway: s?.gateway ?? '',
      dns: s?.dns ?? '',
      leaseTime: String(s?.leaseTime ?? DEFAULT_LEASE_TIME),
    };
    error = null;
  });

  function apply(event: SubmitEvent) {
    event.preventDefault();
    let config: DhcpServerConfig | null = null;
    if (enabled) {
      config = {
        start: draft.start,
        end: draft.end,
        leaseTime: Number(draft.leaseTime),
        ...(draft.gateway.trim() ? { gateway: draft.gateway } : {}),
        ...(draft.dns.trim() ? { dns: draft.dns } : {}),
      };
    }
    const failure = editor.setDhcpServer(device.id, config);
    error = failure ? { field: failure.field, text: t(`error.${failure.code}`, failure.params) } : null;
  }
</script>

<form class="dhcp" onsubmit={apply}>
  <label class="toggle">
    <input type="checkbox" bind:checked={enabled} />
    {t('dhcpServer.enable')}
  </label>
  {#if enabled}
    {#each fields as field (field)}
      <label class="field">
        <span>{t(`dhcpServer.field.${field}`)}</span>
        <input
          bind:value={draft[field]}
          inputmode={field === 'leaseTime' ? 'numeric' : 'decimal'}
          autocomplete="off"
          spellcheck="false"
          aria-invalid={error?.field === field}
        />
      </label>
      {#if error?.field === field}
        <p class="error" role="alert">{error.text}</p>
      {/if}
    {/each}
    <p class="muted">{t('dhcpServer.explain')}</p>
  {/if}
  {#if error && !fields.includes(error.field as Field)}
    <p class="error" role="alert">{error.text}</p>
  {/if}
  <button type="submit">{t('config.apply')}</button>
</form>

<style>
  .dhcp {
    margin: 0;
  }
  .toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.85rem;
    margin-bottom: 8px;
  }
  .field {
    display: grid;
    gap: 2px;
    margin-bottom: 6px;
    font-size: 0.8rem;
  }
  .field input {
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    font-size: 0.85rem;
    padding: 4px 8px;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
  }
  input[aria-invalid='true'] {
    border-color: var(--danger);
  }
  .error {
    margin: -2px 0 6px;
    font-size: 0.8rem;
    color: var(--danger);
  }
  .muted {
    margin: 4px 0 8px;
    font-size: 0.75rem;
    color: var(--muted);
  }
</style>
