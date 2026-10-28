<script lang="ts">
  import { tick } from 'svelte';
  import { complete, execute, getDevice, prompt as promptOf, startSession, type CliSession } from '../../core';
  import { t } from '../../i18n';
  import { editor } from '../state/editor.svelte';
  import { simStore } from '../state/sim.svelte';

  /**
   * Befehlszeile eines Routers oder Switches. Über die Konsole (direkt am
   * Gerät) oder als SSH-Sitzung von einem Endgerät aus (`remote`).
   * Konfigurationsbefehle ändern die Topologie wie die Formulare.
   */
  let {
    deviceId,
    remote = false,
    onclose,
    onsend,
    intro = [],
  }: {
    deviceId: string;
    remote?: boolean;
    onclose?: () => void;
    /** Jede Zeile auch übers Netz schicken (SSH). */
    onsend?: (line: string) => void;
    /** Zeilen vor der ersten Eingabe (z.B. Ausgabe von ssh). */
    intro?: string[];
  } = $props();

  interface Line {
    text: string;
    kind: 'out' | 'in';
  }

  const device = $derived(getDevice(editor.topology, deviceId));
  // svelte-ignore state_referenced_locally
  const started = startSession(getDevice(editor.topology, deviceId)!, remote);
  let session = $state<CliSession>(started.session);
  // svelte-ignore state_referenced_locally
  let lines = $state<Line[]>([...intro.map((text) => ({ text, kind: 'out' as const })), ...started.lines.map((text) => ({ text, kind: 'out' as const }))]);
  let line = $state('');
  let history = $state<string[]>([]);
  let historyIndex = -1;
  let output: HTMLDivElement | undefined = $state();
  let input: HTMLInputElement | undefined = $state();
  let closed = $state(false);

  const prompt = $derived(promptOf(editor.topology, session));
  const secret = $derived(session.awaiting === 'enable-password');

  $effect(() => {
    void lines.length;
    tick().then(() => output?.scrollTo({ top: output.scrollHeight }));
  });

  $effect(() => {
    input?.focus();
  });

  function env() {
    const state = simStore.sim && editor.acting ? simStore.sim.getDeviceState(deviceId) : undefined;
    return { topology: editor.topology, state };
  }

  // --- ping: Ausgaben der Simulation laufend als Zeilen im Gerätestil anhängen.
  let pingFrom = $state<number | null>(null);

  function pingLine(code: string, p: Record<string, string | number> = {}): string | null {
    switch (code) {
      case 'ping.reply':
        return `Reply from ${p.from}: bytes=${p.size} time=${p.time}ms TTL=${p.ttl}`;
      case 'ping.timeout':
        return 'Request timed out.';
      case 'ping.summary':
        return `Success rate is ${p.sent ? Math.round((Number(p.received) / Number(p.sent)) * 100) : 0} percent (${p.received}/${p.sent})`;
      case 'ping.noRoute':
        return '% Network unreachable (no route)';
      case 'ping.hostUnreachable':
      case 'ping.gatewayUnreachable':
        return '% Host unreachable (no ARP reply)';
      case 'ping.ttlExpired':
        return `TTL expired in transit (from ${p.from})`;
      case 'ping.hostUnreachableFrom':
      case 'ping.netUnreachableFrom':
        return `Destination unreachable (from ${p.from})`;
      default:
        return code.startsWith('ping.') && !code.startsWith('ping.start') ? `% ${code}` : null;
    }
  }

  $effect(() => {
    if (pingFrom === null) return;
    void simStore.tick;
    const console = simStore.sim?.getDeviceState(deviceId).console ?? [];
    const fresh = console.slice(pingFrom);
    if (fresh.length === 0) return;
    pingFrom = console.length;
    const added = fresh.flatMap((l) => {
      const text = pingLine(l.code, l.params);
      return text ? [{ text, kind: 'out' as const }] : [];
    });
    if (added.length) lines = [...lines, ...added];
    if (fresh.some((l) => l.code === 'ping.summary')) pingFrom = null;
  });

  function run(text: string, echo: string) {
    const result = execute(session, text, env());
    lines = [...lines, { text: `${prompt}${echo}`, kind: 'in' }, ...result.lines.map((l) => ({ text: l, kind: 'out' as const }))];
    if (result.action?.kind === 'ping') {
      if (editor.acting && simStore.sim) {
        pingFrom = simStore.sim.getDeviceState(deviceId).console.length;
        simStore.ping(deviceId, result.action.target);
      } else {
        lines = [...lines, { text: '% Ping needs the running simulation (action mode)', kind: 'out' }];
      }
    }
    if (result.topology) editor.applyConfig(result.topology);
    session = result.session;
    if (result.close) {
      closed = true;
      onclose?.();
    }
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (closed) return;
    const text = line;
    line = '';
    historyIndex = -1;
    if (secret) {
      onsend?.('********');
      run(text, '');
      return;
    }
    if (text.trim()) history = [...history.filter((h) => h !== text), text].slice(-50);
    onsend?.(text);
    run(text, text);
  }

  function onkeydown(event: KeyboardEvent) {
    if (secret) return;
    if (event.key === 'Tab') {
      event.preventDefault();
      const completed = complete(session, line, env());
      if (completed) line = completed;
      return;
    }
    // «?» zeigt sofort die Hilfe, ohne die Zeile abzuschicken (wie auf echten Geräten).
    if (event.key === '?') {
      event.preventDefault();
      const result = execute(session, `${line}?`, env());
      lines = [...lines, { text: `${prompt}${line}?`, kind: 'in' }, ...result.lines.map((l) => ({ text: l, kind: 'out' as const }))];
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      if (history.length === 0) return;
      if (event.key === 'ArrowUp') historyIndex = historyIndex < 0 ? history.length - 1 : Math.max(0, historyIndex - 1);
      else historyIndex = historyIndex < 0 ? -1 : historyIndex + 1;
      if (historyIndex >= history.length) historyIndex = -1;
      line = historyIndex < 0 ? '' : history[historyIndex]!;
    }
  }
</script>

<div class="cli">
  <div class="output" bind:this={output} role="log" aria-live="polite" aria-label={t('cli.output', { name: device?.name ?? '' })}>
    {#if lines.length === 0}
      <p class="hint">{t('cli.welcome')}</p>
    {/if}
    {#each lines as entry, i (i)}
      <p class:in={entry.kind === 'in'}>{entry.text}</p>
    {/each}
    {#if closed}
      <p class="hint">{t('cli.closed')}</p>
    {/if}
  </div>
  <form onsubmit={submit}>
    <label for="cli-input-{deviceId}" class="prompt">{prompt}</label>
    <input
      id="cli-input-{deviceId}"
      bind:this={input}
      bind:value={line}
      {onkeydown}
      type={secret ? 'password' : 'text'}
      disabled={closed}
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      aria-label={t('cli.input')}
    />
  </form>
</div>

<style>
  .cli {
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
    line-height: 1.45;
    white-space: pre;
    overflow-wrap: normal;
  }
  p.in {
    color: var(--console-prompt, #8fd18f);
  }
  .hint {
    opacity: 0.7;
    white-space: pre-wrap;
  }
  form {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 6px 10px;
    border-top: 1px solid rgba(255, 255, 255, 0.12);
  }
  .prompt {
    color: var(--console-prompt, #8fd18f);
    white-space: nowrap;
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
  form:focus-within {
    box-shadow: inset 0 0 0 2px var(--focus);
  }
</style>
