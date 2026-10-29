<script lang="ts">
  import { tick } from 'svelte';
  import { t } from '../../i18n';
  import { exportPcap } from '../actions';
  import { parseFilter, protocolOf, toRow } from '../packets';
  import { editor } from '../state/editor.svelte';
  import { simStore } from '../state/sim.svelte';
  import { ui } from '../state/ui.svelte';
  import PacketDetails from './PacketDetails.svelte';

  /**
   * Nur sichtbare Zeilen werden gezeichnet (feste Zeilenhöhe), so bleibt die
   * Liste auch mit Tausenden von Einträgen flüssig.
   */
  const ROW_HEIGHT = 24;
  const OVERSCAN = 10;

  let protocol = $state('');
  let expression = $state('');
  /** Schnellfilter: ein Klick setzt einen typischen Ausdruck. */
  const CHIPS = ['arp', 'dhcp', 'dns', 'icmp', 'http', 'tcp', 'stp', 'broadcast', 'not arp and not stp', 'lost'];
  const parsedFilter = $derived(parseFilter(expression));
  let device = $state('');
  let direction = $state<'' | 'sent' | 'received'>('');
  let scroller: HTMLDivElement;
  let followTail = true;
  let scrollTop = $state(0);
  let viewport = $state(300);

  let selectedId = $state<number | null>(null);

  const log = $derived((simStore.tick, [...(simStore.sim?.getPacketLog() ?? [])]));
  const protocols = $derived([...new Set(log.map((e) => protocolOf(e.frame)))].sort());
  const selected = $derived(selectedId === null ? undefined : log.find((e) => e.id === selectedId));
  const filtered = $derived(
    log.filter((entry) => {
      if (parsedFilter.ok && parsedFilter.test && !parsedFilter.test(entry, editor.topology)) return false;
      if (protocol && protocolOf(entry.frame) !== protocol) return false;
      if (!device) return true;
      if (direction === 'sent') return entry.from.device === device;
      if (direction === 'received') return entry.to.device === device;
      return entry.from.device === device || entry.to.device === device;
    }),
  );
  const first = $derived(Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN));
  const last = $derived(Math.min(filtered.length, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN));
  // Nur die sichtbaren Einträge in Tabellenzeilen übersetzen (das ist der teure Teil).
  const rows = $derived(filtered.slice(first, last).map((entry) => toRow(editor.topology, entry)));

  // Neue Zeilen nur dann ins Bild holen, wenn man ohnehin unten war.
  $effect.pre(() => {
    void filtered.length;
    if (scroller) followTail = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - ROW_HEIGHT;
  });
  $effect(() => {
    void filtered.length;
    if (followTail) tick().then(() => scroller?.scrollTo({ top: scroller.scrollHeight }));
  });
</script>

