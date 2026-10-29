import { MODEM_WAN } from '../model/links';
import { cableAt, getDevice, otherEnd } from '../model/topology';
import type { ModemKind } from '../model/types';
import { ACCESS_PROFILES, nextSteps, stepIndex } from './access';
import { BROADCAST_MAC, STP_MAC, type EthernetFrame, type LinkControl, type StpBpdu } from './frames';
import type { NodeContext, SimNode } from './simulation';

/** Lebensdauer eines gelernten Eintrags (5 Minuten virtuelle Zeit). */
export const MAC_TTL = 300_000;

// Spanning Tree, vereinfacht und mit verkürzten Zeiten (Standard: 2 s, 20 s, 15 s).
export const STP_HELLO = 2000;
export const STP_MAX_AGE = 6000;
export const STP_FORWARD_DELAY = 2000;
export const STP_DEFAULT_PRIORITY = 32768;
/** Pfadkosten pro Verbindung (klassischer Wert für 100 Mbit/s). */
export const STP_PATH_COST = 19;
export const DEFAULT_VLAN = 1;

/**
 * Broadcast-Sturm: Kreist ein Rahmen in einer Schleife, leitet der Switch im
 * Sturm nur noch so viele Rahmen pro Zeitfenster weiter, damit die Simulation
 * bedienbar bleibt – echte Switches würden ihre Leitungen ganz füllen.
 */
export const STORM_WINDOW = 100;
export const STORM_THRESHOLD = 60;
/** So lange ohne kreisende Rahmen, dann gilt der Sturm als vorbei. */
export const STORM_QUIET = 1000;

export interface MacEntry {
  mac: string;
  port: number;
  vlan: number;
  expires: number;
}

/** Rolle eines Ports im Spanning Tree; "edge" = Endgerät angeschlossen (wie PortFast). */
export type PortRole = 'root' | 'designated' | 'alternate' | 'edge';
export type PortState = 'forwarding' | 'learning' | 'blocking';

export interface StpPortInfo {
  port: number;
  role: PortRole;
  state: PortState;
}

export interface StormState {
  /** Seit wann der Switch im Sturm ist (virtuelle Zeit). */
  since: number;
  /** Weitergeleitete Rahmen im letzten Zeitfenster. */
  rate: number;
}

export interface StpState {
  bridgeId: string;
  rootId: string;
  rootPort: number | null;
  rootCost: number;
  ports: StpPortInfo[];
}

interface Received {
  rootId: string;
  cost: number;
  bridgeId: string;
  portId: number;
  expires: number;
}

/** Bridge-IDs vergleichen: zuerst die Priorität, dann die MAC-Adresse (kleiner gewinnt). */
function compareId(a: string, b: string): number {
  const [pa = '0', ma = ''] = a.split('.');
  const [pb = '0', mb = ''] = b.split('.');
  return Number(pa) - Number(pb) || ma.localeCompare(mb);
}

/** Prioritätsvektor (Root, Kosten, Absender, Port): kleiner ist besser. */
type Vector = [rootId: string, cost: number, bridgeId: string, portId: number];

function compareVector(a: Vector, b: Vector): number {
  return compareId(a[0], b[0]) || a[1] - b[1] || compareId(a[2], b[2]) || a[3] - b[3];
}

/**
 * Lernender Switch mit VLANs und optionalem Spanning Tree.
 * VLANs: Access-Ports gehören zu einem VLAN, Trunks übertragen alle mit
 * 802.1Q-Tag (VLAN 1 ohne Tag). Die MAC-Tabelle gilt je VLAN.
 */
/** Lokaler Empfänger im Switch (VLAN-Interfaces eines Layer-3-Switches). */
export interface LocalPort {
  mac: string;
  has(vlan: number): boolean;
  deliver(vlan: number, frame: EthernetFrame): void;
}

export class SwitchNode implements SimNode {
  protected local: LocalPort | null = null;
  #table = new Map<string, MacEntry>();
  #received = new Map<number, Received>();
  #roles = new Map<number, PortRole>();
  #since = new Map<number, number>();
  #rootId = '';
  #rootPort: number | null = null;
  #rootCost = 0;
  #helloRunning = false;
  #windowStart = 0;
  #windowCount = 0;
  #lastRate = 0;
  #stormSince: number | null = null;
  #lastLoop = 0;
  #seen = new WeakMap<object, number>();

  constructor(private readonly ctx: NodeContext) {}

