// Hilfen für Tests: Netze knapp beschreiben und Paketfolgen lesbar vergleichen.
import {
  addDevice,
  addStaticRoute,
  configureHost,
  connect,
  emptyTopology,
  getDevice,
  setInterfaceAddress,
  setInterfaceCount,
  type Result,
} from '../model/topology';
import type { DeviceType, Topology } from '../model/types';
import type { PacketLogEntry } from './simulation';

export function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`Unerwarteter Fehler: ${r.error.code}`);
  return r.value;
}

export class NetBuilder {
  topology: Topology = emptyTopology();

  add(type: DeviceType, name: string): string {
    const { topology, id } = unwrap(addDevice(this.topology, type, name, { x: 0, y: 0 }));
    this.topology = topology;
    return id;
  }

  host(name: string, ip: string, mask = '24', gateway?: string): string {
    const id = this.add('pc', name);
    this.topology = unwrap(configureHost(this.topology, id, { ip, mask, gateway }));
    return id;
  }

  link(a: string, b: string): string {
    const { topology, id } = unwrap(connect(this.topology, a, b));
    this.topology = topology;
    return id;
  }

  /** Router mit Adressen in CIDR-Schreibweise, z.B. ["192.168.1.1/24", "192.168.2.1/24"]. */
  router(name: string, addresses: string[]): string {
    const id = this.add('router', name);
    if (addresses.length > 2) this.topology = unwrap(setInterfaceCount(this.topology, id, addresses.length));
    addresses.forEach((cidr, index) => {
      const [ip, prefix] = cidr.split('/');
      this.topology = unwrap(setInterfaceAddress(this.topology, id, index, ip!, prefix!));
    });
    return id;
  }

  route(router: string, network: string, mask: string, gateway: string) {
    this.topology = unwrap(addStaticRoute(this.topology, router, { network, mask, gateway }));
  }
}

/** Kurzform eines Logeintrags, z.B. "PC1→PC2 ARP request 10.0.0.2?". */
export function describe(topology: Topology, entry: PacketLogEntry): string {
  const name = (id: string) => getDevice(topology, id)?.name ?? id;
  const route = `${name(entry.from.device)}→${name(entry.to.device)}`;
  const p = entry.frame.payload;
  if (p.kind === 'arp') return `${route} ARP ${p.op} ${p.targetIp}`;
  return `${route} ICMP ${p.payload.type} ${p.src}>${p.dst}`;
}
