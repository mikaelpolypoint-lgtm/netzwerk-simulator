import { cableAt, getCable, getDevice, otherEnd } from '../model/topology';
import type { Device, Endpoint, Topology } from '../model/types';
import type { EthernetFrame } from './frames';
import { IpNode, RouterNode, type ArpEntry } from './ip';
import { EventQueue } from './queue';
import { ModemNode, SwitchNode, type MacEntry } from './switch';

/** Übertragungszeit pro Kabel in Millisekunden (virtuelle Zeit). */
export const LINK_DELAY = 1;
const LOG_LIMIT = 5000;
const CONSOLE_LIMIT = 500;

export interface PacketLogEntry {
  id: number;
  sent: number;
  arrives: number;
  from: Endpoint;
  to: Endpoint;
  cable: string;
  frame: EthernetFrame;
  /** "lost": Das Kabel wurde während der Übertragung entfernt. */
  status: 'inTransit' | 'delivered' | 'lost';
}

/** Ausgabe einer Anwendung; Text entsteht erst in der Oberfläche aus Code und Parametern. */
export interface ConsoleLine {
  time: number;
  code: string;
  params?: Record<string, string | number>;
}

export interface DeviceState {
  console: ConsoleLine[];
  arp?: ArpEntry[];
  macTable?: MacEntry[];
}

/** Was ein Gerät von der Simulation sehen und auslösen darf. */
export interface NodeContext {
  readonly now: number;
  device(): Device | undefined;
  schedule(delay: number, run: () => void): void;
  transmit(iface: number, frame: EthernetFrame): boolean;
  isConnected(iface: number): boolean;
  print(code: string, params?: ConsoleLine['params']): void;
}

export interface SimNode {
  receive(iface: number, frame: EthernetFrame): void;
  state(): Omit<DeviceState, 'console'>;
}

/**
 * Diskrete Ereignis-Simulation. Die Oberfläche treibt die Zeit mit `runUntil`
 * oder `step` voran und liest Zustände ab; der Kern kennt die Oberfläche nicht.
 */
export class Simulation {
  #topology: Topology;
  #queue = new EventQueue();
  #now = 0;
  #log: PacketLogEntry[] = [];
  #nextLogId = 1;
  #nodes = new Map<string, SimNode>();
  #consoles = new Map<string, ConsoleLine[]>();

  constructor(topology: Topology) {
    this.#topology = topology;
  }

  get now(): number {
    return this.#now;
  }

  get topology(): Topology {
    return this.#topology;
  }

  /** Übernimmt eine geänderte Topologie; Zustände (z.B. ARP-Caches) bestehender Geräte bleiben erhalten. */
  updateTopology(topology: Topology) {
    this.#topology = topology;
    for (const id of [...this.#nodes.keys()]) {
      if (!getDevice(topology, id)) {
        this.#nodes.delete(id);
        this.#consoles.delete(id);
      }
    }
  }

  get idle(): boolean {
    return this.#queue.size === 0;
  }

  nextEventTime(): number | undefined {
    return this.#queue.peekTime();
  }

  /** Verarbeitet genau ein Ereignis. */
  step(): boolean {
    const event = this.#queue.pop();
    if (!event) return false;
    this.#now = event.time;
    event.run();
    return true;
  }

  /**
   * Lässt die Zeit bis `time` laufen; liefert die Anzahl verarbeiteter Ereignisse.
   * Höchstens `maxEvents` pro Aufruf, damit die Oberfläche auch bei sehr viel Verkehr bedienbar bleibt;
   * die Uhr bleibt dann beim letzten Ereignis stehen und holt beim nächsten Aufruf auf.
   */
  runUntil(time: number, maxEvents = 20_000): number {
    let count = 0;
    for (let next = this.#queue.peekTime(); next !== undefined && next <= time; next = this.#queue.peekTime()) {
      if (count >= maxEvents) return count;
      this.step();
      count++;
    }
    this.#now = Math.max(this.#now, time);
    return count;
  }

  /** Für Tests: alles abarbeiten, mit Obergrenze gegen Endlosschleifen. */
  runUntilIdle(maxEvents = 100_000) {
    for (let i = 0; i < maxEvents && this.step(); i++);
  }

  getPacketLog(): readonly PacketLogEntry[] {
    return this.#log;
  }

  clearPacketLog() {
    this.#log = [];
  }

  /** Momentaufnahme; spätere Änderungen der Simulation verändern sie nicht. */
  getDeviceState(id: string): DeviceState {
    const node = getDevice(this.#topology, id) ? this.#node(id) : undefined;
    return { console: [...(this.#consoles.get(id) ?? [])], ...node?.state() };
  }

  clearConsole(id: string) {
    this.#consoles.delete(id);
  }

  /** Startet "ping <ziel>" auf einem Endgerät. */
  ping(deviceId: string, target: string) {
    const node = this.#node(deviceId);
    if (node instanceof IpNode) node.ping(target);
  }

  #node(id: string): SimNode | undefined {
    const existing = this.#nodes.get(id);
    if (existing) return existing;
    const device = getDevice(this.#topology, id);
    if (!device) return undefined;
    const ctx = this.#context(id);
    const node: SimNode =
      device.type === 'switch'
        ? new SwitchNode(ctx)
        : device.type === 'modem'
          ? new ModemNode(ctx)
          : device.type === 'router'
            ? new RouterNode(ctx)
            : new IpNode(ctx);
    this.#nodes.set(id, node);
    return node;
  }

  #context(id: string): NodeContext {
    const sim = this;
    return {
      get now() {
        return sim.#now;
      },
      device: () => getDevice(sim.#topology, id),
      schedule: (delay, run) => sim.#queue.push(sim.#now + delay, run),
      transmit: (iface, frame) => sim.#transmit({ device: id, iface }, frame),
      isConnected: (iface) => cableAt(sim.#topology, { device: id, iface }) !== undefined,
      print: (code, params) => {
        const lines = sim.#consoles.get(id) ?? [];
        lines.push({ time: sim.#now, code, params });
        sim.#consoles.set(id, lines.slice(-CONSOLE_LIMIT));
      },
    };
  }

  #transmit(from: Endpoint, frame: EthernetFrame): boolean {
    const cable = cableAt(this.#topology, from);
    if (!cable) return false;
    const to = otherEnd(cable, from.device);
    const entry: PacketLogEntry = {
      id: this.#nextLogId++,
      sent: this.#now,
      arrives: this.#now + LINK_DELAY,
      from,
      to,
      cable: cable.id,
      frame,
      status: 'inTransit',
    };
    this.#log.push(entry);
    if (this.#log.length > LOG_LIMIT) this.#log.splice(0, this.#log.length - LOG_LIMIT);

    this.#queue.push(entry.arrives, () => {
      // Wurde das Kabel inzwischen entfernt oder umgesteckt, geht der Rahmen verloren.
      const current = getCable(this.#topology, cable.id);
      const intact = current && cableAt(this.#topology, from)?.id === cable.id && cableAt(this.#topology, to)?.id === cable.id;
      if (!intact) {
        entry.status = 'lost';
        return;
      }
      entry.status = 'delivered';
      this.#node(to.device)?.receive(to.iface, frame);
    });
    return true;
  }
}
