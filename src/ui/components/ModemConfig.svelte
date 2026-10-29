<script lang="ts">
  import { ACCESS_PROFILES, MODEM_KINDS, WAN_MEDIUM, type Device, type ModemKind } from '../../core';
  import { t } from '../../i18n';
  import { editor } from '../state/editor.svelte';
  import { simStore } from '../state/sim.svelte';

  /**
   * Modem: Zugangstechnik wählen (Kabel, Glasfaser, Mobilfunk, ADSL, VDSL).
   * In der Simulation zeigt es den Aufbau der Leitung Schritt für Schritt.
   */
  let { device }: { device: Device } = $props();
  const kind = $derived(device.modem?.kind);
  const profile = $derived(kind ? ACCESS_PROFILES[kind] : null);
  const live = $derived((simStore.tick, editor.acting ? simStore.sim?.getDeviceState(device.id).modem : undefined));
</script>

<h3>{t('modem.title')}</h3>
<label class="field">
  <span>{t('modem.kind')}</span>
  <select value={kind ?? ''} disabled={!editor.editable} onchange={(e) => editor.setModemKind(device.id, (e.currentTarget.value || null) as ModemKind | null)}>
    <option value="">{t('modem.kind.legacy')}</option>
    {#each MODEM_KINDS as k (k)}<option value={k}>{t(`modem.kind.${k}`)}</option>{/each}
  </select>
</label>
{#if profile && kind}
  <dl class="facts">
    <dt>{t('modem.standard')}</dt>
    <dd>{profile.standard}</dd>
    <dt>{t('modem.rates')}</dt>
    <dd>{profile.downstream} / {profile.upstream} Mbit/s</dd>
    <dt>{t('modem.wan')}</dt>
    <dd>{t(`medium.${WAN_MEDIUM[kind]}`)}</dd>
  </dl>
  <p class="muted">{t(`modem.kind.${kind}.hint`)}</p>
{:else}
  <p class="muted">{t('modem.legacyHint')}</p>
{/if}
{#if live}
  <div class="status status-{live.phase}">
    <strong>{t(`modem.phase.${live.phase}`)}</strong>
    <progress max={live.total} value={live.progress}></progress>
    <span>{live.progress}/{live.total}</span>
  </div>
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
  select {
    font: inherit;
    padding: 4px 6px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
    color: var(--text);
  }
  .facts {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 10px;
    font-size: 0.8rem;
    margin: 8px 0;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
  }
  .muted {
    color: var(--muted);
    font-size: 0.75rem;
  }
  .status {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.8rem;
    padding: 6px 8px;
    border-radius: 6px;
    background: var(--surface-2);
  }
  .status-online strong {
    color: #16a34a;
  }
  .status-connecting strong {
    color: #d97706;
  }
  progress {
    flex: 1;
  }
</style>
