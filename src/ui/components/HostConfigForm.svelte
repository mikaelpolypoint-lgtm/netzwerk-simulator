<script lang="ts">
  import { checkHostConfig, maskToText, parseMask, type Device } from '../../core';
  import { t } from '../../i18n';
  import { dialogs } from '../state/dialogs.svelte';
  import { editor } from '../state/editor.svelte';
  import { ui } from '../state/ui.svelte';
  import { subnetSummary } from '../subnet';
  import Icon from './Icon.svelte';
  import ScopeBadge from './ScopeBadge.svelte';

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
  let dhcp = $state(false);
  let error = $state<{ field?: string; text: string } | null>(null);

  $effect(() => {
    draft = { ...saved };
    dhcp = !!device.dhcp;
    error = null;
  });

  const dirty = $derived(dhcp !== !!device.dhcp || (!dhcp && fields.some((f) => draft[f].trim() !== saved[f])));
  const warnings = $derived(device.dhcp ? [] : checkHostConfig(saved).warnings);

  /** Zeigt die Maske jeweils in der anderen Schreibweise, damit beide geübt werden. */
  const maskHint = $derived.by(() => {
    const prefix = draft.mask.trim() ? parseMask(draft.mask) : null;
    if (prefix === null) return '';
    return draft.mask.includes('.') ? `/${prefix}` : maskToText(prefix);
  });

  const networkInfo = $derived(subnetSummary(saved.ip, saved.mask));

  /** IP-Rechner mit den aktuellen Werten öffnen; «Übernehmen» füllt Adresse, Maske und Gateway. */
  function calc() {
    dialogs.ipCalculator({
      ip: draft.ip || undefined,
      mask: draft.mask || undefined,
      apply: (v) => {
        draft = { ...draft, ip: v.ip, mask: v.mask, gateway: v.gateway };
        dhcp = false;
      },
    });
  }

  function apply(event: SubmitEvent) {
    event.preventDefault();
    const failure = editor.configureHost(device.id, { ...draft, dhcp });
    error = failure ? { field: failure.field, text: t(`error.${failure.code}`, failure.params) } : null;
  }
</script>

<form class="config" onsubmit={apply}>
  <h3>{t('config.title')}</h3>
  <fieldset class="mode">
    <legend class="visually-hidden">{t('address.mode')}</legend>
    <label><input type="radio" bind:group={dhcp} value={false} /> {t('address.mode.static')}</label>
    <label><input type="radio" bind:group={dhcp} value={true} /> {t('address.mode.dhcp')}</label>
  </fieldset>
  {#if dhcp}
    <p class="muted">{t('config.dhcpExplain')}</p>
  {:else}
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
  {/if}
  {#if error && !error.field}
    <p class="error" role="alert">{error.text}</p>
  {/if}
  <div class="buttons">
    <button type="submit" disabled={!dirty}>{t('config.apply')}</button>
    {#if ui.has('tool.ipCalculator') && !dhcp}
      <button type="button" class="calc" onclick={calc} title={t('ipcalc.openHint')}><Icon name="calc" size={15} /> {t('menu.tool.ipcalc')}</button>
    {/if}
  </div>

  {#if device.dhcp}
    <!-- Adresse steht erst im Aktionsmodus fest. -->
  {:else if networkInfo}
    <p class="muted">{#if ui.has('tool.addressBadges')}<ScopeBadge ip={saved.ip} /> {/if}{networkInfo}</p>
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
  .buttons {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .calc {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .mode {
    display: flex;
    gap: 14px;
    margin: 0 0 8px;
    padding: 0;
    border: none;
    font-size: 0.85rem;
  }
  .mode label {
    display: flex;
    align-items: center;
    gap: 4px;
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
