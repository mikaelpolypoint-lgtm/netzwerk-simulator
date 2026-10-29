<script lang="ts">
  import { CURRENCY_RATES, convert, costOf, type Currency } from '../../core';
  import { t } from '../../i18n';
  import { editor } from '../state/editor.svelte';
  import { ui } from '../state/ui.svelte';
  import Modal from './Modal.svelte';

  /** Kostenaufstellung des Netzes: wer baut es am günstigsten? */
  let { onclose }: { onclose: () => void } = $props();
  const summary = $derived(costOf(editor.topology));
  const money = (chf: number) => new Intl.NumberFormat('de-CH', { maximumFractionDigits: 0 }).format(convert(chf, ui.currency));
  const CURRENCIES = Object.keys(CURRENCY_RATES) as Currency[];

  function label(key: string): string {
    if (key.startsWith('cable:')) return t(`medium.${key.slice(6)}`);
    if (key.startsWith('sfp:')) return `SFP ${key.slice(4)}`;
    if (key === 'rack') return t('areaPreset.rack');
    return t(`device.${key}`);
  }
</script>

<Modal title={t('costs.title')} {onclose} width={560}>
  <p class="muted">{t('costs.intro')}</p>
  <div class="currency" role="radiogroup" aria-label={t('costs.currency')}>
    {#each CURRENCIES as c (c)}
      <button role="radio" aria-checked={ui.currency === c} onclick={() => ui.setCurrency(c)}>{c}</button>
    {/each}
  </div>
  {#if summary.lines.length === 0}
    <p class="muted">{t('costs.empty')}</p>
  {:else}
    <table>
      <thead>
        <tr><th>{t('costs.item')}</th><th class="num">{t('costs.count')}</th><th class="num">{ui.currency}</th></tr>
      </thead>
      <tbody>
        {#each summary.lines as line (line.key)}
          <tr><td>{label(line.key)}</td><td class="num">{line.count}</td><td class="num">{money(line.total)}</td></tr>
        {/each}
      </tbody>
      <tfoot>
        <tr><th>{t('costs.total')}</th><td></td><th class="num">{money(summary.total)}</th></tr>
      </tfoot>
    </table>
  {/if}
  <p class="muted small">{t('costs.disclaimer')}</p>
</Modal>

<style>
  .currency {
    display: flex;
    gap: 4px;
    margin: 8px 0 12px;
  }
  .currency button[aria-checked='true'] {
    background: var(--accent);
    color: var(--on-accent);
    border-color: var(--accent);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.88rem;
  }
  th,
  td {
    text-align: left;
    padding: 4px 6px;
    border-bottom: 1px solid var(--border);
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  tfoot th {
    font-size: 1rem;
  }
  .small {
    font-size: 0.75rem;
  }
</style>