  /**
   * Schleifenerkennung: Kommt derselbe Rahmen (gleiche Nutzlast) ein zweites
   * Mal an, kreist er in einer Schleife. Der Switch leitet weiter wie ein echter
   * (der Sturm ist sichtbar), aber gedrosselt, damit die Simulation bedienbar bleibt.
   */
  #admit(frame: EthernetFrame): boolean {
    const now = this.ctx.now;
    const seen = (this.#seen.get(frame.payload) ?? 0) + 1;
    this.#seen.set(frame.payload, seen);
    if (seen >= 2) {
      this.#lastLoop = now;
      if (this.#stormSince === null) {
        this.#stormSince = now;
        this.ctx.print('storm.detected');
      }
    } else if (this.#stormSince !== null && now - this.#lastLoop > STORM_QUIET) {
      this.#stormSince = null;
      this.ctx.print('storm.ended');
    }
    if (now - this.#windowStart >= STORM_WINDOW) {
      this.#lastRate = this.#windowCount;
      this.#windowStart = now;
      this.#windowCount = 0;
    }
    this.#windowCount++;
    return this.#stormSince === null || this.#windowCount <= STORM_THRESHOLD;
  }

  get storm(): StormState | null {
    return this.#stormSince === null ? null : { since: this.#stormSince, rate: Math.max(this.#lastRate, this.#windowCount) };
  }

