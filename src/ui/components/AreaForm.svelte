<script lang="ts">
  import { floorsOf, networkInfo, type DocArea, type TagColor } from '../../core';
  import { t } from '../../i18n';
  import { editor } from '../state/editor.svelte';
  import { TAG_HEX, TAG_ORDER } from '../tags';

  /** Dokumentationsmodus: Titel, Farbe, Netz (mit berechneten Infos), VLAN und Notiz eines Bereichs. */
  let { area }: { area: DocArea } = $props();

  const canEdit = $derived(editor.documenting || editor.editable);
  const info = $derived(area.network ? networkInfo(area.network) : null);
  const floors = $derived(floorsOf(editor.topology));

  function set(change: Partial<Omit<DocArea, 'id'>>) {
    editor.updateArea(area.id, change);
  }

  function setVlan(value: string) {
    const n = Number(value);
    set({ vlan: value.trim() && Number.isInteger(n) ? n : undefined });
  }
</script>

<dl class="facts">
  <dt>{t('inspector.type')}</dt>
  <dd>{t(area.kind === 'rack' ? 'areaPreset.rack' : 'area.type')}</dd>
</dl>

<label class="field">
  <span>{t('area.title')}</span>
  <input value={area.title} maxlength="80" disabled={!canEdit} onchange={(e) => set({ title: e.currentTarget.value })} />
</label>

<div class="field">
  <span id="area-color">{t('area.color')}</span>
  <div class="colors" role="radiogroup" aria-labelledby="area-color">
    {#each TAG_ORDER as c (c)}
      <button
        role="radio"
        aria-checked={area.color === c}
        aria-label={t(`color.${c}`)}
        title={t(`color.${c}`)}
        disabled={!canEdit}
        style:background={TAG_HEX[c]}
        onclick={() => set({ color: c as TagColor })}
      ></button>
    {/each}
  </div>
</div>

<label class="field">
  <span>{t('area.network')}</span>
  <input
    value={area.network ?? ''}
    placeholder="192.168.10.0/24"
    maxlength="40"
    disabled={!canEdit}
    spellcheck="false"
    onchange={(e) => set({ network: e.currentTarget.value.trim() || undefined })}
  />
</label>
{#if area.network && !info}
  <p class="error">{t('area.networkInvalid')}</p>
{:else if info}
  <dl class="info">
    <dt>{t('area.netAddress')}</dt>
    <dd>{info.network}</dd>
    <dt>{t('area.mask')}</dt>
    <dd>{info.mask}</dd>
    <dt>{t('area.range')}</dt>
    <dd>{info.first} – {info.last}</dd>
    <dt>{t('area.broadcast')}</dt>
    <dd>{info.broadcast}</dd>
    <dt>{t('area.hosts')}</dt>
    <dd>{info.hosts}</dd>
  </dl>
{/if}

<label class="field">
  <span>{t('area.vlan')}</span>
  <input value={area.vlan ?? ''} inputmode="numeric" placeholder="10" disabled={!canEdit} onchange={(e) => setVlan(e.currentTarget.value)} />
</label>

{#if floors.length > 1}
  <label class="field">
    <span>{t('floor.label')}</span>
    <select
      value={area.floor === undefined ? '' : String(area.floor)}
      disabled={!canEdit}
      onchange={(e) => set({ floor: e.currentTarget.value === '' ? undefined : Number(e.currentTarget.value) })}
    >
      <option value="">{t('floor.all')}</option>
      {#each floors as f, i (i)}<option value={String(i)}>{f.name}</option>{/each}
    </select>
  </label>
{/if}

<label class="field">
  <span>{t('area.note')}</span>
  <textarea rows="5" maxlength="2000" disabled={!canEdit} onchange={(e) => set({ note: e.currentTarget.value || undefined })}>{area.note ?? ''}</textarea>
</label>

{#if canEdit}
  <div class="buttons">
    <button onclick={() => editor.duplicateArea()} title="{t('key.ctrl')}+C / {t('key.ctrl')}+V">{t('area.duplicate')}</button>
    <button class="danger" onclick={() => editor.deleteSelection()}>{t('inspector.delete')}</button>
  </div>
{/if}

<style>
  .facts {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 12px;
    margin: 0 0 12px;
    font-size: 0.85rem;
  }
  .facts dt,
  .info dt {
    color: var(--muted);
  }
  .facts dd,
  .info dd {
    margin: 0;
  }
  .field {
    display: grid;
    gap: 4px;
    margin-bottom: 10px;
    font-size: 0.85rem;
  }
  input,
  select,
  textarea {
    font: inherit;
    padding: 5px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
    color: var(--text);
  }
  textarea {
    resize: vertical;
  }
  .colors {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .colors button {
    width: 24px;
    height: 24px;
    padding: 0;
    border-radius: 50%;
    border: 2px solid var(--surface);
    box-shadow: 0 0 0 1px var(--border);
  }
  .colors button[aria-checked='true'] {
    box-shadow: 0 0 0 3px var(--text);
  }
  .info {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 10px;
    margin: -4px 0 12px;
    padding: 8px;
    font-size: 0.75rem;
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    background: var(--surface-2);
    border-radius: 6px;
  }
  .error {
    color: var(--danger);
    font-size: 0.75rem;
    margin: -6px 0 10px;
  }
  .danger {
    color: var(--danger);
    border-color: var(--danger);
  }
  .buttons {
    display: flex;
    gap: 8px;
  }
</style>
