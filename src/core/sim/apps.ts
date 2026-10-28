import type { IcmpMessage, Ipv4Packet } from './frames';
import type { SendError } from './ip';
import type { NodeContext } from './simulation';

export const PING_COUNT = 4;
export const PING_INTERVAL = 1000;
export const PING_TIMEOUT = 3000;
export const PING_SIZE = 32;
export const TRACE_MAX_HOPS = 30;
export const TRACE_TIMEOUT = 2000;

/** Was eine ICMP-Anwendung vom Endgerät braucht. */
export interface IcmpHost {
  readonly ctx: NodeContext;
  sendIp(dst: string, payload: Ipv4Packet['payload'], options?: { ttl?: number }, onError?: (e: SendError) => void): void;
}

export interface IcmpApp {
  onIcmp(packet: Ipv4Packet): void;
  cancel(): void;
}

/** Ablauf von "ping": vier Echo-Anfragen, jeweils eine Sekunde nach Antwort oder Zeitüberschreitung. */
export class PingRun implements IcmpApp {
  #seq = 0;
  #received = 0;
  #outstanding = new Map<number, number>();
  #cancelled = false;

  constructor(
    private readonly host: IcmpHost,
    private readonly target: string,
    private readonly id: number,
    private readonly gateway: string,
    private readonly name?: string,
  ) {}

  get #ctx() {
    return this.host.ctx;
  }

  start() {
    if (this.name) this.#ctx.print('ping.startNamed', { name: this.name, target: this.target, size: PING_SIZE });
    else this.#ctx.print('ping.start', { target: this.target, size: PING_SIZE });
    this.#send();
  }

  cancel() {
    this.#cancelled = true;
  }

  #send() {
    if (this.#cancelled) return;
    const seq = ++this.#seq;
    this.#outstanding.set(seq, this.#ctx.now);
    this.#ctx.schedule(PING_TIMEOUT, () => {
      if (this.#settle(seq)) this.#ctx.print('ping.timeout');
    });
    const request: IcmpMessage = { kind: 'icmp', type: 'echoRequest', id: this.id, seq, size: PING_SIZE };
    this.host.sendIp(this.target, request, {}, (error) => {
      if (this.#settle(seq)) this.#ctx.print(`ping.${error}`, { target: this.target, gateway: this.gateway });
    });
  }

  onIcmp(packet: Ipv4Packet) {
    const icmp = packet.payload;
    if (icmp.kind !== 'icmp') return;
    if (icmp.type === 'echoReply') {
      if (icmp.id !== this.id) return;
      const sentAt = this.#outstanding.get(icmp.seq);
      if (sentAt === undefined || !this.#settle(icmp.seq)) return;
      this.#received++;
      this.#ctx.print('ping.reply', { from: packet.src, size: icmp.size, time: this.#ctx.now - sentAt, ttl: packet.ttl });
      return;
    }
    // Ein Router meldet, dass unsere Anfrage nicht zugestellt werden konnte.
    const original = icmp.original;
    if (!original || original.id !== this.id || !this.#settle(original.seq)) return;
    if (icmp.type === 'timeExceeded') this.#ctx.print('ping.ttlExpired', { from: packet.src });
    else this.#ctx.print(icmp.code === 'host' ? 'ping.hostUnreachableFrom' : 'ping.netUnreachableFrom', { from: packet.src });
  }

  /** Schliesst eine Anfrage ab (genau einmal) und plant die nächste. */
  #settle(seq: number): boolean {
    if (this.#cancelled || !this.#outstanding.delete(seq)) return false;
    if (this.#seq < PING_COUNT) this.#ctx.schedule(PING_INTERVAL, () => this.#send());
    else this.#ctx.schedule(0, () => this.#finish());
    return true;
  }

  #finish() {
    if (this.#cancelled) return;
    const sent = this.#seq;
    const lost = sent - this.#received;
    this.#ctx.print('ping.summary', {
      target: this.target,
      sent,
      received: this.#received,
      lost,
      percent: Math.round((lost / sent) * 100),
    });
  }
}

/**
 * "tracert": Echo-Anfragen mit TTL 1, 2, 3 …; jeder Router auf dem Weg
 * verwirft das Paket bei TTL 0 und verrät sich mit "TTL abgelaufen".
 */
export class TracerouteRun implements IcmpApp {
  #hop = 0;
  #sentAt = 0;
  #done = false;

  constructor(
    private readonly host: IcmpHost,
    private readonly target: string,
    private readonly id: number,
    private readonly name?: string,
  ) {}

  get #ctx() {
    return this.host.ctx;
  }

  start() {
    if (this.name) this.#ctx.print('tracert.startNamed', { name: this.name, target: this.target, max: TRACE_MAX_HOPS });
    else this.#ctx.print('tracert.start', { target: this.target, max: TRACE_MAX_HOPS });
    this.#next();
  }

  cancel() {
    this.#done = true;
  }

  #next() {
    if (this.#done) return;
    if (this.#hop >= TRACE_MAX_HOPS) return this.#finish();
    const hop = ++this.#hop;
    this.#sentAt = this.#ctx.now;
    this.#ctx.schedule(TRACE_TIMEOUT, () => {
      if (this.#done || this.#hop !== hop) return;
      this.#ctx.print('tracert.timeout', { hop });
      this.#next();
    });
    const probe: IcmpMessage = { kind: 'icmp', type: 'echoRequest', id: this.id, seq: hop, size: PING_SIZE };
    this.host.sendIp(this.target, probe, { ttl: hop }, (error) => {
      if (this.#done || this.#hop !== hop) return;
      this.#ctx.print(`ping.${error}`, { target: this.target });
      this.#finish();
    });
  }

  onIcmp(packet: Ipv4Packet) {
    const icmp = packet.payload;
    if (this.#done || icmp.kind !== 'icmp') return;
    const matches =
      icmp.type === 'echoReply' ? icmp.id === this.id && icmp.seq === this.#hop : icmp.original?.id === this.id && icmp.original.seq === this.#hop;
    if (!matches) return;
    const line = { hop: this.#hop, time: this.#ctx.now - this.#sentAt, from: packet.src };
    if (icmp.type === 'timeExceeded') {
      this.#ctx.print('tracert.hop', line);
      this.#next();
    } else if (icmp.type === 'echoReply') {
      this.#ctx.print('tracert.hop', line);
      this.#finish();
    } else {
      this.#ctx.print(icmp.code === 'host' ? 'tracert.hostUnreachable' : 'tracert.netUnreachable', line);
      this.#finish();
    }
  }

  #finish() {
    if (this.#done) return;
    this.#done = true;
    this.#ctx.print('tracert.done');
  }
}
