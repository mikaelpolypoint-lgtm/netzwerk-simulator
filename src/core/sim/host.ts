import { deviceSeq } from '../model/topology';
import type { Device } from '../model/types';
import { formatIp, parseIp } from '../net/ipv4';
import { lookupRoute } from '../net/routing';
import { PingRun, TracerouteRun, type IcmpApp } from './apps';
import { DhcpClient, DhcpServer, type LeaseRecord } from './dhcp';
import { DnsResolver, DnsServer, type DnsCacheEntry } from './dns';
import { DHCP_CLIENT_PORT, DHCP_SERVER_PORT, DNS_PORT, type Ipv4Packet, type TcpSegment, type UdpDatagram } from './frames';
import { HttpClient, HttpServer, type BrowserState } from './http';
import { IpNode, type ArpEntry } from './ip';
import type { NodeContext } from './simulation';
import { TcpStack, type TcpState } from './tcp';

/** Wirksame Adresskonfiguration, wie sie "ipconfig" zeigt. */
export interface AddressState {
  mode: 'static' | 'dhcp';
  ip?: string;
  mask?: string;
  gateway?: string;
  dns?: string;
  /** Nur bei DHCP. */
  server?: string;
  expires?: number;
  dhcpState?: string;
}

export interface ConnectionInfo {
  local: string;
  remote: string;
  state: TcpState;
}

export interface HostState {
  arp: ArpEntry[];
  address: AddressState;
  dhcpLeases?: LeaseRecord[];
  dnsCache: DnsCacheEntry[];
  connections: ConnectionInfo[];
  browser?: BrowserState;
}

type Command = 'ping' | 'tracert';

/** Endgerät: IP-Stack plus Anwendungen und Dienste. */
export class HostNode extends IpNode {
  readonly dhcpClient: DhcpClient;
  readonly dhcpServer: DhcpServer;
  readonly resolver: DnsResolver;
  readonly dnsService: DnsServer;
  readonly tcp: TcpStack;
  readonly browser: HttpClient;
  #ping: IcmpApp | null = null;
  #trace: IcmpApp | null = null;
  #icmpId = 0;

  constructor(ctx: NodeContext) {
    super(ctx);
    const seq = deviceSeq(ctx.device()?.id ?? 'd0');
    this.dhcpClient = new DhcpClient(this, seq);
    this.dhcpServer = new DhcpServer(this);
    this.resolver = new DnsResolver(this);
    this.dnsService = new DnsServer(this);
    this.tcp = new TcpStack(this, seq);
    this.browser = new HttpClient(this);
    new HttpServer(this);
  }

  /** Im DHCP-Modus gelten Adresse, Gateway und DNS aus der Lease (oder gar keine). */
  protected override effectiveDevice(): Device | undefined {
    const device = this.ctx.device();
    if (!device?.dhcp) return device;
    const { gateway: _g, dns: _d, ...rest } = device;
    const [first, ...others] = device.interfaces;
    if (!first) return device;
    const lease = this.dhcpClient.lease;
    const base = { index: first.index, mac: first.mac };
    if (!lease) return { ...rest, interfaces: [base, ...others] };
    return {
      ...rest,
      interfaces: [{ ...base, ip: lease.ip, mask: lease.mask }, ...others],
      ...(lease.gateway ? { gateway: lease.gateway } : {}),
      ...(lease.dns ? { dns: lease.dns } : {}),
    };
  }

  dnsServer(): string | undefined {
    return this.effectiveDevice()?.dns;
  }

  protected override onIcmp(packet: Ipv4Packet) {
    this.#ping?.onIcmp(packet);
    this.#trace?.onIcmp(packet);
  }

  protected override onUdp(packet: Ipv4Packet, datagram: UdpDatagram, index: number, srcMac: string) {
    const msg = datagram.payload;
    if (msg.kind === 'dns') {
      if (datagram.dstPort === DNS_PORT) this.dnsService.onQuery(packet, datagram);
      else if (datagram.srcPort === DNS_PORT) this.resolver.onResponse(msg);
      return;
    }
    if (datagram.dstPort === DHCP_CLIENT_PORT) {
      this.dhcpClient.onMessage(msg);
      // Den Server kennen wir aus seinem Ack; Erneuern und Freigeben brauchen so kein ARP.
      if (msg.op === 'ack' && msg.serverIp && this.dhcpClient.lease) this.learnNeighbor(msg.serverIp, srcMac, index);
    } else if (datagram.dstPort === DHCP_SERVER_PORT) {
      this.dhcpServer.onMessage(packet, msg);
    }
  }

