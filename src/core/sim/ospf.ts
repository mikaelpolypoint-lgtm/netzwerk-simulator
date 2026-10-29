import { formatIp, maskToText, networkOf, parseIp, parseMask } from '../net/ipv4';
import { ADMIN_DISTANCE, type IfaceAddress, type Route } from '../net/routing';
import { inNetworks } from '../net/dynamic';
import { OSPF_ALL_ROUTERS, type Ipv4Packet, type OspfLsa, type OspfPacket } from './frames';
import { routerIdOf, type RoutingHost } from './routing-host';

// Verkürzte Zeiten (Standard: Hello 10 s, Dead 40 s), damit man im Unterricht nicht warten muss.
export const OSPF_HELLO = 2000;
export const OSPF_DEAD = 8000;
export const OSPF_DEFAULT_COST = 10;
const EXTERNAL_COST = 20;

export type OspfNeighborState = 'init' | '2way' | 'exchange' | 'full';

export interface OspfNeighbor {
  routerId: string;
  ip: string;
  iface: number;
  state: OspfNeighborState;
  /** Zeitpunkt des letzten Hellos. */
  lastHello: number;
}

export interface OspfState {
  routerId: string;
  neighbors: OspfNeighbor[];
  lsdb: { type: OspfLsa['type']; advertisingRouter: string; seq: number; links: number }[];
}

interface Participation {
  iface: IfaceAddress;
  area: number;
  passive: boolean;
  cost: number;
}

const lsaKey = (type: OspfLsa['type'], router: string) => `${type}:${router}`;
const sameLinks = (a: OspfLsa['links'], b: OspfLsa['links']) => JSON.stringify(a) === JSON.stringify(b);

/**
 * OSPFv2 (RFC 2328), vereinfacht für den Unterricht:
 * - Hellos an 224.0.0.5 finden Nachbarn (Init → 2-Way); Netzmaske, Intervalle und Area müssen passen.
 * - Datenbankabgleich: DBD (Kopfzeilen) → LSR (Anfrage) → LSU (LSAs) → LSAck; danach «Full».
 * - Jeder Router beschreibt sich in einem Router-LSA (Nachbarn mit Kosten, eigene Netze);
 *   Änderungen werden an alle Nachbarn geflutet.
 * - Dijkstra (SPF) berechnet daraus die kürzesten Wege.
 * Weggelassen: DR/BDR-Wahl, Netz-LSAs, mehrere Areas mit ABR-Zusammenfassung, LSA-Alterung.
 * Auf einem LAN bildet jeder Router mit jedem eine Nachbarschaft.
 */
export class Ospf {
  #neighbors = new Map<string, OspfNeighbor>();
  #lsdb = new Map<string, OspfLsa>();
  #routes: Route[] = [];
  #running = false;
  #seq = 0x80000001;

  constructor(private readonly host: RoutingHost) {}

