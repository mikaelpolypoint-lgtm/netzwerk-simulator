// Hilfen für Tests: Netze knapp beschreiben und Paketfolgen lesbar vergleichen.
import {
  addPortForward,
  setInterfaceNat,
  addDhcpScope,
  setInterfaceRelay,
  addDevice,
  addDnsRecord,
  addStaticRoute,
  addMailbox,
  saveWebFile,
  setDnsServerEnabled,
  setMailAccount,
  setMailServerEnabled,
  setWebServerEnabled,
  configureHost,
  connect,
  emptyTopology,
  getDevice,
  setDhcpServer,
  setInterfaceAddress,
  setInterfaceCount,
  setPortSerial,
  setEncapsulation,
  type Result,
} from '../model/topology';
import type { DeviceType, DhcpScope, DhcpServerConfig, Medium, Topology } from '../model/types';
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

  link(a: string, b: string, medium: Medium = 'tp'): string {
    const { topology, id } = unwrap(connect(this.topology, a, b, medium));
    this.topology = topology;
    return id;
  }

  /** Beliebige Topologie-Operation anwenden, z.B. `net.apply((t) => setOspf(t, r1, …))`. */
  apply(change: (t: Topology) => Result<Topology>) {
    this.topology = unwrap(change(this.topology));
  }

  /** Router-Anschluss auf seriell umstellen (vor dem Verkabeln). */
  serial(router: string, index: number, encapsulation: 'hdlc' | 'ppp' = 'hdlc') {
    this.topology = unwrap(setPortSerial(this.topology, router, index, true));
    if (encapsulation === 'ppp') this.topology = unwrap(setEncapsulation(this.topology, router, index, 'ppp'));
  }

  /** Internet-Gerät mit Adressen in CIDR-Schreibweise. */
  internet(name: string, addresses: string[]): string {
    return this.router(name, addresses, 'internet');
  }

  /** Router mit Adressen in CIDR-Schreibweise, z.B. ["192.168.1.1/24", "192.168.2.1/24"]. */
  router(name: string, addresses: string[], type: 'router' | 'internet' = 'router'): string {
    const id = this.add(type, name);
    if (addresses.length > 2) this.topology = unwrap(setInterfaceCount(this.topology, id, addresses.length));
    addresses.forEach((cidr, index) => {
      const [ip, prefix] = cidr.split('/');
      this.topology = unwrap(setInterfaceAddress(this.topology, id, index, ip!, prefix!));
    });
    return id;
  }

  nat(router: string, index: number) {
    this.topology = unwrap(setInterfaceNat(this.topology, router, index, true));
  }

  portForward(router: string, port: number, to: string, toPort = port) {
    this.topology = unwrap(addPortForward(this.topology, router, { protocol: 'tcp', port, to, toPort }));
  }

  relay(router: string, index: number, server: string) {
    this.topology = unwrap(setInterfaceRelay(this.topology, router, index, server));
  }

  scope(server: string, scope: DhcpScope) {
    this.topology = unwrap(addDhcpScope(this.topology, server, scope));
  }

  route(router: string, network: string, mask: string, gateway: string) {
    this.topology = unwrap(addStaticRoute(this.topology, router, { network, mask, gateway }));
  }

  dhcpClient(name: string, type: DeviceType = 'notebook'): string {
    const id = this.add(type, name);
    this.topology = unwrap(configureHost(this.topology, id, { ip: '', mask: '', dhcp: true }));
    return id;
  }

  dhcpServer(id: string, config: DhcpServerConfig) {
    this.topology = unwrap(setDhcpServer(this.topology, id, config));
  }

  dnsServer(id: string, records: [name: string, ip: string, ttl?: number][]) {
    this.topology = unwrap(setDnsServerEnabled(this.topology, id, true));
    for (const [name, value, ttl = 60] of records) {
      this.topology = unwrap(addDnsRecord(this.topology, id, { name, type: 'A', value, ttl }));
    }
  }

  setDns(id: string, dns: string) {
    this.topology = {
      ...this.topology,
      devices: this.topology.devices.map((d) => (d.id === id ? { ...d, dns } : d)),
    };
  }

  dnsRecord(id: string, name: string, type: 'A' | 'MX', value: string) {
    if (!getDevice(this.topology, id)?.dnsServer) this.topology = unwrap(setDnsServerEnabled(this.topology, id, true));
    this.topology = unwrap(addDnsRecord(this.topology, id, { name, type, value, ttl: 60 }));
  }

  mailServer(id: string, domain: string, users: string[]) {
    this.topology = unwrap(setMailServerEnabled(this.topology, id, true, domain));
    for (const user of users) this.topology = unwrap(addMailbox(this.topology, id, { user, password: 'geheim' }));
  }

  mailAccount(id: string, address: string, server: string, protocol: 'pop3' | 'imap' = 'pop3', password = 'geheim') {
    this.topology = unwrap(setMailAccount(this.topology, id, { address, password, smtpServer: server, incomingServer: server, protocol }));
  }

  webServer(id: string, files: Record<string, string>) {
    this.topology = unwrap(setWebServerEnabled(this.topology, id, true));
    for (const [path, content] of Object.entries(files)) this.topology = unwrap(saveWebFile(this.topology, id, { path, content }));
  }
}

/** Kurzform eines Logeintrags, z.B. "PC1→PC2 ARP request 10.0.0.2?". */
export function describe(topology: Topology, entry: PacketLogEntry): string {
  const name = (id: string) => getDevice(topology, id)?.name ?? id;
  const route = `${name(entry.from.device)}→${name(entry.to.device)}`;
  const p = entry.frame.payload;
  const tag = entry.frame.vlan !== undefined ? ` [VLAN ${entry.frame.vlan}]` : '';
  if (p.kind === 'arp') return `${route}${tag} ARP ${p.op} ${p.targetIp}`;
  if (p.kind === 'stp') return `${route} STP root=${p.rootId} cost=${p.cost}`;
  if (p.kind === 'ppp') return `${route} PPP ${p.protocol.toUpperCase()} ${p.code}`;
  if (p.kind === 'link') return `${route} ${p.tech.toUpperCase()} ${p.message}`;
  const inner = p.payload;
  if (inner.kind === 'ospf') return `${route} OSPF ${inner.type} ${inner.routerId}`;
  if (inner.kind === 'tcp') {
    const data = inner.data ? ` "${inner.data.split('\r\n')[0]}"` : '';
    return `${route} TCP ${inner.srcPort}>${inner.dstPort} [${inner.flags.join(',')}] seq=${inner.seq} ack=${inner.ack}${data}`;
  }
  if (inner.kind === 'udp') {
    const msg = inner.payload;
    if (msg.kind === 'dns') {
      const answer = msg.response ? ` → ${msg.rcode === 'ok' ? msg.answers.map((a) => a.value).join(',') : msg.rcode}` : '';
      return `${route} DNS ${msg.response ? 'response' : 'query'} ${msg.question.name}${answer}`;
    }
    if (msg.kind === 'rip') return `${route} RIP ${msg.command} ${msg.entries.map((e) => `${e.network}/${e.metric}`).join(',')}`;
    return `${route} DHCP ${msg.op} ${p.src}>${p.dst}`;
  }
  return `${route} ICMP ${inner.type} ${p.src}>${p.dst}`;
}
