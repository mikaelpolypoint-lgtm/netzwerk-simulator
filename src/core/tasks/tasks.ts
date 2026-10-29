// Aufgaben: Lernziele mit automatischen Prüfungen. Es gibt nur fest
// definierte Prüfbausteine (kein ausführbarer Code in Aufgabendateien).
// Dynamische Prüfungen (Ping, HTTP, DHCP, E-Mail) laufen in einer eigenen,
// frischen Simulation des aktuellen Netzes und sind deshalb wiederholbar.

import { DEVICE_TYPES } from '../model/devices';
import { cablesOf, otherEnd, vlanColor } from '../model/topology';
import { linkStatus, mediumOf } from '../model/links';
import { costOf } from '../model/costs';
import { MEDIA, type Device, type DeviceType, type Medium, type Topology } from '../model/types';
import { formatIp, networkOf, parseIp, parseMask } from '../net/ipv4';
import { protocolOf } from '../sim/protocol';
import { Simulation, type PacketLogEntry } from '../sim/simulation';

export type Check =
  | { type: 'deviceCount'; deviceType?: DeviceType; min?: number; max?: number }
  | { type: 'connected'; a: string; b: string }
  | { type: 'inNetwork'; device: string; network: string }
  | { type: 'sameNetwork'; devices: string[] }
  | { type: 'differentNetworks'; devices: string[] }
  | { type: 'gateway'; device: string; gateway?: string }
  | { type: 'ping'; from: string; to: string }
  /** Gegenprobe: Der Ping darf NICHT ankommen (z.B. VLANs trennen). */
  | { type: 'noPing'; from: string; to: string }
  | { type: 'http'; from: string; url: string; status?: number }
  | { type: 'dhcpLease'; device: string }
  | { type: 'mail'; from: string; to: string }
  | { type: 'packetSeen'; protocol: string; from?: string; to?: string }
  /** Router hat ein Netz über ein Routingprotokoll gelernt (oder überhaupt eine Route dorthin). */
  | { type: 'routeLearned'; device: string; network: string; protocol?: 'ospf' | 'rip' | 'bgp' }
  /** So viele OSPF-Nachbarn «Full» bzw. BGP-Sitzungen «Established». */
  | { type: 'neighbors'; device: string; protocol: 'ospf' | 'bgp'; min?: number }
  /** Kein Broadcast-Sturm (Schleifen nur mit Spanning Tree). */
  | { type: 'noStorm' }
  /** Modem hat seine Zugangsleitung aufgebaut. */
  | { type: 'modemOnline'; device: string }
  /** Alle (oder mindestens `min`) Rechner der Client-Gruppe haben eine Adresse. */
  | { type: 'groupLeases'; device: string; min?: number }
  /** Gesamtkosten höchstens so viele CHF. */
  | { type: 'budget'; max: number }
  /** Direkte Verbindung zwischen zwei Geräten ist aktiv (optional mit bestimmtem Medium). */
  | { type: 'linkUp'; a: string; b: string; medium?: Medium }
  /** VLAN ist mit Farbe dokumentiert. */
  | { type: 'vlanDocumented'; vlan: number };

export const CHECK_TYPES = [
  'deviceCount',
  'connected',
  'inNetwork',
  'sameNetwork',
  'differentNetworks',
  'gateway',
  'ping',
  'noPing',
  'http',
  'dhcpLease',
  'mail',
  'packetSeen',
  'routeLearned',
  'neighbors',
  'noStorm',
  'modemOnline',
  'groupLeases',
  'budget',
  'linkUp',
  'vlanDocumented',
] as const satisfies readonly Check['type'][];

export interface Goal {
  id: string;
  /** Lernziel in Worten, wie es die Lernenden sehen. */
  text: string;
  check: Check;
  /** Hinweis, der bei nicht erfülltem Ziel angezeigt wird. */
  hint?: string;
}

export interface TaskSet {
  title: string;
  description?: string;
  /** Schwierigkeit von 1 (einfach) bis 5 (anspruchsvoll) Sternen. */
  difficulty?: number;
  goals: Goal[];
}

export interface GoalResult {
  id: string;
  passed: boolean;
  /** Warum nicht erfüllt; die Oberfläche übersetzt den Code. */
  reason?: { code: string; params?: Record<string, string | number> };
}

/** Wie lange eine Prüf-Simulation laufen darf (virtuelle Zeit): DHCP-Bezug, dann die Aktion. */
const BOOT_MS = 10_000;
/** Routingprotokolle brauchen etwas länger, bis sie sich gefunden haben. */
const CONVERGE_MS = 25_000;
const ACTION_MS = 15_000;

