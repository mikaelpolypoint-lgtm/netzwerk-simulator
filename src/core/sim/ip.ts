import type { Device } from '../model/types';
import { LIMITED_BROADCAST, broadcastOf, formatIp, parseIp } from '../net/ipv4';
import { buildRoutes, interfaceAddresses, lookupRoute, type IfaceAddress, type Route } from '../net/routing';
import {
  BROADCAST_MAC,
  DHCP_CLIENT_PORT,
  DHCP_SERVER_PORT,
  ZERO_MAC,
  type ArpPacket,
  type EthernetFrame,
  type IcmpMessage,
  type Ipv4Packet,
  type TcpSegment,
  type UdpDatagram,
} from './frames';
import type { NodeContext, SimNode } from './simulation';

export const ARP_TIMEOUT = 1000;
export const ARP_ATTEMPTS = 2;
/** Lebensdauer eines ARP-Eintrags (5 Minuten virtuelle Zeit). */
export const ARP_TTL = 300_000;
export const DEFAULT_TTL = 64;

export interface ArpEntry {
  ip: string;
  mac: string;
  iface: number;
  expires: number;
}

interface Waiter {
  onMac: (mac: string) => void;
  onFail: () => void;
}

interface PendingResolution {
  iface: number;
  attempts: number;
  waiters: Waiter[];
}

/** Fehler, die schon beim Absender auffallen. */
export type SendError = 'noRoute' | 'hostUnreachable' | 'gatewayUnreachable';

export interface SendOptions {
  src?: string;
  ttl?: number;
}

const isLoopback = (ip: number) => ip >>> 24 === 127;
export const isIcmpError = (icmp: IcmpMessage) => icmp.type === 'destUnreachable' || icmp.type === 'timeExceeded';

/**
 * IPv4-Teilnehmer mit ARP und ICMP-Echo. Endgeräte (`HostNode`) ergänzen
 * Anwendungen, Vermittlungsrechner (`RouterNode`) die Weiterleitung.
 */
export class IpNode implements SimNode {
  protected readonly forwarding: boolean = false;
  #arp = new Map<string, ArpEntry>();
  #pending = new Map<string, PendingResolution>();
  #ipId = 0;

  constructor(readonly ctx: NodeContext) {}

  /** Gerät mit der tatsächlich wirksamen Konfiguration (Endgeräte: ggf. per DHCP bezogen). */
  protected effectiveDevice(): Device | undefined {
    return this.ctx.device();
  }

  interfaces(): IfaceAddress[] {
    const device = this.effectiveDevice();
    return device ? interfaceAddresses(device) : [];
  }

  routes(): Route[] {
    const device = this.effectiveDevice();
    return device ? buildRoutes(device).routes : [];
  }

  arpEntries(): ArpEntry[] {
    const now = this.ctx.now;
    return [...this.#arp.values()]
      .filter((e) => e.expires > now)
      .sort((a, b) => (parseIp(a.ip) ?? 0) - (parseIp(b.ip) ?? 0));
  }

  clearArp() {
    this.#arp.clear();
  }

  state(): object {
    return { arp: this.arpEntries() };
  }

  receive(index: number, frame: EthernetFrame) {
    const mac = this.ctx.device()?.interfaces[index]?.mac;
    if (!mac || (frame.dst !== mac && frame.dst !== BROADCAST_MAC)) return;
    if (frame.payload.kind === 'arp') this.#onArp(index, frame.payload);
    else this.#onIp(index, frame.payload, frame.src);
  }

  /** Nachbarn auch ohne ARP bekannt machen, z.B. den DHCP-Server aus seinem Ack. */
  learnNeighbor(ip: string, mac: string, iface: number) {
    this.#learn(ip, mac, iface);
  }

  // --- ARP -----------------------------------------------------------------

  #onArp(index: number, arp: ArpPacket) {
    const iface = this.interfaces().find((i) => i.index === index);
    if (!iface) return;
    const forMe = parseIp(arp.targetIp) === iface.ip;
    // Wie RFC 826: Absender lernen, wenn die Anfrage uns gilt oder er schon bekannt ist.
    if (forMe || this.#arp.has(arp.senderIp)) this.#learn(arp.senderIp, arp.senderMac, index);
    if (arp.op === 'request' && forMe) {
      this.ctx.transmit(index, {
        src: iface.mac,
        dst: arp.senderMac,
        payload: {
          kind: 'arp',
          op: 'reply',
          senderMac: iface.mac,
          senderIp: formatIp(iface.ip),
          targetMac: arp.senderMac,
          targetIp: arp.senderIp,
        },
      });
    }
  }

  #learn(ip: string, mac: string, iface: number) {
    this.#arp.set(ip, { ip, mac, iface, expires: this.ctx.now + ARP_TTL });
    const pending = this.#pending.get(ip);
    if (!pending) return;
    this.#pending.delete(ip);
    for (const waiter of pending.waiters) waiter.onMac(mac);
  }

