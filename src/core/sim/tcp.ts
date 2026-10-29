import type { TcpFlag, TcpSegment } from './frames';
import type { SendError, SendOptions } from './ip';
import type { NodeContext } from './simulation';

/** Höchstens so viele Bytes pro Segment (Ethernet-MTU 1500 − 20 IP − 20 TCP); längere Daten werden aufgeteilt. */
export const MSS = 1460;
/** Wiederholung eines unbestätigten Segments nach 1 s, höchstens 3-mal. */
export const RTO = 1000;
export const MAX_RETRIES = 3;
export const EPHEMERAL_PORT_START = 49152;

export type TcpState =
  | 'SYN_SENT'
  | 'SYN_RECEIVED'
  | 'ESTABLISHED'
  | 'FIN_WAIT_1'
  | 'FIN_WAIT_2'
  | 'CLOSE_WAIT'
  | 'LAST_ACK'
  | 'CLOSING'
  | 'CLOSED';

export type TcpError = 'refused' | 'timeout' | 'reset' | SendError;

export interface TcpHandlers {
  onOpen?(conn: TcpConnection): void;
  onData?(conn: TcpConnection, data: string): void;
  /** Gegenseite hat FIN gesendet: von dort kommen keine Daten mehr. */
  onEnd?(conn: TcpConnection): void;
  onClose?(conn: TcpConnection): void;
  onError?(conn: TcpConnection, error: TcpError): void;
}

export interface TcpAddress {
  ip: string;
  port: number;
}

/** Was der TCP-Stack vom Endgerät braucht. */
export interface TcpHost {
  readonly ctx: NodeContext;
  sendIp(dst: string, payload: TcpSegment, options?: SendOptions, onError?: (e: SendError) => void): void;
  /** Eigene Adresse für Verbindungen zu `remote`, oder null ohne Adresse/Route. */
  localIpFor(remote: string): string | null;
}

interface Unacked {
  segment: TcpSegment;
  /** Erste Sequenznummer nach diesem Segment (SYN und FIN zählen je 1). */
  end: number;
  retries: number;
}

const length = (s: TcpSegment) => s.data.length + (s.flags.includes('SYN') ? 1 : 0) + (s.flags.includes('FIN') ? 1 : 0);

export class TcpConnection {
  state: TcpState;
  #sndNxt: number;
  #rcvNxt = 0;
  #unacked: Unacked[] = [];
  #pendingWrites: string[] = [];
  #closeRequested = false;
  #finSent = false;

  constructor(
    private readonly stack: TcpStack,
    readonly local: TcpAddress,
    readonly remote: TcpAddress,
    readonly iss: number,
    public handlers: TcpHandlers,
    state: TcpState,
  ) {
    this.state = state;
    this.#sndNxt = iss;
  }

