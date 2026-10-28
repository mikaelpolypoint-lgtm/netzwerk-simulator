<script lang="ts">
  import { t } from '../../i18n';
  import { session } from '../state/session.svelte';
  import { ui } from '../state/ui.svelte';
  import Modal from './Modal.svelte';

  /** Datenschutzhinweis (revDSG / DSGVO): was gespeichert wird und was nicht. */
  let { onclose }: { onclose: () => void } = $props();
  const hours = $derived(session.config?.policy.sessionHours ?? ui.policy.sessionHours);
  const days = $derived(session.config?.feedbackDays ?? 30);
</script>

<Modal title={t('privacy.title')} {onclose} width={680}>
  <p>{t('privacy.intro')}</p>
  <h3>{t('privacy.localTitle')}</h3>
  <p class="muted">{t('privacy.local')}</p>
  {#if ui.online}
    <h3>{t('privacy.onlineTitle')}</h3>
    <ul>
      <li>{t('privacy.sessions', { hours })}</li>
      <li>{t('privacy.classes')}</li>
      <li>{t('privacy.feedback', { days })}</li>
      <li>{t('privacy.noIp')}</li>
      <li>{t('privacy.storage')}</li>
    </ul>
  {/if}
  <h3>{t('privacy.rulesTitle')}</h3>
  <p class="muted">{t('privacy.rules')}</p>
  <h3>{t('privacy.rightsTitle')}</h3>
  <p class="muted">{t('privacy.rights')}</p>
</Modal>

<style>
  ul {
    padding-left: 1.2em;
    margin: 0;
    display: grid;
    gap: 4px;
    font-size: 0.9rem;
  }
</style>