<section class="packets" aria-labelledby="packets-title">
  <header>
    <h2 id="packets-title">{t('packets.title')}</h2>
    <span class="muted">{t('packets.count', { n: filtered.length })}</span>
    <label>
      {t('packets.filterProtocol')}
      <select bind:value={protocol}>
        <option value="">{t('packets.all')}</option>
        {#each protocols as p (p)}
          <option value={p}>{p}</option>
        {/each}
      </select>
    </label>
    <label>
      {t('packets.filterDevice')}
      <select bind:value={device}>
        <option value="">{t('packets.all')}</option>
        {#each editor.topology.devices as d (d.id)}
          <option value={d.id}>{d.name}</option>
        {/each}
      </select>
    </label>
    <label>
      {t('packets.filterDirection')}
      <select bind:value={direction} disabled={!device}>
        <option value="">{t('packets.both')}</option>
        <option value="sent">{t('packets.sent')}</option>
        <option value="received">{t('packets.received')}</option>
      </select>
    </label>
    {#if ui.has('tool.pcap')}
      <button class="clear" onclick={exportPcap} disabled={log.length === 0} title={t('pcap.tip')}>{t('pcap.export')}</button>
    {/if}
    <button class="clear" onclick={() => simStore.clearPacketLog()} disabled={log.length === 0}>{t('packets.clear')}</button>
  </header>
  <div class="filterbar">
    <label class="expr">
      <span class="visually-hidden">{t('filter.label')}</span>
      <input
        type="search"
        bind:value={expression}
        placeholder={t('filter.placeholder')}
        title={t('filter.help')}
        class:invalid={!parsedFilter.ok}
        aria-invalid={!parsedFilter.ok}
        aria-describedby="filter-error"
        spellcheck="false"
        autocomplete="off"
      />
    </label>
    {#each CHIPS as chip (chip)}
      <button class="chip" class:on={expression === chip} onclick={() => (expression = expression === chip ? '' : chip)}>{chip}</button>
    {/each}
    <span id="filter-error" class="error" role="status">{parsedFilter.ok ? '' : parsedFilter.error}</span>
  </div>

  <div class="body">
  <div class="scroller" bind:this={scroller} bind:clientHeight={viewport} onscroll={() => (scrollTop = scroller.scrollTop)}>
    {#if filtered.length === 0}
      <p class="muted empty">{t('packets.empty')}</p>
    {:else}
      <table aria-describedby="packets-hint">
        <caption id="packets-hint" class="visually-hidden">{t('packets.selectHint')}</caption>
        <thead>
          <tr>
            <th scope="col" class="num">{t('packets.no')}</th>
            <th scope="col" class="num">{t('packets.time')}</th>
            <th scope="col">{t('packets.route')}</th>
            <th scope="col">{t('packets.protocol')}</th>
            <th scope="col">{t('packets.source')}</th>
            <th scope="col">{t('packets.destination')}</th>
            <th scope="col">{t('packets.info')}</th>
          </tr>
        </thead>
        <tbody>
          {#if first > 0}
            <tr class="spacer" aria-hidden="true" style="height: {first * ROW_HEIGHT}px"><td colspan="7"></td></tr>
          {/if}
          {#each rows as row (row.id)}
            <tr
              class="proto-{row.protocol.toLowerCase()}"
              class:lost={row.lost}
              class:selected={row.id === selectedId}
              tabindex="0"
              aria-selected={row.id === selectedId}
              onclick={() => (selectedId = row.id)}
              onkeydown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  selectedId = row.id;
                }
              }}
            >
              <td class="num">{row.id}</td>
              <td class="num">{row.time}</td>
              <td>{row.route}</td>
              <td><span class="badge">{row.protocol}</span></td>
              <td class="mono">{row.source}</td>
              <td class="mono">{row.destination}</td>
              <td class="info" title={row.info}>{row.info}</td>
            </tr>
          {/each}
          {#if last < filtered.length}
            <tr class="spacer" aria-hidden="true" style="height: {(filtered.length - last) * ROW_HEIGHT}px"><td colspan="7"></td></tr>
          {/if}
        </tbody>
      </table>
    {/if}
  </div>
  {#if selected}
    <div class="detail-pane">
      <PacketDetails entry={selected} onclose={() => (selectedId = null)} />
    </div>
  {/if}
  </div>
</section>

<style>
  .filterbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    border-bottom: 1px solid var(--border);
  }
  .expr input {
    width: min(320px, 50vw);
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    font-size: 0.78rem;
  }
  .expr input.invalid {
    outline: 2px solid var(--danger, #c0392b);
  }
  .chip {
    font-size: 0.7rem;
    padding: 1px 8px;
    border-radius: 999px;
  }
  .chip.on {
    background: var(--accent);
    color: var(--accent-contrast, #fff);
  }
  .error {
    color: var(--danger, #c0392b);
    font-size: 0.72rem;
  }
  .packets {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    background: var(--surface);
    border-top: 1px solid var(--border);
  }
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 14px;
    padding: 6px 12px;
    border-bottom: 1px solid var(--border);
    font-size: 0.85rem;
  }
  h2 {
    margin: 0;
    font-size: 0.95rem;
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
  .clear {
    margin-left: auto;
  }
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .scroller {
    flex: 1;
    min-width: 0;
    overflow: auto;
  }
  .detail-pane {
    width: min(360px, 45%);
    flex-shrink: 0;
  }
  tbody tr {
    cursor: pointer;
  }
  tbody tr:hover td {
    background: var(--hover);
  }
  tbody tr.selected td {
    background: var(--selected-soft);
  }
  tbody tr:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: -2px;
  }
  .empty {
    padding: 12px;
    margin: 0;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8rem;
  }
  thead th {
    position: sticky;
    top: 0;
    background: var(--surface-2);
    text-align: left;
    font-weight: 600;
    padding: 4px 8px;
    white-space: nowrap;
  }
  /* Feste Zeilenhöhe: Voraussetzung, damit nur die sichtbaren Zeilen gezeichnet werden können. */
  tbody tr:not(.spacer) {
    height: 24px;
  }
  td {
    padding: 0 8px;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
    line-height: 23px;
  }
  td.info {
    min-width: 16rem;
    max-width: 40rem;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .spacer td {
    padding: 0;
    border: none;
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .mono {
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  }
  .badge {
    display: inline-block;
    min-width: 3.5em;
    padding: 0 6px;
    border-radius: 4px;
    font-weight: 600;
    text-align: center;
    background: var(--proto, var(--surface-2));
  }
  .lost td {
    color: var(--danger);
  }
  .muted {
    color: var(--muted);
  }
</style>
