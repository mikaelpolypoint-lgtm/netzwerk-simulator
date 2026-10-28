<script lang="ts">
  import { DEVICE_SPECS, DEVICE_TYPES, SFP_MODULES, type DeviceType, type Medium, type SfpModule } from '../../core';
  import { t } from '../../i18n';
  import { AREA_PRESETS, presetArea, type AreaPreset } from '../areaPresets';
  import { AREA_MIME, DEVICE_MIME, SFP_MIME } from '../dnd';
  import { TAG_HEX } from '../tags';
  import { roleLabel, typeLabel } from '../labels';
  import { editor } from '../state/editor.svelte';
  import { ui } from '../state/ui.svelte';
  import DeviceIcon from './DeviceIcon.svelte';

  /** Geräte, die erst im Pro-Modus erscheinen. */
  const PRO_TYPES: DeviceType[] = ['l3switch'];
  const types = $derived(DEVICE_TYPES.filter((type) => ui.pro || !PRO_TYPES.includes(type)));
  const MEDIA: Medium[] = ['tp', 'fiber', 'wireless'];

  function chooseMedium(medium: Medium) {
    const active = editor.tool === 'cable' && editor.medium === medium;
    editor.medium = medium;
    editor.setTool(active ? 'select' : 'cable');
  }

  function ondragstart(event: DragEvent, type: DeviceType) {
    if (!event.dataTransfer) return;
    event.dataTransfer.setData(DEVICE_MIME, type);
    event.dataTransfer.effectAllowed = 'copy';
  }

  function drag(event: DragEvent, mime: string, value: string) {
    if (!event.dataTransfer) return;
    event.dataTransfer.setData(mime, value);
    event.dataTransfer.effectAllowed = 'copy';
  }

  const floor = $derived(ui.floor === 'all' ? undefined : ui.floor);

  function addPreset(preset: AreaPreset) {
    editor.addArea(presetArea(preset, editor.viewCenter(), (editor.topology.areas?.length ?? 0) + 1, floor));
  }

  /** Farben der Module wie bei echten SFPs: SX/SR schwarz/beige (Multimode), LX/LR blau (Singlemode). */
  const SFP_COLOR: Record<SfpModule, string> = { '1G-SX': '#111827', '1G-LX': '#2563eb', '10G-SR': '#a8a29e', '10G-LR': '#1d4ed8' };
  const RACK = AREA_PRESETS.find((p) => p.key === 'rack')!;
</script>

