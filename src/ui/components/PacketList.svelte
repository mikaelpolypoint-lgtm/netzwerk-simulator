<script lang="ts">
  import { tick } from 'svelte';
  import { t } from '../../i18n';
  import { protocolOf, toRow } from '../packets';
  import { editor } from '../state/editor.svelte';
  import { simStore } from '../state/sim.svelte';
  import PacketDetails from './PacketDetails.svelte';

  /** Mehr Zeilen machen die Tabelle träge; ältere bleiben in der Simulation erhalten. */
  const MAX_ROWS = 500;

  let protocol = $state('');
  let device = $state('');
  let direction = $state<'' | 'sent' | 'received'>('');
  let scroller: HTMLDivElement;
  let followTail = true;

  let selectedId = $state<number | null>(null);

  const log = $derived((simStore.tick, [...(simStore.sim?.getPacketLog() ?? [])]));
  const protocols = $derived([...new Set(log.map((e) => protocolOf(e.frame)))].sort());
  const selected = $derived(selectedId === null ? undefined : log.find((e) => e.id === selectedId));
  const filtered = $derived(
    log.filter((entry) => {
      if (protocol && protocolOf(entry.frame) !== protocol) return false;
      if (!device) return true;
      if (direction === 'sent') return entry.from.device === device;
      if (direction === 'received') return entry.to.device === device;
      return entry.from.device === device || entry.to.device === device;
    }),
  );
  const rows = $derived(filtered.slice(-MAX_ROWS).map((entry) => toRow(editor.topology, entry)));

  // Neue Zeilen nur dann ins Bild holen, wenn man ohnehin unten war.
  $effect.pre(() => {
    void rows;
    if (scroller) followTail = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 8;
  });
  $effect(() => {
    void rows;
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
    <button class="clear" onclick={() => simStore.clearPacketLog()} disabled={log.length === 0}>{t('packets.clear')}</button>
  </header>

  <div class="body">
  <div class="scroller" bind:this={scroller}>
    {#if rows.length === 0}
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
              <td>{row.info}</td>
            </tr>
          {/each}
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
  td {
    padding: 3px 8px;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }
  td:last-child {
    white-space: normal;
    min-width: 16rem;
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
  .proto-arp {
    --proto: var(--proto-arp);
  }
  .proto-icmp {
    --proto: var(--proto-icmp);
  }
  .proto-dhcp {
    --proto: var(--proto-dhcp);
  }
  .lost td {
    color: var(--danger);
  }
  .muted {
    color: var(--muted);
  }
</style>
