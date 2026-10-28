import { formatIp, maskToText, networkOf, parseIp } from '../net/ipv4';
import type { IfaceAddress } from '../net/routing';
import { DHCP_CLIENT_PORT, DHCP_SERVER_PORT, type DhcpMessage, type DhcpOp, type Ipv4Packet, type UdpDatagram } from './frames';
import type { SendOptions } from './ip';
import type { NodeContext } from './simulation';

export const DISCOVER_TIMEOUT = 2000;
export const DISCOVER_ATTEMPTS = 3;
export const REQUEST_TIMEOUT = 2000;
/** So lange hält der Server eine angebotene Adresse für den Client frei. */
export const OFFER_HOLD = 10_000;

export interface Lease {
  ip: string;
  mask: string;
  gateway?: string;
  dns?: string;
  server: string;
  expires: number;
}

export interface LeaseRecord {
  mac: string;
  ip: string;
  expires: number;
}

/** Was DHCP-Client und -Server vom Endgerät brauchen. */
export interface DhcpHost {
  readonly ctx: NodeContext;
  interfaces(): IfaceAddress[];
  sendIp(dst: string, payload: UdpDatagram, options?: SendOptions): void;
  sendUnconfiguredBroadcast(index: number, payload: UdpDatagram): void;
}

const datagram = (srcPort: number, dstPort: number, payload: DhcpMessage): UdpDatagram => ({
  kind: 'udp',
  srcPort,
  dstPort,
  payload,
});

/**
 * DHCP-Client: Discover → Offer → Request → Ack ("DORA"), danach Erneuerung
 * nach der halben Lease-Dauer direkt beim Server.
 */
export class DhcpClient {
  lease: Lease | null = null;
  #state: 'idle' | 'selecting' | 'requesting' | 'bound' | 'renewing' = 'idle';
  #xid = 0;
  #transactions = 0;
  #attempt = 0;
  /** Steigt bei jedem Neustart; ältere Timer erkennen daran, dass sie nicht mehr gelten. */
  #round = 0;

  constructor(
    private readonly host: DhcpHost,
    private readonly seq: number,
  ) {}

  get state() {
    return this.#state;
  }

