<script lang="ts">
  import { subifId, type Device } from '../../core';
  import { t } from '../../i18n';
  import { interfaceLabel } from '../labels';
  import { editor } from '../state/editor.svelte';
  import { subnetSummary } from '../subnet';

  /**
   * Router-on-a-Stick: Subinterfaces mit 802.1Q-Tag auf einem Anschluss.
   * Der Anschluss hängt am Trunk-Port eines Switches; jedes Subinterface ist
   * das Gateway eines VLANs.
   */
  let { device }: { device: Device } = $props();

  let draft = $state({ parent: '0', vlan: '', ip: '', mask: '' });
  let error = $state<string | null>(null);

  function add(event: SubmitEvent) {
    event.preventDefault();
    const failure = editor.setSubinterface(device.id, Number(draft.parent), Number(draft.vlan), draft.ip, draft.mask);
    error = failure ? t(`error.${failure.code}`, failure.params) : null;
    if (!failure) draft = { ...draft, vlan: '', ip: '', mask: '' };
  }
</script>

<h3>{t('subif.title')}</h3>
<p class="muted">{t('subif.hint')}</p>
{#if (device.subinterfaces ?? []).length > 0}
  <ul>
    {#each device.subinterfaces ?? [] as s (`${s.parent}.${s.vlan}`)}
      <li>
        <span class="name">{interfaceLabel(device, subifId(s.parent, s.vlan))}</span>
        <span class="mono">{s.ip ? `${s.ip} ${s.mask ?? ''}` : t('subif.noAddress')}</span>
        <button class="small" onclick={() => editor.removeSubinterface(device.id, s.parent, s.vlan)} aria-label={t('subif.remove')}>✕</button>
        {#if s.ip}<span class="summary">{subnetSummary(s.ip, s.mask)}</span>{/if}
      </li>
    {/each}
  </ul>
{/if}
<form onsubmit={add}>
  <select bind:value={draft.parent} aria-label={t('subif.parent')}>
    {#each device.interfaces as iface (iface.index)}
      <option value={String(iface.index)}>{interfaceLabel(device, iface.index)}</option>
    {/each}
  </select>
  <input bind:value={draft.vlan} inputmode="numeric" placeholder="VLAN" aria-label={t('subif.vlan')} />
  <input bind:value={draft.ip} placeholder="192.168.10.1" aria-label={t('config.ip')} autocomplete="off" spellcheck="false" />
  <input bind:value={draft.mask} placeholder="/24" aria-label={t('config.mask')} autocomplete="off" spellcheck="false" />
  <button type="submit" disabled={!draft.vlan.trim()} title={t('subif.add')} aria-label={t('subif.add')}>+</button>
</form>
{#if error}<p class="error" role="alert">{error}</p>{/if}

<style>
  h3 {
    margin: 16px 0 6px;
    font-size: 0.85rem;
  }
  .muted {
    color: var(--muted);
    font-size: 0.75rem;
    margin: 0 0 6px;
  }
  ul {
    list-style: none;
    margin: 0 0 6px;
    padding: 0;
    font-size: 0.8rem;
  }
  li {
    display: grid;
    grid-template-columns: 4.5rem minmax(0, 1fr) auto;
    gap: 4px;
    align-items: center;
    padding: 3px 0;
    border-bottom: 1px solid var(--border);
  }
  .summary {
    grid-column: 1 / -1;
    color: var(--muted);
    font-size: 0.7rem;
  }
  .mono {
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    overflow-wrap: anywhere;
  }
  form {
    display: grid;
    grid-template-columns: 4rem 3.5rem minmax(0, 1fr) 3rem auto;
    gap: 4px;
  }
  input,
  select {
    font: inherit;
    font-size: 0.8rem;
    padding: 3px 5px;
    min-width: 0;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
  }
  button {
    padding: 3px 8px;
  }
  .small {
    padding: 1px 6px;
    font-size: 0.75rem;
  }
  .error {
    color: var(--danger);
    font-size: 0.75rem;
    margin: 4px 0 0;
  }
</style>
