import { formatIp, maskToText, networkOf, parseIp, parseMask } from '../net/ipv4';
import { inNetworks } from '../net/dynamic';
import { ADMIN_DISTANCE, type Route } from '../net/routing';
import { RIP_MULTICAST, RIP_PORT, type Ipv4Packet, type RipMessage, type UdpDatagram } from './frames';
import type { RoutingHost } from './routing-host';

// Verkürzte Zeiten (Standard: Update 30 s, Timeout 180 s).
export const RIP_UPDATE = 5000;
export const RIP_TIMEOUT = 30_000;
export const RIP_INFINITY = 16;

interface Learned {
  network: number;
  prefix: number;
  via: number;
  iface: number;
  metric: number;
  expires: number;
}

/**
 * RIP Version 2 (RFC 2453): Distanzvektor mit Hop-Anzahl. Jeder Router schickt
 * regelmässig seine Tabelle an 224.0.0.9; Nachbarn übernehmen bessere Wege.
 * Split Horizon: Routen nicht dorthin zurückmelden, woher sie kamen.
 * Unerreichbar ist ab 16 Hops.
 */
export class Rip {
  #learned = new Map<string, Learned>();
  #running = false;
  #triggered = false;

  constructor(private readonly host: RoutingHost) {}

  get #config() {
    return this.host.device()?.rip;
  }

  #participating() {
    const config = this.#config;
    if (!config) return [];
    return this.host.interfaces().filter((i) => inNetworks(i.ip, config.networks));
  }

  routes(): Route[] {
    if (!this.#config) return [];
    const now = this.host.ctx.now;
    return [...this.#learned.values()]
      .filter((r) => r.expires > now && r.metric < RIP_INFINITY)
      .map((r) => ({ network: r.network, prefix: r.prefix, iface: r.iface, via: r.via, kind: 'rip' as const, metric: r.metric, distance: ADMIN_DISTANCE.rip }));
  }

  boot() {
    if (!this.#config) {
      if (this.#learned.size) {
        this.#learned.clear();
        this.host.routesChanged();
      }
      this.#running = false;
      return;
    }
    if (this.#running) return;
    this.#running = true;
    // Beim Start nach den Tabellen der Nachbarn fragen.
    for (const iface of this.#sendingInterfaces()) {
      this.host.sendMulticast(iface.index, RIP_MULTICAST, this.#datagram({ kind: 'rip', command: 'request', entries: [] }));
    }
    const tick = () => {
      if (!this.#config) {
        this.#running = false;
        this.boot();
        return;
      }
      this.#expire();
      this.#sendUpdates();
      this.host.ctx.schedule(RIP_UPDATE, tick);
    };
    this.host.ctx.schedule(1, tick);
  }

  #sendingInterfaces() {
    const passive = new Set(this.#config?.passive ?? []);
    return this.#participating().filter((i) => !passive.has(i.index) && this.host.ifaceUp(i.index));
  }

  #datagram(message: RipMessage): UdpDatagram {
    return { kind: 'udp', srcPort: RIP_PORT, dstPort: RIP_PORT, payload: message };
  }

  #expire() {
    const now = this.host.ctx.now;
    let changed = false;
    for (const [key, r] of this.#learned) {
      if (r.expires <= now) {
        this.#learned.delete(key);
        changed = true;
      }
    }
    if (changed) this.host.routesChanged();
  }

  /** Was dieser Router auf einem Interface ankündigt (mit Split Horizon). */
  #entries(outIface: number): RipMessage['entries'] {
    const config = this.#config;
    if (!config) return [];
    const result = new Map<string, RipMessage['entries'][number]>();
    const add = (network: number, prefix: number, metric: number) => {
      const key = `${network}/${prefix}`;
      const existing = result.get(key);
      if (existing && existing.metric <= metric) return;
      result.set(key, { network: formatIp(network), mask: maskToText(prefix), nextHop: '0.0.0.0', metric: Math.min(RIP_INFINITY, metric) });
    };
    for (const i of this.#participating()) add(networkOf(i.ip, i.prefix), i.prefix, 1);
    const now = this.host.ctx.now;
    for (const r of this.#learned.values()) {
      if (r.iface === outIface || r.expires <= now) continue;
      add(r.network, r.prefix, r.metric + 1);
    }
    if (config.defaultOriginate) add(0, 0, 1);
    const sources = new Set(config.redistribute ?? []);
    if (sources.size) {
      for (const r of this.host.routesExcept('rip')) {
        const source = r.kind === 'default' ? 'static' : r.kind;
        if (sources.has(source as never) && r.iface !== outIface) add(r.network, r.prefix, 1);
      }
    }
    return [...result.values()];
  }

  #sendUpdates() {
    for (const iface of this.#sendingInterfaces()) {
      const entries = this.#entries(iface.index);
      if (entries.length) this.host.sendMulticast(iface.index, RIP_MULTICAST, this.#datagram({ kind: 'rip', command: 'response', entries }));
    }
  }

  #triggerUpdate() {
    if (this.#triggered) return;
    this.#triggered = true;
    this.host.ctx.schedule(1, () => {
      this.#triggered = false;
      this.#sendUpdates();
    });
  }

  receive(packet: Ipv4Packet, message: RipMessage, index: number) {
    const iface = this.#participating().find((i) => i.index === index);
    if (!iface) return;
    if (message.command === 'request') {
      const entries = this.#entries(index);
      if (entries.length) this.host.sendIp(packet.src, this.#datagram({ kind: 'rip', command: 'response', entries }), { src: formatIp(iface.ip), ttl: 1 });
      return;
    }
    const via = parseIp(packet.src);
    if (via === null) return;
    const own = new Set(this.host.interfaces().map((i) => `${networkOf(i.ip, i.prefix)}/${i.prefix}`));
    const now = this.host.ctx.now;
    let changed = false;
    for (const entry of message.entries) {
      const network = parseIp(entry.network);
      const prefix = parseMask(entry.mask);
      if (network === null || prefix === null) continue;
      const key = `${network}/${prefix}`;
      if (own.has(key)) continue;
      const metric = Math.min(RIP_INFINITY, entry.metric);
      const current = this.#learned.get(key);
      const fromSame = current && current.via === via;
      if (metric >= RIP_INFINITY) {
        if (fromSame) {
          this.#learned.delete(key);
          changed = true;
        }
        continue;
      }
      if (!current || current.expires <= now || metric < current.metric || fromSame) {
        if (!current || current.metric !== metric || current.via !== via) changed = true;
        this.#learned.set(key, { network, prefix, via, iface: index, metric, expires: now + RIP_TIMEOUT });
      }
    }
    if (changed) {
      this.host.routesChanged();
      this.#triggerUpdate();
    }
  }

  state() {
    return { routes: this.routes().length };
  }
}