  /** Liefert die MAC zu einer IP, nötigenfalls per ARP-Anfrage. */
  #resolve(index: number, ip: number, waiter: Waiter) {
    const key = formatIp(ip);
    const cached = this.#arp.get(key);
    if (cached && cached.expires > this.ctx.now) {
      waiter.onMac(cached.mac);
      return;
    }
    const pending = this.#pending.get(key);
    if (pending) {
      pending.waiters.push(waiter);
      return;
    }
    this.#pending.set(key, { iface: index, attempts: 1, waiters: [waiter] });
    this.#sendArpRequest(index, ip);
    const retry = () => {
      const current = this.#pending.get(key);
      if (!current) return;
      if (current.attempts >= ARP_ATTEMPTS) {
        this.#pending.delete(key);
        for (const w of current.waiters) w.onFail();
        return;
      }
      current.attempts++;
      this.#sendArpRequest(index, ip);
      this.ctx.schedule(ARP_TIMEOUT, retry);
    };
    this.ctx.schedule(ARP_TIMEOUT, retry);
  }

  #sendArpRequest(index: number, ip: number) {
    const iface = this.interfaces().find((i) => i.index === index);
    if (!iface) return;
    this.ctx.transmit(index, {
      src: iface.mac,
      dst: BROADCAST_MAC,
      payload: {
        kind: 'arp',
        op: 'request',
        senderMac: iface.mac,
        senderIp: formatIp(iface.ip),
        targetMac: ZERO_MAC,
        targetIp: formatIp(ip),
      },
    });
  }

  // --- IPv4 ----------------------------------------------------------------

  isOwn(ip: number): boolean {
    return isLoopback(ip) || this.interfaces().some((i) => i.ip === ip);
  }

  #onIp(index: number, packet: Ipv4Packet, srcMac: string) {
    const dst = parseIp(packet.dst);
    if (dst === null) return;
    const iface = this.interfaces().find((i) => i.index === index);
    const broadcast = dst === LIMITED_BROADCAST || (iface !== undefined && dst === broadcastOf(iface.ip, iface.prefix));
    if (this.isOwn(dst) || broadcast) this.#deliver(packet, broadcast, index, srcMac);
    else if (this.forwarding && iface) this.#forward(iface, packet);
  }

  /** Weiterleiten wie ein Router: TTL senken, Route wählen, bei Problemen ICMP an den Absender. */
  #forward(inIface: IfaceAddress, packet: Ipv4Packet) {
    if (packet.ttl <= 1) {
      this.#icmpError(inIface, packet, 'timeExceeded');
      return;
    }
    const dst = parseIp(packet.dst)!;
    const route = lookupRoute(this.routes(), dst);
    const out = route && this.interfaces().find((i) => i.index === route.iface);
    if (!route || !out) {
      this.#icmpError(inIface, packet, 'destUnreachable', 'net');
      return;
    }
    const forwarded: Ipv4Packet = { ...packet, ttl: packet.ttl - 1 };
    this.#resolve(out.index, route.via ?? dst, {
      onMac: (mac) => this.ctx.transmit(out.index, { src: out.mac, dst: mac, payload: forwarded }),
      onFail: () => this.#icmpError(inIface, packet, 'destUnreachable', 'host'),
    });
  }

  #icmpError(from: IfaceAddress, original: Ipv4Packet, type: 'destUnreachable' | 'timeExceeded', code?: 'net' | 'host') {
    const payload = original.payload;
    // Auf Fehlermeldungen antwortet man nie mit Fehlermeldungen (sonst Ping-Pong).
    if (payload.kind === 'icmp' && isIcmpError(payload)) return;
    const message: IcmpMessage = {
      kind: 'icmp',
      type,
      id: 0,
      seq: 0,
      size: 0,
      original: {
        src: original.src,
        dst: original.dst,
        id: payload.kind === 'icmp' ? payload.id : 0,
        seq: payload.kind === 'icmp' ? payload.seq : 0,
      },
      ...(code ? { code } : {}),
    };
    this.sendIp(original.src, message, { src: formatIp(from.ip) });
  }

  #deliver(packet: Ipv4Packet, broadcast: boolean, index: number, srcMac = '') {
    const payload = packet.payload;
    if (payload.kind === 'udp') {
      this.onUdp(packet, payload, index, srcMac);
    } else if (payload.kind === 'tcp') {
      this.onTcp(packet, payload);
    } else if (payload.type === 'echoRequest') {
      if (!broadcast) this.sendIp(packet.src, { ...payload, type: 'echoReply' }, { src: packet.dst });
    } else {
      this.onIcmp(packet);
    }
  }

  /** Anwendungen hängen sich hier ein (Ping, Traceroute). */
  protected onIcmp(_packet: Ipv4Packet) {}

  /** UDP-Dienste hängen sich hier ein (DHCP, DNS). */
  protected onUdp(_packet: Ipv4Packet, _datagram: UdpDatagram, _index: number, _srcMac: string) {}

  /** TCP-Segmente gehen an den TCP-Stack des Endgeräts. */
  protected onTcp(_packet: Ipv4Packet, _segment: TcpSegment) {}

  /** Eigene Adresse, über die `remote` erreicht wird (oder null). */
  localIpFor(remote: string): string | null {
    const dst = parseIp(remote);
    if (dst === null) return null;
    if (this.isOwn(dst)) return remote;
    const route = lookupRoute(this.routes(), dst);
    const iface = route && this.interfaces().find((i) => i.index === route.iface);
    return iface ? formatIp(iface.ip) : null;
  }

  /**
   * Sendet ein IP-Paket: Route suchen, nächsten Hop per ARP auflösen, Rahmen senden.
   * Fehler, die schon beim Absender auffallen, meldet `onError`.
   */
  sendIp(dstText: string, payload: Ipv4Packet['payload'], options: SendOptions = {}, onError?: (e: SendError) => void) {
    const dst = parseIp(dstText);
    if (dst === null) return;
    const build = (src: string): Ipv4Packet => ({
      kind: 'ipv4',
      src: options.src ?? src,
      dst: dstText,
      ttl: options.ttl ?? DEFAULT_TTL,
      id: ++this.#ipId,
      payload,
    });

    // Eigene Adresse und Loopback verlassen das Gerät nicht.
    if (this.isOwn(dst)) {
      const packet = build(dstText);
      this.ctx.schedule(0, () => this.#deliver(packet, false, 0));
      return;
    }

    // Broadcast an alle im eigenen Netz, unabhängig von Routen.
    if (dst === LIMITED_BROADCAST) {
      const iface = this.interfaces()[0];
      if (!iface) return void onError?.('noRoute');
      this.ctx.transmit(iface.index, { src: iface.mac, dst: BROADCAST_MAC, payload: build(formatIp(iface.ip)) });
      return;
    }

    const route = lookupRoute(this.routes(), dst);
    const iface = route && this.interfaces().find((i) => i.index === route.iface);
    if (!route || !iface) {
      onError?.('noRoute');
      return;
    }
    const packet = build(formatIp(iface.ip));
    if (route.via === null && dst === broadcastOf(iface.ip, iface.prefix)) {
      this.ctx.transmit(iface.index, { src: iface.mac, dst: BROADCAST_MAC, payload: packet });
      return;
    }
    this.#resolve(iface.index, route.via ?? dst, {
      onMac: (mac) => this.ctx.transmit(iface.index, { src: iface.mac, dst: mac, payload: packet }),
      onFail: () => onError?.(route.via === null ? 'hostUnreachable' : 'gatewayUnreachable'),
    });
  }

  /** Sendet ohne eigene Adresse an alle (DHCP vor der Adressvergabe): Absender 0.0.0.0. */
  sendUnconfiguredBroadcast(index: number, payload: UdpDatagram, src = '0.0.0.0') {
    const mac = this.ctx.device()?.interfaces[index]?.mac;
    if (!mac) return;
    this.ctx.transmit(index, {
      src: mac,
      dst: BROADCAST_MAC,
      payload: { kind: 'ipv4', src, dst: '255.255.255.255', ttl: DEFAULT_TTL, id: ++this.#ipId, payload },
    });
  }
}

