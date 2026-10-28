<script lang="ts">
  import { tick } from 'svelte';
  import type { Device } from '../../core';
  import { t } from '../../i18n';
  import { simStore } from '../state/sim.svelte';

  let { device }: { device: Device } = $props();

  let line = $state('');
  let history = $state<string[]>([]);
  let historyIndex = -1;
  let output: HTMLDivElement | undefined = $state();
  let input: HTMLInputElement | undefined = $state();

  // Meldungen des DHCP-Server-Dienstes gehören in dessen eigenes Fenster.
  const lines = $derived(
    ((simStore.tick, simStore.sim?.getDeviceState(device.id).console) ?? []).filter((l) => !l.code.startsWith('dhcpServer.')),
  );

  $effect(() => {
    void lines.length;
    tick().then(() => output?.scrollTo({ top: output.scrollHeight }));
  });

  $effect(() => {
    input?.focus();
  });

  function submit(event: SubmitEvent) {
    event.preventDefault();
    const command = line;
    line = '';
    historyIndex = -1;
    if (command.trim()) history = [...history.filter((h) => h !== command), command].slice(-30);
    simStore.runCommand(device.id, command);
  }

  /** Pfeiltasten blättern durch frühere Befehle wie in einer echten Konsole. */
  function onkeydown(event: KeyboardEvent) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    if (history.length === 0) return;
    if (event.key === 'ArrowUp') historyIndex = historyIndex < 0 ? history.length - 1 : Math.max(0, historyIndex - 1);
    else historyIndex = historyIndex < 0 ? -1 : historyIndex + 1;
    if (historyIndex >= history.length) historyIndex = -1;
    line = historyIndex < 0 ? '' : history[historyIndex]!;
  }

  const prompt = 'C:\\>';
</script>

<div class="terminal">
  <div class="output" bind:this={output} role="log" aria-live="polite" aria-label={t('desktop.terminal')}>
    {#if lines.length === 0}
      <p class="hint">{t('terminal.welcome')}</p>
    {/if}
    {#each lines as entry, i (i)}
      {#if entry.code === 'cmd.echo'}
        <p class="echo"><span class="prompt">{prompt}</span> {entry.params?.line}</p>
      {:else}
        <p>{t(`console.${entry.code}`, entry.params)}</p>
      {/if}
    {/each}
  </div>
  <form onsubmit={submit}>
    <label for="terminal-input" class="prompt">{prompt}</label>
    <input
      id="terminal-input"
      bind:this={input}
      bind:value={line}
      {onkeydown}
      autocomplete="off"
      spellcheck="false"
      aria-label={t('terminal.input')}
      placeholder={t('terminal.placeholder')}
    />
  </form>
</div>

<style>
  .terminal {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--console-bg);
    color: var(--console-text);
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    font-size: 0.8rem;
  }
  .output {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 8px 10px;
  }
  p {
    margin: 0;
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .echo {
    margin-top: 6px;
  }
  .hint {
    opacity: 0.7;
  }
  .prompt {
    color: var(--console-prompt);
  }
  form {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-top: 1px solid rgba(255, 255, 255, 0.12);
  }
  input {
    flex: 1;
    min-width: 0;
    font: inherit;
    color: inherit;
    background: transparent;
    border: none;
    outline: none;
  }
  input::placeholder {
    color: inherit;
    opacity: 0.45;
  }
  form:focus-within {
    box-shadow: inset 0 0 0 2px var(--focus);
  }
</style>