  get #device() {
    return this.ctx.device();
  }

  get #stp(): boolean {
    return !!this.#device?.stp;
  }

  #bridgeId(): string {
    const device = this.#device;
    return `${device?.stpPriority ?? STP_DEFAULT_PRIORITY}.${device?.interfaces[0]?.mac ?? ''}`;
  }

  #isTrunk(port: number) {
    return !!this.#device?.interfaces[port]?.trunk;
  }

  #vlanOf(port: number) {
    return this.#device?.interfaces[port]?.vlan ?? DEFAULT_VLAN;
  }

  #member(port: number, vlan: number) {
    return this.#isTrunk(port) || this.#vlanOf(port) === vlan;
  }

  /** Am Port hängt ein Endgerät oder Router: keine Schleifengefahr, darum sofort weiterleiten. */
  #isEdge(port: number): boolean {
    const device = this.#device;
    if (!device) return true;
    const cable = cableAt(this.#topology(), { device: device.id, iface: port });
    if (!cable) return true;
    const peer = getDevice(this.#topology(), otherEnd(cable, device.id).device);
    return !peer || (peer.type !== 'switch' && peer.type !== 'l3switch' && peer.type !== 'modem' && peer.type !== 'accesspoint');
  }

  #topology() {
    return this.ctx.topology();
  }

  // --- Spanning Tree -----------------------------------------------------------

  boot() {
    this.start();
  }

  /** Startet die regelmässigen BPDUs (beim Start der Simulation). */
  start() {
    if (!this.#stp || this.#helloRunning) return;
    this.#helloRunning = true;
    const hello = () => {
      if (!this.#stp) {
        this.#helloRunning = false;
        return;
      }
      this.#recompute();
      this.#sendBpdus();
      this.ctx.schedule(STP_HELLO, hello);
    };
    this.ctx.schedule(0, hello);
  }

  #sendBpdus() {
    const device = this.#device;
    if (!device) return;
    const bridgeId = this.#bridgeId();
    for (const port of device.interfaces) {
      if (this.#roles.get(port.index) !== 'designated') continue;
      const bpdu: StpBpdu = { kind: 'stp', rootId: this.#rootId, cost: this.#rootCost, bridgeId, portId: port.index };
      this.ctx.transmit(port.index, { src: port.mac, dst: STP_MAC, payload: bpdu });
    }
  }

  #recompute() {
    const device = this.#device;
    if (!device) return;
    const now = this.ctx.now;
    for (const [port, info] of this.#received) {
      if (info.expires <= now || !this.ctx.isConnected(port)) this.#received.delete(port);
    }
    const me = this.#bridgeId();
    let best: Vector = [me, 0, me, -1];
    let rootPort: number | null = null;
    for (const [port, r] of this.#received) {
      const candidate: Vector = [r.rootId, r.cost + STP_PATH_COST, r.bridgeId, r.portId];
      if (compareId(r.rootId, me) < 0 && (rootPort === null || compareVector(candidate, best) < 0)) {
        best = candidate;
        rootPort = port;
      }
    }
    this.#rootId = best[0];
    this.#rootCost = rootPort === null ? 0 : best[1];
    this.#rootPort = rootPort;

    let changed = false;
    for (const port of device.interfaces) {
      if (!this.ctx.isConnected(port.index)) continue;
      let role: PortRole;
      if (this.#isEdge(port.index)) role = 'edge';
      else if (port.index === rootPort) role = 'root';
      else {
        const r = this.#received.get(port.index);
        const offer: Vector = [this.#rootId, this.#rootCost, me, port.index];
        role = !r || compareVector(offer, [r.rootId, r.cost, r.bridgeId, r.portId]) < 0 ? 'designated' : 'alternate';
      }
      if (this.#roles.get(port.index) !== role) {
        changed = true;
        this.#roles.set(port.index, role);
        this.#since.set(port.index, now);
      }
    }
    if (changed) {
      // Vereinfachte Topologieänderung: gelernte Adressen könnten auf blockierte Ports zeigen.
      this.#table.clear();
      this.ctx.print('stp.changed', { root: this.#rootId, rootPort: this.#rootPort === null ? '–' : this.#rootPort + 1 });
    }
  }

  #state(port: number): PortState {
    if (!this.#stp) return 'forwarding';
    const role = this.#roles.get(port) ?? (this.#isEdge(port) ? 'edge' : undefined);
    if (role === 'edge') return 'forwarding';
    if (role === undefined || role === 'alternate') return 'blocking';
    // Neue Root- und Designated-Ports warten die Weiterleitungsverzögerung ab, bevor sie weiterleiten.
    return this.ctx.now - (this.#since.get(port) ?? 0) >= STP_FORWARD_DELAY ? 'forwarding' : 'learning';
  }

  #onBpdu(port: number, bpdu: StpBpdu) {
    this.#received.set(port, { ...bpdu, expires: this.ctx.now + STP_MAX_AGE });
    this.#recompute();
  }

  // --- Weiterleiten -------------------------------------------------------------

  #send(port: number, frame: EthernetFrame, vlan: number) {
    // Auf Trunks mit Tag (ausser VLAN 1), auf Access-Ports immer ohne.
    const { vlan: _v, ...untagged } = frame;
    this.ctx.transmit(port, this.#isTrunk(port) && vlan !== DEFAULT_VLAN ? { ...untagged, vlan } : untagged);
  }

  receive(inPort: number, frame: EthernetFrame) {
    const device = this.#device;
    if (!device) return;
    if (frame.payload.kind === 'stp' && this.#stp) return this.#onBpdu(inPort, frame.payload);
    if (!this.#admit(frame)) return;

    const inState = this.#state(inPort);
    if (inState === 'blocking') return;
    // Getaggte Rahmen gehören nur auf Trunks.
    if (!this.#isTrunk(inPort) && frame.vlan !== undefined) return;
    const vlan = this.#isTrunk(inPort) ? (frame.vlan ?? DEFAULT_VLAN) : this.#vlanOf(inPort);
    const now = this.ctx.now;
    this.#table.set(`${vlan}|${frame.src}`, { mac: frame.src, port: inPort, vlan, expires: now + MAC_TTL });
    if (inState === 'learning') return;

    // Layer-3-Switch: Rahmen an die eigene SVI gehen nach oben, Broadcasts zusätzlich.
    if (this.local?.has(vlan)) {
      if (frame.dst === this.local.mac) return this.local.deliver(vlan, frame);
      if (frame.dst === BROADCAST_MAC) this.local.deliver(vlan, frame);
    }

    const flood = frame.dst === BROADCAST_MAC || frame.dst === STP_MAC;
    const known = flood ? undefined : this.#table.get(`${vlan}|${frame.dst}`);
    if (known && known.expires > now && this.ctx.isConnected(known.port) && this.#state(known.port) === 'forwarding') {
      // Ziel hängt am selben Port wie der Absender: Der Rahmen hat sein Ziel schon erreicht.
      if (known.port !== inPort) this.#send(known.port, frame, vlan);
      return;
    }
    for (const port of device.interfaces) {
      if (port.index === inPort || !this.#member(port.index, vlan) || this.#state(port.index) !== 'forwarding') continue;
      this.#send(port.index, frame, vlan);
    }
  }

  /** Rahmen vom Switch selbst (SVI) ins VLAN schicken: bekannter Port oder an alle. */
  injectLocal(vlan: number, frame: EthernetFrame) {
    const device = this.#device;
    if (!device) return;
    const now = this.ctx.now;
    const known = frame.dst === BROADCAST_MAC ? undefined : this.#table.get(`${vlan}|${frame.dst}`);
    if (known && known.expires > now && this.ctx.isConnected(known.port) && this.#state(known.port) === 'forwarding') {
      this.#send(known.port, frame, vlan);
      return;
    }
    for (const port of device.interfaces) {
      if (!this.#member(port.index, vlan) || this.#state(port.index) !== 'forwarding') continue;
      this.#send(port.index, frame, vlan);
    }
  }

  state(): object {
    const now = this.ctx.now;
    const macTable = [...this.#table.values()]
      .filter((e) => e.expires > now && this.ctx.isConnected(e.port))
      .sort((a, b) => a.vlan - b.vlan || a.port - b.port || a.mac.localeCompare(b.mac));
    const storm = this.storm;
    if (!this.#stp) return { macTable, ...(storm ? { storm } : {}) };
    const device = this.#device;
    const ports = (device?.interfaces ?? [])
      .filter((p) => this.ctx.isConnected(p.index))
      .map((p) => ({ port: p.index, role: this.#roles.get(p.index) ?? 'designated', state: this.#state(p.index) }));
    const stp: StpState = { bridgeId: this.#bridgeId(), rootId: this.#rootId || this.#bridgeId(), rootPort: this.#rootPort, rootCost: this.#rootCost, ports };
    return { macTable, stp, ...(storm ? { storm } : {}) };
  }
}

export interface ModemState {
  kind: ModemKind;
  standard: string;
  phase: 'idle' | 'connecting' | 'online';
  /** Erledigte Schritte des Verbindungsaufbaus. */
  progress: number;
  total: number;
  downstream: number;
  upstream: number;
}

/**
 * Modem: Brücke zwischen LAN-Buchse (Anschluss 0) und Zugangsleitung
 * (Anschluss 1). Mit Zugangstechnik baut es zuerst die Leitung zum Provider
 * auf (siehe access.ts) und überträgt erst danach Nutzdaten. Ohne Technik
 * (ältere Projekte) ist es eine reine Transportstrecke.
 */
export class ModemNode implements SimNode {
  #phase: ModemState['phase'] = 'idle';
  #progress = 0;
  #run = 0;

  constructor(private readonly ctx: NodeContext) {}

  #kind(): ModemKind | undefined {
    return this.ctx.device()?.modem?.kind;
  }

  boot() {
    const kind = this.#kind();
    if (!kind) return;
    if (!this.ctx.isConnected(MODEM_WAN)) {
      if (this.#phase !== 'idle') this.ctx.print('modem.down');
      this.#phase = 'idle';
      this.#progress = 0;
      this.#run++;
      return;
    }
    if (this.#phase !== 'idle') return;
    this.#phase = 'connecting';
    this.ctx.print('modem.connecting', { standard: ACCESS_PROFILES[kind].standard });
    if (ACCESS_PROFILES[kind].steps[0]?.from === 'cpe') this.#sendFrom(kind, 0);
  }

  /** Eigene Schritte ab `index` senden, jeweils nach ihrer Wartezeit. */
  #sendFrom(kind: ModemKind, index: number) {
    const steps = nextSteps(kind, index, 'cpe');
    const run = this.#run;
    let delay = 0;
    steps.forEach((step, i) => {
      delay += step.delay ?? 1;
      this.ctx.schedule(delay, () => {
        if (run !== this.#run) return;
        const mac = this.ctx.device()?.interfaces[MODEM_WAN]?.mac ?? '';
        const payload: LinkControl = { kind: 'link', tech: step.tech, message: step.message, ...(step.fields ? { fields: step.fields } : {}) };
        this.ctx.transmit(MODEM_WAN, { src: mac, dst: '', payload });
        this.#progress = index + i + 1;
        this.#checkDone(kind);
      });
    });
  }

  #checkDone(kind: ModemKind) {
    const total = ACCESS_PROFILES[kind].steps.length;
    if (this.#phase === 'connecting' && this.#progress >= total) {
      this.#phase = 'online';
      const p = ACCESS_PROFILES[kind];
      this.ctx.print('modem.online', { standard: p.standard, down: p.downstream, up: p.upstream });
    }
  }

  receive(inPort: number, frame: EthernetFrame) {
    const device = this.ctx.device();
    const kind = this.#kind();
    if (!kind) {
      for (const port of device?.interfaces ?? []) {
        if (port.index !== inPort) this.ctx.transmit(port.index, frame);
      }
      return;
    }
    if (frame.payload.kind === 'link') {
      if (inPort !== MODEM_WAN) return;
      const index = stepIndex(kind, frame.payload, 'provider');
      if (index < 0) return;
      if (this.#phase === 'idle') this.#phase = 'connecting';
      this.#progress = Math.max(this.#progress, index + 1);
      this.#checkDone(kind);
      if (ACCESS_PROFILES[kind].steps[index + 1]?.from === 'cpe') this.#sendFrom(kind, index + 1);
      return;
    }
    // Nutzdaten erst, wenn die Leitung steht.
    if (this.#phase !== 'online') return;
    const { access: _a, ...plain } = frame;
    this.ctx.transmit(inPort === MODEM_WAN ? 0 : MODEM_WAN, inPort === MODEM_WAN ? plain : frame);
  }

  state() {
    const kind = this.#kind();
    if (!kind) return {};
    const p = ACCESS_PROFILES[kind];
    const modem: ModemState = { kind, standard: p.standard, phase: this.#phase, progress: this.#progress, total: p.steps.length, downstream: p.downstream, upstream: p.upstream };
    return { modem };
  }
}
