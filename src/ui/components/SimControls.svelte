<script lang="ts">
  import { t } from '../../i18n';
  import { simStore, type Speed } from '../state/sim.svelte';

  /** Zeitlauf-Regler: Anhalten, Einzelschritt und Zeitlupe für die Demonstration am Beamer. */
  const speeds: Speed[] = ['realtime', 'slow', 'slower'];
  const clock = $derived((simStore.tick, ((simStore.sim?.now ?? 0) / 1000).toFixed(3)));
</script>

<div class="controls" role="toolbar" aria-label={t('sim.controls')}>
  <button onclick={() => simStore.togglePause()} aria-pressed={simStore.paused}>
    {simStore.paused ? `▶ ${t('sim.resume')}` : `⏸ ${t('sim.pause')}`}
  </button>
  <button onclick={() => simStore.step()} title={t('sim.stepHint')}>⏭ {t('sim.step')}</button>
  <label>
    {t('sim.speed')}
    <select bind:value={simStore.speed}>
      {#each speeds as speed (speed)}
        <option value={speed}>{t(`sim.speed.${speed}`)}</option>
      {/each}
    </select>
  </label>
  <span class="clock">{t('sim.clock', { time: clock })}</span>
  <span class="hint">{t('mode.actionHint')}</span>
</div>

<style>
  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    padding: 6px 12px;
    background: var(--selected-soft);
    border-bottom: 1px solid var(--border);
    font-size: 0.85rem;
  }
  label {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  select {
    font: inherit;
    padding: 2px 4px;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
  }
  .clock {
    font-variant-numeric: tabular-nums;
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  }
  .hint {
    color: var(--muted);
    font-size: 0.8rem;
  }
</style>
