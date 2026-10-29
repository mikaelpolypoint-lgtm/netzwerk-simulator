import { t } from '../../i18n';
import { presetArea } from '../areaPresets';
import type { ShopCategory, ShopItem } from '../shop';
import { editor } from './editor.svelte';
import { ui } from './ui.svelte';

/** Offene Kategorie der Palette («Shop») und das Einfügen einer gewählten Variante. */
class ShopState {
  category = $state<ShopCategory | null>(null);

  toggle(category: ShopCategory) {
    this.category = this.category === category ? null : category;
  }

  close() {
    this.category = null;
  }

  /** Variante einfügen: Gerät in die Bildmitte, Verbindung als Werkzeug, Modul ins gewählte Gerät, Bereich in die Mitte. */
  use(item: ShopItem) {
    if (editor.acting) editor.setMode('design');
    const floor = ui.floor === 'all' ? 0 : ui.floor;
    if (item.kind === 'device') {
      editor.addDeviceAtCenter(item.type, floor, item.options ?? {}, item.prepare, item.options?.groupSize ? t('defaultName.clientgroup') : undefined);
    } else if (item.kind === 'medium') {
      editor.medium = item.medium;
      editor.setTool('cable');
      editor.notify(t('shop.cableHint', { medium: t(`medium.${item.medium}`) }));
    } else if (item.kind === 'sfp') {
      editor.insertSfp(item.module);
    } else {
      editor.addArea(presetArea(item.preset, editor.viewCenter(), (editor.topology.areas?.length ?? 0) + 1, ui.floor === 'all' ? undefined : ui.floor));
    }
    this.close();
  }
}

export const shop = new ShopState();
