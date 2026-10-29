import { formatIp, parseIp, parseMask } from '../net/ipv4';
import { ADMIN_DISTANCE, lookupRoute, type Route } from '../net/routing';
import { BGP_PORT } from './frames';
import { routerIdOf, type RoutingHost } from './routing-host';
import type { TcpConnection } from './tcp';

// Verkürzte Zeiten (Standard: Keepalive 60 s, Hold 180 s).
export const BGP_KEEPALIVE = 3000;
export const BGP_HOLD = 9000;
export const BGP_RETRY = 4000;

export type BgpPeerState = 'idle' | 'connect' | 'openSent' | 'openConfirm' | 'established';

export type BgpMessage =
  | { type: 'OPEN'; version: 4; asn: number; holdTime: number; bgpId: string }
  | { type: 'KEEPALIVE' }
  | { type: 'UPDATE'; withdrawn: string[]; nlri: string[]; asPath: number[]; nextHop: string }
  | { type: 'NOTIFICATION'; code: string };

/**
 * BGP-4-Nachrichten im Binärformat nach RFC 4271 (mit 4-Byte-AS nach RFC 6793).
 * In der Simulation reisen sie als «Binärtext» (ein Zeichen = ein Byte) in
 * TCP-Segmenten an Port 179; Länge und Sequenznummern stimmen so mit echten Bytes überein.
 */
const MARKER = '\xff'.repeat(16);
const TYPES = { OPEN: 1, UPDATE: 2, NOTIFICATION: 3, KEEPALIVE: 4 } as const;
/** Fehlercodes (Code/Subcode) der NOTIFICATION. */
export const BGP_ERRORS: Record<string, [number, number]> = {
  'Bad Peer AS': [2, 2],
  'Hold Timer Expired': [4, 0],
  Cease: [6, 0],
};
const AS_TRANS = 23456;

const byte = (n: number) => String.fromCharCode(n & 0xff);
const u16 = (n: number) => byte(n >>> 8) + byte(n);
const u32 = (n: number) => u16(n >>> 16) + u16(n);
const ipBytes = (ip: string) => (ip.split('.').map(Number) as number[]).map(byte).join('');
const at = (s: string, i: number) => s.charCodeAt(i) & 0xff;
const r16 = (s: string, i: number) => (at(s, i) << 8) | at(s, i + 1);
const r32 = (s: string, i: number) => r16(s, i) * 65536 + r16(s, i + 2);
const rip = (s: string, i: number) => [0, 1, 2, 3].map((k) => at(s, i + k)).join('.');

function prefixBytes(text: string): string {
  const [ip = '0.0.0.0', len = '0'] = text.split('/');
  const prefix = Number(len);
  return byte(prefix) + ipBytes(ip).slice(0, Math.ceil(prefix / 8));
}

function readPrefixes(s: string, start: number, end: number): string[] {
  const result: string[] = [];
  let i = start;
  while (i < end) {
    const prefix = at(s, i);
    const n = Math.ceil(prefix / 8);
    const octets = [0, 0, 0, 0].map((_, k) => (k < n ? at(s, i + 1 + k) : 0));
    result.push(`${octets.join('.')}/${prefix}`);
    i += 1 + n;
  }
  return result;
}

export function encodeBgp(message: BgpMessage): string {
  let body = '';
  if (message.type === 'OPEN') {
    // Optionaler Parameter: Capability 65 (4-Byte-AS).
    const capability = byte(65) + byte(4) + u32(message.asn);
    const param = byte(2) + byte(capability.length) + capability;
    body = byte(4) + u16(message.asn > 65535 ? AS_TRANS : message.asn) + u16(message.holdTime) + ipBytes(message.bgpId) + byte(param.length) + param;
  } else if (message.type === 'UPDATE') {
    const withdrawn = message.withdrawn.map(prefixBytes).join('');
    let attrs = '';
    if (message.nlri.length) {
      const origin = byte(0x40) + byte(1) + byte(1) + byte(0);
      const segment = message.asPath.length ? byte(2) + byte(message.asPath.length) + message.asPath.map(u32).join('') : '';
      const asPath = byte(0x40) + byte(2) + byte(segment.length) + segment;
      const nextHop = byte(0x40) + byte(3) + byte(4) + ipBytes(message.nextHop);
      attrs = origin + asPath + nextHop;
    }
    body = u16(withdrawn.length) + withdrawn + u16(attrs.length) + attrs + message.nlri.map(prefixBytes).join('');
  } else if (message.type === 'NOTIFICATION') {
    const [code, sub] = BGP_ERRORS[message.code] ?? [6, 0];
    body = byte(code) + byte(sub);
  }
  return MARKER + u16(19 + body.length) + byte(TYPES[message.type as keyof typeof TYPES]) + body;
}

