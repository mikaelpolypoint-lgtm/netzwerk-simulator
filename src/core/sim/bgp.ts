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

/**
 * BGP-4-Nachrichten (RFC 4271). Sie reisen als Textzeilen «BGP {json}» über
 * TCP-Port 179; die Paketansicht zeigt sie wie ein Analysator an.
 */
export type BgpMessage =
  | { type: 'OPEN'; version: 4; asn: number; holdTime: number; bgpId: string }
  | { type: 'KEEPALIVE' }
  | { type: 'UPDATE'; withdrawn: string[]; nlri: string[]; asPath: number[]; nextHop: string }
  | { type: 'NOTIFICATION'; code: string };

export const BGP_PREFIX = 'BGP ';

export function encodeBgp(message: BgpMessage): string {
  return `${BGP_PREFIX}${JSON.stringify(message)}\n`;
}

/** Liest BGP-Nachrichten aus TCP-Nutzdaten (für die Paketansicht). */
export function decodeBgp(data: string): BgpMessage[] {
  return data
    .split('\n')
    .filter((line) => line.startsWith(BGP_PREFIX))
    .flatMap((line) => {
      try {
        return [JSON.parse(line.slice(BGP_PREFIX.length)) as BgpMessage];
      } catch {
        return [];
      }
    });
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
        peer.buffer += data;
        let newline = peer.buffer.indexOf('\n');
        while (newline >= 0) {
          const line = peer.buffer.slice(0, newline + 1);
          peer.buffer = peer.buffer.slice(newline + 1);
          for (const message of decodeBgp(line)) this.#onMessage(peer, message);
          newline = peer.buffer.indexOf('\n');
        }
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

