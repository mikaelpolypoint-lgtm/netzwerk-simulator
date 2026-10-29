import type { PppControl } from './frames';
import type { NodeContext } from './simulation';

/** Wiederholung einer unbeantworteten Configure-Request (Restart-Timer, RFC 1661: 3 s). */
export const PPP_RESTART = 3000;
export const PPP_MAX_CONFIGURE = 10;

type Phase = 'lcp' | 'ipcp' | 'opened';

interface LinkState {
  phase: Phase;
  /** Eigene Anfrage wurde bestätigt. */
  acked: boolean;
  /** Anfrage der Gegenseite wurde bestätigt. */
  ackSent: boolean;
  id: number;
  tries: number;
  magic: number;
}

export interface PppStatus {
  port: number;
  phase: Phase;
}

/**
 * PPP auf seriellen Leitungen (RFC 1661, 1332), vereinfacht: Beide Seiten
 * senden eine Configure-Request und bestätigen die der Gegenseite mit
 * Configure-Ack – zuerst für LCP (Verbindung), dann für IPCP (IP-Adressen).
 * Erst wenn IPCP offen ist, fliessen IP-Pakete.
 */
export class PppLinks {
  #links = new Map<number, LinkState>();

  constructor(
    private readonly ctx: NodeContext,
    private readonly send: (port: number, control: PppControl) => void,
    private readonly ownIp: (port: number) => string | undefined,
    private readonly magicBase: number,
  ) {}

  isOpen(port: number): boolean {
    return this.#links.get(port)?.phase === 'opened';
  }

  status(): PppStatus[] {
    return [...this.#links.entries()].map(([port, s]) => ({ port, phase: s.phase }));
  }

  /** Leitung (neu) aushandeln, z.B. beim Start der Simulation oder nach dem Einstecken. */
  start(port: number) {
    if (this.#links.has(port)) return;
    const state: LinkState = { phase: 'lcp', acked: false, ackSent: false, id: 1, tries: 0, magic: (this.magicBase * 7919 + port * 104729) >>> 0 };
    this.#links.set(port, state);
    this.#request(port, state);
  }

  /** Leitung unterbrochen: alles zurück auf Anfang. */
  reset(port: number) {
    this.#links.delete(port);
  }

  #request(port: number, state: LinkState) {
    if (!this.ctx.isConnected(port)) {
      this.#links.delete(port);
      return;
    }
    state.tries++;
    const control: PppControl =
      state.phase === 'lcp'
        ? { kind: 'ppp', protocol: 'lcp', code: 'configureRequest', id: state.id, magic: state.magic }
        : { kind: 'ppp', protocol: 'ipcp', code: 'configureRequest', id: state.id, ip: this.ownIp(port) ?? '0.0.0.0' };
    this.send(port, control);
    const phase = state.phase;
    const id = state.id;
    this.ctx.schedule(PPP_RESTART, () => {
      const now = this.#links.get(port);
      if (now !== state || now.phase !== phase || now.id !== id || now.acked) return;
      if (now.tries >= PPP_MAX_CONFIGURE) return;
      this.#request(port, now);
    });
  }

  receive(port: number, control: PppControl) {
    let state = this.#links.get(port);
    if (!state) {
      // Die Gegenseite beginnt: selbst auch aushandeln.
      this.start(port);
      state = this.#links.get(port)!;
    }
    const phase = control.protocol;
    if (control.code === 'configureRequest') {
      // Eine neue LCP-Anfrage mitten im Betrieb heisst: Gegenseite hat neu gestartet.
      if (phase === 'lcp' && state.phase !== 'lcp') {
        this.#links.delete(port);
        this.start(port);
        state = this.#links.get(port)!;
      }
      if (phase !== state.phase) return;
      this.send(port, { ...control, code: 'configureAck' });
      state.ackSent = true;
    } else if (control.code === 'configureAck') {
      if (phase !== state.phase || control.id !== state.id) return;
      state.acked = true;
    } else if (control.code === 'echoRequest') {
      this.send(port, { ...control, code: 'echoReply' });
      return;
    } else {
      return;
    }
    if (state.acked && state.ackSent) this.#advance(port, state);
  }

  #advance(port: number, state: LinkState) {
    if (state.phase === 'lcp') {
      this.ctx.print('ppp.lcpOpen', { port });
      state.phase = 'ipcp';
    } else if (state.phase === 'ipcp') {
      state.phase = 'opened';
      this.ctx.print('ppp.up', { port });
      return;
    }
    state.acked = false;
    state.ackSent = false;
    state.id++;
    state.tries = 0;
    this.#request(port, state);
  }
}