  protected override onTcp(packet: Ipv4Packet, segment: TcpSegment) {
    this.tcp.receive(packet.src, packet.dst, segment);
  }

  /** Beim Start der Simulation: DHCP-Clients beziehen ihre Adresse. */
  ensureDhcp() {
    if (this.ctx.device()?.dhcp && this.dhcpClient.state === 'idle' && !this.dhcpClient.lease) this.dhcpClient.start();
  }

  renewDhcp() {
    if (!this.ctx.device()?.dhcp) return this.ctx.print('dhcp.static');
    this.dhcpClient.renew();
  }

  releaseDhcp() {
    if (!this.ctx.device()?.dhcp) return this.ctx.print('dhcp.static');
    this.dhcpClient.release();
  }

  /** Prüft vor Ping/Traceroute, was ohne Netzverkehr feststellbar ist; meldet das Problem und liefert false. */
  #reachable(target: number): boolean {
    if (this.isOwn(target)) return true;
    const iface = this.interfaces()[0];
    if (!iface) {
      this.ctx.print(this.ctx.device()?.dhcp ? 'ping.noLease' : 'ping.noAddress');
      return false;
    }
    if (!this.ctx.isConnected(iface.index)) {
      this.ctx.print('ping.noLink');
      return false;
    }
    if (!lookupRoute(this.routes(), target)) {
      this.ctx.print('ping.noRoute', { target: formatIp(target) });
      return false;
    }
    return true;
  }

  /** Ziel als IP oder Name; Namen werden zuerst per DNS aufgelöst. */
  #withTarget(text: string, command: Command, start: (ip: string, name?: string) => void) {
    const target = text.trim();
    const ip = parseIp(target);
    if (ip !== null) {
      if (this.#reachable(ip)) start(formatIp(ip));
      return;
    }
    if (/^[\d.]+$/.test(target)) return this.ctx.print('ping.invalidTarget', { target });
    this.resolver.resolve(target, 'A', (result) => {
      if (!result.ok) {
        const code = result.error === 'nxdomain' || result.error === 'invalidName' ? 'unknownHost' : `dns.${result.error}`;
        return this.ctx.print(`${command}.${code}`, { name: target, server: result.server });
      }
      const resolved = parseIp(result.records[0]!.value);
      if (resolved !== null && this.#reachable(resolved)) start(formatIp(resolved), target);
    });
  }

  ping(target: string) {
    this.#withTarget(target, 'ping', (ip, name) => {
      this.#ping?.cancel();
      const run = new PingRun(this, ip, ++this.#icmpId, this.effectiveDevice()?.gateway ?? '', name);
      this.#ping = run;
      run.start();
    });
  }

  traceroute(target: string) {
    this.#withTarget(target, 'tracert', (ip, name) => {
      this.#trace?.cancel();
      const run = new TracerouteRun(this, ip, ++this.#icmpId, name);
      this.#trace = run;
      run.start();
    });
  }

  browse(url: string) {
    this.browser.get(url);
  }

  address(): AddressState {
    const device = this.effectiveDevice();
    const iface = device?.interfaces[0];
    const lease = this.dhcpClient.lease;
    return {
      mode: this.ctx.device()?.dhcp ? 'dhcp' : 'static',
      ...(iface?.ip ? { ip: iface.ip } : {}),
      ...(iface?.mask ? { mask: iface.mask } : {}),
      ...(device?.gateway ? { gateway: device.gateway } : {}),
      ...(device?.dns ? { dns: device.dns } : {}),
      ...(this.ctx.device()?.dhcp
        ? { dhcpState: this.dhcpClient.state, ...(lease ? { server: lease.server, expires: lease.expires } : {}) }
        : {}),
    };
  }

  connections(): ConnectionInfo[] {
    return this.tcp.connections().map((c) => ({
      local: `${c.local.ip}:${c.local.port}`,
      remote: `${c.remote.ip}:${c.remote.port}`,
      state: c.state,
    }));
  }

  override state(): HostState {
    const browser = this.browser.state;
    return {
      arp: this.arpEntries(),
      address: this.address(),
      dnsCache: this.resolver.cacheEntries(),
      connections: this.connections(),
      ...(this.ctx.device()?.dhcpServer ? { dhcpLeases: this.dhcpServer.leases() } : {}),
      // Kopie, damit die Oberfläche eine unveränderliche Momentaufnahme erhält.
      ...(browser ? { browser: { ...browser, steps: [...browser.steps] } } : {}),
    };
  }
}
