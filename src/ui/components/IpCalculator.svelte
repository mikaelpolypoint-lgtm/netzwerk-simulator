<script lang="ts">
  import { parseAddressInput, parseIp, splitByHosts, splitEqual, subnetInfo, type SubnetInfo } from '../../core';
  import { t } from '../../i18n';
  import { dialogs } from '../state/dialogs.svelte';
  import Modal from './Modal.svelte';

  /**
   * IP-Rechner: Netz, Broadcast, nutzbarer Bereich, Maske in allen
   * Schreibweisen, Binärdarstellung und Subnetting (gleich gross oder nach
   * Bedarf). «Übernehmen» trägt die Werte direkt ins Formular ein.
   */
  let { onclose }: { onclose: () => void } = $props();
  const target = dialogs.ipcalc;

  let address = $state(target.ip ?? '192.168.1.10');
  let mask = $state(target.mask ?? '24');
  let tab = $state<'equal' | 'hosts'>('equal');
  let count = $state(4);
  let needs = $state('50, 20, 10, 2');

  const parsed = $derived(parseAddressInput(address, mask));
  const info = $derived(parsed ? subnetInfo(parsed.ip, parsed.prefix) : null);
  const equal = $derived(parsed ? splitEqual(parsed.ip, parsed.prefix, count) : null);
  const vlsm = $derived.by(() => {
    if (!parsed) return null;
    const list = needs
      .split(/[,;\s]+/)
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0);
    return list.length ? splitByHosts(parsed.ip, parsed.prefix, list) : null;
  });

  /** Werte übernehmen: Adresse (falls im Netz, sonst die zweite nutzbare), Maske, Gateway = erste nutzbare. */
  function apply(subnet: SubnetInfo) {
    if (!target.apply) return;
    const own = parseIp(subnet.ip);
    const first = parseIp(subnet.first)!;
    const last = parseIp(subnet.last)!;
    const inside = own !== null && own >= first && own <= last && own !== first;
    const ip = inside ? subnet.ip : first + 1 <= last ? formatNumber(first + 1) : subnet.first;
    target.apply({ ip, mask: subnet.mask, gateway: subnet.first, network: `${subnet.network}/${subnet.prefix}` });
    onclose();
  }

  function formatNumber(n: number) {
    return [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');
  }
</script>

<Modal title={t('ipcalc.title')} {onclose} width={720}>
  <div class="inputs">
    <label class="field">
      <span>{t('ipcalc.address')}</span>
      <input bind:value={address} spellcheck="false" placeholder="192.168.1.10/24" />
    </label>
    <label class="field">
      <span>{t('ipcalc.mask')}</span>
      <input bind:value={mask} spellcheck="false" placeholder="24 / 255.255.255.0" />
    </label>
  </div>

  {#if !info}
    <p class="error">{t('ipcalc.invalid')}</p>
  {:else}
    <dl class="result">
      <dt>{t('area.netAddress')}</dt><dd>{info.network}/{info.prefix}</dd>
      <dt>{t('area.broadcast')}</dt><dd>{info.broadcast}</dd>
      <dt>{t('area.range')}</dt><dd>{info.first} – {info.last}</dd>
      <dt>{t('area.hosts')}</dt><dd>{info.hosts.toLocaleString('de-CH')}</dd>
      <dt>{t('area.mask')}</dt><dd>{info.mask} = /{info.prefix}</dd>
      <dt>{t('ipcalc.wildcard')}</dt><dd>{info.wildcard}</dd>
      <dt>{t('ipcalc.binaryIp')}</dt><dd class="bin">{info.ipBinary}</dd>
      <dt>{t('ipcalc.binaryMask')}</dt><dd class="bin">{info.maskBinary}</dd>
      <dt>{t('ipcalc.scope')}</dt><dd><span class="scope scope-{info.scope}">{t(`scope.${info.scope}`)}</span> · {t('ipcalc.class', { c: info.addressClass })}</dd>
    </dl>
    {#if target.apply}
      <button class="primary" onclick={() => apply(info)}>{t('ipcalc.apply')}</button>
    {/if}

    <h3>{t('ipcalc.subnetting')}</h3>
    <div class="tabs" role="tablist">
      <button role="tab" aria-selected={tab === 'equal'} onclick={() => (tab = 'equal')}>{t('ipcalc.equal')}</button>
      <button role="tab" aria-selected={tab === 'hosts'} onclick={() => (tab = 'hosts')}>{t('ipcalc.byHosts')}</button>
    </div>
    {#if tab === 'equal'}
      <label class="field inline">
        <span>{t('ipcalc.count')}</span>
        <input type="number" min="1" max="1024" bind:value={count} />
      </label>
      {#if equal}
        {@render list(equal.map((subnet) => ({ subnet, hosts: subnet.hosts })))}
      {:else}
        <p class="error">{t('ipcalc.tooMany')}</p>
      {/if}
    {:else}
      <label class="field inline">
        <span>{t('ipcalc.needs')}</span>
        <input bind:value={needs} placeholder="50, 20, 10, 2" />
      </label>
      {#if vlsm}
        {@render list(vlsm)}
      {:else}
        <p class="error">{t('ipcalc.noSpace')}</p>
      {/if}
    {/if}
  {/if}
</Modal>

{#snippet list(rows: { subnet: SubnetInfo; hosts: number }[])}
  <table>
    <thead>
      <tr><th>{t('ipcalc.subnet')}</th><th>{t('area.range')}</th><th>{t('area.broadcast')}</th><th class="num">{t('ipcalc.needOrHosts')}</th><th></th></tr>
    </thead>
    <tbody>
      {#each rows.slice(0, 64) as row, i (i)}
        <tr>
          <td class="mono">{row.subnet.network}/{row.subnet.prefix}</td>
          <td class="mono">{row.subnet.first} – {row.subnet.last}</td>
          <td class="mono">{row.subnet.broadcast}</td>
          <td class="num">{row.hosts} / {row.subnet.hosts}</td>
          <td>{#if target.apply}<button class="small" onclick={() => apply(row.subnet)}>{t('ipcalc.applyShort')}</button>{/if}</td>
        </tr>
      {/each}
    </tbody>
  </table>
  {#if rows.length > 64}<p class="muted">{t('ipcalc.more', { n: rows.length - 64 })}</p>{/if}
{/snippet}

<style>
  .inputs {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 10px;
  }
  .field {
    display: grid;
    gap: 4px;
    font-size: 0.85rem;
  }
  .field.inline {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 6px 0;
  }
  .field.inline input {
    width: 12rem;
  }
  .result {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 3px 14px;
    margin: 12px 0;
    padding: 10px 12px;
    background: var(--surface-2);
    border-radius: 8px;
    font-size: 0.86rem;
  }
  .result dt {
    color: var(--muted);
  }
  .result dd {
    margin: 0;
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  }
  .bin {
    letter-spacing: 0.02em;
  }
  .scope {
    padding: 1px 6px;
    border-radius: 4px;
    font-family: system-ui, sans-serif;
    font-size: 0.78rem;
    color: #fff;
  }
  .scope-private {
    background: #2563eb;
  }
  .scope-public {
    background: #16a34a;
  }
  .scope-cgnat {
    background: #d97706;
  }
  .scope-special {
    background: #6b7280;
  }
  .primary {
    background: var(--accent);
    color: var(--on-accent);
    border-color: var(--accent);
  }
  .tabs {
    display: flex;
    gap: 4px;
  }
  .tabs [aria-selected='true'] {
    background: var(--selected-soft);
    border-color: var(--accent);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8rem;
    margin-top: 6px;
  }
  th,
  td {
    text-align: left;
    padding: 3px 6px;
    border-bottom: 1px solid var(--border);
  }
  .mono {
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  }
  .num {
    text-align: right;
  }
  .small {
    font-size: 0.75rem;
    padding: 1px 8px;
  }
</style>
