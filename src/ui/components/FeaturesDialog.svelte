<script lang="ts">
  import { t } from '../../i18n';
  import { loadFeatureFile, unlockFeatureFile, saveFeatureFile } from '../actions';
  import { FEATURES, FEATURE_GROUPS, PROFILE_LEVELS } from '../features';
  import { featureName } from '../labels';
  import { ui } from '../state/ui.svelte';
  import Modal from './Modal.svelte';

  /**
   * Funktionsumfang wählen: Profil (1. Lehrjahr bis Studium) oder einzelne
   * Funktionen. Lehrpersonen speichern die Auswahl als Datei und verteilen sie.
   */
  let { onclose }: { onclose: () => void } = $props();
  let lock = $state(false);
  let title = $state('');
</script>

<Modal title={t('features.title')} {onclose} width={760}>
  <p class="muted">{t('features.intro')}</p>

  {#if ui.locked}
    <p class="locked">🔒 {t('features.locked', { title: ui.profileTitle ?? '' })}</p>
  {/if}

  <div class="levels" role="radiogroup" aria-label={t('features.profile')}>
    {#each PROFILE_LEVELS as level (level)}
      <button
        role="radio"
        aria-checked={ui.profile === level}
        disabled={ui.locked || level > ui.policy.maxLevel}
        onclick={() => ui.setProfile(level)}
        title={level > ui.policy.maxLevel ? t('features.adminMax') : undefined}
      >
        <strong>{t(`profile.${level}`)}</strong>
        <span>{t(`profile.${level}.hint`)}</span>
      </button>
    {/each}
  </div>
  {#if ui.profile === 'custom'}
    <p class="muted">{t('features.customNote', { base: t(`profile.${ui.baseLevel}`) })}</p>
  {/if}

  <div class="groups">
    {#each FEATURE_GROUPS as group (group)}
      <fieldset>
        <legend>{t(`features.group.${group}`)}</legend>
        {#each FEATURES.filter((f) => f.group === group) as spec (spec.id)}
          <label class:blocked={!ui.permitted(spec.id)} title={ui.permitted(spec.id) ? t(`feature.${spec.id}.hint`) : t('features.adminBlocked')}>
            <input type="checkbox" checked={ui.has(spec.id)} disabled={ui.locked || !ui.permitted(spec.id)} onchange={(e) => ui.setFeature(spec.id, e.currentTarget.checked)} />
            <span>{featureName(spec.id)}</span>
            <span class="lvl" aria-label={t('features.fromLevel', { level: spec.level })}>{spec.level}</span>
          </label>
        {/each}
      </fieldset>
    {/each}
  </div>

  <h3>{t('features.fileTitle')}</h3>
  <p class="muted">{t('features.fileHint')}</p>
  <div class="file">
    <label class="field">
      <span>{t('features.fileName')}</span>
      <input bind:value={title} maxlength="80" placeholder={t('features.fileNamePlaceholder')} />
    </label>
    <label class="check"><input type="checkbox" bind:checked={lock} /> {t('features.lock')}</label>
  </div>

  {#snippet actions()}
    {#if ui.locked}<button onclick={() => void unlockFeatureFile()}>{t('features.unlock')}</button>{/if}
    <button onclick={() => void loadFeatureFile()} disabled={ui.locked}>{t('features.load')}</button>
    <button onclick={() => saveFeatureFile(lock, title)}>{t('features.save')}</button>
  {/snippet}
</Modal>

<style>
  .levels {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 6px;
    margin: 10px 0;
  }
  .levels button {
    display: grid;
    gap: 2px;
    padding: 8px;
    text-align: left;
    border-radius: 8px;
    font-size: 0.78rem;
  }
  .levels button span {
    color: var(--muted);
    font-size: 0.72rem;
  }
  .levels button[aria-checked='true'] {
    border-color: var(--accent);
    background: var(--selected-soft);
  }
  .groups {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 10px;
  }
  fieldset {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 6px 10px 8px;
    margin: 0;
  }
  legend {
    font-weight: 600;
    font-size: 0.82rem;
    padding: 0 4px;
  }
  fieldset label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.82rem;
    padding: 2px 0;
  }
  fieldset label span:nth-child(2) {
    flex: 1;
  }
  .lvl {
    font-size: 0.68rem;
    color: var(--muted);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0 4px;
  }
  .blocked {
    opacity: 0.5;
  }
  .locked {
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--surface-2);
    font-size: 0.85rem;
  }
  .file {
    display: flex;
    align-items: end;
    gap: 16px;
    flex-wrap: wrap;
  }
  .field {
    display: grid;
    gap: 4px;
    font-size: 0.85rem;
  }
  .check {
    display: flex;
    gap: 6px;
    align-items: center;
    font-size: 0.85rem;
  }
  @media (max-width: 700px) {
    .levels {
      grid-template-columns: 1fr 1fr;
    }
  }
</style>
