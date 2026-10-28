import { DEVICE_SPECS } from '../model/devices';
import { cableAt, getCable, getDevice, otherEnd } from '../model/topology';
import type { Device, Endpoint, Topology } from '../model/types';
import { runCommand } from './commands';
import type { LeaseRecord } from './dhcp';
import type { EthernetFrame } from './frames';
import type { DnsCacheEntry } from './dns';
import { HostNode, type AddressState, type ConnectionInfo } from './host';
import type { BrowserState } from './http';
import type { MailClientState } from './mail';
import { InternetNode, RouterNode, type ArpEntry, type NatEntry } from './ip';
import { EventQueue } from './queue';
import { ModemNode, SwitchNode, type MacEntry, type StpState } from './switch';

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
  /** "lost": Rahmen kam nicht an, siehe `lostBecause`. */
  status: 'inTransit' | 'delivered' | 'lost';
  /** "removed": Kabel während der Übertragung entfernt; "damaged": beschädigtes Kabel. */
  lostBecause?: 'removed' | 'damaged';
}

/** Kleiner, schneller Zufallsgenerator mit festem Startwert (Mulberry32): gleiche Abläufe, gleiche Verluste. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = state;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
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
  address?: AddressState;
  dhcpLeases?: LeaseRecord[];
  dnsCache?: DnsCacheEntry[];
  connections?: ConnectionInfo[];
  browser?: BrowserState;
  mail?: MailClientState;
  mailboxes?: { user: string; count: number }[];
  nat?: NatEntry[];
  stp?: StpState;
}

/** Was ein Gerät von der Simulation sehen und auslösen darf. */
export interface NodeContext {
  readonly now: number;
  device(): Device | undefined;
  /** Gesamte Topologie, z.B. damit ein Switch weiss, was an seinen Ports hängt. */
  topology(): Topology;
  schedule(delay: number, run: () => void): void;
  transmit(iface: number, frame: EthernetFrame): boolean;
  isConnected(iface: number): boolean;
  print(code: string, params?: ConsoleLine['params']): void;
  clearConsole(): void;
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
  #inFlight = new Set<PacketLogEntry>();
  #nextLogId = 1;
  #nodes = new Map<string, SimNode>();
  #consoles = new Map<string, ConsoleLine[]>();
  #random = seededRandom(20_260_001);

  constructor(topology: Topology) {
    this.#topology = topology;
    this.#bootDhcpClients();
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
    this.#bootDhcpClients();
  }

  /** Wie beim Einschalten: Switches mit STP beginnen BPDUs zu senden, DHCP-Clients fragen nach einer Adresse. */
  #bootDhcpClients() {
    for (const device of this.#topology.devices) {
      if (device.type === 'switch' && device.stp) {
        const node = this.#node(device.id);
        if (node instanceof SwitchNode) node.start();
      }
    }
    for (const device of this.#topology.devices) {
      if (device.dhcp && DEVICE_SPECS[device.type].role === 'endpoint') this.#host(device.id)?.ensureDhcp();
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

  /** Rahmen, die gerade über ein Kabel unterwegs sind (für die Animation). */
  getInFlight(): PacketLogEntry[] {
    return [...this.#inFlight];
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
    this.#host(deviceId)?.ping(target);
  }

  traceroute(deviceId: string, target: string) {
    this.#host(deviceId)?.traceroute(target);
  }

  /** Ruft im Webbrowser des Geräts eine URL auf, z.B. "http://webserver1/index.html". */
  browse(deviceId: string, url: string) {
    this.#host(deviceId)?.browse(url);
  }

  /** E-Mail-Programm: Nachricht über den SMTP-Server des Kontos senden. */
  sendMail(deviceId: string, message: { to: string[]; subject: string; body: string }) {
    this.#host(deviceId)?.mail.send(message);
  }

  /** E-Mail-Programm: Posteingang per POP3 oder IMAP abholen. */
  fetchMail(deviceId: string) {
    this.#host(deviceId)?.mail.fetch();
  }

  /** Führt eine Zeile der simulierten Befehlszeile aus, z.B. "ipconfig /renew". */
  runCommand(deviceId: string, line: string) {
    const host = this.#host(deviceId);
    if (host) runCommand(host, line);
  }

  #host(id: string): HostNode | undefined {
    const node = this.#node(id);
    return node instanceof HostNode ? node : undefined;
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
            : device.type === 'internet'
              ? new InternetNode(ctx)
              : new HostNode(ctx);
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
      topology: () => sim.#topology,
      schedule: (delay, run) => sim.#queue.push(sim.#now + delay, run),
      transmit: (iface, frame) => sim.#transmit({ device: id, iface }, frame),
      isConnected: (iface) => cableAt(sim.#topology, { device: id, iface }) !== undefined,
      print: (code, params) => {
        const lines = sim.#consoles.get(id) ?? [];
        lines.push({ time: sim.#now, code, params });
        sim.#consoles.set(id, lines.slice(-CONSOLE_LIMIT));
      },
      clearConsole: () => sim.#consoles.delete(id),
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
    this.#inFlight.add(entry);
    // Beschädigtes Kabel: Die Entscheidung fällt beim Senden, damit die Reihenfolge der Zufallszahlen feststeht.
    const damaged = (cable.loss ?? 0) > 0 && this.#random() * 100 < cable.loss!;

    this.#queue.push(entry.arrives, () => {
      this.#inFlight.delete(entry);
      // Wurde das Kabel inzwischen entfernt oder umgesteckt, geht der Rahmen verloren.
      const current = getCable(this.#topology, cable.id);
      const intact = current && cableAt(this.#topology, from)?.id === cable.id && cableAt(this.#topology, to)?.id === cable.id;
      if (!intact || damaged) {
        entry.status = 'lost';
        entry.lostBecause = intact ? 'damaged' : 'removed';
        return;
      }
      entry.status = 'delivered';
      this.#node(to.device)?.receive(to.iface, frame);
    });
    return true;
  }
}