/** Eine vollständige Nachricht ab Position `i`, oder null, wenn noch Bytes fehlen. */
function decodeOne(s: string, i: number): { message: BgpMessage | null; length: number } | null {
  if (s.length - i < 19) return null;
  const length = r16(s, i + 16);
  if (length < 19 || s.length - i < length) return null;
  const type = at(s, i + 18);
  const b = i + 19;
  let message: BgpMessage | null = null;
  if (type === 4) message = { type: 'KEEPALIVE' };
  else if (type === 1) {
    let asn = r16(s, b + 1);
    const optLen = at(s, b + 9);
    for (let p = b + 10; p < b + 10 + optLen; ) {
      const paramType = at(s, p);
      const paramLen = at(s, p + 1);
      if (paramType === 2 && at(s, p + 2) === 65) asn = r32(s, p + 4);
      p += 2 + paramLen;
    }
    message = { type: 'OPEN', version: 4, asn, holdTime: r16(s, b + 3), bgpId: rip(s, b + 5) };
  } else if (type === 2) {
    const wLen = r16(s, b);
    const withdrawn = readPrefixes(s, b + 2, b + 2 + wLen);
    const aStart = b + 2 + wLen + 2;
    const aLen = r16(s, b + 2 + wLen);
    let asPath: number[] = [];
    let nextHop = '0.0.0.0';
    for (let p = aStart; p < aStart + aLen; ) {
      const flags = at(s, p);
      const code = at(s, p + 1);
      const extended = (flags & 0x10) !== 0;
      const len = extended ? r16(s, p + 2) : at(s, p + 2);
      const v = p + (extended ? 4 : 3);
      if (code === 2 && len >= 2) asPath = Array.from({ length: at(s, v + 1) }, (_, k) => r32(s, v + 2 + k * 4));
      if (code === 3) nextHop = rip(s, v);
      p = v + len;
    }
    message = { type: 'UPDATE', withdrawn, nlri: readPrefixes(s, aStart + aLen, i + length), asPath, nextHop };
  } else if (type === 3) {
    const code = at(s, b);
    const sub = at(s, b + 1);
    const name = Object.entries(BGP_ERRORS).find(([, [c, x]]) => c === code && x === sub)?.[0] ?? `Error ${code}/${sub}`;
    message = { type: 'NOTIFICATION', code: name };
  }
  return { message, length };
}

/** Liest alle vollständigen BGP-Nachrichten; `rest` sind Bytes einer noch unvollständigen Nachricht. */
export function decodeBgpStream(data: string): { messages: BgpMessage[]; rest: string } {
  const messages: BgpMessage[] = [];
  let i = 0;
  for (;;) {
    const one = decodeOne(data, i);
    if (!one) break;
    if (one.message) messages.push(one.message);
    i += one.length;
  }
  return { messages, rest: data.slice(i) };
}

/** Für die Paketansicht: BGP-Nachrichten in einem Segment (unvollständige werden ignoriert). */
export function decodeBgp(data: string): BgpMessage[] {
  return decodeBgpStream(data).messages;
}

export function isBgpData(data: string): boolean {
  return data.startsWith(MARKER);
}

interface Path {
  network: number;
  prefix: number;
  asPath: number[];
  nextHop: string;
}

interface Peer {
  ip: string;
  remoteAs: number;
  state: BgpPeerState;
  conn: TcpConnection | null;
  buffer: string;
  holdExpires: number;
  received: Map<string, Path>;
  /** Was diesem Nachbarn zuletzt angekündigt wurde: Präfix → Signatur. */
  advertised: Map<string, string>;
  retryAt: number;
}