const fail = (id: string, code: string, params?: Record<string, string | number>): GoalResult => ({
  id,
  passed: false,
  reason: { code, ...(params ? { params } : {}) },
});

/** Geräte werden in Aufgaben über ihren Namen angesprochen (Gross-/Kleinschreibung egal). */
function byName(topology: Topology, name: string): Device | undefined {
  const wanted = name.trim().toLowerCase();
  return topology.devices.find((d) => d.name.toLowerCase() === wanted);
}

/** Netz eines Geräts aus seiner statischen Konfiguration, z.B. "192.168.1.0/24". */
function networkOfDevice(device: Device): string | null {
  const iface = device.interfaces[0];
  const ip = iface?.ip ? parseIp(iface.ip) : null;
  const prefix = iface?.mask ? parseMask(iface.mask) : null;
  return ip === null || prefix === null ? null : `${formatIp(networkOf(ip, prefix))}/${prefix}`;
}

function bootedSimulation(topology: Topology): Simulation {
  const sim = new Simulation(topology);
  sim.runUntil(BOOT_MS);
  return sim;
}

export function evaluateGoal(topology: Topology, goal: Goal, liveLog: readonly PacketLogEntry[] = []): GoalResult {
  const { id, check } = goal;
  const need = (name: string) => byName(topology, name);
  const missing = (name: string) => fail(id, 'deviceMissing', { name });

  switch (check.type) {
    case 'deviceCount': {
      const count = topology.devices.filter((d) => !check.deviceType || d.type === check.deviceType).length;
      if (check.min !== undefined && count < check.min) return fail(id, 'tooFewDevices', { count, min: check.min });
      if (check.max !== undefined && count > check.max) return fail(id, 'tooManyDevices', { count, max: check.max });
      return { id, passed: true };
    }
    case 'connected': {
      const a = need(check.a);
      const b = need(check.b);
      if (!a) return missing(check.a);
      if (!b) return missing(check.b);
      const linked = cablesOf(topology, a.id).some((c) => otherEnd(c, a.id).device === b.id);
      return linked ? { id, passed: true } : fail(id, 'notConnected', { a: a.name, b: b.name });
    }
    case 'inNetwork': {
      const device = need(check.device);
      if (!device) return missing(check.device);
      const actual = networkOfDevice(device);
      const [netText = '', prefixText = ''] = check.network.split('/');
      const wantedIp = parseIp(netText);
      const prefix = parseMask(prefixText);
      if (!actual) return fail(id, 'noAddress', { name: device.name });
      const wanted = wantedIp === null || prefix === null ? check.network : `${formatIp(networkOf(wantedIp, prefix))}/${prefix}`;
      return actual === wanted ? { id, passed: true } : fail(id, 'wrongNetwork', { name: device.name, actual, expected: wanted });
    }
    case 'sameNetwork':
    case 'differentNetworks': {
      const networks: string[] = [];
      for (const name of check.devices) {
        const device = need(name);
        if (!device) return missing(name);
        const net = networkOfDevice(device);
        if (!net) return fail(id, 'noAddress', { name: device.name });
        networks.push(net);
      }
      const distinct = new Set(networks).size;
      if (check.type === 'sameNetwork') return distinct === 1 ? { id, passed: true } : fail(id, 'notSameNetwork');
      return distinct === networks.length ? { id, passed: true } : fail(id, 'notDifferentNetworks');
    }
    case 'gateway': {
      const device = need(check.device);
      if (!device) return missing(check.device);
      if (!device.gateway) return fail(id, 'noGateway', { name: device.name });
      if (check.gateway && device.gateway !== check.gateway) {
        return fail(id, 'wrongGateway', { name: device.name, actual: device.gateway, expected: check.gateway });
      }
      return { id, passed: true };
    }
    case 'ping': {
      const from = need(check.from);
      if (!from) return missing(check.from);
      // Ziel als Gerätename (dann dessen Adresse), IP-Adresse oder DNS-Name.
      const targetDevice = need(check.to);
      const target = targetDevice ? targetDevice.interfaces[0]?.ip : check.to;
      if (targetDevice && !target && !targetDevice.dhcp) return fail(id, 'noAddress', { name: targetDevice.name });
      const sim = bootedSimulation(topology);
      const address = target ?? sim.getDeviceState(targetDevice!.id).address?.ip;
      if (!address) return fail(id, 'noAddress', { name: check.to });
      sim.ping(from.id, address);
      sim.runUntil(BOOT_MS + ACTION_MS);
      const lines = sim.getDeviceState(from.id).console;
      if (lines.some((l) => l.code === 'ping.reply')) return { id, passed: true };
      const last = lines.filter((l) => l.code !== 'ping.summary' && !l.code.startsWith('dhcp.')).at(-1);
      return fail(id, 'pingFailed', { from: from.name, to: check.to, detail: last?.code ?? '' });
    }
    case 'noPing': {
      const from = need(check.from);
      if (!from) return missing(check.from);
      const targetDevice = need(check.to);
      const sim = bootedSimulation(topology);
      const address = targetDevice ? (targetDevice.interfaces[0]?.ip ?? sim.getDeviceState(targetDevice.id).address?.ip) : check.to;
      // Ohne Adresse ist das Ziel ohnehin nicht erreichbar; das zählt aber nicht als gelöst.
      if (!address) return fail(id, 'noAddress', { name: check.to });
      sim.ping(from.id, address);
      sim.runUntil(BOOT_MS + ACTION_MS);
      const reached = sim.getDeviceState(from.id).console.some((l) => l.code === 'ping.reply');
      return reached ? fail(id, 'pingReached', { from: from.name, to: check.to }) : { id, passed: true };
    }
    case 'http': {
      const from = need(check.from);
      if (!from) return missing(check.from);
      const sim = bootedSimulation(topology);
      sim.browse(from.id, check.url);
      sim.runUntil(BOOT_MS + ACTION_MS);
      const browser = sim.getDeviceState(from.id).browser;
      const status = browser?.response?.status;
      if (browser?.status === 'done' && (check.status === undefined ? status === 200 : status === check.status)) {
        return { id, passed: true };
      }
      return fail(id, 'httpFailed', { url: check.url, detail: status ?? browser?.steps.at(-1)?.code ?? '' });
    }
    case 'dhcpLease': {
      const device = need(check.device);
      if (!device) return missing(check.device);
      if (!device.dhcp) return fail(id, 'notDhcp', { name: device.name });
      const ip = bootedSimulation(topology).getDeviceState(device.id).address?.ip;
      return ip ? { id, passed: true } : fail(id, 'noLease', { name: device.name });
    }
    case 'mail': {
      const from = need(check.from);
      if (!from) return missing(check.from);
      if (!from.mailAccount) return fail(id, 'noMailAccount', { name: from.name });
      const sim = bootedSimulation(topology);
      sim.sendMail(from.id, { to: [check.to], subject: 'Prüfung', body: 'Automatische Prüfung der Aufgabe.' });
      sim.runUntil(BOOT_MS + ACTION_MS);
      const sent = sim.getDeviceState(from.id).mail?.sent.at(-1);
      return sent?.ok ? { id, passed: true } : fail(id, 'mailFailed', { from: from.name, to: check.to });
    }
    case 'packetSeen': {
      // Prüft, was die Lernenden selbst im Aktionsmodus ausgelöst haben.
      const from = check.from ? need(check.from) : undefined;
      const to = check.to ? need(check.to) : undefined;
      if (check.from && !from) return missing(check.from);
      if (check.to && !to) return missing(check.to);
      const seen = liveLog.some(
        (e) =>
          protocolOf(e.frame) === check.protocol.toUpperCase() &&
          (!from || e.from.device === from.id) &&
          (!to || e.to.device === to.id),
      );
      return seen ? { id, passed: true } : fail(id, 'packetNotSeen', { protocol: check.protocol.toUpperCase() });
    }
    case 'routeLearned': {
      const device = need(check.device);
      if (!device) return missing(check.device);
      const [netText = '', prefixText = ''] = check.network.split('/');
      const network = parseIp(netText);
      const prefix = parseMask(prefixText);
      if (network === null || prefix === null) return fail(id, 'noRoute', { name: device.name, network: check.network });
      const sim = new Simulation(topology);
      sim.runUntil(CONVERGE_MS);
      const route = sim.getRoutes(device.id).find((r) => r.network === networkOf(network, prefix) && r.prefix === prefix && (!check.protocol || r.kind === check.protocol));
      return route ? { id, passed: true } : fail(id, 'noRoute', { name: device.name, network: check.network });
    }
    case 'neighbors': {
      const device = need(check.device);
      if (!device) return missing(check.device);
      const sim = new Simulation(topology);
      sim.runUntil(CONVERGE_MS);
      const state = sim.getDeviceState(device.id);
      const count =
        check.protocol === 'ospf'
          ? (state.ospf?.neighbors.filter((n) => n.state === 'full').length ?? 0)
          : (state.bgp?.filter((p) => p.state === 'established').length ?? 0);
      const min = check.min ?? 1;
      return count >= min ? { id, passed: true } : fail(id, 'tooFewNeighbors', { name: device.name, count, min, protocol: check.protocol.toUpperCase() });
    }
    case 'noStorm': {
      const sim = bootedSimulation(topology);
      // Broadcasts auslösen: jedes Endgerät fragt per ARP nach einer unbekannten Adresse.
      for (const d of topology.devices) if (d.type === 'pc' || d.type === 'notebook' || d.type === 'server') sim.ping(d.id, '255.255.255.254');
      sim.runUntil(BOOT_MS + 3000);
      const storming = sim.stormingDevices().map((sid) => topology.devices.find((d) => d.id === sid)?.name ?? sid);
      return storming.length ? fail(id, 'storm', { names: storming.join(', ') }) : { id, passed: true };
    }
    case 'modemOnline': {
      const device = need(check.device);
      if (!device) return missing(check.device);
      const modem = bootedSimulation(topology).getDeviceState(device.id).modem;
      return modem?.phase === 'online' ? { id, passed: true } : fail(id, 'modemOffline', { name: device.name });
    }
    case 'groupLeases': {
      const device = need(check.device);
      if (!device) return missing(check.device);
      const sim = new Simulation(topology);
      sim.runUntil(BOOT_MS + (device.groupSize ?? 0) * 25);
      const members = sim.getDeviceState(device.id).group ?? [];
      const withIp = members.filter((m) => m.ip).length;
      const min = check.min ?? members.length;
      return members.length > 0 && withIp >= min ? { id, passed: true } : fail(id, 'groupWithoutLease', { name: device.name, count: withIp, total: members.length });
    }
    case 'budget': {
      const total = costOf(topology).total;
      return total <= check.max ? { id, passed: true } : fail(id, 'overBudget', { total, max: check.max });
    }
    case 'linkUp': {
      const a = need(check.a);
      const b = need(check.b);
      if (!a) return missing(check.a);
      if (!b) return missing(check.b);
      const cable = cablesOf(topology, a.id).find((c) => otherEnd(c, a.id).device === b.id);
      if (!cable) return fail(id, 'notConnected', { a: a.name, b: b.name });
      if (check.medium && mediumOf(cable) !== check.medium) return fail(id, 'wrongMedium', { a: a.name, b: b.name, medium: check.medium });
      const status = linkStatus(topology, cable);
      return status.up ? { id, passed: true } : fail(id, 'linkDown', { a: a.name, b: b.name, reason: status.reason ?? '' });
    }
    case 'vlanDocumented': {
      return vlanColor(topology, check.vlan) ? { id, passed: true } : fail(id, 'vlanUndocumented', { vlan: check.vlan });
    }
  }
}