  get #ctx() {
    return this.host.ctx;
  }

  get #mac(): string {
    return this.#ctx.device()?.interfaces[0]?.mac ?? '';
  }

  /** Transaktionsnummern sind deterministisch, damit Abläufe wiederholbar bleiben. */
  #nextXid() {
    this.#xid = this.seq * 1000 + ++this.#transactions;
    return this.#xid;
  }

  start() {
    this.lease = null;
    this.#round++;
    this.#attempt = 0;
    this.#ctx.print('dhcp.discover');
    this.#discover();
  }

  #discover() {
    const round = this.#round;
    this.#state = 'selecting';
    this.#attempt++;
    const xid = this.#nextXid();
    this.host.sendUnconfiguredBroadcast(
      0,
      datagram(DHCP_CLIENT_PORT, DHCP_SERVER_PORT, { kind: 'dhcp', op: 'discover', xid, clientMac: this.#mac }),
    );
    this.#ctx.schedule(DISCOVER_TIMEOUT, () => {
      if (round !== this.#round || this.#state !== 'selecting' || xid !== this.#xid) return;
      if (this.#attempt < DISCOVER_ATTEMPTS) return this.#discover();
      this.#state = 'idle';
      this.#ctx.print('dhcp.noServer');
    });
  }

  onMessage(msg: DhcpMessage) {
    if (msg.clientMac !== this.#mac || msg.xid !== this.#xid) return;
    if (msg.op === 'offer' && this.#state === 'selecting' && msg.yourIp && msg.serverIp) {
      this.#request(msg.yourIp, msg.serverIp);
    } else if (msg.op === 'ack' && (this.#state === 'requesting' || this.#state === 'renewing')) {
      this.#bind(msg);
    } else if (msg.op === 'nak') {
      this.lease = null;
      this.#state = 'idle';
      this.#round++;
      this.#ctx.print('dhcp.nak', { server: msg.serverIp ?? '?' });
      this.#ctx.schedule(1000, () => this.start());
    }
  }

  #request(ip: string, server: string) {
    const round = this.#round;
    this.#state = 'requesting';
    const xid = this.#xid;
    this.host.sendUnconfiguredBroadcast(
      0,
      datagram(DHCP_CLIENT_PORT, DHCP_SERVER_PORT, {
        kind: 'dhcp',
        op: 'request',
        xid,
        clientMac: this.#mac,
        requestedIp: ip,
        serverIp: server,
      }),
    );
    this.#ctx.schedule(REQUEST_TIMEOUT, () => {
      if (round === this.#round && this.#state === 'requesting' && xid === this.#xid) this.#discover();
    });
  }

  #bind(msg: DhcpMessage) {
    const leaseTime = msg.leaseTime ?? 3600;
    this.lease = {
      ip: msg.yourIp ?? '',
      mask: msg.mask ?? '255.255.255.0',
      server: msg.serverIp ?? '',
      expires: this.#ctx.now + leaseTime * 1000,
      ...(msg.gateway ? { gateway: msg.gateway } : {}),
      ...(msg.dns ? { dns: msg.dns } : {}),
    };
    const renewing = this.#state === 'renewing';
    this.#state = 'bound';
    this.#round++;
    const round = this.#round;
    this.#ctx.print(renewing ? 'dhcp.renewed' : 'dhcp.bound', { ip: this.lease.ip, server: this.lease.server, lease: leaseTime });
    // Erneuern nach der halben Lease-Dauer (T1), spätestens bei Ablauf neu beginnen.
    this.#ctx.schedule((leaseTime * 1000) / 2, () => {
      if (round === this.#round && this.#state === 'bound') this.renew();
    });
    this.#ctx.schedule(leaseTime * 1000, () => {
      if (round !== this.#round || !this.lease || this.lease.expires > this.#ctx.now) return;
      this.#ctx.print('dhcp.expired', { ip: this.lease.ip });
      this.start();
    });
  }

  /** Erneuert die Lease direkt beim Server; ohne Lease beginnt die Vergabe von vorn. */
  renew() {
    const lease = this.lease;
    if (!lease || (this.#state !== 'bound' && this.#state !== 'renewing')) return this.start();
    this.#state = 'renewing';
    const xid = this.#nextXid();
    this.host.sendIp(
      lease.server,
      datagram(DHCP_CLIENT_PORT, DHCP_SERVER_PORT, {
        kind: 'dhcp',
        op: 'request',
        xid,
        clientMac: this.#mac,
        requestedIp: lease.ip,
        serverIp: lease.server,
      }),
      { src: lease.ip },
    );
    // Antwortet der Server nicht, gilt die bisherige Lease bis zu ihrem Ablauf weiter.
    this.#ctx.schedule(REQUEST_TIMEOUT, () => {
      if (this.#state === 'renewing' && xid === this.#xid) this.#state = 'bound';
    });
  }

  release() {
    const lease = this.lease;
    if (!lease) {
      this.#ctx.print('dhcp.noLease');
      return;
    }
    this.host.sendIp(
      lease.server,
      datagram(DHCP_CLIENT_PORT, DHCP_SERVER_PORT, {
        kind: 'dhcp',
        op: 'release',
        xid: this.#nextXid(),
        clientMac: this.#mac,
        serverIp: lease.server,
      }),
      { src: lease.ip },
    );
    this.#ctx.print('dhcp.released', { ip: lease.ip });
    this.lease = null;
    this.#state = 'idle';
    this.#round++;
  }
}

/** DHCP-Server-Dienst eines Rechners. Er vergibt nur Adressen aus seinem eigenen Netz (kein Relay). */
export class DhcpServer {
  #leases = new Map<string, LeaseRecord>();
  #offers = new Map<string, LeaseRecord>();

  constructor(private readonly host: DhcpHost) {}