  get #config() {
    return this.host.device()?.ospf;
  }

  routerId(): string {
    return routerIdOf(this.host, this.#config?.routerId);
  }

  routes(): Route[] {
    return this.#config ? this.#routes : [];
  }

  #participating(): Participation[] {
    const config = this.#config;
    const device = this.host.device();
    if (!config || !device) return [];
    return this.host.interfaces().flatMap((iface) => {
      const net = inNetworks(iface.ip, config.networks);
      if (!net) return [];
      const port = device.interfaces[iface.index];
      return [{ iface, area: net.area, passive: !!config.passive?.includes(iface.index), cost: port?.ospfCost ?? OSPF_DEFAULT_COST }];
    });
  }

  boot() {
    if (!this.#config) {
      if (this.#running || this.#routes.length) {
        this.#neighbors.clear();
        this.#lsdb.clear();
        this.#routes = [];
        this.host.routesChanged();
      }
      this.#running = false;
      return;
    }
    if (this.#running) return;
    this.#running = true;
    const tick = () => {
      if (!this.#config) {
        this.#running = false;
        this.boot();
        return;
      }
      this.#checkDead();
      this.#sendHellos();
      this.#originate();
      this.host.ctx.schedule(OSPF_HELLO, tick);
    };
    this.host.ctx.schedule(0, tick);
  }

  #sendHellos() {
    for (const p of this.#participating()) {
      if (p.passive || !this.host.ifaceUp(p.iface.index)) continue;
      const seen = [...this.#neighbors.values()].filter((n) => n.iface === p.iface.index).map((n) => n.routerId);
      const packet: OspfPacket = {
        kind: 'ospf',
        type: 'hello',
        routerId: this.routerId(),
        area: p.area,
        hello: { mask: maskToText(p.iface.prefix), helloInterval: OSPF_HELLO / 1000, deadInterval: OSPF_DEAD / 1000, neighbors: seen },
      };
      this.host.sendMulticast(p.iface.index, OSPF_ALL_ROUTERS, packet);
    }
  }

  #checkDead() {
    const now = this.host.ctx.now;
    let changed = false;
    for (const [key, n] of this.#neighbors) {
      if (now - n.lastHello > OSPF_DEAD || !this.#participating().some((p) => p.iface.index === n.iface)) {
        this.#neighbors.delete(key);
        this.host.ctx.print('ospf.down', { neighbor: n.routerId, ip: n.ip });
        changed = true;
      }
    }
    if (changed) this.#originate();
  }

  receive(packet: Ipv4Packet, ospf: OspfPacket, index: number) {
    const part = this.#participating().find((p) => p.iface.index === index);
    if (!part || part.passive) return;
    if (ospf.routerId === this.routerId()) return;
    if (ospf.area !== part.area) {
      if (ospf.type === 'hello') this.host.ctx.print('ospf.areaMismatch', { neighbor: ospf.routerId, area: ospf.area, own: part.area });
      return;
    }
    const key = `${index}|${ospf.routerId}`;
    if (ospf.type === 'hello') return this.#onHello(packet, ospf, part, key);
    const neighbor = this.#neighbors.get(key);
    if (!neighbor) return;
    if (ospf.type === 'dbd') this.#onDbd(neighbor, ospf);
    else if (ospf.type === 'lsr') this.#onLsr(neighbor, ospf);
    else if (ospf.type === 'lsu') this.#onLsu(neighbor, ospf);
  }

  #onHello(packet: Ipv4Packet, ospf: OspfPacket, part: Participation, key: string) {
    const hello = ospf.hello;
    if (!hello) return;
    if (parseMask(hello.mask) !== part.iface.prefix || hello.helloInterval * 1000 !== OSPF_HELLO) {
      this.host.ctx.print('ospf.helloMismatch', { neighbor: ospf.routerId, mask: hello.mask });
      return;
    }
    let neighbor = this.#neighbors.get(key);
    if (!neighbor) {
      neighbor = { routerId: ospf.routerId, ip: packet.src, iface: part.iface.index, state: 'init', lastHello: this.host.ctx.now };
      this.#neighbors.set(key, neighbor);
      this.host.ctx.print('ospf.init', { neighbor: ospf.routerId, ip: packet.src });
    }
    neighbor.lastHello = this.host.ctx.now;
    neighbor.ip = packet.src;
    const seesMe = hello.neighbors.includes(this.routerId());
    if (!seesMe) {
      if (neighbor.state !== 'init') neighbor.state = 'init';
      return;
    }
    if (neighbor.state === 'init') {
      neighbor.state = 'exchange';
      this.#sendDbd(neighbor, part.area);
    }
  }

  #headers() {
    return [...this.#lsdb.values()].map((l) => ({ advertisingRouter: l.advertisingRouter, seq: l.seq, type: l.type }));
  }

  #send(neighbor: OspfNeighbor, packet: Omit<OspfPacket, 'kind' | 'routerId' | 'area'>) {
    const part = this.#participating().find((p) => p.iface.index === neighbor.iface);
    if (!part) return;
    this.host.sendIp(neighbor.ip, { kind: 'ospf', routerId: this.routerId(), area: part.area, ...packet }, { src: formatIp(part.iface.ip), ttl: 1 });
  }

  #sendDbd(neighbor: OspfNeighbor, _area: number) {
    this.#send(neighbor, { type: 'dbd', headers: this.#headers() });
  }

  #onDbd(neighbor: OspfNeighbor, ospf: OspfPacket) {
    if (neighbor.state === 'init') {
      neighbor.state = 'exchange';
      this.#sendDbd(neighbor, ospf.area);
    }
    const wanted = (ospf.headers ?? []).filter((h) => {
      const mine = this.#lsdb.get(lsaKey(h.type, h.advertisingRouter));
      return !mine || mine.seq < h.seq;
    });
    if (wanted.length) this.#send(neighbor, { type: 'lsr', headers: wanted });
    else this.#full(neighbor);
  }

  #onLsr(neighbor: OspfNeighbor, ospf: OspfPacket) {
    const lsas = (ospf.headers ?? []).flatMap((h) => this.#lsdb.get(lsaKey(h.type, h.advertisingRouter)) ?? []);
    if (lsas.length) this.#send(neighbor, { type: 'lsu', lsas });
  }

  #onLsu(neighbor: OspfNeighbor, ospf: OspfPacket) {
    const fresh: OspfLsa[] = [];
    for (const lsa of ospf.lsas ?? []) {
      const key = lsaKey(lsa.type, lsa.advertisingRouter);
      const mine = this.#lsdb.get(key);
      if (lsa.advertisingRouter === this.routerId()) {
        // Eigenes LSA mit höherer Nummer (nach einem Neustart): mit noch höherer Nummer neu ausgeben.
        if (mine && lsa.seq >= mine.seq) {
          this.#seq = lsa.seq + 1;
          this.#lsdb.delete(key);
          this.#originate();
        }
        continue;
      }
      if (!mine || mine.seq < lsa.seq) {
        this.#lsdb.set(key, lsa);
        fresh.push(lsa);
      }
    }
    this.#send(neighbor, { type: 'lsack', headers: (ospf.lsas ?? []).map((l) => ({ advertisingRouter: l.advertisingRouter, seq: l.seq, type: l.type })) });
    if (fresh.length) {
      this.#flood(fresh, neighbor);
      this.#spf();
    }
    if (neighbor.state === 'exchange') this.#full(neighbor);
  }

  #full(neighbor: OspfNeighbor) {
    if (neighbor.state === 'full') return;
    neighbor.state = 'full';
    this.host.ctx.print('ospf.full', { neighbor: neighbor.routerId, ip: neighbor.ip });
    this.#originate();
    // Neue Nachbarn erhalten die ganze Datenbank.
    const all = [...this.#lsdb.values()];
    if (all.length) this.#send(neighbor, { type: 'lsu', lsas: all });
  }

  #flood(lsas: OspfLsa[], except?: OspfNeighbor) {
    for (const n of this.#neighbors.values()) {
      if (n === except || n.state !== 'full') continue;
      this.#send(n, { type: 'lsu', lsas });
    }
  }

  /** Eigenes Router-LSA (und ggf. External-LSA) neu erzeugen und bei Änderungen fluten. */
  #originate() {
    const config = this.#config;
    if (!config) return;
    const me = this.routerId();
    const links: OspfLsa['links'] = [];
    for (const p of this.#participating()) {
      links.push({ kind: 'stub', id: formatIp(networkOf(p.iface.ip, p.iface.prefix)), data: maskToText(p.iface.prefix), cost: p.cost });
      for (const n of this.#neighbors.values()) {
        if (n.iface === p.iface.index && n.state === 'full') links.push({ kind: 'p2p', id: n.routerId, data: formatIp(p.iface.ip), cost: p.cost });
      }
    }
    const changed: OspfLsa[] = [];
    const install = (type: OspfLsa['type'], next: OspfLsa['links']) => {
      const key = lsaKey(type, me);
      const current = this.#lsdb.get(key);
      if (current && sameLinks(current.links, next)) return;
      if (!current && type === 'external' && next.length === 0) return;
      const lsa: OspfLsa = { type, advertisingRouter: me, seq: this.#seq++, links: next };
      this.#lsdb.set(key, lsa);
      changed.push(lsa);
    };
    install('router', links);
    install('external', this.#externalLinks());
    if (changed.length) {
      this.#flood(changed);
      this.#spf();
    }
  }

  /** Redistribution und Standardroute als External-LSA (Typ 5, Metrik-Typ 2). */
  #externalLinks(): OspfLsa['links'] {
    const config = this.#config;
    const device = this.host.device();
    if (!config || !device) return [];
    const result: OspfLsa['links'] = [];
    if (config.defaultOriginate) result.push({ kind: 'stub', id: '0.0.0.0', data: '0.0.0.0', cost: 1 });
    const sources = new Set(config.redistribute ?? []);
    if (sources.size) {
      const participating = new Set(this.#participating().map((p) => `${networkOf(p.iface.ip, p.iface.prefix)}/${p.iface.prefix}`));
      for (const r of this.host.routesExcept('ospf')) {
        const source = r.kind === 'default' ? 'static' : r.kind;
        if (!sources.has(source as never)) continue;
        if (r.kind === 'connected' && participating.has(`${r.network}/${r.prefix}`)) continue;
        result.push({ kind: 'stub', id: formatIp(r.network), data: maskToText(r.prefix), cost: EXTERNAL_COST });
      }
    }
    return result;
  }

  /** Dijkstra über die Router-LSAs: kürzeste Wege und erster Nachbar auf dem Weg. */
  #spf() {
    const me = this.routerId();
    const routerLsa = (id: string) => this.#lsdb.get(lsaKey('router', id));
    const dist = new Map<string, number>([[me, 0]]);
    const firstHop = new Map<string, OspfNeighbor | null>([[me, null]]);
    const done = new Set<string>();
    for (;;) {
      let current: string | undefined;
      for (const [id, d] of dist) if (!done.has(id) && (current === undefined || d < dist.get(current)!)) current = id;
      if (current === undefined) break;
      done.add(current);
      const lsa = routerLsa(current);
      for (const link of lsa?.links ?? []) {
        if (link.kind !== 'p2p') continue;
        // Nur Verbindungen, die beide Seiten melden (Zwei-Wege-Prüfung).
        if (!routerLsa(link.id)?.links.some((l) => l.kind === 'p2p' && l.id === current)) continue;
        const d = dist.get(current)! + link.cost;
        if (dist.has(link.id) && dist.get(link.id)! <= d) continue;
        dist.set(link.id, d);
        const hop = current === me ? [...this.#neighbors.values()].find((n) => n.routerId === link.id && n.state === 'full' && formatIp(this.host.interfaces().find((i) => i.index === n.iface)?.ip ?? 0) === link.data) ?? null : firstHop.get(current)!;
        firstHop.set(link.id, hop);
      }
    }
    const best = new Map<string, Route>();
    const own = new Set(this.host.interfaces().map((i) => `${networkOf(i.ip, i.prefix)}/${i.prefix}`));
    const offer = (network: number, prefix: number, metric: number, hop: OspfNeighbor | null | undefined) => {
      if (!hop) return;
      const key = `${network}/${prefix}`;
      if (own.has(key)) return;
      const via = parseIp(hop.ip);
      if (via === null) return;
      const existing = best.get(key);
      if (existing && (existing.metric ?? 0) <= metric) return;
      best.set(key, { network, prefix, iface: hop.iface, via, kind: 'ospf', metric, distance: ADMIN_DISTANCE.ospf });
    };
    for (const [id, d] of dist) {
      if (id === me) continue;
      for (const link of routerLsa(id)?.links ?? []) {
        if (link.kind !== 'stub') continue;
        const network = parseIp(link.id);
        const prefix = parseMask(link.data);
        if (network !== null && prefix !== null) offer(network, prefix, d + link.cost, firstHop.get(id));
      }
      for (const link of this.#lsdb.get(lsaKey('external', id))?.links ?? []) {
        const network = parseIp(link.id);
        const prefix = parseMask(link.data);
        if (network !== null && prefix !== null) offer(network, prefix, link.cost + d / 1000, firstHop.get(id));
      }
    }
    const routes = [...best.values()].map((r) => ({ ...r, metric: Math.round(r.metric ?? 0) }));
    if (JSON.stringify(routes) !== JSON.stringify(this.#routes)) {
      this.#routes = routes;
      this.host.routesChanged();
    }
  }

  state(): OspfState {
    return {
      routerId: this.routerId(),
      neighbors: [...this.#neighbors.values()].map((n) => ({ ...n })),
      lsdb: [...this.#lsdb.values()].map((l) => ({ type: l.type, advertisingRouter: l.advertisingRouter, seq: l.seq, links: l.links.length })),
    };
  }
}