  get #ctx() {
    return this.stack.host.ctx;
  }

  /** Aktiver Aufbau: SYN senden. */
  open() {
    this.#send(['SYN'], '');
  }

  /** Passiver Aufbau: auf ein empfangenes SYN mit SYN-ACK antworten. */
  accept(syn: TcpSegment) {
    this.#rcvNxt = syn.seq + 1;
    this.#send(['SYN', 'ACK'], '');
  }

  write(data: string) {
    if (this.state === 'SYN_SENT' || this.state === 'SYN_RECEIVED') {
      this.#pendingWrites.push(data);
      return;
    }
    if (this.state !== 'ESTABLISHED' && this.state !== 'CLOSE_WAIT') return;
    for (let i = 0; i < data.length; i += MSS) this.#send(['PSH', 'ACK'], data.slice(i, i + MSS));
  }

  /** Eigene Richtung schliessen (FIN), nachdem alle Daten gesendet sind. */
  close() {
    this.#closeRequested = true;
    if (this.state === 'SYN_SENT' || this.state === 'SYN_RECEIVED' || this.#finSent) return;
    if (this.state === 'ESTABLISHED') this.state = 'FIN_WAIT_1';
    else if (this.state === 'CLOSE_WAIT') this.state = 'LAST_ACK';
    else return;
    this.#finSent = true;
    this.#send(['FIN', 'ACK'], '');
  }

  #send(flags: TcpFlag[], data: string) {
    const segment: TcpSegment = {
      kind: 'tcp',
      srcPort: this.local.port,
      dstPort: this.remote.port,
      seq: this.#sndNxt,
      ack: flags.includes('ACK') ? this.#rcvNxt : 0,
      flags,
      data,
    };
    const size = length(segment);
    this.#sndNxt += size;
    if (size > 0) {
      const entry: Unacked = { segment, end: this.#sndNxt, retries: 0 };
      this.#unacked.push(entry);
      this.#armTimer(entry);
    }
    this.stack.transmit(this, segment);
  }

  #sendAck() {
    this.stack.transmit(this, {
      kind: 'tcp',
      srcPort: this.local.port,
      dstPort: this.remote.port,
      seq: this.#sndNxt,
      ack: this.#rcvNxt,
      flags: ['ACK'],
      data: '',
    });
  }

  #armTimer(entry: Unacked) {
    this.#ctx.schedule(RTO, () => {
      if (!this.#unacked.includes(entry) || this.state === 'CLOSED') return;
      if (entry.retries >= MAX_RETRIES) return this.fail('timeout');
      entry.retries++;
      const flags = entry.segment.flags;
      // Wiederholung mit aktueller Bestätigungsnummer.
      this.stack.transmit(this, { ...entry.segment, ack: flags.includes('ACK') ? this.#rcvNxt : 0 });
      this.#armTimer(entry);
    });
  }

  fail(error: TcpError) {
    if (this.state === 'CLOSED') return;
    this.state = 'CLOSED';
    this.#unacked = [];
    this.stack.remove(this);
    this.handlers.onError?.(this, error);
  }

  #finish() {
    this.state = 'CLOSED';
    this.#unacked = [];
    this.stack.remove(this);
    this.handlers.onClose?.(this);
  }

  receive(segment: TcpSegment) {
    const flags = new Set(segment.flags);
    if (flags.has('RST')) return this.fail(this.state === 'SYN_SENT' ? 'refused' : 'reset');

    if (this.state === 'SYN_SENT') {
      if (!flags.has('SYN') || !flags.has('ACK') || segment.ack !== this.iss + 1) return;
      this.#rcvNxt = segment.seq + 1;
      this.#acknowledge(segment.ack);
      this.state = 'ESTABLISHED';
      this.#sendAck();
      return this.#opened();
    }

    if (flags.has('ACK')) this.#acknowledge(segment.ack);
    if (this.state === 'SYN_RECEIVED') {
      if (!flags.has('ACK') || segment.ack !== this.iss + 1) return;
      this.state = 'ESTABLISHED';
      this.#opened();
    }

    let mustAck = false;
    if (segment.data.length > 0) {
      mustAck = true;
      // Nur lückenlos Anschliessendes annehmen; sonst bestätigt das ACK, was noch fehlt.
      if (segment.seq === this.#rcvNxt) {
        this.#rcvNxt += segment.data.length;
        this.handlers.onData?.(this, segment.data);
      }
    }
    if (flags.has('FIN') && segment.seq + segment.data.length === this.#rcvNxt) {
      this.#rcvNxt += 1;
      mustAck = true;
      if (this.state === 'ESTABLISHED') this.state = 'CLOSE_WAIT';
      else if (this.state === 'FIN_WAIT_1') this.state = 'CLOSING';
      else if (this.state === 'FIN_WAIT_2') {
        this.#sendAck();
        this.handlers.onEnd?.(this);
        return this.#finish();
      }
      this.#sendAck();
      this.handlers.onEnd?.(this);
      if (this.#closeRequested && this.state === 'CLOSE_WAIT') this.close();
      return;
    }
    if (mustAck) this.#sendAck();
  }

  #acknowledge(ack: number) {
    this.#unacked = this.#unacked.filter((u) => u.end > ack);
    if (this.#finSent && ack >= this.#sndNxt) {
      if (this.state === 'FIN_WAIT_1') this.state = 'FIN_WAIT_2';
      else if (this.state === 'LAST_ACK' || this.state === 'CLOSING') this.#finish();
    }
  }

  #opened() {
    this.handlers.onOpen?.(this);
    const writes = this.#pendingWrites;
    this.#pendingWrites = [];
    for (const data of writes) this.write(data);
    if (this.#closeRequested) this.close();
  }
}

