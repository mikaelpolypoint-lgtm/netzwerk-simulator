import {
  addDnsRecord,
  configureHost,
  devicePrice,
  PRICES,
  setDhcpServer,
  setDnsServerEnabled,
  setMailServerEnabled,
  setWebServerEnabled,
  addMailbox,
  type DeviceOptions,
  type DeviceType,
  type Medium,
  type ModemKind,
  type NetInterface,
  type Result,
  type SfpModule,
  type Topology,
} from '../core';
import { t } from '../i18n';
import { AREA_PRESETS, type AreaPreset } from './areaPresets';
import { deviceFeature, mediumFeature } from './features';

/**
 * Der «Shop» der Palette: Hauptgeräte nach Kategorien, darunter die
 * Ausführungen (Varianten) mit Richtpreis. Jede Variante nennt die
 * Funktion, die eingeschaltet sein muss, damit sie erscheint.
 */
export type ShopCategory = 'endpoints' | 'servers' | 'switches' | 'routers' | 'wireless' | 'internet' | 'links' | 'modules' | 'areas';
export const SHOP_CATEGORIES: readonly ShopCategory[] = ['endpoints', 'servers', 'switches', 'routers', 'wireless', 'internet', 'links', 'modules', 'areas'];

interface Base {
  id: string;
  category: ShopCategory;
  /** Alle genannten Funktionen müssen eingeschaltet sein. */
  features: string[];
}

export interface DeviceItem extends Base {
  kind: 'device';
  type: DeviceType;
  options?: DeviceOptions;
  /** Vorbelegung nach dem Einfügen (z.B. Dienste eines Servers). */
  prepare?: (t: Topology, id: string) => Topology;
}

export interface MediumItem extends Base {
  kind: 'medium';
  medium: Medium;
}

export interface SfpItem extends Base {
  kind: 'sfp';
  module: SfpModule;
}

export interface AreaItem extends Base {
  kind: 'area';
  preset: AreaPreset;
}

export type ShopItem = DeviceItem | MediumItem | SfpItem | AreaItem;

/** Ergebnis einer Vorbelegung übernehmen, Fehler ignorieren (Vorbelegung ist nur ein Vorschlag). */
const step = (topology: Topology, change: (t: Topology) => Result<Topology>): Topology => {
  const r = change(topology);
  return r.ok ? r.value : topology;
};

const serverPreset =
  (ip: string, services: ('dhcp' | 'dns' | 'web' | 'mail')[]) =>
  (topology: Topology, id: string): Topology => {
    let next = step(topology, (t) => configureHost(t, id, { ip, mask: '255.255.255.0', gateway: '192.168.1.1', dns: services.includes('dns') ? ip : undefined }));
    if (services.includes('dhcp')) {
      next = step(next, (t) => setDhcpServer(t, id, { start: '192.168.1.100', end: '192.168.1.199', gateway: '192.168.1.1', dns: services.includes('dns') ? ip : '192.168.1.3', leaseTime: 3600 }));
    }
    if (services.includes('dns')) {
      next = step(next, (t) => setDnsServerEnabled(t, id, true));
      next = step(next, (t) => addDnsRecord(t, id, { name: 'www.firma.example', type: 'A', value: services.includes('web') ? ip : '192.168.1.80', ttl: 300 }));
    }
    if (services.includes('web')) {
      const name = next.devices.find((d) => d.id === id)?.name ?? '';
      next = step(next, (t) => setWebServerEnabled(t, id, true, [{ path: '/index.html', content: t_defaultPage(name) }]));
    }
    if (services.includes('mail')) {
      next = step(next, (t) => setMailServerEnabled(t, id, true, 'firma.example'));
      next = step(next, (t) => addMailbox(t, id, { user: 'info', password: 'geheim' }));
    }
    return next;
  };

const t_defaultPage = (name: string) => t('web.defaultPage', { name });

const device = (id: string, category: ShopCategory, type: DeviceType, extra: Partial<DeviceItem> = {}): DeviceItem => ({
  id,
  category,
  kind: 'device',
  type,
  features: [deviceFeature(type), ...(extra.features ?? [])],
  ...extra,
});

