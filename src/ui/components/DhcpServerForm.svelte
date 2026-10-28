<script lang="ts">
  import { DEFAULT_LEASE_TIME, parseMask, type Device, type DhcpServerConfig } from '../../core';
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

  // --- Weitere Bereiche für Netze hinter einem Relay ---------------------------

  type ScopeField = 'start' | 'end' | 'mask' | 'gateway' | 'dns';
  const scopeFields: ScopeField[] = ['start', 'end', 'mask', 'gateway', 'dns'];
  let scopeDraft = $state<Record<ScopeField, string>>({ start: '', end: '', mask: '/24', gateway: '', dns: '' });
  let scopeError = $state<{ field?: string; text: string } | null>(null);

  function addScope(event: SubmitEvent) {
    event.preventDefault();
    const failure = editor.addDhcpScope(device.id, scopeDraft);
    scopeError = failure ? { field: failure.field, text: t(`error.${failure.code}`, failure.params) } : null;
    if (!failure) scopeDraft = { start: '', end: '', mask: '/24', gateway: '', dns: '' };
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

{#if device.dhcpServer}
  <h4>{t('dhcpServer.scopes')}</h4>
  <p class="muted">{t('dhcpServer.scopesHint')}</p>
  {#each device.dhcpServer.scopes ?? [] as scope, i (i)}
    <div class="scope">
      <span class="mono">{scope.start} – {scope.end} /{parseMask(scope.mask)}</span>
      <button class="small" aria-label={t('dhcpServer.removeScope')} onclick={() => editor.removeDhcpScope(device.id, i)}>✕</button>
    </div>
  {/each}
  <form class="scope-form" onsubmit={addScope}>
    {#each scopeFields as field (field)}
      <label class="field">
        <span>{t(`dhcpServer.scope.${field}`)}</span>
        <input bind:value={scopeDraft[field]} autocomplete="off" spellcheck="false" aria-invalid={scopeError?.field === field} />
      </label>
    {/each}
    {#if scopeError}
      <p class="error" role="alert">{scopeError.text}</p>
    {/if}
    <button type="submit" disabled={!scopeDraft.start.trim() || !scopeDraft.end.trim()}>{t('dhcpServer.addScope')}</button>
  </form>
{/if}

<style>
  .dhcp {
    margin: 0;
  }
  h4 {
    margin: 12px 0 2px;
    font-size: 0.8rem;
  }
  .scope {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 2px 0;
    border-bottom: 1px solid var(--border);
    font-size: 0.8rem;
  }
  .scope-form {
    margin-top: 6px;
  }
  .small {
    font-size: 0.7rem;
    padding: 1px 6px;
  }
  .mono {
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
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
