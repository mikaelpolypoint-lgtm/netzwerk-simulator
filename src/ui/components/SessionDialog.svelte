<script lang="ts">
  import { serializeProject } from '../../core';
  import { locale, t } from '../../i18n';
  import { editor } from '../state/editor.svelte';
  import { session, ApiError } from '../state/session.svelte';
  import { usesProFeatures, ui } from '../state/ui.svelte';
  import Modal from './Modal.svelte';

  /**
   * Online-Session: Code anzeigen, mit einem Code weiterarbeiten, einer Klasse
   * beitreten oder die eigene Session löschen. Es gibt keine Namen.
   */
  let { onclose }: { onclose: () => void } = $props();

  let resumeCode = $state('');
  let classCode = $state('');
  let message = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);
  let busy = $state(false);

  const project = () => serializeProject(editor.topology, editor.tasks, editor.snapshots);
  const until = $derived(
    session.expires ? new Date(session.expires).toLocaleString(locale() === 'en' ? 'en-GB' : 'de-CH', { dateStyle: 'short', timeStyle: 'short' }) : '',
  );

  function errorText(error: unknown): string {
    const code = error instanceof ApiError ? error.code : 'error';
    return t(`session.error.${['unknownSession', 'unknownClass', 'rateLimited', 'offline'].includes(code) ? code : 'other'}`);
  }

  async function run(action: () => Promise<string>) {
    busy = true;
    message = null;
    try {
      message = { kind: 'ok', text: await action() };
    } catch (error) {
      message = { kind: 'error', text: errorText(error) };
    } finally {
      busy = false;
    }
  }

  const resume = () =>
    run(async () => {
      const loaded = await session.open(resumeCode);
      editor.replace(loaded.topology, { undoable: true, tasks: loaded.tasks ?? null, snapshots: loaded.snapshots ?? [] });
      if (usesProFeatures(loaded.topology) && ui.policy.pro) ui.setLevel('pro');
      resumeCode = '';
      return t('session.resumed', { code: session.code ?? '' });
    });

  const join = () =>
    run(async () => {
      await session.joinClass(classCode, project());
      classCode = '';
      return t('session.joined', { label: session.classLabel ?? '', code: session.code ?? '' });
    });

  const fresh = () =>
    run(async () => {
      session.detach();
      const code = await session.create(project(), null);
      return t('session.created', { code });
    });

  const remove = () =>
    run(async () => {
      await session.remove();
      return t('session.deleted');
    });

  async function copy() {
    if (!session.code) return;
    try {
      await navigator.clipboard.writeText(session.code);
      message = { kind: 'ok', text: t('session.copied') };
    } catch {
      message = null;
    }
  }
</script>

<Modal title={t('session.title')} {onclose}>
  {#if session.code}
    <p>{t('session.current')}</p>
    <p class="big code">{session.code} <button onclick={copy}>{t('session.copy')}</button></p>
    <p class="muted">
      {t('session.expires', { time: until })}
      {#if session.classCode}· {t('session.inClass')}{/if}
    </p>
  {:else}
    <p class="muted">{t('session.none')}</p>
  {/if}

  <h3>{t('session.resumeTitle')}</h3>
  <form onsubmit={(e) => (e.preventDefault(), resume())}>
    <input bind:value={resumeCode} placeholder="ABCD-2345" maxlength="12" aria-label={t('session.code')} class="code" autocomplete="off" />
    <button type="submit" disabled={busy || !resumeCode.trim()}>{t('session.resume')}</button>
  </form>

  <h3>{t('session.classTitle')}</h3>
  <p class="muted">{t('session.classHint')}</p>
  <form onsubmit={(e) => (e.preventDefault(), join())}>
    <input bind:value={classCode} placeholder="WXYZ-6789" maxlength="12" aria-label={t('session.classCode')} class="code" autocomplete="off" />
    <button type="submit" disabled={busy || !classCode.trim()}>{t('session.join')}</button>
  </form>

  <h3>{t('session.manageTitle')}</h3>
  <div class="row">
    <button onclick={fresh} disabled={busy}>{t('session.new')}</button>
    <button class="danger" onclick={remove} disabled={busy || !session.code}>{t('session.delete')}</button>
  </div>

  {#if message}<p class={message.kind} role="status">{message.text}</p>{/if}
  <p class="muted small">{t('session.privacy', { hours: session.config?.policy.sessionHours ?? 24 })}</p>
</Modal>

<style>
  .big {
    font-size: 1.6rem;
    font-weight: 700;
    margin: 4px 0;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .big button {
    font-size: 0.8rem;
    font-weight: normal;
    letter-spacing: normal;
  }
  form,
  .row {
    display: flex;
    gap: 8px;
  }
  form input {
    flex: 1;
    text-transform: uppercase;
  }
  .danger {
    color: var(--danger);
    border-color: var(--danger);
  }
  .small {
    font-size: 0.75rem;
    margin-top: 14px;
  }
</style>