/** Alle TCP-Verbindungen eines Endgeräts und seine offenen (lauschenden) Ports. */
export class TcpStack {
  #connections = new Map<string, TcpConnection>();
  #listeners = new Map<number, (conn: TcpConnection) => TcpHandlers | null>();
  #nextPort = EPHEMERAL_PORT_START;
  #issCounter = 0;

  constructor(
    readonly host: TcpHost,
    private readonly seed: number,
  ) {}

  /** Anfangssequenznummer: deterministisch statt zufällig, damit Abläufe wiederholbar sind. */
  #nextIss() {
    return this.seed * 10_000 + ++this.#issCounter * 1000;
  }

  /** Der Annahme-Callback darf null liefern (Dienst gerade aus): dann wird abgewiesen. */
  listen(port: number, accept: (conn: TcpConnection) => TcpHandlers | null) {
    this.#listeners.set(port, accept);
  }

  connect(remoteIp: string, remotePort: number, handlers: TcpHandlers): TcpConnection | null {
    const localIp = this.host.localIpFor(remoteIp);
    if (!localIp) return null;
    const port = this.#nextPort++;
    if (this.#nextPort > 65535) this.#nextPort = EPHEMERAL_PORT_START;
    const conn = new TcpConnection(this, { ip: localIp, port }, { ip: remoteIp, port: remotePort }, this.#nextIss(), handlers, 'SYN_SENT');
    this.#connections.set(this.#key(conn.local.port, conn.remote), conn);
    conn.open();
    return conn;
  }

  connections(): TcpConnection[] {
    return [...this.#connections.values()];
  }

  receive(src: string, dst: string, segment: TcpSegment) {
    const remote = { ip: src, port: segment.srcPort };
    const conn = this.#connections.get(this.#key(segment.dstPort, remote));
    if (conn) return conn.receive(segment);
    const isSyn = segment.flags.includes('SYN') && !segment.flags.includes('ACK');
    const accept = isSyn ? this.#listeners.get(segment.dstPort) : undefined;
    if (accept) {
      const incoming = new TcpConnection(this, { ip: dst, port: segment.dstPort }, remote, this.#nextIss(), {}, 'SYN_RECEIVED');
      const handlers = accept(incoming);
      if (handlers) {
        incoming.handlers = handlers;
        this.#connections.set(this.#key(segment.dstPort, remote), incoming);
        incoming.accept(segment);
        return;
      }
    }
    // Kein Dienst an diesem Port: Verbindung zurückweisen (ausser auf RST selbst).
    if (segment.flags.includes('RST')) return;
    this.host.sendIp(src, {
      kind: 'tcp',
      srcPort: segment.dstPort,
      dstPort: segment.srcPort,
      seq: segment.flags.includes('ACK') ? segment.ack : 0,
      ack: segment.seq + length(segment),
      flags: ['RST', 'ACK'],
      data: '',
    }, { src: dst });
  }

  transmit(conn: TcpConnection, segment: TcpSegment) {
    this.host.sendIp(conn.remote.ip, segment, { src: conn.local.ip }, (error) => conn.fail(error));
  }

  remove(conn: TcpConnection) {
    this.#connections.delete(this.#key(conn.local.port, conn.remote));
  }

  #key(localPort: number, remote: TcpAddress) {
    return `${localPort}|${remote.ip}|${remote.port}`;
  }
}
