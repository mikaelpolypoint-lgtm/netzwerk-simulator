<script lang="ts">
  import { broadcastOf, checkHostConfig, formatIp, maskToText, networkOf, parseIp, parseMask, type Device } from '../../core';
  import { t } from '../../i18n';
  import { editor } from '../state/editor.svelte';

  let { device }: { device: Device } = $props();

  type Field = 'ip' | 'mask' | 'gateway' | 'dns';
  const fields: Field[] = ['ip', 'mask', 'gateway', 'dns'];

  const saved = $derived({
    ip: device.interfaces[0]?.ip ?? '',
    mask: device.interfaces[0]?.mask ?? '',
    gateway: device.gateway ?? '',
    dns: device.dns ?? '',
  });

  let draft = $state<Record<Field, string>>({ ip: '', mask: '', gateway: '', dns: '' });
  let error = $state<{ field?: string; text: string } | null>(null);

  $effect(() => {
    draft = { ...saved };
    error = null;
  });

  const dirty = $derived(fields.some((f) => draft[f].trim() !== saved[f]));
  const warnings = $derived(checkHostConfig(saved).warnings);

  /** Zeigt die Maske jeweils in der anderen Schreibweise, damit beide geübt werden. */
  const maskHint = $derived.by(() => {
    const prefix = draft.mask.trim() ? parseMask(draft.mask) : null;
    if (prefix === null) return '';
    return draft.mask.includes('.') ? `/${prefix}` : maskToText(prefix);
  });

  const networkInfo = $derived.by(() => {
    const ip = saved.ip ? parseIp(saved.ip) : null;
    const prefix = saved.mask ? parseMask(saved.mask) : null;
    if (ip === null || prefix === null) return null;
    return t('config.network', {
      net: `${formatIp(networkOf(ip, prefix))}/${prefix}`,
      broadcast: formatIp(broadcastOf(ip, prefix)),
    });
  });

  function apply(event: SubmitEvent) {
    event.preventDefault();
    const failure = editor.configureHost(device.id, draft);
    error = failure ? { field: failure.field, text: t(`error.${failure.code}`, failure.params) } : null;
  }
</script>

<form class="config" onsubmit={apply}>
  <h3>{t('config.title')}</h3>
  {#each fields as field (field)}
    <label class="field">
      <span>{t(`config.${field}`)}</span>
      <span class="row">
        <input
          id={`config-${field}`}
          type="text"
          inputmode="decimal"
          autocomplete="off"
          spellcheck="false"
          placeholder={t(`config.placeholder.${field}`)}
          bind:value={draft[field]}
          aria-invalid={error?.field === field}
          aria-describedby={error?.field === field ? 'config-error' : undefined}
        />
        {#if field === 'mask' && maskHint}
          <span class="hint">= {maskHint}</span>
        {/if}
      </span>
    </label>
    {#if error?.field === field}
      <p id="config-error" class="error" role="alert">{error.text}</p>
    {/if}
  {/each}
  <button type="submit" disabled={!dirty}>{t('config.apply')}</button>

  {#if networkInfo}
    <p class="muted">{networkInfo}</p>
  {:else}
    <p class="muted">{t('config.none')}</p>
  {/if}
  {#each warnings as warning (warning.code)}
    <p class="warning" role="note">⚠ {t(`warning.${warning.code}`, warning.params)}</p>
  {/each}
</form>

<style>
  .config {
    margin: 8px 0 12px;
  }
  h3 {
    margin: 16px 0 8px;
    font-size: 0.85rem;
  }
  .field {
    display: grid;
    gap: 2px;
    margin-bottom: 8px;
    font-size: 0.8rem;
  }
  .row {
    display: flex;
    align-items: center;
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
  input[aria-invalid='true'] {
    border-color: var(--danger);
  }
  .hint {
    font-size: 0.8rem;
    color: var(--muted);
    white-space: nowrap;
  }
  .error {
    margin: -4px 0 8px;
    font-size: 0.8rem;
    color: var(--danger);
  }
  .warning {
    margin: 6px 0 0;
    padding: 6px 8px;
    font-size: 0.8rem;
    border-radius: 6px;
    background: var(--warning-soft);
  }
  .muted {
    margin: 8px 0 0;
    font-size: 0.8rem;
    color: var(--muted);
  }
</style>
