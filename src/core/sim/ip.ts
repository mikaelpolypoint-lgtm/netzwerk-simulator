import type { Device } from '../model/types';
import { LIMITED_BROADCAST, broadcastOf, formatIp, isPrivate, parseIp } from '../net/ipv4';
import { buildRoutes, decodeIface, interfaceAddresses, lookupRoute, macOfIface, relayOf, subifId, type IfaceAddress, type Route } from '../net/routing';
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
import { deviceSeq } from '../model/topology';
import { SSH_PORT, startSshServer } from './ssh';
import { TcpStack } from './tcp';

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

  /**
   * Rahmen am physischen Anschluss `port`. Getaggte Rahmen gehören zum
   * passenden Subinterface (Router-on-a-Stick); ohne Subinterface werden sie
   * verworfen, wie bei echten Geräten.
   */
  receive(port: number, frame: EthernetFrame) {
    const device = this.ctx.device();
    if (!device) return;
    let index = port;
    if (frame.vlan !== undefined) {
      if (!device.subinterfaces?.some((s) => s.parent === port && s.vlan === frame.vlan)) return;
      index = subifId(port, frame.vlan);
    }
    this.receiveOn(index, frame);
  }

  /** Rahmen auf einem logischen Interface; Ziel muss dessen MAC oder Broadcast sein. */
  receiveOn(index: number, frame: EthernetFrame) {
    const device = this.ctx.device();
    const mac = device && macOfIface(device, index);
    if (!mac || (frame.dst !== mac && frame.dst !== BROADCAST_MAC)) return;
    if (frame.payload.kind === 'arp') this.#onArp(index, frame.payload);
    else if (frame.payload.kind === 'ipv4') this.#onIp(index, frame.payload, frame.src);
  }

  /** Sendet einen Rahmen auf einem logischen Interface, bei Subinterfaces mit 802.1Q-Tag. */
  protected sendFrame(index: number, frame: EthernetFrame): boolean {
    const ref = decodeIface(index);
    if (ref.kind === 'port') return this.ctx.transmit(ref.port, frame);
    if (ref.kind === 'sub') return this.ctx.transmit(ref.port, { ...frame, vlan: ref.vlan });
    return false;
  }

  /** MAC des logischen Interfaces. */
  macOf(index: number): string | undefined {
    const device = this.ctx.device();
    return device && macOfIface(device, index);
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
      this.sendFrame(index, {
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
    this.sendFrame(index, {
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
    // NAT: Antworten an die Internet-Adresse des Routers gehen an den internen Rechner weiter.
    const translated = this.forwarding && iface ? this.inbound(iface, packet) : null;
    if (translated && iface) this.#forward(iface, translated);
    else if (this.isOwn(dst) || broadcast) this.#deliver(packet, broadcast, index, srcMac);
    else if (this.forwarding && iface) this.#forward(iface, packet);
  }

  /** Eingehende Übersetzung (NAT) vor der Zustellung; null = nichts zu übersetzen. */
  protected inbound(_iface: IfaceAddress, _packet: Ipv4Packet): Ipv4Packet | null {
    return null;
  }

  /** Letzter Schritt vor dem Weiterleiten (NAT, Filter); null = verwerfen. */
  protected outbound(_inIface: IfaceAddress, _outIface: IfaceAddress, packet: Ipv4Packet): Ipv4Packet | null {
    return packet;
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
    const forwarded = this.outbound(inIface, out, { ...packet, ttl: packet.ttl - 1 });
    if (!forwarded) return;
    this.#resolve(out.index, route.via ?? dst, {
      onMac: (mac) => this.sendFrame(out.index, { src: out.mac, dst: mac, payload: forwarded }),
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
      this.sendFrame(iface.index, { src: iface.mac, dst: BROADCAST_MAC, payload: build(formatIp(iface.ip)) });
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
      this.sendFrame(iface.index, { src: iface.mac, dst: BROADCAST_MAC, payload: packet });
      return;
    }
    this.#resolve(iface.index, route.via ?? dst, {
      onMac: (mac) => this.sendFrame(iface.index, { src: iface.mac, dst: mac, payload: packet }),
      onFail: () => onError?.(route.via === null ? 'hostUnreachable' : 'gatewayUnreachable'),
    });
  }

  /** Sendet ohne eigene Adresse an alle (DHCP vor der Adressvergabe): Absender 0.0.0.0. */
  sendUnconfiguredBroadcast(index: number, payload: UdpDatagram, src = '0.0.0.0') {
    const mac = this.macOf(index);
    if (!mac) return;
    this.sendFrame(index, {
      src: mac,
      dst: BROADCAST_MAC,
      payload: { kind: 'ipv4', src, dst: '255.255.255.255', ttl: DEFAULT_TTL, id: ++this.#ipId, payload },
    });
  }
}

export const NAT_TIMEOUT = 300_000;
export const NAT_PORT_START = 50_000;

export interface NatEntry {
  protocol: 'tcp' | 'udp' | 'icmp';
  inside: string;
  insidePort: number;
  outside: string;
  outsidePort: number;
  /** Durch eine Portweiterleitung entstanden statt durch ausgehenden Verkehr. */
  forwarded: boolean;
  expires: number;
}

type Flow = { protocol: NatEntry['protocol']; port: number };

/** Port bzw. ICMP-Kennung, die NAT umschreibt; `side` = Quelle oder Ziel. */
function flowOf(payload: Ipv4Packet['payload'], side: 'src' | 'dst'): Flow | null {
  if (payload.kind === 'tcp' || payload.kind === 'udp') {
    return { protocol: payload.kind, port: side === 'src' ? payload.srcPort : payload.dstPort };
  }
  if (payload.type === 'echoRequest' || payload.type === 'echoReply') return { protocol: 'icmp', port: payload.id };
  return null;
}

function withFlowPort(payload: Ipv4Packet['payload'], side: 'src' | 'dst', port: number): Ipv4Packet['payload'] {
  if (payload.kind === 'tcp' || payload.kind === 'udp') return side === 'src' ? { ...payload, srcPort: port } : { ...payload, dstPort: port };
  return { ...payload, id: port };
}

/** Vermittlungsrechner: leitet weiter, kann als DHCP-Relay arbeiten und Adressen übersetzen (NAT). */
export class RouterNode extends IpNode {
  protected override readonly forwarding = true;
  /** TCP nur für die Verwaltung per SSH. */
  readonly tcp: TcpStack;
  #byInside = new Map<string, NatEntry>();
  #byOutside = new Map<string, NatEntry>();
  #nextPort = NAT_PORT_START;

  constructor(ctx: NodeContext) {
    super(ctx);
    this.tcp = new TcpStack(this, deviceSeq(ctx.device()?.id ?? 'd0'));
    startSshServer(this, ctx);
  }

  /** Nur SSH (Port 22); alles andere an den Router selbst verwirft er still, wie Heimrouter. */
  protected override onTcp(packet: Ipv4Packet, segment: TcpSegment) {
    if (segment.dstPort !== SSH_PORT) return;
    this.tcp.receive(packet.src, packet.dst, segment);
  }

  #isNat(index: number) {
    return !!this.ctx.device()?.interfaces[index]?.nat;
  }

  natEntries(): NatEntry[] {
    const now = this.ctx.now;
    return [...this.#byOutside.values()].filter((e) => e.expires > now).sort((a, b) => a.outsidePort - b.outsidePort);
  }

  #remember(entry: NatEntry) {
    this.#byInside.set(`${entry.protocol}:${entry.inside}:${entry.insidePort}`, entry);
    this.#byOutside.set(`${entry.protocol}:${entry.outside}:${entry.outsidePort}`, entry);
  }

  /** Ausgehend ins Internet: Absender wird die Router-Adresse, der Port eine freie Nummer (PAT). */
  protected override outbound(inIface: IfaceAddress, outIface: IfaceAddress, packet: Ipv4Packet): Ipv4Packet | null {
    if (!this.#isNat(outIface.index) || this.#isNat(inIface.index)) return packet;
    const flow = flowOf(packet.payload, 'src');
    if (!flow) return packet;
    const now = this.ctx.now;
    const outside = formatIp(outIface.ip);
    let entry = this.#byInside.get(`${flow.protocol}:${packet.src}:${flow.port}`);
    if (!entry || entry.expires <= now || entry.outside !== outside) {
      entry = {
        protocol: flow.protocol,
        inside: packet.src,
        insidePort: flow.port,
        outside,
        outsidePort: this.#nextPort++,
        forwarded: false,
        expires: 0,
      };
      this.#remember(entry);
      this.ctx.print('nat.new', { protocol: flow.protocol.toUpperCase(), inside: `${entry.inside}:${entry.insidePort}`, outside: `${outside}:${entry.outsidePort}` });
    }
    entry.expires = now + NAT_TIMEOUT;
    return { ...packet, src: outside, payload: withFlowPort(packet.payload, 'src', entry.outsidePort) };
  }

  /** Eingehend an die Internet-Adresse: bekannte Verbindung oder Portweiterleitung → interner Rechner. */
  protected override inbound(iface: IfaceAddress, packet: Ipv4Packet): Ipv4Packet | null {
    if (!this.#isNat(iface.index) || packet.dst !== formatIp(iface.ip)) return null;
    const flow = flowOf(packet.payload, 'dst');
    if (!flow) return null;
    const now = this.ctx.now;
    let entry = this.#byOutside.get(`${flow.protocol}:${packet.dst}:${flow.port}`);
    if (!entry || entry.expires <= now) {
      const rule = (this.ctx.device()?.portForwards ?? []).find((f) => f.protocol === flow.protocol && f.port === flow.port);
      if (!rule) return null;
      entry = { protocol: flow.protocol, inside: rule.to, insidePort: rule.toPort, outside: packet.dst, outsidePort: rule.port, forwarded: true, expires: 0 };
      this.#remember(entry);
      this.ctx.print('nat.forward', { protocol: flow.protocol.toUpperCase(), port: rule.port, inside: `${rule.to}:${rule.toPort}` });
    }
    entry.expires = now + NAT_TIMEOUT;
    return { ...packet, dst: entry.inside, payload: withFlowPort(packet.payload, 'dst', entry.insidePort) };
  }

  override state(): object {
    return { ...super.state(), nat: this.natEntries() };
  }

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
      const device = this.ctx.device();
      const server = device && relayOf(device, index);
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

/**
 * Das Internet als vereinfachter Provider-Router: leitet zwischen seinen
 * Anschlüssen weiter, verwirft aber private Adressen (RFC 1918), wie es
 * echte Provider tun. Darum braucht ein Heimnetz NAT.
 */
export class InternetNode extends IpNode {
  protected override readonly forwarding = true;

  protected override outbound(_in: IfaceAddress, _out: IfaceAddress, packet: Ipv4Packet): Ipv4Packet | null {
    const src = parseIp(packet.src);
    const dst = parseIp(packet.dst);
    if ((src !== null && isPrivate(src)) || (dst !== null && isPrivate(dst))) {
      this.ctx.print('internet.private', { src: packet.src, dst: packet.dst });
      return null;
    }
    return packet;
  }
}
