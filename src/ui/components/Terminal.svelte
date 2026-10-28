<script lang="ts">
  import { tick } from 'svelte';
  import type { Device } from '../../core';
  import { t } from '../../i18n';
  import { simStore } from '../state/sim.svelte';
  import CliTerminal from './CliTerminal.svelte';

  let { device }: { device: Device } = $props();

  let line = $state('');
  let history = $state<string[]>([]);
  let historyIndex = -1;
  let output: HTMLDivElement | undefined = $state();
  let input: HTMLInputElement | undefined = $state();

  // Meldungen der Server-Dienste gehören in deren eigene Fenster.
  const SERVICE_PREFIXES = ['dhcpServer.', 'dnsServer.', 'http.', 'smtp.', 'pop3.', 'imap.'];
  const lines = $derived(
    ((simStore.tick, simStore.sim?.getDeviceState(device.id).console) ?? []).filter(
      (l) => !SERVICE_PREFIXES.some((p) => l.code.startsWith(p)),
    ),
  );

  $effect(() => {
    void lines.length;
    tick().then(() => output?.scrollTo({ top: output.scrollHeight }));
  });

  $effect(() => {
    input?.focus();
  });

  // --- SSH ---------------------------------------------------------------------
  // «ssh benutzer@adresse» fragt hier das Passwort ab; nach erfolgreicher
  // Anmeldung übernimmt die Befehlszeile des Zielgeräts das Fenster.

  let passwordFor = $state<{ user: string; target: string } | null>(null);
  let remote = $state<{ deviceId: string; target: string; intro: string[] } | null>(null);
  let seen = $state(0);

  $effect(() => {
    const all = lines;
    if (all.length < seen) seen = 0;
    for (const entry of all.slice(seen)) {
      if (entry.code === 'ssh.open' && entry.params?.device) {
        remote = { deviceId: String(entry.params.device), target: String(entry.params.target), intro: [t('console.ssh.open', entry.params)] };
      } else if (entry.code === 'ssh.closed' && remote) {
        remote = null;
      }
    }
    seen = all.length;
  });

  function parseSsh(command: string): { user: string; target: string } | null {
    const parts = command.trim().split(/\s+/);
    if (parts[0]?.toLowerCase() !== 'ssh') return null;
    if (parts[1] === '-l' && parts[2] && parts[3]) return { user: parts[2], target: parts[3] };
    const m = /^([^@\s]+)@(\S+)$/.exec(parts[1] ?? '');
    return m ? { user: m[1]!, target: m[2]! } : null;
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    const command = line;
    line = '';
    historyIndex = -1;
    if (passwordFor) {
      const { user, target } = passwordFor;
      passwordFor = null;
      simStore.ssh(device.id, target, user, command);
      return;
    }
    if (command.trim()) history = [...history.filter((h) => h !== command), command].slice(-30);
    const ssh = parseSsh(command);
    if (ssh) {
      simStore.runCommand(device.id, command);
      passwordFor = ssh;
      return;
    }
    simStore.runCommand(device.id, command);
  }

  function closeRemote() {
    simStore.sshClose(device.id);
    remote = null;
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

{#if remote}
  {#key remote.deviceId + remote.target}
    <CliTerminal deviceId={remote.deviceId} remote intro={remote.intro} onclose={closeRemote} onsend={(l) => simStore.sshSend(device.id, l)} />
  {/key}
{:else}
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
    <label for="terminal-input" class="prompt">{passwordFor ? t('terminal.sshPassword', passwordFor) : prompt}</label>
    <input
      id="terminal-input"
      bind:this={input}
      bind:value={line}
      {onkeydown}
      type={passwordFor ? 'password' : 'text'}
      autocomplete="off"
      spellcheck="false"
      aria-label={t('terminal.input')}
      placeholder={passwordFor ? '' : t('terminal.placeholder')}
    />
  </form>
</div>
{/if}

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
