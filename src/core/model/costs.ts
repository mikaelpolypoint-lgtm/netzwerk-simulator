import { mediumOf } from './links';
import { copperPorts } from './topology';
import type { Device, Medium, ModemKind, SfpModule, Topology } from './types';

/**
 * Richtpreise in CHF (Schweizer Fachhandel 2026, gerundet, ohne Installation).
 * Sie dienen dem Lernspiel «wer baut am günstigsten?» und zeigen
 * Grössenordnungen – keine Offerte.
 */
export const PRICES = {
  notebook: 950,
  pc: 1100,
  server: 2800,
  serverRack: 4500,
  groupMember: 900,
  switchBase: 120,
  switchPort: 20,
  switchSfp: 25,
  l3Base: 900,
  l3Port: 50,
  l3Sfp: 40,
  routerBase: 300,
  routerEth: 60,
  routerSerial: 250,
  routerSfp: 50,
  accesspoint: 320,
  rack: 900,
  modem: { cable: 180, fiber: 120, mobile: 280, adsl: 60, vdsl: 110 } as Record<ModemKind, number>,
  legacyModem: 100,
  cable: { tp: 8, fiber: 25, wireless: 0, serial: 90, coax: 15, dsl: 5, cellular: 0 } as Record<Medium, number>,
  sfp: { '1G-SX': 35, '1G-LX': 60, '10G-SR': 80, '10G-LR': 150 } as Record<SfpModule, number>,
} as const;

export type Currency = 'CHF' | 'EUR' | 'USD';
/** Ungefähre Umrechnung von CHF (Stand 2026, fest, damit Vergleiche stabil bleiben). */
export const CURRENCY_RATES: Record<Currency, number> = { CHF: 1, EUR: 1.05, USD: 1.2 };

export function convert(chf: number, currency: Currency): number {
  return Math.round(chf * CURRENCY_RATES[currency]);
}

/** Preis eines Geräts ohne eingesteckte Module. */
export function devicePrice(device: Pick<Device, 'type' | 'interfaces' | 'variant' | 'groupSize' | 'modem'>): number {
  const slots = device.interfaces.filter((i) => i.sfpSlot).length;
  const serial = device.interfaces.filter((i) => i.serial).length;
  const copper = copperPorts(device as Device).length - serial;
  switch (device.type) {
    case 'notebook':
      return PRICES.notebook;
    case 'pc':
      return PRICES.pc;
    case 'server':
      return device.variant === 'rack' ? PRICES.serverRack : PRICES.server;
    case 'clientgroup':
      return (device.groupSize ?? 0) * PRICES.groupMember;
    case 'switch':
      return PRICES.switchBase + copper * PRICES.switchPort + slots * PRICES.switchSfp;
    case 'l3switch':
      return PRICES.l3Base + copper * PRICES.l3Port + slots * PRICES.l3Sfp;
    case 'router':
      return PRICES.routerBase + copper * PRICES.routerEth + serial * PRICES.routerSerial + slots * PRICES.routerSfp;
    case 'accesspoint':
      return PRICES.accesspoint;
    case 'modem':
      return device.modem ? PRICES.modem[device.modem.kind] : PRICES.legacyModem;
    case 'internet':
      return 0;
  }
}

export interface CostLine {
  /** Art der Position: Gerätetyp, «cable:<medium>», «sfp:<modul>» oder «rack». */
  key: string;
  count: number;
  /** Summe in CHF. */
  total: number;
}

export interface CostSummary {
  total: number;
  lines: CostLine[];
}

/** Gesamtkosten der Topologie in CHF, gruppiert nach Positionen. */
export function costOf(t: Topology): CostSummary {
  const lines = new Map<string, CostLine>();
  const add = (key: string, price: number, count = 1) => {
    if (price === 0) return;
    const line = lines.get(key) ?? { key, count: 0, total: 0 };
    line.count += count;
    line.total += price;
    lines.set(key, line);
  };
  for (const d of t.devices) {
    add(d.type === 'clientgroup' ? 'clientgroup' : d.type, devicePrice(d), d.type === 'clientgroup' ? (d.groupSize ?? 0) : 1);
    for (const i of d.interfaces) if (i.sfp) add(`sfp:${i.sfp}`, PRICES.sfp[i.sfp]);
  }
  for (const c of t.cables) add(`cable:${mediumOf(c)}`, PRICES.cable[mediumOf(c)]);
  for (const a of t.areas ?? []) if (a.kind === 'rack') add('rack', PRICES.rack);
  const list = [...lines.values()].sort((a, b) => b.total - a.total);
  return { total: list.reduce((sum, l) => sum + l.total, 0), lines: list };
}
