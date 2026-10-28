import { LIMITED_BROADCAST, broadcastOf, formatIp, parseIp } from '../net/ipv4';
import { buildRoutes, interfaceAddresses, lookupRoute, type IfaceAddress, type Route } from '../net/routing';
import { BROADCAST_MAC, ZERO_MAC, type ArpPacket, type EthernetFrame, type IcmpMessage, type Ipv4Packet } from './frames';
import type { NodeContext, SimNode } from './simulation';

export const ARP_TIMEOUT = 1000;
export const ARP_ATTEMPTS = 2;
/** Lebensdauer eines ARP-Eintrags (5 Minuten virtuelle Zeit). */
export const ARP_TTL = 300_000;
export const DEFAULT_TTL = 64;

export const PING_COUNT = 4;
export const PING_INTERVAL = 1000;
export const PING_TIMEOUT = 3000;
export const PING_SIZE = 32;

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

const isLoopback = (ip: number) => ip >>> 24 === 127;
const isIcmpError = (icmp: IcmpMessage) => icmp.type === 'destUnreachable' || icmp.type === 'timeExceeded';

/**
 * IPv4-Teilnehmer mit ARP und ICMP. Endgeräte nutzen ihn direkt;
 * Vermittlungsrechner (`RouterNode`) leiten zusätzlich weiter.
 */
export class IpNode implements SimNode {
  protected readonly forwarding: boolean = false;
  #arp = new Map<string, ArpEntry>();
  #pending = new Map<string, PendingResolution>();
  #ipId = 0;
  #icmpId = 0;
  #ping: PingRun | null = null;

  constructor(protected readonly ctx: NodeContext) {}

  protected interfaces(): IfaceAddress[] {
    const device = this.ctx.device();
    return device ? interfaceAddresses(device) : [];
  }

  protected routes(): Route[] {
    const device = this.ctx.device();
    return device ? buildRoutes(device).routes : [];
  }

  state() {
    const now = this.ctx.now;
    const arp = [...this.#arp.values()]
      .filter((e) => e.expires > now)
      .sort((a, b) => (parseIp(a.ip) ?? 0) - (parseIp(b.ip) ?? 0));
    return { arp };
  }

  receive(index: number, frame: EthernetFrame) {
    const mac = this.ctx.device()?.interfaces[index]?.mac;
    if (!mac || (frame.dst !== mac && frame.dst !== BROADCAST_MAC)) return;
    if (frame.payload.kind === 'arp') this.#onArp(index, frame.payload);
    else this.#onIp(index, frame.payload);
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

  #isOwn(ip: number): boolean {
    return isLoopback(ip) || this.interfaces().some((i) => i.ip === ip);
  }

  #onIp(index: number, packet: Ipv4Packet) {
    const dst = parseIp(packet.dst);
    if (dst === null) return;
    const iface = this.interfaces().find((i) => i.index === index);
    const broadcast = dst === LIMITED_BROADCAST || (iface !== undefined && dst === broadcastOf(iface.ip, iface.prefix));
    if (this.#isOwn(dst) || broadcast) this.deliver(packet, broadcast);
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
    // Auf Fehlermeldungen antwortet man nie mit Fehlermeldungen (sonst Ping-Pong).
    if (isIcmpError(original.payload)) return;
    const message: IcmpMessage = {
      kind: 'icmp',
      type,
      id: 0,
      seq: 0,
      size: 0,
      original: { src: original.src, dst: original.dst, id: original.payload.id, seq: original.payload.seq },
      ...(code ? { code } : {}),
    };
    this.sendIp(original.src, message, { src: formatIp(from.ip) });
  }

  protected deliver(packet: Ipv4Packet, broadcast: boolean) {
    const icmp = packet.payload;
    if (icmp.type === 'echoRequest' && !broadcast) {
      this.sendIp(packet.src, { ...icmp, type: 'echoReply' }, { src: packet.dst });
    } else if (icmp.type === 'echoReply') {
      this.#ping?.onReply(packet);
    } else if (isIcmpError(icmp)) {
      this.#ping?.onIcmpError(packet);
    }
  }

  /**
   * Sendet ein IP-Paket: Route suchen, nächsten Hop per ARP auflösen, Rahmen senden.
   * Fehler, die schon beim Absender auffallen, meldet `onError`.
   */
  sendIp(dstText: string, payload: IcmpMessage, options: { src?: string; ttl?: number } = {}, onError?: (e: SendError) => void) {
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
    if (this.#isOwn(dst)) {
      const packet = build(dstText);
      this.ctx.schedule(0, () => this.deliver(packet, false));
      return;
    }

    const route = lookupRoute(this.routes(), dst);
    const iface = route && this.interfaces().find((i) => i.index === route.iface);
    if (!route || !iface) {
      onError?.('noRoute');
      return;
    }
    const packet = build(formatIp(iface.ip));
    if (dst === LIMITED_BROADCAST || (route.via === null && dst === broadcastOf(iface.ip, iface.prefix))) {
      this.ctx.transmit(iface.index, { src: iface.mac, dst: BROADCAST_MAC, payload: packet });
      return;
    }
    this.#resolve(iface.index, route.via ?? dst, {
      onMac: (mac) => this.ctx.transmit(iface.index, { src: iface.mac, dst: mac, payload: packet }),
      onFail: () => onError?.(route.via === null ? 'hostUnreachable' : 'gatewayUnreachable'),
    });
  }

  // --- Anwendungen ---------------------------------------------------------

  ping(targetText: string) {
    const target = parseIp(targetText.trim());
    if (target === null) {
      this.ctx.print('ping.invalidTarget', { target: targetText.trim() });
      return;
    }
    const own = this.#isOwn(target);
    const iface = this.interfaces()[0];
    if (!own) {
      if (!iface) {
        this.ctx.print('ping.noAddress');
        return;
      }
      if (!this.ctx.isConnected(iface.index)) {
        this.ctx.print('ping.noLink');
        return;
      }
      if (!lookupRoute(this.routes(), target)) {
        this.ctx.print('ping.noRoute', { target: formatIp(target) });
        return;
      }
    }
    this.#ping?.cancel();
    this.#ping = new PingRun(this, this.ctx, formatIp(target), ++this.#icmpId, this.ctx.device()?.gateway ?? '');
    this.#ping.start();
  }
}

