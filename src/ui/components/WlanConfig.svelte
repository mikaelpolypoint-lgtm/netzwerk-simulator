<script lang="ts">
  import { CHANNELS, type Device, type WlanBand } from '../../core';
  import { t } from '../../i18n';
  import { editor } from '../state/editor.svelte';
  import { ui } from '../state/ui.svelte';

  /** Access Point: Funknetz (SSID, WPA2-Passwort, Band, Kanal) und Mesh-Betrieb. */
  let { device }: { device: Device } = $props();

  let draft = $state({ enabled: false, ssid: '', password: '', band: '5' as WlanBand, channel: 36, mesh: false });
  let error = $state<{ field?: string; text: string } | null>(null);

  $effect(() => {
    const w = device.wlan;
    draft = { enabled: !!w, ssid: w?.ssid ?? '', password: w?.password ?? '', band: w?.band ?? '5', channel: w?.channel ?? 36, mesh: !!w?.mesh };
    error = null;
  });

  function apply(event?: SubmitEvent) {
    event?.preventDefault();
    const failure = editor.setWlan(
      device.id,
      draft.enabled ? { ssid: draft.ssid, password: draft.password || undefined, band: draft.band, channel: draft.channel, mesh: draft.mesh } : null,
    );
    error = failure ? { field: failure.field, text: t(`error.${failure.code}`, failure.params) } : null;
  }

  function setBand(band: WlanBand) {
    draft.band = band;
    if (!CHANNELS[band].includes(draft.channel)) draft.channel = CHANNELS[band][0]!;
  }
</script>

<h3>{t('wlan.title')}</h3>
<form onsubmit={apply}>
  <label class="toggle">
    <input type="checkbox" bind:checked={draft.enabled} />
    {t('wlan.enable')}
  </label>
  {#if draft.enabled}
    <label class="row">
      <span>{t('wlan.ssid')}</span>
      <input bind:value={draft.ssid} maxlength="32" placeholder="Schulnetz" aria-invalid={error?.field === 'ssid'} />
    </label>
    <label class="row">
      <span>{t('wlan.password')}</span>
      <input bind:value={draft.password} maxlength="63" placeholder={t('wlan.open')} aria-invalid={error?.field === 'password'} />
    </label>
    <div class="row">
      <span>{t('wlan.band')}</span>
      <div class="seg" role="radiogroup" aria-label={t('wlan.band')}>
        <button type="button" role="radio" aria-checked={draft.band === '2.4'} onclick={() => setBand('2.4')}>2,4 GHz</button>
        <button type="button" role="radio" aria-checked={draft.band === '5'} onclick={() => setBand('5')}>5 GHz</button>
      </div>
    </div>
    <label class="row">
      <span>{t('wlan.channel')}</span>
      <select bind:value={draft.channel}>
        {#each CHANNELS[draft.band] as c (c)}
          <option value={c}>{c}</option>
        {/each}
      </select>
    </label>
    {#if ui.has('net.wlanMesh') || draft.mesh}
      <label class="toggle">
        <input type="checkbox" bind:checked={draft.mesh} />
        {t('wlan.mesh')}
      </label>
    {/if}
    <p class="muted">{t(draft.mesh ? 'wlan.meshHint' : 'wlan.hint')}</p>
  {/if}
  {#if error}<p class="error" role="alert">{error.text}</p>{/if}
  <button type="submit">{t('config.apply')}</button>
</form>

<style>
  h3 {
    margin: 16px 0 6px;
    font-size: 0.85rem;
  }
  form {
    display: grid;
    gap: 6px;
    font-size: 0.85rem;
  }
  .toggle {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .row {
    display: grid;
    grid-template-columns: 6.5rem minmax(0, 1fr);
    align-items: center;
    gap: 6px;
  }
  input:not([type='checkbox']),
  select {
    font: inherit;
    padding: 4px 6px;
    min-width: 0;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
  }
  .seg {
    display: flex;
  }
  .seg button {
    flex: 1;
    font-size: 0.8rem;
    padding: 3px 6px;
    border-radius: 0;
  }
  .seg button:first-child {
    border-radius: 6px 0 0 6px;
  }
  .seg button:last-child {
    border-radius: 0 6px 6px 0;
  }
  .seg button[aria-checked='true'] {
    background: var(--selected-soft);
    border-color: var(--accent);
  }
  .muted {
    color: var(--muted);
    font-size: 0.75rem;
    margin: 0;
  }
  .error {
    color: var(--danger);
    font-size: 0.75rem;
    margin: 0;
  }
  button[type='submit'] {
    justify-self: start;
  }
</style>