{#if editor.documenting}
  <nav class="palette" aria-labelledby="palette-title">
    <h2 id="palette-title">{t('palette.areas')}</h2>
    <p class="hint">{t('palette.areasHint')}</p>
    <ul>
      {#each AREA_PRESETS as preset (preset.key)}
        <li>
          <button draggable="true" onclick={() => addPreset(preset)} ondragstart={(e) => drag(e, AREA_MIME, preset.key)}>
            <svg viewBox="0 0 44 32" width="44" height="32" aria-hidden="true">
              {#if preset.key === 'rack'}
                <rect x="10" y="2" width="24" height="28" rx="2" fill="#111827" stroke="#475569" stroke-width="2" />
                <path d="M14 9 H30 M14 15 H30 M14 21 H30" stroke="#64748b" stroke-width="2" />
              {:else}
                <rect x="3" y="4" width="38" height="24" rx="5" fill={TAG_HEX[preset.color]} fill-opacity="0.15" stroke={TAG_HEX[preset.color]} stroke-width="2" stroke-dasharray="5 3" />
              {/if}
            </svg>
            <span>
              <span class="name">{t(`areaPreset.${preset.key}`)}</span>
              <span class="role">{t(`areaPreset.${preset.key}.hint`)}</span>
            </span>
          </button>
        </li>
      {/each}
    </ul>
    <p class="hint tip">{t('palette.areasTip')}</p>
  </nav>
{:else}

<nav class="palette" aria-labelledby="palette-title">
  <h2 id="palette-title">{t('palette.title')}</h2>
  <p class="hint">{t('palette.hint')}</p>
  <ul>
    {#each types as type (type)}
      <li>
        <button
          class="role-{DEVICE_SPECS[type].role}"
          draggable={editor.editable}
          disabled={!editor.editable}
          onclick={() => editor.addDeviceAtCenter(type, ui.floor === 'all' ? 0 : ui.floor)}
          ondragstart={(e) => ondragstart(e, type)}
        >
          <svg viewBox="-28 -24 56 48" width="44" height="38" aria-hidden="true">
            <DeviceIcon {type} />
          </svg>
          <span>
            <span class="name">{typeLabel(type)}</span>
            <span class="role">{roleLabel(type)}</span>
          </span>
        </button>
      </li>
    {/each}
  </ul>

  <h2 class="links-title" id="links-title">{t('palette.links')}</h2>
  <p class="hint">{t('palette.linksHint')}</p>
  <ul aria-labelledby="links-title">
    {#each MEDIA as medium (medium)}
      <li>
        <button
          class="link"
          aria-pressed={editor.tool === 'cable' && editor.medium === medium}
          disabled={!editor.editable}
          onclick={() => chooseMedium(medium)}
        >
          <svg viewBox="0 0 44 20" width="44" height="20" aria-hidden="true">
            <line class="sample sample-{medium}" x1="4" y1="10" x2="40" y2="10" />
            {#if medium === 'wireless'}<path class="sample-wave" d="M16 8 Q22 2 28 8 M19 10 Q22 7 25 10" />{/if}
          </svg>
          <span>
            <span class="name">{t(`medium.${medium}`)}</span>
            <span class="role">{t(`medium.${medium}.hint`)}</span>
          </span>
        </button>
      </li>
    {/each}
  </ul>

  <h2 class="links-title" id="sfp-title">{t('palette.sfp')}</h2>
  <p class="hint">{t('palette.sfpHint')}</p>
  <ul aria-labelledby="sfp-title" class="sfp-list">
    {#each SFP_MODULES as module (module)}
      <li>
        <button
          class="sfp"
          draggable={editor.editable}
          disabled={!editor.editable}
          onclick={() => editor.insertSfp(module)}
          ondragstart={(e) => drag(e, SFP_MIME, module)}
          title={t(`sfp.${module}`)}
        >
          <svg viewBox="0 0 44 20" width="44" height="20" aria-hidden="true">
            <rect x="4" y="5" width="28" height="10" rx="1.5" fill="#cbd5e1" stroke="#64748b" />
            <rect x="32" y="4" width="8" height="12" rx="2" fill={SFP_COLOR[module]} />
          </svg>
          <span>
            <span class="name">{module}</span>
            <span class="role">{t(`sfp.${module}`)}</span>
          </span>
        </button>
      </li>
    {/each}
  </ul>

  <h2 class="links-title">{t('palette.infrastructure')}</h2>
  <ul>
    <li>
      <button disabled={!editor.editable} draggable={editor.editable} onclick={() => addPreset(RACK)} ondragstart={(e) => drag(e, AREA_MIME, 'rack')}>
        <svg viewBox="0 0 44 32" width="44" height="32" aria-hidden="true">
          <rect x="10" y="2" width="24" height="28" rx="2" fill="#111827" stroke="#475569" stroke-width="2" />
          <path d="M14 9 H30 M14 15 H30 M14 21 H30" stroke="#64748b" stroke-width="2" />
        </svg>
        <span>
          <span class="name">{t('areaPreset.rack')}</span>
          <span class="role">{t('areaPreset.rack.hint')}</span>
        </span>
      </button>
    </li>
  </ul>
</nav>
{/if}

<style>
  .palette {
    padding: 12px;
    overflow-y: auto;
  }
  h2 {
    margin: 0 0 4px;
    font-size: 0.95rem;
  }
  .hint {
    margin: 0 0 12px;
    color: var(--muted);
    font-size: 0.8rem;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  button {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    text-align: left;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    cursor: grab;
  }
  button:hover:not(:disabled) {
    border-color: var(--role);
  }
  button:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
  button > span {
    min-width: 0;
  }
  .name {
    display: block;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .role {
    display: block;
    font-size: 0.75rem;
    color: var(--muted);
  }
  .links-title {
    margin-top: 18px;
  }
  .sfp-list {
    grid-template-columns: 1fr 1fr;
  }
  .sfp {
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: 4px 6px;
  }
  .sfp .role {
    font-size: 0.65rem;
  }
  .tip {
    margin-top: 12px;
  }
  .link {
    cursor: pointer;
  }
  .link[aria-pressed='true'] {
    background: var(--selected-soft);
    border-color: var(--accent);
  }
  .sample {
    stroke-width: 3;
    stroke-linecap: round;
  }
  .sample-tp {
    stroke: var(--cable);
  }
  .sample-fiber {
    stroke: #ef6c00;
    stroke-width: 4;
  }
  .sample-wireless {
    stroke: #2563eb;
    stroke-dasharray: 1 6;
  }
  .sample-wave {
    fill: none;
    stroke: #2563eb;
    stroke-width: 1.6;
    stroke-linecap: round;
  }
</style>
