import { deviceSeq } from '../model/topology';
import type { Device } from '../model/types';
import { formatIp, parseIp } from '../net/ipv4';
import { lookupRoute } from '../net/routing';
import { PingRun, TracerouteRun, type IcmpApp } from './apps';
import { DhcpClient, DhcpServer, type LeaseRecord } from './dhcp';
import { DHCP_CLIENT_PORT, DHCP_SERVER_PORT, type Ipv4Packet, type UdpDatagram } from './frames';
import { IpNode, type ArpEntry } from './ip';
import type { NodeContext } from './simulation';

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

export interface HostState {
  arp: ArpEntry[];
  address: AddressState;
  dhcpLeases?: LeaseRecord[];
}

/** Endgerät: IP-Stack plus Anwendungen (Ping, Traceroute, DHCP-Client und -Server). */
export class HostNode extends IpNode {
  readonly dhcpClient: DhcpClient;
  readonly dhcpServer: DhcpServer;
  #ping: IcmpApp | null = null;
  #trace: IcmpApp | null = null;
  #icmpId = 0;

  constructor(ctx: NodeContext) {
    super(ctx);
    this.dhcpClient = new DhcpClient(this, deviceSeq(ctx.device()?.id ?? 'd0'));
    this.dhcpServer = new DhcpServer(this);
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

  protected override onIcmp(packet: Ipv4Packet) {
    this.#ping?.onIcmp(packet);
    this.#trace?.onIcmp(packet);
  }

  protected override onUdp(packet: Ipv4Packet, datagram: UdpDatagram, index: number, srcMac: string) {
    if (datagram.payload.kind !== 'dhcp') return;
    if (datagram.dstPort === DHCP_CLIENT_PORT) {
      const msg = datagram.payload;
      this.dhcpClient.onMessage(msg);
      // Den Server kennen wir aus seinem Ack; Erneuern und Freigeben brauchen so kein ARP.
      if (msg.op === 'ack' && msg.serverIp && this.dhcpClient.lease) this.learnNeighbor(msg.serverIp, srcMac, index);
    } else if (datagram.dstPort === DHCP_SERVER_PORT) {
      this.dhcpServer.onMessage(packet, datagram.payload);
    }
  }

  /** Beim Start der Simulation: DHCP-Clients beziehen ihre Adresse. */
  ensureDhcp() {
    if (this.ctx.device()?.dhcp && this.dhcpClient.state === 'idle' && !this.dhcpClient.lease) this.dhcpClient.start();
  }

  renewDhcp() {
    if (!this.ctx.device()?.dhcp) {
      this.ctx.print('dhcp.static');
      return;
    }
    this.dhcpClient.renew();
  }

  releaseDhcp() {
    if (!this.ctx.device()?.dhcp) {
      this.ctx.print('dhcp.static');
      return;
    }
    this.dhcpClient.release();
  }

  /** Prüft vor Ping/Traceroute, was ohne Netzverkehr feststellbar ist; meldet das Problem und liefert null. */
  #prepare(targetText: string): string | null {
    const target = parseIp(targetText.trim());
    if (target === null) {
      this.ctx.print('ping.invalidTarget', { target: targetText.trim() });
      return null;
    }
    if (this.isOwn(target)) return formatIp(target);
    const iface = this.interfaces()[0];
    if (!iface) {
      this.ctx.print(this.ctx.device()?.dhcp ? 'ping.noLease' : 'ping.noAddress');
      return null;
    }
    if (!this.ctx.isConnected(iface.index)) {
      this.ctx.print('ping.noLink');
      return null;
    }
    if (!lookupRoute(this.routes(), target)) {
      this.ctx.print('ping.noRoute', { target: formatIp(target) });
      return null;
    }
    return formatIp(target);
  }

  ping(targetText: string) {
    const target = this.#prepare(targetText);
    if (!target) return;
    this.#ping?.cancel();
    const run = new PingRun(this, target, ++this.#icmpId, this.effectiveDevice()?.gateway ?? '');
    this.#ping = run;
    run.start();
  }

  traceroute(targetText: string) {
    const target = this.#prepare(targetText);
    if (!target) return;
    this.#trace?.cancel();
    const run = new TracerouteRun(this, target, ++this.#icmpId);
    this.#trace = run;
    run.start();
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

  override state(): HostState {
    return {
      arp: this.arpEntries(),
      address: this.address(),
      ...(this.ctx.device()?.dhcpServer ? { dhcpLeases: this.dhcpServer.leases() } : {}),
    };
  }
}
