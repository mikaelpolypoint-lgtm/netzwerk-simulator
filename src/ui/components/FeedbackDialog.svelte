<script lang="ts">
  import { serializeProject } from '../../core';
  import { locale, t } from '../../i18n';
  import { editor } from '../state/editor.svelte';
  import { api, ApiError, session } from '../state/session.svelte';
  import Modal from './Modal.svelte';

  /** Rückmeldung an den Admin: Problem, Idee oder Sonstiges. Ohne Personendaten. */
  let { onclose }: { onclose: () => void } = $props();

  let kind = $state<'problem' | 'idea' | 'other'>('problem');
  let text = $state('');
  let attach = $state(false);
  let phase = $state<'idle' | 'sending' | 'sent' | 'error'>('idle');
  let errorCode = $state('');

  const disabled = $derived(session.config?.feedbackEnabled === false);

  async function send(event: SubmitEvent) {
    event.preventDefault();
    phase = 'sending';
    try {
      await api('POST', 'feedback', {
        kind,
        text,
        version: __APP_VERSION__,
        locale: locale(),
        ...(attach ? { project: JSON.parse(serializeProject(editor.topology, editor.tasks)) } : {}),
      });
      phase = 'sent';
      text = '';
    } catch (error) {
      errorCode = error instanceof ApiError ? error.code : 'error';
      phase = 'error';
    }
  }
</script>

<Modal title={t('feedback.title')} {onclose}>
  {#if disabled}
    <p class="muted">{t('feedback.disabled')}</p>
  {:else if phase === 'sent'}
    <p class="ok" role="status">{t('feedback.thanks')}</p>
  {:else}
    <p class="muted">{t('feedback.intro')}</p>
    <form onsubmit={send}>
      <div class="kinds" role="radiogroup" aria-label={t('feedback.kind')}>
        {#each ['problem', 'idea', 'other'] as k (k)}
          <label><input type="radio" name="kind" value={k} bind:group={kind} /> {t(`feedback.kind.${k}`)}</label>
        {/each}
      </div>
      <label class="field">
        <span>{t('feedback.text')}</span>
        <textarea bind:value={text} rows="6" maxlength="2000" required></textarea>
      </label>
      <p class="warn">⚠ {t('feedback.noPersonalData')}</p>
      <label class="check"><input type="checkbox" bind:checked={attach} /> {t('feedback.attach')}</label>
      {#if phase === 'error'}<p class="error" role="alert">{t(errorCode === 'rateLimited' ? 'feedback.rateLimited' : 'feedback.failed')}</p>{/if}
      <button type="submit" disabled={phase === 'sending' || !text.trim()}>{t('feedback.send')}</button>
    </form>
  {/if}
</Modal>

<style>
  form {
    display: grid;
    gap: 10px;
  }
  .kinds {
    display: flex;
    gap: 16px;
    font-size: 0.9rem;
  }
  .field {
    display: grid;
    gap: 4px;
    font-size: 0.85rem;
  }
  textarea {
    resize: vertical;
  }
  .warn {
    margin: 0;
    font-size: 0.8rem;
    padding: 6px 8px;
    border-radius: 6px;
    background: var(--warning-soft);
  }
  .check {
    display: flex;
    gap: 6px;
    font-size: 0.85rem;
    align-items: center;
  }
  button[type='submit'] {
    justify-self: start;
  }
</style>