/** Vermittlungsrechner: leitet weiter und kann als DHCP-Relay arbeiten. */
export class RouterNode extends IpNode {
  protected override readonly forwarding = true;

  /**
   * DHCP-Relay (RFC 1542): Broadcasts von Clients gehen per Unicast an den
   * eingetragenen Server, mit der eigenen Interface-Adresse als giaddr;
   * Antworten des Servers verteilt der Router wieder im Netz des Clients.
   */
  protected override onUdp(_packet: Ipv4Packet, datagram: UdpDatagram, index: number) {
    const msg = datagram.payload;
    if (msg.kind !== 'dhcp' || datagram.dstPort !== DHCP_SERVER_PORT) return;
    const fromClient = msg.op === 'discover' || msg.op === 'request' || msg.op === 'release';
    if (fromClient) {
      const server = this.ctx.device()?.interfaces[index]?.dhcpRelay;
      const own = this.interfaces().find((i) => i.index === index);
      if (!server || !own || msg.giaddr) return;
      this.ctx.print('relay.forward', { op: msg.op, server });
      this.sendIp(server, { ...datagram, srcPort: DHCP_SERVER_PORT, payload: { ...msg, giaddr: formatIp(own.ip) } });
      return;
    }
    const out = this.interfaces().find((i) => formatIp(i.ip) === msg.giaddr);
    if (!out) return;
    this.ctx.print('relay.back', { op: msg.op, iface: out.index });
    this.sendUnconfiguredBroadcast(out.index, { ...datagram, dstPort: DHCP_CLIENT_PORT }, formatIp(out.ip));
  }
}