export function evaluateTasks(topology: Topology, tasks: TaskSet, liveLog: readonly PacketLogEntry[] = []): GoalResult[] {
  return tasks.goals.map((goal) => evaluateGoal(topology, goal, liveLog));
}

// --- Einlesen -----------------------------------------------------------------

/** Liest den `tasks`-Block einer Datei; wirft bei Fehlern den betroffenen Pfad. */
export function readTasks(value: unknown, invalid: (path: string) => never): TaskSet {
  const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  const str = (v: unknown, path: string) => (typeof v === 'string' ? v : invalid(path));
  const optStr = (v: unknown, path: string) => (v === undefined ? undefined : str(v, path));
  const names = (v: unknown, path: string) =>
    Array.isArray(v) && v.length > 0 ? v.map((n, i) => str(n, `${path}[${i}]`)) : invalid(path);
  const optNum = (v: unknown, path: string) =>
    v === undefined ? undefined : typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : invalid(path);

  if (!isObject(value)) invalid('tasks');
  const t = value as Record<string, unknown>;
  const goals = Array.isArray(t.goals) ? t.goals : invalid('tasks.goals');
  const ids = new Set<string>();
  return {
    title: str(t.title, 'tasks.title'),
    ...(t.description !== undefined ? { description: str(t.description, 'tasks.description') } : {}),
    ...(t.difficulty !== undefined
      ? { difficulty: typeof t.difficulty === 'number' && Number.isInteger(t.difficulty) && t.difficulty >= 1 && t.difficulty <= 5 ? t.difficulty : invalid('tasks.difficulty') }
      : {}),
    goals: goals.map((raw, i): Goal => {
      const p = `tasks.goals[${i}]`;
      if (!isObject(raw)) invalid(p);
      const g = raw as Record<string, unknown>;
      const id = str(g.id, `${p}.id`);
      if (ids.has(id)) invalid(`${p}.id`);
      ids.add(id);
      if (!isObject(g.check)) invalid(`${p}.check`);
      const c = g.check as Record<string, unknown>;
      const cp = `${p}.check`;
      const type = c.type;
      let check: Check;
      switch (type) {
        case 'deviceCount': {
          const deviceType = c.deviceType;
          if (deviceType !== undefined && !(DEVICE_TYPES as readonly unknown[]).includes(deviceType)) invalid(`${cp}.deviceType`);
          const min = optNum(c.min, `${cp}.min`);
          const max = optNum(c.max, `${cp}.max`);
          check = { type, ...(deviceType ? { deviceType: deviceType as DeviceType } : {}), ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) };
          break;
        }
        case 'connected':
          check = { type, a: str(c.a, `${cp}.a`), b: str(c.b, `${cp}.b`) };
          break;
        case 'inNetwork':
          check = { type, device: str(c.device, `${cp}.device`), network: str(c.network, `${cp}.network`) };
          break;
        case 'sameNetwork':
        case 'differentNetworks':
          check = { type, devices: names(c.devices, `${cp}.devices`) };
          break;
        case 'gateway': {
          const gateway = optStr(c.gateway, `${cp}.gateway`);
          check = { type, device: str(c.device, `${cp}.device`), ...(gateway ? { gateway } : {}) };
          break;
        }
        case 'ping':
        case 'noPing':
          check = { type, from: str(c.from, `${cp}.from`), to: str(c.to, `${cp}.to`) };
          break;
        case 'http': {
          const status = optNum(c.status, `${cp}.status`);
          check = { type, from: str(c.from, `${cp}.from`), url: str(c.url, `${cp}.url`), ...(status !== undefined ? { status } : {}) };
          break;
        }
        case 'dhcpLease':
          check = { type, device: str(c.device, `${cp}.device`) };
          break;
        case 'mail':
          check = { type, from: str(c.from, `${cp}.from`), to: str(c.to, `${cp}.to`) };
          break;
        case 'packetSeen': {
          const from = optStr(c.from, `${cp}.from`);
          const to = optStr(c.to, `${cp}.to`);
          check = { type, protocol: str(c.protocol, `${cp}.protocol`), ...(from ? { from } : {}), ...(to ? { to } : {}) };
          break;
        }
        case 'routeLearned': {
          const protocol = c.protocol;
          if (protocol !== undefined && protocol !== 'ospf' && protocol !== 'rip' && protocol !== 'bgp') invalid(`${cp}.protocol`);
          check = { type, device: str(c.device, `${cp}.device`), network: str(c.network, `${cp}.network`), ...(protocol ? { protocol: protocol as 'ospf' | 'rip' | 'bgp' } : {}) };
          break;
        }
        case 'neighbors': {
          if (c.protocol !== 'ospf' && c.protocol !== 'bgp') invalid(`${cp}.protocol`);
          const min = optNum(c.min, `${cp}.min`);
          check = { type, device: str(c.device, `${cp}.device`), protocol: c.protocol as 'ospf' | 'bgp', ...(min !== undefined ? { min } : {}) };
          break;
        }
        case 'noStorm':
          check = { type };
          break;
        case 'modemOnline':
          check = { type, device: str(c.device, `${cp}.device`) };
          break;
        case 'groupLeases': {
          const min = optNum(c.min, `${cp}.min`);
          check = { type, device: str(c.device, `${cp}.device`), ...(min !== undefined ? { min } : {}) };
          break;
        }
        case 'budget':
          check = { type, max: optNum(c.max, `${cp}.max`) ?? invalid(`${cp}.max`) };
          break;
        case 'linkUp': {
          if (c.medium !== undefined && !(MEDIA as readonly unknown[]).includes(c.medium)) invalid(`${cp}.medium`);
          check = { type, a: str(c.a, `${cp}.a`), b: str(c.b, `${cp}.b`), ...(c.medium ? { medium: c.medium as Medium } : {}) };
          break;
        }
        case 'vlanDocumented': {
          const vlan = optNum(c.vlan, `${cp}.vlan`);
          if (vlan === undefined || vlan < 1 || vlan > 4094) invalid(`${cp}.vlan`);
          check = { type, vlan: vlan! };
          break;
        }
        default:
          return invalid(`${cp}.type`);
      }
      const hint = optStr(g.hint, `${p}.hint`);
      return { id, text: str(g.text, `${p}.text`), check, ...(hint ? { hint } : {}) };
    }),
  };
}
