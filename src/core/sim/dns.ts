import type { DnsRecord, DnsType } from '../model/types';
import { isValidName, lookupRecords, normalizeName } from '../net/dns';
import { DNS_PORT, type DnsMessage, type Ipv4Packet, type UdpDatagram } from './frames';
import type { SendError, SendOptions } from './ip';
import type { NodeContext } from './simulation';

export const DNS_TIMEOUT = 2000;
export const DNS_ATTEMPTS = 2;
const CLIENT_PORT_BASE = 53_000;

export interface DnsCacheEntry {
  name: string;
  type: DnsType;
  records: DnsRecord[];
  expires: number;
}

export type ResolveError = 'invalidName' | 'noDnsServer' | 'nxdomain' | 'timeout' | SendError;

export type ResolveResult =
  | { ok: true; records: DnsRecord[]; cached: boolean; server: string }
  | { ok: false; error: ResolveError; server: string };

export interface DnsHost {
  readonly ctx: NodeContext;
  /** Wirksamer DNS-Server (statisch oder per DHCP). */
  dnsServer(): string | undefined;
  sendIp(dst: string, payload: UdpDatagram, options?: SendOptions, onError?: (e: SendError) => void): void;
}

interface Pending {
  name: string;
  type: DnsType;
  server: string;
  attempts: number;
  done: (result: ResolveResult) => void;
}

/** Namensauflösung auf dem Client, mit Cache gemäss TTL der Antwort. */
export class DnsResolver {
  #cache = new Map<string, DnsCacheEntry>();
  #pending = new Map<number, Pending>();
  #nextId = 0;

  constructor(private readonly host: DnsHost) {}

  get #ctx() {
    return this.host.ctx;
  }

  cacheEntries(): DnsCacheEntry[] {
    const now = this.#ctx.now;
    return [...this.#cache.values()].filter((e) => e.expires > now).sort((a, b) => a.name.localeCompare(b.name));
  }

  flush() {
    this.#cache.clear();
  }

  /** `useCache: false` fragt den Server direkt (wie nslookup). */
  resolve(name: string, type: DnsType, done: (result: ResolveResult) => void, { useCache = true } = {}) {
    const wanted = normalizeName(name);
    const server = this.host.dnsServer() ?? '';
    if (!isValidName(wanted)) return done({ ok: false, error: 'invalidName', server });
    const cached = this.#cache.get(`${type} ${wanted}`);
    if (useCache && cached && cached.expires > this.#ctx.now) {
      return done({ ok: true, records: cached.records, cached: true, server });
    }
    if (!server) return done({ ok: false, error: 'noDnsServer', server });
    const id = ++this.#nextId;
    this.#pending.set(id, { name: wanted, type, server, attempts: 0, done });
    this.#query(id);
  }

  #query(id: number) {
    const pending = this.#pending.get(id);
    if (!pending) return;
    const attempt = ++pending.attempts;
    const message: DnsMessage = {
      kind: 'dns',
      id,
      response: false,
      question: { name: pending.name, type: pending.type },
      answers: [],
      rcode: 'ok',
    };
    this.host.sendIp(
      pending.server,
      { kind: 'udp', srcPort: CLIENT_PORT_BASE + (id % 1000), dstPort: DNS_PORT, payload: message },
      {},
      (error) => this.#finish(id, { ok: false, error, server: pending.server }),
    );
    this.#ctx.schedule(DNS_TIMEOUT, () => {
      const current = this.#pending.get(id);
      if (!current || current.attempts !== attempt) return;
      if (current.attempts < DNS_ATTEMPTS) this.#query(id);
      else this.#finish(id, { ok: false, error: 'timeout', server: current.server });
    });
  }

  #finish(id: number, result: ResolveResult) {
    const pending = this.#pending.get(id);
    if (!pending) return;
    this.#pending.delete(id);
    pending.done(result);
  }

  onResponse(message: DnsMessage) {
    const pending = this.#pending.get(message.id);
    if (!pending || !message.response) return;
    if (message.rcode === 'nxdomain' || message.answers.length === 0) {
      return this.#finish(message.id, { ok: false, error: 'nxdomain', server: pending.server });
    }
    const ttl = Math.min(...message.answers.map((a) => a.ttl));
    if (ttl > 0) {
      this.#cache.set(`${pending.type} ${pending.name}`, {
        name: pending.name,
        type: pending.type,
        records: message.answers,
        expires: this.#ctx.now + ttl * 1000,
      });
    }
    this.#finish(message.id, { ok: true, records: message.answers, cached: false, server: pending.server });
  }
}

/** DNS-Server-Dienst: beantwortet Anfragen aus seiner eigenen Zone, ohne Rekursion. */
export class DnsServer {
  constructor(private readonly host: DnsHost) {}

  onQuery(packet: Ipv4Packet, datagram: UdpDatagram) {
    const message = datagram.payload;
    const config = this.host.ctx.device()?.dnsServer;
    if (!config || message.kind !== 'dns' || message.response) return;
    const answers = lookupRecords(config, message.question.name, message.question.type);
    this.host.ctx.print(answers.length ? 'dnsServer.answer' : 'dnsServer.unknown', {
      name: message.question.name,
      type: message.question.type,
      client: packet.src,
      value: answers.map((a) => a.value).join(', '),
    });
    const reply: DnsMessage = {
      kind: 'dns',
      id: message.id,
      response: true,
      question: message.question,
      answers,
      rcode: answers.length ? 'ok' : 'nxdomain',
    };
    this.host.sendIp(packet.src, { kind: 'udp', srcPort: DNS_PORT, dstPort: datagram.srcPort, payload: reply }, { src: packet.dst });
  }
}
