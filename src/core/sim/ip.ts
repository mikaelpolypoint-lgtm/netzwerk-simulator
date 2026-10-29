import type { Device } from '../model/types';
import { LIMITED_BROADCAST, broadcastOf, formatIp, isCgnatRange, isPrivate, parseIp } from '../net/ipv4';
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
  type PppControl,
  type OspfPacket,
  type TcpSegment,
  type UdpDatagram,
} from './frames';
import type { NodeContext, SimNode } from './simulation';
import { cableAt, deviceSeq, getDevice, otherEnd } from '../model/topology';
import { MODEM_WAN } from '../model/links';
import type { ModemKind } from '../model/types';
import { BGP_PORT, OSPF_ALL_ROUTERS, RIP_MULTICAST, RIP_PORT } from './frames';
import { ACCESS_PROFILES, nextSteps, stepIndex } from './access';
import { PingRun, type IcmpApp } from './apps';
import { SSH_PORT, startSshServer } from './ssh';
import { TcpStack } from './tcp';
import { PppLinks } from './ppp';
import { Ospf } from './ospf';
import { Rip } from './rip';
import { Bgp } from './bgp';
import type { RoutingHost } from './routing-host';

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
    if (frame.l2) {
      // Serielle Leitung (HDLC/PPP): Punkt-zu-Punkt, keine MAC-Adressen.
      if (!this.isSerial(index)) return;
      if (frame.payload.kind === 'ppp') return this.onPpp(index, frame.payload);
      if (frame.l2 === 'ppp' && !this.serialOpen(index)) return;
      if (frame.payload.kind === 'ipv4') this.#onIp(index, frame.payload, '');
      return;
    }
    const mac = device && macOfIface(device, index);
    if (!mac || (frame.dst !== mac && frame.dst !== BROADCAST_MAC && !this.acceptsMulticast(frame.dst))) return;
    if (frame.payload.kind === 'arp') this.#onArp(index, frame.payload);
    else if (frame.payload.kind === 'ipv4') this.#onIp(index, frame.payload, frame.src);
  }

  /** Proxy-ARP: zusätzliche Adressen, für die das Interface ARP-Anfragen beantwortet. */
  protected answersArpFor(_index: number, _ip: string): boolean {
    return false;
  }

  /** Router hören zusätzlich auf Multicast ihrer Routingprotokolle (OSPF, RIP). */
  protected acceptsMulticast(mac: string): boolean {
    return mac.startsWith('01:00:5E:') && this.joinedGroup(`224.0.0.${parseInt(mac.slice(-2), 16)}`);
  }

  /** Mitglied der Multicast-Gruppe (z.B. 224.0.0.5 für OSPF)? */
  protected joinedGroup(_group: string): boolean {
    return false;
  }

  /** Multicast im lokalen Netz senden (TTL 1), z.B. OSPF-Hello an 224.0.0.5. */
  sendMulticast(index: number, group: string, payload: Ipv4Packet['payload']) {
    const iface = this.interfaces().find((i) => i.index === index);
    if (!iface) return;
    const last = Number(group.split('.')[3] ?? 0);
    const mac = `01:00:5E:00:00:${last.toString(16).toUpperCase().padStart(2, '0')}`;
    this.sendFrame(index, { src: iface.mac, dst: mac, payload: { kind: 'ipv4', src: formatIp(iface.ip), dst: group, ttl: 1, id: ++this.#ipId, payload } });
  }

  /** Serieller Anschluss? (nur physische Ports von Routern) */
  isSerial(index: number): boolean {
    const ref = decodeIface(index);
    return ref.kind === 'port' && !!this.ctx.device()?.interfaces[ref.port]?.serial;
  }

  /** PPP: Leitung ausgehandelt? HDLC-Leitungen sind immer bereit. */
  protected serialOpen(_index: number): boolean {
    return true;
  }

  protected onPpp(_index: number, _control: PppControl) {}

  /** Sendet einen Rahmen auf einem logischen Interface, bei Subinterfaces mit 802.1Q-Tag. */
  protected sendFrame(index: number, frame: EthernetFrame): boolean {
    const ref = decodeIface(index);
    if (ref.kind === 'port' && this.isSerial(index)) {
      const port = this.ctx.device()?.interfaces[ref.port];
      const l2 = port?.encapsulation === 'ppp' ? 'ppp' : 'hdlc';
      if (l2 === 'ppp' && frame.payload.kind !== 'ppp' && !this.serialOpen(index)) return false;
      if (frame.payload.kind === 'arp') return false;
      return this.ctx.transmit(ref.port, { src: '', dst: '', l2, payload: frame.payload });
    }
    if (ref.kind === 'port') return this.ctx.transmit(ref.port, frame);
    if (ref.kind === 'sub') return this.ctx.transmit(ref.port, { ...frame, vlan: ref.vlan });
    return false;
  }

  /** MAC des logischen Interfaces. */
  macOf(index: number): string | undefined {
    const device = this.ctx.device();
    return device && macOfIface(device, index);
  }

  /** Gratuitous ARP: die eigene Adresse im Netz bekannt machen (z.B. nach dem WLAN-Roaming). */
  announce() {
    for (const iface of this.interfaces()) {
      const ip = formatIp(iface.ip);
      this.sendFrame(iface.index, { src: iface.mac, dst: BROADCAST_MAC, payload: { kind: 'arp', op: 'request', senderMac: iface.mac, senderIp: ip, targetMac: ZERO_MAC, targetIp: ip } });
    }
  }

  /** Nachbarn auch ohne ARP bekannt machen, z.B. den DHCP-Server aus seinem Ack. */
  learnNeighbor(ip: string, mac: string, iface: number) {
    this.#learn(ip, mac, iface);
  }

  // --- ARP -----------------------------------------------------------------

  #onArp(index: number, arp: ArpPacket) {
    const iface = this.interfaces().find((i) => i.index === index);
    if (!iface) return;
    const forMe = parseIp(arp.targetIp) === iface.ip || this.answersArpFor(index, arp.targetIp);
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
          senderIp: arp.targetIp,
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
    // Punkt-zu-Punkt-Leitungen brauchen keine Adressauflösung.
    if (this.isSerial(index)) return waiter.onMac('');
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
    // Multicast (224.0.0.0/4) wird nie weitergeleitet; Router nehmen OSPF/RIP-Gruppen an.
    if (dst >>> 28 === 0xe) {
      if (this.joinedGroup(packet.dst)) this.#deliver(packet, true, index, srcMac);
      return;
    }
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
    if (payload.kind === 'ospf') {
      this.onOspf(packet, payload, index);
    } else if (payload.kind === 'udp') {
      this.onUdp(packet, payload, index, srcMac);
    } else if (payload.kind === 'tcp') {
      this.onTcp(packet, payload);
    } else if (payload.type === 'echoRequest') {
      if (!broadcast) this.sendIp(packet.src, { ...payload, type: 'echoReply' }, { src: packet.dst });
    } else {
      this.onIcmp(packet);
    }
  }

  /** OSPF-Pakete (IP-Protokoll 89) für Router. */
  protected onOspf(_packet: Ipv4Packet, _ospf: OspfPacket, _index: number) {}

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
  /** Art der Übersetzung: PAT (viele intern → eine Adresse), statisch 1:1, Portweiterleitung, CGNAT beim Provider. */
  kind?: 'pat' | 'static' | 'dnat' | 'cgnat';
}

type Flow = { protocol: NatEntry['protocol']; port: number };

/** Port bzw. ICMP-Kennung, die NAT umschreibt; `side` = Quelle oder Ziel. */
function flowOf(payload: Ipv4Packet['payload'], side: 'src' | 'dst'): Flow | null {
  if (payload.kind === 'tcp' || payload.kind === 'udp') {
    return { protocol: payload.kind, port: side === 'src' ? payload.srcPort : payload.dstPort };
  }
  if (payload.kind === 'icmp' && (payload.type === 'echoRequest' || payload.type === 'echoReply')) return { protocol: 'icmp', port: payload.id };
  return null;
}

function withFlowPort(payload: Ipv4Packet['payload'], side: 'src' | 'dst', port: number): Ipv4Packet['payload'] {
  if (payload.kind === 'tcp' || payload.kind === 'udp') return side === 'src' ? { ...payload, srcPort: port } : { ...payload, dstPort: port };
  if (payload.kind === 'icmp') return { ...payload, id: port };
  return payload;
}

/**
 * Übersetzungstabelle für PAT (NAPT): viele interne Adressen teilen sich eine
 * äussere; unterschieden wird über den Port. Router (NAT) und Provider (CGNAT)
 * verwenden dieselbe Tabelle.
 */
export class PatTable {
  #byInside = new Map<string, NatEntry>();
  #byOutside = new Map<string, NatEntry>();
  #nextPort = NAT_PORT_START;

  constructor(
    private readonly ctx: NodeContext,
    private readonly kind: 'pat' | 'cgnat',
  ) {}

  entries(): NatEntry[] {
    const now = this.ctx.now;
    return [...this.#byOutside.values()].filter((e) => e.expires > now).sort((a, b) => a.outsidePort - b.outsidePort);
  }

  remember(entry: NatEntry) {
    this.#byInside.set(`${entry.protocol}:${entry.inside}:${entry.insidePort}`, entry);
    this.#byOutside.set(`${entry.protocol}:${entry.outside}:${entry.outsidePort}`, entry);
  }

  /** Ausgehend: Absender wird `outside`, der Port eine freie Nummer. */
  outbound(packet: Ipv4Packet, outside: string): Ipv4Packet {
    const flow = flowOf(packet.payload, 'src');
    if (!flow) return { ...packet, src: outside };
    const now = this.ctx.now;
    let entry = this.#byInside.get(`${flow.protocol}:${packet.src}:${flow.port}`);
    if (!entry || entry.expires <= now || entry.outside !== outside) {
      entry = { protocol: flow.protocol, inside: packet.src, insidePort: flow.port, outside, outsidePort: this.#nextPort++, forwarded: false, expires: 0, kind: this.kind };
      this.remember(entry);
      this.ctx.print(this.kind === 'cgnat' ? 'cgnat.new' : 'nat.new', {
        protocol: flow.protocol.toUpperCase(),
        inside: `${entry.inside}:${entry.insidePort}`,
        outside: `${outside}:${entry.outsidePort}`,
      });
    }
    entry.expires = now + NAT_TIMEOUT;
    return { ...packet, src: outside, payload: withFlowPort(packet.payload, 'src', entry.outsidePort) };
  }

  /** Eingehend an `outside`: bekannte Verbindung → interne Adresse, sonst null. */
  inbound(packet: Ipv4Packet): Ipv4Packet | null {
    const flow = flowOf(packet.payload, 'dst');
    if (!flow) return null;
    const entry = this.#byOutside.get(`${flow.protocol}:${packet.dst}:${flow.port}`);
    if (!entry || entry.expires <= this.ctx.now) return null;
    entry.expires = this.ctx.now + NAT_TIMEOUT;
    return { ...packet, dst: entry.inside, payload: withFlowPort(packet.payload, 'dst', entry.insidePort) };
  }

  lookupOutside(protocol: NatEntry['protocol'], outside: string, port: number): NatEntry | undefined {
    const entry = this.#byOutside.get(`${protocol}:${outside}:${port}`);
    return entry && entry.expires > this.ctx.now ? entry : undefined;
  }
}

/**
 * Gemeinsame Basis von Routern und Provider: leitet weiter und spricht
 * dynamische Routingprotokolle (OSPF, RIP, BGP). Deren Routen ergänzen die
 * direkt verbundenen Netze und statischen Routen; bei gleichem Präfix
 * entscheidet die administrative Distanz.
 */
export class ForwardingNode extends IpNode {
  protected override readonly forwarding: boolean = true;
  readonly tcp: TcpStack;
  readonly ospf: Ospf;
  readonly rip: Rip;
  readonly bgp: Bgp;
  #version = 0;
  #cache: { device: Device | undefined; version: number; routes: Route[] } | null = null;

  constructor(ctx: NodeContext) {
    super(ctx);
    this.tcp = new TcpStack(this, deviceSeq(ctx.device()?.id ?? 'd0'));
    const host: RoutingHost = {
      ctx,
      tcp: this.tcp,
      device: () => ctx.device(),
      interfaces: () => this.interfaces(),
      routesExcept: (kind) => this.#combine(kind),
      sendMulticast: (index, group, payload) => this.sendMulticast(index, group, payload),
      sendIp: (dst, payload, options, onError) => this.sendIp(dst, payload, options, onError),
      ifaceUp: (index) => this.ifaceUp(index),
      routesChanged: () => {
        this.#version++;
      },
    };
    this.ospf = new Ospf(host);
    this.rip = new Rip(host);
    this.bgp = new Bgp(host);
  }

  /** Physische Verbindung eines logischen Interfaces; VLAN-Interfaces (SVI) gelten als verbunden. */
  ifaceUp(index: number): boolean {
    const ref = decodeIface(index);
    return ref.kind === 'svi' ? true : this.ctx.isConnected(ref.port);
  }

  boot() {
    this.ospf.boot();
    this.rip.boot();
    this.bgp.boot();
  }

  #combine(except: 'ospf' | 'rip' | 'bgp' | null): Route[] {
    const routes = [...super.routes()];
    if (except !== 'ospf') routes.push(...this.ospf.routes());
    if (except !== 'rip') routes.push(...this.rip.routes());
    if (except !== 'bgp') routes.push(...this.bgp.routes());
    return routes;
  }

  override routes(): Route[] {
    const device = this.ctx.device();
    if (this.#cache && this.#cache.device === device && this.#cache.version === this.#version) return this.#cache.routes;
    const routes = this.#combine(null);
    this.#cache = { device, version: this.#version, routes };
    return routes;
  }

  protected override joinedGroup(group: string): boolean {
    const device = this.ctx.device();
    return (group === OSPF_ALL_ROUTERS && !!device?.ospf) || (group === RIP_MULTICAST && !!device?.rip);
  }

  protected override onOspf(packet: Ipv4Packet, ospf: OspfPacket, index: number) {
    this.ospf.receive(packet, ospf, index);
  }

  protected override onUdp(packet: Ipv4Packet, datagram: UdpDatagram, index: number, _srcMac: string) {
    if (datagram.payload.kind === 'rip' && datagram.dstPort === RIP_PORT) this.rip.receive(packet, datagram.payload, index);
  }

  protected override onTcp(packet: Ipv4Packet, segment: TcpSegment) {
    if (segment.dstPort === BGP_PORT || segment.srcPort === BGP_PORT) this.tcp.receive(packet.src, packet.dst, segment);
  }

  override state(): object {
    const device = this.ctx.device();
    return {
      ...super.state(),
      ...(device?.ospf ? { ospf: this.ospf.state() } : {}),
      ...(device?.bgp ? { bgp: this.bgp.peers() } : {}),
    };
  }
}

/** Vermittlungsrechner: leitet weiter, kann als DHCP-Relay arbeiten und Adressen übersetzen (NAT). */
export class RouterNode extends ForwardingNode {
  readonly nat: PatTable;

  #ping: IcmpApp | null = null;
  #pingId = 0x4000;
  readonly ppp: PppLinks;

  constructor(ctx: NodeContext) {
    super(ctx);
    const seq = deviceSeq(ctx.device()?.id ?? 'd0');
    this.nat = new PatTable(ctx, 'pat');
    startSshServer(this, ctx);
    this.ppp = new PppLinks(
      ctx,
      (port, control) => this.sendFrame(port, { src: '', dst: '', payload: control }),
      (port) => ctx.device()?.interfaces[port]?.ip,
      seq,
    );
  }

  override boot() {
    this.start();
    super.boot();
  }

  /** Beim Start und nach Änderungen: PPP-Leitungen aushandeln bzw. zurücksetzen. */
  start() {
    for (const port of this.ctx.device()?.interfaces ?? []) {
      if (!port.serial || port.encapsulation !== 'ppp') continue;
      if (this.ctx.isConnected(port.index)) this.ppp.start(port.index);
      else this.ppp.reset(port.index);
    }
  }

  protected override serialOpen(index: number): boolean {
    const port = this.ctx.device()?.interfaces[index];
    return port?.encapsulation !== 'ppp' || this.ppp.isOpen(index);
  }

  protected override onPpp(index: number, control: PppControl) {
    if (this.ctx.device()?.interfaces[index]?.encapsulation === 'ppp') this.ppp.receive(index, control);
  }

  /** «ping» aus der Befehlszeile des Routers. */
  ping(target: string) {
    this.#ping?.cancel();
    const run = new PingRun(this, target, ++this.#pingId, '');
    this.#ping = run;
    run.start();
  }

  protected override onIcmp(packet: Ipv4Packet) {
    this.#ping?.onIcmp(packet);
  }

  /** Verwaltung per SSH (Port 22) und BGP (179); alles andere an den Router selbst verwirft er still, wie Heimrouter. */
  protected override onTcp(packet: Ipv4Packet, segment: TcpSegment) {
    if (segment.dstPort === SSH_PORT) this.tcp.receive(packet.src, packet.dst, segment);
    else super.onTcp(packet, segment);
  }

  #isNat(index: number) {
    return !!this.ctx.device()?.interfaces[index]?.nat;
  }

  natEntries(): NatEntry[] {
    const statics: NatEntry[] = (this.ctx.device()?.staticNat ?? []).map((r) => ({
      protocol: 'icmp',
      inside: r.inside,
      insidePort: 0,
      outside: r.outside,
      outsidePort: 0,
      forwarded: false,
      expires: Number.POSITIVE_INFINITY,
      kind: 'static',
    }));
    return [...statics, ...this.nat.entries()];
  }

  #staticFor(field: 'inside' | 'outside', ip: string) {
    return this.ctx.device()?.staticNat?.find((r) => r[field] === ip);
  }

  /** Proxy-ARP: Der Router antwortet für die öffentlichen Adressen des statischen NAT. */
  protected override answersArpFor(index: number, ip: string): boolean {
    return this.#isNat(index) && !!this.#staticFor('outside', ip);
  }

  /**
   * Ausgehend ins Internet: Statisches NAT ersetzt nur die Adresse (1:1),
   * sonst teilen sich alle die Router-Adresse und werden über Ports unterschieden (PAT).
   */
  protected override outbound(inIface: IfaceAddress, outIface: IfaceAddress, packet: Ipv4Packet): Ipv4Packet | null {
    if (!this.#isNat(outIface.index) || this.#isNat(inIface.index)) return packet;
    const fixed = this.#staticFor('inside', packet.src);
    if (fixed) return { ...packet, src: fixed.outside };
    return this.nat.outbound(packet, formatIp(outIface.ip));
  }

  /** Eingehend: statisches NAT, bekannte Verbindung oder Portweiterleitung (DNAT) → interner Rechner. */
  protected override inbound(iface: IfaceAddress, packet: Ipv4Packet): Ipv4Packet | null {
    if (!this.#isNat(iface.index)) return null;
    const fixed = this.#staticFor('outside', packet.dst);
    if (fixed) return { ...packet, dst: fixed.inside };
    if (packet.dst !== formatIp(iface.ip)) return null;
    const known = this.nat.inbound(packet);
    if (known) return known;
    const flow = flowOf(packet.payload, 'dst');
    if (!flow) return null;
    const rule = (this.ctx.device()?.portForwards ?? []).find((f) => f.protocol === flow.protocol && f.port === flow.port);
    if (!rule) return null;
    const entry: NatEntry = { protocol: flow.protocol, inside: rule.to, insidePort: rule.toPort, outside: packet.dst, outsidePort: rule.port, forwarded: true, expires: this.ctx.now + NAT_TIMEOUT, kind: 'dnat' };
    this.nat.remember(entry);
    this.ctx.print('nat.forward', { protocol: flow.protocol.toUpperCase(), port: rule.port, inside: `${rule.to}:${rule.toPort}` });
    return { ...packet, dst: rule.to, payload: withFlowPort(packet.payload, 'dst', rule.toPort) };
  }

  override state(): object {
    return { ...super.state(), nat: this.natEntries(), ...(this.ppp.status().length ? { ppp: this.ppp.status() } : {}) };
  }

  /**
   * DHCP-Relay (RFC 1542): Broadcasts von Clients gehen per Unicast an den
   * eingetragenen Server, mit der eigenen Interface-Adresse als giaddr;
   * Antworten des Servers verteilt der Router wieder im Netz des Clients.
   */
  protected override onUdp(packet: Ipv4Packet, datagram: UdpDatagram, index: number, srcMac: string) {
    const msg = datagram.payload;
    if (msg.kind === 'rip') return super.onUdp(packet, datagram, index, srcMac);
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
 * Anschlüssen weiter, verwirft aber private Adressen (RFC 1918) und den
 * CGNAT-Bereich (RFC 6598), wie es echte Provider tun. Darum braucht ein
 * Heimnetz NAT.
 *
 * CGNAT: Kunden an Anschlüssen mit `cgnat` erhalten eine Adresse aus
 * 100.64.0.0/10; der Provider übersetzt sie zusätzlich auf seine öffentliche
 * Adresse (`cgnatAddress`). Viele Kunden teilen sich so eine Adresse –
 * Portweiterleitungen von aussen sind dann nicht möglich.
 */
export class InternetNode extends ForwardingNode {
  readonly cgnat: PatTable;
  /** Zugangsleitungen, deren Aufbau begonnen hat (Kabel-ID), damit er nicht doppelt startet. */
  #access = new Set<string>();

  constructor(ctx: NodeContext) {
    super(ctx);
    this.cgnat = new PatTable(ctx, 'cgnat');
  }

  /** Modem der Gegenseite an diesem Anschluss (mit seiner Technik). */
  #modemAt(port: number): ModemKind | undefined {
    const device = this.ctx.device();
    if (!device) return undefined;
    const topology = this.ctx.topology();
    const cable = cableAt(topology, { device: device.id, iface: port });
    if (!cable) return undefined;
    const end = otherEnd(cable, device.id);
    const peer = getDevice(topology, end.device);
    return peer?.type === 'modem' && end.iface === MODEM_WAN ? peer.modem?.kind : undefined;
  }

  /** Provider-Seite der Zugangsleitungen: beginnt den Aufbau, wo die Norm es so vorsieht. */
  override boot() {
    super.boot();
    const device = this.ctx.device();
    if (!device) return;
    const topology = this.ctx.topology();
    for (const port of device.interfaces) {
      const cable = cableAt(topology, { device: device.id, iface: port.index });
      const kind = this.#modemAt(port.index);
      if (!cable || !kind || this.#access.has(cable.id) || !this.ctx.isConnected(port.index)) continue;
      this.#access.add(cable.id);
      if (ACCESS_PROFILES[kind].steps[0]?.from === 'provider') this.#sendAccess(port.index, kind, 0);
    }
  }

  #sendAccess(port: number, kind: ModemKind, index: number) {
    let delay = 0;
    for (const step of nextSteps(kind, index, 'provider')) {
      delay += step.delay ?? 1;
      this.ctx.schedule(delay, () => {
        const mac = this.ctx.device()?.interfaces[port]?.mac ?? '';
        this.ctx.transmit(port, { src: mac, dst: '', payload: { kind: 'link', tech: step.tech, message: step.message, ...(step.fields ? { fields: step.fields } : {}) } });
      });
    }
  }

  override receive(port: number, frame: EthernetFrame) {
    if (frame.payload.kind === 'link') {
      const kind = this.#modemAt(port);
      if (!kind) return;
      const index = stepIndex(kind, frame.payload, 'cpe');
      if (index >= 0 && ACCESS_PROFILES[kind].steps[index + 1]?.from === 'provider') this.#sendAccess(port, kind, index + 1);
      return;
    }
    super.receive(port, frame);
  }

  #cgnatPort(index: number) {
    return !!this.ctx.device()?.interfaces[index]?.cgnat;
  }

  override isOwn(ip: number): boolean {
    const extra = this.ctx.device()?.cgnatAddress;
    return super.isOwn(ip) || (!!extra && parseIp(extra) === ip);
  }

  protected override inbound(_iface: IfaceAddress, packet: Ipv4Packet): Ipv4Packet | null {
    const address = this.ctx.device()?.cgnatAddress;
    if (!address || packet.dst !== address) return null;
    return this.cgnat.inbound(packet);
  }

  protected override outbound(inIface: IfaceAddress, outIface: IfaceAddress, packet: Ipv4Packet): Ipv4Packet | null {
    let current = packet;
    const address = this.ctx.device()?.cgnatAddress;
    const src = parseIp(packet.src);
    if (address && src !== null && isCgnatRange(src) && this.#cgnatPort(inIface.index) && !this.#cgnatPort(outIface.index)) {
      current = this.cgnat.outbound(packet, address);
    }
    const from = parseIp(current.src);
    const to = parseIp(current.dst);
    const blocked = (ip: number | null) => ip !== null && (isPrivate(ip) || (isCgnatRange(ip) && !this.#cgnatPort(outIface.index) && !this.#cgnatPort(inIface.index)));
    if (blocked(from) || blocked(to)) {
      this.ctx.print('internet.private', { src: current.src, dst: current.dst });
      return null;
    }
    return current;
  }

  override state(): object {
    return { ...super.state(), nat: this.cgnat.entries() };
  }
}