export class RouterNode extends IpNode {
  protected override readonly forwarding = true;
}

/** Ablauf von "ping": vier Echo-Anfragen, jeweils eine Sekunde nach Antwort oder Zeitüberschreitung. */
class PingRun {
  #seq = 0;
  #received = 0;
  #outstanding = new Map<number, number>();
  #cancelled = false;

  constructor(
    private readonly host: IpNode,
    private readonly ctx: NodeContext,
    private readonly target: string,
    private readonly id: number,
    private readonly gateway: string,
  ) {}

  start() {
    this.ctx.print('ping.start', { target: this.target, size: PING_SIZE });
    this.#send();
  }

  cancel() {
    this.#cancelled = true;
  }

  #send() {
    if (this.#cancelled) return;
    const seq = ++this.#seq;
    this.#outstanding.set(seq, this.ctx.now);
    this.ctx.schedule(PING_TIMEOUT, () => {
      if (this.#settle(seq)) this.ctx.print('ping.timeout');
    });
    const request: IcmpMessage = { kind: 'icmp', type: 'echoRequest', id: this.id, seq, size: PING_SIZE };
    this.host.sendIp(this.target, request, {}, (error) => {
      if (this.#settle(seq)) this.ctx.print(`ping.${error}`, { target: this.target, gateway: this.gateway });
    });
  }

  onReply(packet: Ipv4Packet) {
    const icmp = packet.payload;
    if (icmp.id !== this.id) return;
    const sentAt = this.#outstanding.get(icmp.seq);
    if (sentAt === undefined || !this.#settle(icmp.seq)) return;
    this.#received++;
    this.ctx.print('ping.reply', { from: packet.src, size: icmp.size, time: this.ctx.now - sentAt, ttl: packet.ttl });
  }

  /** Ein Router meldet, dass unsere Anfrage nicht zugestellt werden konnte. */
  onIcmpError(packet: Ipv4Packet) {
    const icmp = packet.payload;
    const original = icmp.original;
    if (!original || original.id !== this.id || !this.#settle(original.seq)) return;
    if (icmp.type === 'timeExceeded') this.ctx.print('ping.ttlExpired', { from: packet.src });
    else this.ctx.print(icmp.code === 'host' ? 'ping.hostUnreachableFrom' : 'ping.netUnreachableFrom', { from: packet.src });
  }

  /** Schliesst eine Anfrage ab (genau einmal) und plant die nächste. */
  #settle(seq: number): boolean {
    if (this.#cancelled || !this.#outstanding.delete(seq)) return false;
    if (this.#seq < PING_COUNT) this.ctx.schedule(PING_INTERVAL, () => this.#send());
    else this.ctx.schedule(0, () => this.#finish());
    return true;
  }

  #finish() {
    if (this.#cancelled) return;
    const sent = this.#seq;
    const lost = sent - this.#received;
    this.ctx.print('ping.summary', {
      target: this.target,
      sent,
      received: this.#received,
      lost,
      percent: Math.round((lost / sent) * 100),
    });
  }
}
