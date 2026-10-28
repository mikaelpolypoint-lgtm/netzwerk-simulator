import { BROADCAST_MAC, type EthernetFrame } from './frames';
import type { NodeContext, SimNode } from './simulation';

/** Lebensdauer eines gelernten Eintrags (5 Minuten virtuelle Zeit). */
export const MAC_TTL = 300_000;

export interface MacEntry {
  mac: string;
  port: number;
  expires: number;
}

/**
 * Lernender Switch: merkt sich, an welchem Port welche Absender-MAC hängt.
 * Bekannte Ziele erhalten den Rahmen gezielt, Broadcasts und unbekannte
 * Ziele gehen an alle anderen Ports ("Flooding").
 */
export class SwitchNode implements SimNode {
  #table = new Map<string, MacEntry>();

  constructor(private readonly ctx: NodeContext) {}

  receive(inPort: number, frame: EthernetFrame) {
    const device = this.ctx.device();
    if (!device) return;
    const now = this.ctx.now;
    this.#table.set(frame.src, { mac: frame.src, port: inPort, expires: now + MAC_TTL });

    const known = frame.dst === BROADCAST_MAC ? undefined : this.#table.get(frame.dst);
    if (known && known.expires > now && this.ctx.isConnected(known.port)) {
      // Ziel hängt am selben Port wie der Absender: Der Rahmen hat sein Ziel schon erreicht.
      if (known.port !== inPort) this.ctx.transmit(known.port, frame);
      return;
    }
    for (const port of device.interfaces) {
      if (port.index !== inPort) this.ctx.transmit(port.index, frame);
    }
  }

  state() {
    const now = this.ctx.now;
    const macTable = [...this.#table.values()]
      .filter((e) => e.expires > now && this.ctx.isConnected(e.port))
      .sort((a, b) => a.port - b.port || a.mac.localeCompare(b.mac));
    return { macTable };
  }
}

/** Modem als reine Transportstrecke: Was an einem Anschluss ankommt, geht am anderen hinaus. */
export class ModemNode implements SimNode {
  constructor(private readonly ctx: NodeContext) {}

  receive(inPort: number, frame: EthernetFrame) {
    const device = this.ctx.device();
    for (const port of device?.interfaces ?? []) {
      if (port.index !== inPort) this.ctx.transmit(port.index, frame);
    }
  }

  state() {
    return {};
  }
}
