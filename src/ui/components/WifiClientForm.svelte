<script lang="ts">
  import { type Device } from '../../core';
  import { t } from '../../i18n';
  import { editor } from '../state/editor.svelte';

  /** Endgerät: mit welchem Funknetz es sich verbindet (SSID und Passwort). */
  let { device }: { device: Device } = $props();

  let ssid = $state('');
  let password = $state('');
  let error = $state<string | null>(null);

  $effect(() => {
    ssid = device.wifi?.ssid ?? '';
    password = device.wifi?.password ?? '';
    error = null;
  });

  const ssids = $derived([...new Set(editor.topology.devices.flatMap((d) => (d.wlan ? [d.wlan.ssid] : [])))]);

  function apply(event: SubmitEvent) {
    event.preventDefault();
    const failure = editor.setWifiClient(device.id, ssid.trim() ? { ssid, password: password || undefined } : null);
    error = failure ? t(`error.${failure.code}`, failure.params) : null;
  }
</script>

<form onsubmit={apply}>
  <label class="row">
    <span>{t('wlan.ssid')}</span>
    <input bind:value={ssid} list="ssids-{device.id}" maxlength="32" placeholder={t('wifi.none')} />
    <datalist id="ssids-{device.id}">
      {#each ssids as name (name)}<option value={name}></option>{/each}
    </datalist>
  </label>
  <label class="row">
    <span>{t('wlan.password')}</span>
    <input bind:value={password} type="password" maxlength="63" autocomplete="off" />
  </label>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <p class="muted">{t('wifi.hint')}</p>
  <button type="submit">{t('config.apply')}</button>
</form>

<style>
  form {
    display: grid;
    gap: 6px;
    font-size: 0.85rem;
    padding-bottom: 8px;
  }
  .row {
    display: grid;
    grid-template-columns: 5.5rem minmax(0, 1fr);
    align-items: center;
    gap: 6px;
  }
  input {
    font: inherit;
    padding: 4px 6px;
    min-width: 0;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
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
  button {
    justify-self: start;
  }
</style>
