<script lang="ts">
  import type { TagColor } from '../../core';
  import { t } from '../../i18n';
  import { editor } from '../state/editor.svelte';
  import { TAG_HEX, TAG_ORDER } from '../tags';
  import Modal from './Modal.svelte';

  /**
   * VLANs dokumentieren: Nummer, Name und Farbe. Die Farbe erscheint an allen
   * Switch-Anschlüssen dieses VLANs (Anschlussübersicht, Rack, Karte).
   */
  let { onclose }: { onclose: () => void } = $props();
  let id = $state(10);
  let name = $state('');
  let color = $state<TagColor>('green');
  let error = $state('');

  const documented = $derived(editor.topology.vlans ?? []);
  /** VLANs, die auf Switches verwendet, aber noch nicht dokumentiert sind. */
  const used = $derived(
    [...new Set(editor.topology.devices.flatMap((d) => [...d.interfaces.map((i) => i.vlan ?? 1), ...(d.svis ?? []).map((s) => s.vlan), ...(d.subinterfaces ?? []).map((s) => s.vlan)]))]
      .filter((v) => v !== 1 && !documented.some((d) => d.id === v))
      .sort((a, b) => a - b),
  );

  function add() {
    const issue = editor.setVlanDef({ id: Number(id), name, color });
    error = issue ? t(`error.${issue.code}`) : '';
    if (!issue) {
      name = '';
      id = Number(id) + 10;
    }
  }
</script>

<Modal title={t('vlans.title')} {onclose} width={560}>
  <p class="muted">{t('vlans.intro')}</p>
  {#if documented.length}
    <table>
      <thead><tr><th>VLAN</th><th>{t('vlans.name')}</th><th>{t('area.color')}</th><th></th></tr></thead>
      <tbody>
        {#each documented as v (v.id)}
          <tr>
            <td>{v.id}</td>
            <td><input value={v.name ?? ''} maxlength="32" disabled={!editor.editable} onchange={(e) => editor.setVlanDef({ ...v, name: e.currentTarget.value })} /></td>
            <td>
              <div class="colors">
                {#each TAG_ORDER as c (c)}
                  <button class="dot" aria-label={t(`color.${c}`)} aria-pressed={v.color === c} disabled={!editor.editable} style:background={TAG_HEX[c]} onclick={() => editor.setVlanDef({ ...v, color: c })}></button>
                {/each}
              </div>
            </td>
            <td><button class="small danger" disabled={!editor.editable} onclick={() => editor.removeVlanDef(v.id)}>{t('inspector.delete')}</button></td>
          </tr>
        {/each}
      </tbody>
    </table>
  {:else}
    <p class="muted">{t('vlans.none')}</p>
  {/if}

  <h3>{t('vlans.add')}</h3>
  <div class="add">
    <label>VLAN <input type="number" min="1" max="4094" bind:value={id} /></label>
    <label>{t('vlans.name')} <input bind:value={name} maxlength="32" placeholder={t('vlans.namePlaceholder')} /></label>
    <div class="colors" role="radiogroup" aria-label={t('area.color')}>
      {#each TAG_ORDER as c (c)}
        <button class="dot" role="radio" aria-checked={color === c} aria-label={t(`color.${c}`)} style:background={TAG_HEX[c]} onclick={() => (color = c)}></button>
      {/each}
    </div>
    <button onclick={add} disabled={!editor.editable}>{t('vlans.addButton')}</button>
  </div>
  {#if error}<p class="error">{error}</p>{/if}
  {#if used.length}
    <p class="muted">{t('vlans.undocumented', { list: used.join(', ') })}</p>
  {/if}
</Modal>

<style>
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
  }
  th,
  td {
    text-align: left;
    padding: 4px;
    border-bottom: 1px solid var(--border);
  }
  .colors {
    display: flex;
    gap: 3px;
    flex-wrap: wrap;
  }
  .dot {
    width: 18px;
    height: 18px;
    padding: 0;
    border-radius: 50%;
    border: 2px solid var(--surface);
    box-shadow: 0 0 0 1px var(--border);
  }
  .dot[aria-pressed='true'],
  .dot[aria-checked='true'] {
    box-shadow: 0 0 0 2px var(--text);
  }
  .add {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
    font-size: 0.85rem;
  }
  .add input[type='number'] {
    width: 5rem;
  }
  .small {
    font-size: 0.75rem;
  }
  .danger {
    color: var(--danger);
  }
</style>