  get #ctx() {
    return this.host.ctx;
  }

  leases(): LeaseRecord[] {
    const now = this.#ctx.now;
    return [...this.#leases.values()]
      .filter((l) => l.expires > now)
      .sort((a, b) => (parseIp(a.ip) ?? 0) - (parseIp(b.ip) ?? 0));
  }

  onMessage(packet: Ipv4Packet, msg: DhcpMessage) {
    const device = this.#ctx.device();
    const config = device?.dhcpServer;
    const own = this.host.interfaces()[0];
    if (!config || device.dhcp || !own) return;
    const start = parseIp(config.start);
    const end = parseIp(config.end);
    if (start === null || end === null || networkOf(start, own.prefix) !== networkOf(own.ip, own.prefix)) return;
    const ownIp = formatIp(own.ip);
    const mac = msg.clientMac;

    if (msg.op === 'discover') {
      const ip = this.#pick(mac, start, end, own.ip);
      if (ip === null) {
        this.#ctx.print('dhcpServer.exhausted', { mac });
        return;
      }
      this.#offers.set(mac, { mac, ip: formatIp(ip), expires: this.#ctx.now + OFFER_HOLD });
      this.#ctx.print('dhcpServer.offer', { ip: formatIp(ip), mac });
      this.#reply('offer', msg, formatIp(ip), '255.255.255.255');
    } else if (msg.op === 'request') {
      // Der Client hat sich für einen anderen Server entschieden.
      if (msg.serverIp && msg.serverIp !== ownIp) {
        this.#offers.delete(mac);
        return;
      }
      const requested = msg.requestedIp ?? packet.src;
      const value = parseIp(requested);
      const known = this.#offers.get(mac)?.ip === requested || this.#leases.get(mac)?.ip === requested;
      const valid = value !== null && value >= start && value <= end && known && !this.#takenByOther(requested, mac);
      const replyTo = packet.src === '0.0.0.0' ? '255.255.255.255' : packet.src;
      if (!valid) {
        this.#ctx.print('dhcpServer.nak', { ip: requested, mac });
        this.#reply('nak', msg, undefined, replyTo);
        return;
      }
      this.#offers.delete(mac);
      this.#leases.set(mac, { mac, ip: requested, expires: this.#ctx.now + config.leaseTime * 1000 });
      this.#ctx.print('dhcpServer.ack', { ip: requested, mac });
      this.#reply('ack', msg, requested, replyTo);
    } else if (msg.op === 'release') {
      const lease = this.#leases.get(mac);
      if (lease && lease.ip === packet.src) {
        this.#leases.delete(mac);
        this.#ctx.print('dhcpServer.release', { ip: lease.ip, mac });
      }
    }
  }

  #takenByOther(ip: string, mac: string): boolean {
    const now = this.#ctx.now;
    const busy = (map: Map<string, LeaseRecord>) => [...map.values()].some((r) => r.ip === ip && r.mac !== mac && r.expires > now);
    return busy(this.#leases) || busy(this.#offers);
  }

  /** Bisherige Adresse des Clients, sonst die kleinste freie im Bereich. */
  #pick(mac: string, start: number, end: number, ownIp: number): number | null {
    const now = this.#ctx.now;
    for (const previous of [this.#leases.get(mac), this.#offers.get(mac)]) {
      const ip = previous && previous.expires > now ? parseIp(previous.ip) : null;
      if (ip !== null && ip >= start && ip <= end) return ip;
    }
    for (let ip = start; ip <= end; ip++) {
      if (ip !== ownIp && !this.#takenByOther(formatIp(ip), mac)) return ip;
    }
    return null;
  }

  #reply(op: DhcpOp, request: DhcpMessage, yourIp: string | undefined, to: string) {
    const config = this.#ctx.device()?.dhcpServer;
    const own = this.host.interfaces()[0];
    if (!config || !own) return;
    const message: DhcpMessage = {
      kind: 'dhcp',
      op,
      xid: request.xid,
      clientMac: request.clientMac,
      serverIp: formatIp(own.ip),
      ...(op === 'nak'
        ? {}
        : {
            yourIp,
            mask: maskToText(own.prefix),
            leaseTime: config.leaseTime,
            ...(config.gateway ? { gateway: config.gateway } : {}),
            ...(config.dns ? { dns: config.dns } : {}),
          }),
    };
    this.host.sendIp(to, datagram(DHCP_SERVER_PORT, DHCP_CLIENT_PORT, message));
  }
}