export const SHOP: readonly ShopItem[] = [
  device('notebook', 'endpoints', 'notebook'),
  device('pc', 'endpoints', 'pc'),
  device('group10', 'endpoints', 'clientgroup', { options: { groupSize: 10 } }),
  device('group25', 'endpoints', 'clientgroup', { options: { groupSize: 25 } }),
  device('group50', 'endpoints', 'clientgroup', { options: { groupSize: 50 } }),

  device('server', 'servers', 'server'),
  device('serverRack', 'servers', 'server', { options: { variant: 'rack' }, features: ['tool.racks'] }),
  device('serverDhcp', 'servers', 'server', { prepare: serverPreset('192.168.1.2', ['dhcp']), features: ['service.dhcp'] }),
  device('serverDns', 'servers', 'server', { prepare: serverPreset('192.168.1.3', ['dns']), features: ['service.dns'] }),
  device('serverWeb', 'servers', 'server', { prepare: serverPreset('192.168.1.80', ['web']), features: ['service.web'] }),
  device('serverMail', 'servers', 'server', { prepare: serverPreset('192.168.1.25', ['mail']), features: ['service.mail'] }),
  device('serverAll', 'servers', 'server', { prepare: serverPreset('192.168.1.2', ['dhcp', 'dns', 'web']), features: ['service.dhcp', 'service.dns', 'service.web'] }),

  device('switch8', 'switches', 'switch', { options: { ports: 8, sfpSlots: 2 } }),
  device('switch16', 'switches', 'switch', { options: { ports: 16, sfpSlots: 2 } }),
  device('switch24', 'switches', 'switch', { options: { ports: 24, sfpSlots: 4 } }),
  device('l3switch24', 'switches', 'l3switch', { options: { ports: 24, sfpSlots: 4 } }),
  device('l3switch48', 'switches', 'l3switch', { options: { ports: 48, sfpSlots: 4 } }),

  device('router2', 'routers', 'router', { options: { ports: 2, sfpSlots: 1 } }),
  device('router4', 'routers', 'router', { options: { ports: 4, sfpSlots: 1 } }),
  device('routerSerial', 'routers', 'router', { options: { ports: 2, serialPorts: 2, sfpSlots: 0 }, features: ['medium.serial'] }),
  device('routerWan', 'routers', 'router', { options: { ports: 4, serialPorts: 2, sfpSlots: 2 }, features: ['medium.serial'] }),

  device('accesspoint', 'wireless', 'accesspoint'),

  device('internet', 'internet', 'internet'),
  ...(['cable', 'fiber', 'mobile', 'vdsl', 'adsl'] as ModemKind[]).map((kind) => device(`modem-${kind}`, 'internet', 'modem', { options: { modem: kind }, features: ['medium.access'] })),

  ...(['tp', 'fiber', 'wireless', 'serial', 'coax', 'dsl', 'cellular'] as Medium[]).map(
    (medium): MediumItem => ({ id: `medium-${medium}`, category: 'links', kind: 'medium', medium, features: mediumFeature(medium) ? [mediumFeature(medium)!] : [] }),
  ),

  ...(['1G-SX', '1G-LX', '10G-SR', '10G-LR'] as SfpModule[]).map((module): SfpItem => ({ id: `sfp-${module}`, category: 'modules', kind: 'sfp', module, features: ['medium.fiber'] })),

  ...AREA_PRESETS.map(
    (preset): AreaItem => ({
      id: `area-${preset.key}`,
      category: 'areas',
      kind: 'area',
      preset,
      features: preset.key === 'rack' ? ['tool.racks'] : preset.key === 'vlan' ? ['tool.areas', 'net.vlan'] : ['tool.areas'],
    }),
  ),
];

/** Richtpreis in CHF (ohne eingesteckte Module). */
export function priceOf(item: ShopItem): number {
  if (item.kind === 'medium') return PRICES.cable[item.medium];
  if (item.kind === 'sfp') return PRICES.sfp[item.module];
  if (item.kind === 'area') return item.preset.key === 'rack' ? PRICES.rack : 0;
  const o = item.options ?? {};
  const ports = o.ports ?? (item.type === 'switch' || item.type === 'l3switch' ? 8 : item.type === 'router' ? 2 : 1);
  const interfaces: NetInterface[] = [
    ...Array.from({ length: ports }, (_, i) => ({ index: i, mac: '' })),
    ...Array.from({ length: o.serialPorts ?? 0 }, (_, i) => ({ index: ports + i, mac: '', serial: true })),
    ...Array.from({ length: o.sfpSlots ?? (item.type === 'switch' ? 2 : item.type === 'l3switch' ? 4 : item.type === 'router' ? 1 : 0) }, (_, i) => ({ index: 100 + i, mac: '', sfpSlot: true })),
  ];
  return devicePrice({
    type: item.type,
    interfaces,
    ...(o.variant ? { variant: o.variant } : {}),
    ...(o.groupSize ? { groupSize: o.groupSize } : {}),
    ...(o.modem ? { modem: { kind: o.modem } } : {}),
  });
}

export function itemsOf(category: ShopCategory, has: (feature: string) => boolean): ShopItem[] {
  return SHOP.filter((item) => item.category === category && item.features.every(has));
}

export function itemLabel(item: ShopItem): string {
  return t(`shop.${item.id}`);
}

export function itemHint(item: ShopItem): string {
  return t(`shop.${item.id}.hint`);
}