export interface BgpPeerInfo {
  ip: string;
  remoteAs: number;
  state: BgpPeerState;
  received: number;
}

const keyOf = (network: number, prefix: number) => `${formatIp(network)}/${prefix}`;

function parsePrefix(text: string): { network: number; prefix: number } | null {
  const [ip, len] = text.split('/');
  const network = parseIp(ip ?? '');
  const prefix = parseMask(len ?? '');
  return network === null || prefix === null ? null : { network, prefix };
}

/**
 * BGP-4, vereinfacht: Sitzungen über TCP 179 mit OPEN → KEEPALIVE →
 * Established, dann UPDATEs mit AS-Pfad und Next Hop. Bester Weg: kürzester
 * AS-Pfad, dann kleinste Nachbaradresse. Schleifenschutz: Enthält der
 * AS-Pfad die eigene AS, wird die Route verworfen. iBGP-Routen werden nicht
 * an andere iBGP-Nachbarn weitergegeben.
 * Zur Vereinfachung baut die Seite mit der kleineren Adresse die Verbindung auf.
 */
export class Bgp {
  #peers = new Map<string, Peer>();
  #routes: Route[] = [];
  #running = false;
  #listening = false;

  constructor(private readonly host: RoutingHost) {}

  get #config() {
    return this.host.device()?.bgp;
  }

  routerId(): string {
    return routerIdOf(this.host, this.#config?.routerId);
  }

  routes(): Route[] {
    return this.#config ? this.#routes : [];
  }

  peers(): BgpPeerInfo[] {
    return [...this.#peers.values()].map((p) => ({ ip: p.ip, remoteAs: p.remoteAs, state: p.state, received: p.received.size }));
  }

  boot() {
    const config = this.#config;
    if (!config) {
      for (const peer of this.#peers.values()) this.#reset(peer, false);
      this.#peers.clear();
      this.#updateRoutes();
      this.#running = false;
      return;
    }
    // Nachbarn mit der Konfiguration abgleichen.
    for (const [ip, peer] of this.#peers) {
      const wanted = config.neighbors.find((n) => n.ip === ip);
      if (!wanted || wanted.remoteAs !== peer.remoteAs) {
        this.#reset(peer, false);
        this.#peers.delete(ip);
      }
    }
    for (const n of config.neighbors) {
      if (!this.#peers.has(n.ip)) {
        this.#peers.set(n.ip, { ip: n.ip, remoteAs: n.remoteAs, state: 'idle', conn: null, buffer: '', holdExpires: 0, received: new Map(), advertised: new Map(), retryAt: 0 });
      }
    }
    if (!this.#listening) {
      this.#listening = true;
      this.host.tcp.listen(BGP_PORT, (conn) => {
        const peer = this.#peers.get(conn.remote.ip);
        if (!this.#config || !peer || peer.conn) return null;
        peer.conn = conn;
        peer.state = 'connect';
        return this.#handlers(peer);
      });
    }
    if (this.#running) return;
    this.#running = true;
    const tick = () => {
      if (!this.#config) {
        this.#running = false;
        this.boot();
        return;
      }
      this.#tick();
      this.host.ctx.schedule(BGP_KEEPALIVE, tick);
    };
    this.host.ctx.schedule(1, tick);
  }

  #tick() {
    const now = this.host.ctx.now;
    for (const peer of this.#peers.values()) {
      if (peer.state === 'idle' && now >= peer.retryAt) this.#connect(peer);
      if (peer.state === 'established' || peer.state === 'openConfirm') {
        if (now > peer.holdExpires) {
          this.host.ctx.print('bgp.holdExpired', { peer: peer.ip });
          this.#send(peer, { type: 'NOTIFICATION', code: 'Hold Timer Expired' });
          this.#reset(peer, true);
          continue;
        }
        this.#send(peer, { type: 'KEEPALIVE' });
      }
      if (peer.state === 'established') this.#advertise(peer);
    }
  }

  /** Die Seite mit der kleineren Adresse verbindet sich aktiv. */
  #connect(peer: Peer) {
    const local = this.#localIpFor(peer.ip);
    if (!local) return;
    if ((parseIp(local) ?? 0) > (parseIp(peer.ip) ?? 0)) return;
    const conn = this.host.tcp.connect(peer.ip, BGP_PORT, this.#handlers(peer));
    if (!conn) return;
    peer.conn = conn;
    peer.state = 'connect';
  }

  #localIpFor(remote: string): string | null {
    const dst = parseIp(remote);
    if (dst === null) return null;
    const route = lookupRoute(this.host.routesExcept('bgp'), dst);
    const iface = route && this.host.interfaces().find((i) => i.index === route.iface);
    return iface ? formatIp(iface.ip) : null;
  }

  #handlers(peer: Peer) {
    return {
      onOpen: () => {
        this.#sendOpen(peer);
      },
      onData: (_conn: TcpConnection, data: string) => {
        const { messages, rest } = decodeBgpStream(peer.buffer + data);
        peer.buffer = rest;
        for (const message of messages) this.#onMessage(peer, message);
      },
      onEnd: () => this.#reset(peer, true),
      onClose: () => this.#reset(peer, true),
      onError: () => this.#reset(peer, true),
    };
  }

  #sendOpen(peer: Peer) {
    const config = this.#config;
    if (!config) return;
    this.#send(peer, { type: 'OPEN', version: 4, asn: config.asn, holdTime: BGP_HOLD / 1000, bgpId: this.routerId() });
    peer.state = 'openSent';
  }

  #send(peer: Peer, message: BgpMessage) {
    peer.conn?.write(encodeBgp(message));
  }

  #reset(peer: Peer, retry: boolean) {
    const conn = peer.conn;
    peer.conn = null;
    const wasUp = peer.state === 'established';
    peer.state = 'idle';
    peer.buffer = '';
    peer.advertised.clear();
    peer.retryAt = this.host.ctx.now + (retry ? BGP_RETRY : 0);
    if (conn && conn.state !== 'CLOSED') conn.close();
    if (peer.received.size) {
      peer.received.clear();
      this.#updateRoutes();
    }
    if (wasUp) this.host.ctx.print('bgp.down', { peer: peer.ip });
  }

  #onMessage(peer: Peer, message: BgpMessage) {
    const config = this.#config;
    if (!config) return;
    peer.holdExpires = this.host.ctx.now + BGP_HOLD;
    if (message.type === 'OPEN') {
      if (message.asn !== peer.remoteAs) {
        this.host.ctx.print('bgp.badPeerAs', { peer: peer.ip, expected: peer.remoteAs, got: message.asn });
        this.#send(peer, { type: 'NOTIFICATION', code: 'Bad Peer AS' });
        this.#reset(peer, true);
        return;
      }
      if (peer.state === 'connect') this.#sendOpen(peer);
      this.#send(peer, { type: 'KEEPALIVE' });
      peer.state = 'openConfirm';
    } else if (message.type === 'KEEPALIVE') {
      if (peer.state === 'openConfirm') {
        peer.state = 'established';
        this.host.ctx.print('bgp.established', { peer: peer.ip, as: peer.remoteAs });
        this.#advertise(peer);
      }
    } else if (message.type === 'UPDATE') {
      if (peer.state !== 'established') return;
      for (const text of message.withdrawn) peer.received.delete(text);
      if (message.asPath.includes(config.asn)) {
        // Eigene AS im Pfad: Schleife, verwerfen.
      } else {
        for (const text of message.nlri) {
          const p = parsePrefix(text);
          if (p) peer.received.set(text, { ...p, asPath: message.asPath, nextHop: message.nextHop });
        }
      }
      this.#updateRoutes();
    } else if (message.type === 'NOTIFICATION') {
      this.host.ctx.print('bgp.notification', { peer: peer.ip, code: message.code });
      this.#reset(peer, true);
    }
  }

  #isIbgp(peer: Peer) {
    return peer.remoteAs === this.#config?.asn;
  }

  /** Bester Weg je Präfix über alle Nachbarn. */
  #bestPaths(): Map<string, { path: Path; peer: Peer }> {
    const best = new Map<string, { path: Path; peer: Peer }>();
    for (const peer of this.#peers.values()) {
      if (peer.state !== 'established') continue;
      for (const [key, path] of peer.received) {
        const current = best.get(key);
        const better =
          !current ||
          path.asPath.length < current.path.asPath.length ||
          (path.asPath.length === current.path.asPath.length && (parseIp(peer.ip) ?? 0) < (parseIp(current.peer.ip) ?? 0));
        if (better) best.set(key, { path, peer });
      }
    }
    return best;
  }

  #updateRoutes() {
    const base = this.host.routesExcept('bgp');
    const routes: Route[] = [];
    for (const { path, peer } of this.#bestPaths().values()) {
      const hop = parseIp(path.nextHop);
      if (hop === null) continue;
      // Next Hop rekursiv über die übrige Routingtabelle auflösen.
      const towards = lookupRoute(base, hop);
      if (!towards) continue;
      routes.push({
        network: path.network,
        prefix: path.prefix,
        iface: towards.iface,
        via: towards.via ?? hop,
        kind: 'bgp',
        metric: path.asPath.length,
        distance: this.#isIbgp(peer) ? ADMIN_DISTANCE.ibgp : ADMIN_DISTANCE.ebgp,
      });
    }
    if (JSON.stringify(routes) !== JSON.stringify(this.#routes)) {
      this.#routes = routes;
      this.host.routesChanged();
    }
  }

  /** Eigene Netze (network-Anweisung, sofern in der Tabelle) und Redistribution. */
  #originated(): Map<string, { asPath: number[]; nextHop: string | null }> {
    const config = this.#config;
    const result = new Map<string, { asPath: number[]; nextHop: string | null }>();
    if (!config) return result;
    const table = this.host.routesExcept('bgp');
    for (const n of config.networks) {
      const network = parseIp(n.network);
      const prefix = parseMask(n.mask);
      if (network === null || prefix === null) continue;
      if (table.some((r) => r.network === network && r.prefix === prefix)) result.set(keyOf(network, prefix), { asPath: [], nextHop: null });
    }
    const sources = new Set(config.redistribute ?? []);
    for (const r of table) {
      const source = r.kind === 'default' ? 'static' : r.kind;
      if (sources.has(source as never)) result.set(keyOf(r.network, r.prefix), { asPath: [], nextHop: null });
    }
    return result;
  }

  /** Ankündigungen an einen Nachbarn mit dem letzten Stand abgleichen und Unterschiede senden. */
  #advertise(peer: Peer) {
    const config = this.#config;
    if (!config || peer.state !== 'established') return;
    const local = this.#localIpFor(peer.ip) ?? '0.0.0.0';
    const ibgp = this.#isIbgp(peer);
    const wanted = new Map<string, { asPath: number[]; nextHop: string }>();
    for (const key of this.#originated().keys()) wanted.set(key, { asPath: ibgp ? [] : [config.asn], nextHop: local });
    for (const [key, { path, peer: from }] of this.#bestPaths()) {
      if (from === peer || wanted.has(key)) continue;
      if (ibgp && this.#isIbgp(from)) continue;
      wanted.set(key, { asPath: ibgp ? path.asPath : [config.asn, ...path.asPath], nextHop: ibgp ? path.nextHop : local });
    }
    const withdrawn = [...peer.advertised.keys()].filter((key) => !wanted.has(key));
    for (const key of withdrawn) peer.advertised.delete(key);
    // Gleiche Attribute in einem UPDATE zusammenfassen.
    const groups = new Map<string, string[]>();
    for (const [key, attrs] of wanted) {
      const signature = JSON.stringify(attrs);
      if (peer.advertised.get(key) === signature) continue;
      peer.advertised.set(key, signature);
      groups.set(signature, [...(groups.get(signature) ?? []), key]);
    }
    if (withdrawn.length && !groups.size) this.#send(peer, { type: 'UPDATE', withdrawn, nlri: [], asPath: [], nextHop: local });
    let first = true;
    for (const [signature, nlri] of groups) {
      const attrs = JSON.parse(signature) as { asPath: number[]; nextHop: string };
      this.#send(peer, { type: 'UPDATE', withdrawn: first ? withdrawn : [], nlri, asPath: attrs.asPath, nextHop: attrs.nextHop });
      first = false;
    }
  }
}

