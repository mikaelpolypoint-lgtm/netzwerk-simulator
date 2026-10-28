<script lang="ts">
  import { DEVICE_SPECS, DEVICE_TYPES, type DeviceType, type Medium } from '../../core';
  import { t } from '../../i18n';
  import { DEVICE_MIME } from '../dnd';
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
</script>

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
</nav>

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
