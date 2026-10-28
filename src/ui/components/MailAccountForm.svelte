<script lang="ts">
  import type { Device, MailProtocol } from '../../core';
  import { t } from '../../i18n';
  import { editor } from '../state/editor.svelte';

  /** Entwurfsmodus, Endgerät: E-Mail-Konto für die Anwendung "E-Mail". */
  let { device }: { device: Device } = $props();

  type Field = 'address' | 'password' | 'smtpServer' | 'incomingServer';
  const fields: Field[] = ['address', 'password', 'smtpServer', 'incomingServer'];

  let enabled = $state(false);
  let draft = $state<Record<Field, string>>({ address: '', password: '', smtpServer: '', incomingServer: '' });
  let protocol = $state<MailProtocol>('pop3');
  let error = $state<{ field?: string; text: string } | null>(null);

  $effect(() => {
    const a = device.mailAccount;
    enabled = !!a;
    draft = { address: a?.address ?? '', password: a?.password ?? '', smtpServer: a?.smtpServer ?? '', incomingServer: a?.incomingServer ?? '' };
    protocol = a?.protocol ?? 'pop3';
    error = null;
  });

  function apply(event: SubmitEvent) {
    event.preventDefault();
    const failure = editor.setMailAccount(device.id, enabled ? { ...draft, protocol } : null);
    error = failure ? { field: failure.field, text: t(`error.${failure.code}`, failure.params) } : null;
  }
</script>

<form onsubmit={apply}>
  <label class="toggle">
    <input type="checkbox" bind:checked={enabled} />
    {t('mailAccount.enable')}
  </label>
  {#if enabled}
    {#each fields as field (field)}
      <label class="field">
        <span>{t(`mailAccount.${field}`)}</span>
        <input
          bind:value={draft[field]}
          placeholder={t(`mailAccount.placeholder.${field}`)}
          autocomplete="off"
          spellcheck="false"
          aria-invalid={error?.field === field}
        />
      </label>
    {/each}
    <fieldset class="protocol">
      <legend>{t('mailAccount.protocol')}</legend>
      <label><input type="radio" bind:group={protocol} value="pop3" /> POP3</label>
      <label><input type="radio" bind:group={protocol} value="imap" /> IMAP</label>
    </fieldset>
    <p class="muted">{t('mailAccount.explain')}</p>
  {/if}
  {#if error}
    <p class="error" role="alert">{error.text}</p>
  {/if}
  <button type="submit">{t('config.apply')}</button>
</form>

<style>
  .toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.85rem;
    margin-bottom: 8px;
  }
  .field {
    display: grid;
    gap: 2px;
    margin-bottom: 6px;
    font-size: 0.75rem;
  }
  .field input {
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    font-size: 0.8rem;
    padding: 4px 6px;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
  }
  input[aria-invalid='true'] {
    border-color: var(--danger);
  }
  .protocol {
    display: flex;
    gap: 12px;
    border: none;
    padding: 0;
    margin: 0 0 6px;
    font-size: 0.8rem;
  }
  .protocol legend {
    font-size: 0.75rem;
    margin-bottom: 2px;
  }
  .error {
    margin: 0 0 6px;
    font-size: 0.8rem;
    color: var(--danger);
  }
  .muted {
    margin: 0 0 8px;
    font-size: 0.75rem;
    color: var(--muted);
  }
</style>
