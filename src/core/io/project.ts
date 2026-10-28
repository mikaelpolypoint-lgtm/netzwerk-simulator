import { DEVICE_SPECS, isDeviceType } from '../model/devices';
import { maskToText, parseIp, parseMask } from '../net/ipv4';
import { MAC_PATTERN } from '../model/mac';
import { MAX_NAME_LENGTH, deviceSeq, findSwitchLoop } from '../model/topology';
import type {
  Cable,
  Device,
  DhcpServerConfig,
  DnsRecord,
  Endpoint,
  MailAccount,
  Mailbox,
  NetInterface,
  StaticRoute,
  Topology,
  WebFile,
} from '../model/types';
import { isValidName, normalizeName } from '../net/dns';
import { isValidPath } from '../net/http';
import { checkMailAccount } from '../net/mail';
import { readTasks, type TaskSet } from '../tasks/tasks';

export const FORMAT_ID = 'netzwerk-simulator';
export const FORMAT_VERSION = 1;

export interface ProjectFile {
  meta: { format: typeof FORMAT_ID; version: number };
  topology: Topology;
  /** Geräteübergreifende Einstellungen; Gerätebezogenes liegt direkt beim Gerät. */
  configuration: Record<string, unknown>;
  /** Nur in Aufgabendateien: Lernziele mit automatischer Prüfung. */
  tasks?: TaskSet;
}

export type ParseErrorCode = 'invalidJson' | 'notAProject' | 'unsupportedVersion' | 'invalidStructure' | 'switchLoop';

export interface ParseError {
  code: ParseErrorCode;
  params?: Record<string, string | number>;
}

export type ParseResult = { ok: true; topology: Topology; tasks?: TaskSet } | { ok: false; error: ParseError };

export function serializeProject(topology: Topology, tasks?: TaskSet | null): string {
  const file: ProjectFile = {
    meta: { format: FORMAT_ID, version: FORMAT_VERSION },
    topology,
    configuration: {},
    ...(tasks ? { tasks } : {}),
  };
  return JSON.stringify(file, null, 2) + '\n';
}

/**
 * Liest eine Projektdatei und prüft sie vollständig. Übernommen werden nur
 * bekannte Felder, damit eine fremde oder beschädigte Datei keinen
 * inkonsistenten Zustand erzeugen kann.
 */
export function parseProject(text: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return failure('invalidJson');
  }
  if (!isObject(data) || !isObject(data.meta) || data.meta.format !== FORMAT_ID) return failure('notAProject');
  const version = data.meta.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return failure('invalidStructure', { path: 'meta.version' });
  }
  if (version > FORMAT_VERSION) return failure('unsupportedVersion', { version, supported: FORMAT_VERSION });
  let topology: Topology;
  let tasks: TaskSet | undefined;
  try {
    const current = migrate(data, version);
    topology = readTopology(current.topology);
    if (current.tasks !== undefined) {
      tasks = readTasks(current.tasks, (path) => {
        throw new Invalid(path);
      });
    }
  } catch (e) {
    if (e instanceof Invalid) return failure('invalidStructure', { path: e.path });
    throw e;
  }
  // Eine Schleife zwischen Switches würde die Simulation mit einem Broadcast-Sturm lahmlegen.
  const loop = findSwitchLoop(topology);
  if (loop) {
    const name = (id: string) => topology.devices.find((d) => d.id === id)?.name ?? id;
    return failure('switchLoop', { a: name(loop.a.device), b: name(loop.b.device) });
  }
  return tasks ? { ok: true, topology, tasks } : { ok: true, topology };
}

/** Hebt ältere Formatversionen schrittweise auf die aktuelle an. */
function migrate(data: Record<string, unknown>, _version: number): Record<string, unknown> {
  return data;
}

function failure(code: ParseErrorCode, params?: ParseError['params']): ParseResult {
  return { ok: false, error: { code, params } };
}

class Invalid extends Error {
  constructor(readonly path: string) {
    super(path);
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function obj(v: unknown, path: string): Record<string, unknown> {
  if (!isObject(v)) throw new Invalid(path);
  return v;
}

function arr(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) throw new Invalid(path);
  return v;
}

function str(v: unknown, path: string): string {
  if (typeof v !== 'string') throw new Invalid(path);
  return v;
}

function num(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Invalid(path);
  return v;
}

function int(v: unknown, path: string): number {
  const n = num(v, path);
  if (!Number.isInteger(n)) throw new Invalid(path);
  return n;
}

function readTopology(v: unknown): Topology {
  const t = obj(v, 'topology');

  const devices = arr(t.devices, 'topology.devices').map((d, i) => readDevice(d, `topology.devices[${i}]`));
  const ids = new Set<string>();
  const names = new Set<string>();
  devices.forEach((d, i) => {
    if (ids.has(d.id)) throw new Invalid(`topology.devices[${i}].id`);
    if (names.has(d.name.toLowerCase())) throw new Invalid(`topology.devices[${i}].name`);
    ids.add(d.id);
    names.add(d.name.toLowerCase());
  });

  const byId = new Map(devices.map((d) => [d.id, d]));
  const usedEndpoints = new Set<string>();
  const cableIds = new Set<string>();
  const cables = arr(t.cables, 'topology.cables').map((c, i): Cable => {
    const path = `topology.cables[${i}]`;
    const o = obj(c, path);
    const id = str(o.id, `${path}.id`);
    if (!/^c\d+$/.test(id) || cableIds.has(id)) throw new Invalid(`${path}.id`);
    cableIds.add(id);
    const a = readEndpoint(o.a, `${path}.a`, byId, usedEndpoints);
    const b = readEndpoint(o.b, `${path}.b`, byId, usedEndpoints);
    if (a.device === b.device) throw new Invalid(`${path}.b`);
    if (o.loss === undefined) return { id, a, b };
    const loss = int(o.loss, `${path}.loss`);
    if (loss < 0 || loss > 100) throw new Invalid(`${path}.loss`);
    return loss > 0 ? { id, a, b, loss } : { id, a, b };
  });

  const highest = Math.max(0, ...devices.map((d) => deviceSeq(d.id)), ...cables.map((c) => deviceSeq(c.id)));
  const nextId = typeof t.nextId === 'number' && Number.isInteger(t.nextId) && t.nextId > highest ? t.nextId : highest + 1;
  return { devices, cables, nextId };
}

function readDevice(v: unknown, path: string): Device {
  const o = obj(v, path);
  const id = str(o.id, `${path}.id`);
  if (!/^d\d+$/.test(id)) throw new Invalid(`${path}.id`);
  if (!isDeviceType(o.type)) throw new Invalid(`${path}.type`);
  const type = o.type;
  const name = str(o.name, `${path}.name`).trim();
  if (!name || name.length > MAX_NAME_LENGTH) throw new Invalid(`${path}.name`);
  const pos = obj(o.position, `${path}.position`);
  const position = { x: num(pos.x, `${path}.position.x`), y: num(pos.y, `${path}.position.y`) };

  const spec = DEVICE_SPECS[type];
  const rawIfaces = arr(o.interfaces, `${path}.interfaces`);
  if (rawIfaces.length < spec.minInterfaces || rawIfaces.length > spec.maxInterfaces) {
    throw new Invalid(`${path}.interfaces`);
  }
  const interfaces = rawIfaces.map((raw, i): NetInterface => {
    const p = `${path}.interfaces[${i}]`;
    const io = obj(raw, p);
    if (int(io.index, `${p}.index`) !== i) throw new Invalid(`${p}.index`);
    const mac = str(io.mac, `${p}.mac`).toUpperCase();
    if (!MAC_PATTERN.test(mac)) throw new Invalid(`${p}.mac`);
    const iface: NetInterface = { index: i, mac };
    if (io.ip !== undefined) iface.ip = ip(io.ip, `${p}.ip`);
    if (io.mask !== undefined) {
      const prefix = parseMask(str(io.mask, `${p}.mask`));
      if (prefix === null) throw new Invalid(`${p}.mask`);
      iface.mask = maskToText(prefix);
    }
    if (io.dhcpRelay !== undefined) iface.dhcpRelay = ip(io.dhcpRelay, `${p}.dhcpRelay`);
    if (io.nat !== undefined) {
      if (typeof io.nat !== 'boolean') throw new Invalid(`${p}.nat`);
      if (io.nat) iface.nat = true;
    }
    return iface;
  });

  const device: Device = { id, type, name, position, interfaces };
  if (o.gateway !== undefined) device.gateway = ip(o.gateway, `${path}.gateway`);
  if (o.dns !== undefined) device.dns = ip(o.dns, `${path}.dns`);
  if (o.dhcp !== undefined) {
    if (typeof o.dhcp !== 'boolean') throw new Invalid(`${path}.dhcp`);
    if (o.dhcp) device.dhcp = true;
  }
  if (o.dhcpServer !== undefined) {
    const p = `${path}.dhcpServer`;
    const s = obj(o.dhcpServer, p);
    const leaseTime = int(s.leaseTime, `${p}.leaseTime`);
    if (leaseTime < 1) throw new Invalid(`${p}.leaseTime`);
    const server: DhcpServerConfig = { start: ip(s.start, `${p}.start`), end: ip(s.end, `${p}.end`), leaseTime };
    if (s.gateway !== undefined) server.gateway = ip(s.gateway, `${p}.gateway`);
    if (s.dns !== undefined) server.dns = ip(s.dns, `${p}.dns`);
    if (s.scopes !== undefined) {
      server.scopes = arr(s.scopes, `${p}.scopes`).map((raw, i) => {
        const sp = `${p}.scopes[${i}]`;
        const sc = obj(raw, sp);
        const prefix = parseMask(str(sc.mask, `${sp}.mask`));
        if (prefix === null) throw new Invalid(`${sp}.mask`);
        return {
          start: ip(sc.start, `${sp}.start`),
          end: ip(sc.end, `${sp}.end`),
          mask: maskToText(prefix),
          ...(sc.gateway !== undefined ? { gateway: ip(sc.gateway, `${sp}.gateway`) } : {}),
          ...(sc.dns !== undefined ? { dns: ip(sc.dns, `${sp}.dns`) } : {}),
        };
      });
    }
    device.dhcpServer = server;
  }
  if (o.dnsServer !== undefined) {
    const p = `${path}.dnsServer`;
    const records = arr(obj(o.dnsServer, p).records, `${p}.records`).map((raw, i): DnsRecord => {
      const rp = `${p}.records[${i}]`;
      const r = obj(raw, rp);
      const type = r.type;
      if (type !== 'A' && type !== 'MX') throw new Invalid(`${rp}.type`);
      const record: DnsRecord = {
        name: normalizeName(str(r.name, `${rp}.name`)),
        type,
        value: str(r.value, `${rp}.value`).trim(),
        ttl: int(r.ttl, `${rp}.ttl`),
      };
      if (!isValidName(record.name)) throw new Invalid(`${rp}.name`);
      if (type === 'A' ? parseIp(record.value) === null : !isValidName(record.value)) throw new Invalid(`${rp}.value`);
      if (record.ttl < 0) throw new Invalid(`${rp}.ttl`);
      return record;
    });
    device.dnsServer = { records };
  }
  if (o.webServer !== undefined) {
    const p = `${path}.webServer`;
    const files = arr(obj(o.webServer, p).files, `${p}.files`).map((raw, i): WebFile => {
      const fp = `${p}.files[${i}]`;
      const f = obj(raw, fp);
      const filePath = str(f.path, `${fp}.path`);
      if (!isValidPath(filePath)) throw new Invalid(`${fp}.path`);
      return { path: filePath, content: str(f.content, `${fp}.content`) };
    });
    device.webServer = { files };
  }
  if (o.portForwards !== undefined) {
    device.portForwards = arr(o.portForwards, `${path}.portForwards`).map((raw, i) => {
      const fp = `${path}.portForwards[${i}]`;
      const f = obj(raw, fp);
      if (f.protocol !== 'tcp' && f.protocol !== 'udp') throw new Invalid(`${fp}.protocol`);
      const port = int(f.port, `${fp}.port`);
      const toPort = int(f.toPort, `${fp}.toPort`);
      if (port < 1 || port > 65535) throw new Invalid(`${fp}.port`);
      if (toPort < 1 || toPort > 65535) throw new Invalid(`${fp}.toPort`);
      return { protocol: f.protocol, port, to: ip(f.to, `${fp}.to`), toPort };
    });
  }
  if (o.mailServer !== undefined) {
    const p = `${path}.mailServer`;
    const m = obj(o.mailServer, p);
    const domain = normalizeName(str(m.domain, `${p}.domain`));
    if (!isValidName(domain)) throw new Invalid(`${p}.domain`);
    const mailboxes = arr(m.mailboxes, `${p}.mailboxes`).map((raw, i): Mailbox => {
      const bp = `${p}.mailboxes[${i}]`;
      const b = obj(raw, bp);
      const user = str(b.user, `${bp}.user`).toLowerCase();
      if (!/^[a-z0-9._-]{1,32}$/.test(user)) throw new Invalid(`${bp}.user`);
      return { user, password: str(b.password, `${bp}.password`) };
    });
    device.mailServer = { domain, mailboxes };
  }
  if (o.mailAccount !== undefined) {
    const p = `${path}.mailAccount`;
    const a = obj(o.mailAccount, p);
    const protocol = a.protocol;
    if (protocol !== 'pop3' && protocol !== 'imap') throw new Invalid(`${p}.protocol`);
    const account: MailAccount = {
      address: str(a.address, `${p}.address`).toLowerCase(),
      password: str(a.password, `${p}.password`),
      smtpServer: str(a.smtpServer, `${p}.smtpServer`).toLowerCase(),
      incomingServer: str(a.incomingServer, `${p}.incomingServer`).toLowerCase(),
      protocol,
    };
    const issue = checkMailAccount(account);
    if (issue) throw new Invalid(`${p}.${issue.field}`);
    device.mailAccount = account;
  }
  if (o.routes !== undefined) {
    device.routes = arr(o.routes, `${path}.routes`).map((raw, i): StaticRoute => {
      const p = `${path}.routes[${i}]`;
      const r = obj(raw, p);
      const prefix = parseMask(str(r.mask, `${p}.mask`));
      if (prefix === null) throw new Invalid(`${p}.mask`);
      const route: StaticRoute = { network: ip(r.network, `${p}.network`), mask: maskToText(prefix) };
      if (r.gateway !== undefined) route.gateway = ip(r.gateway, `${p}.gateway`);
      if (r.iface !== undefined) {
        const iface = int(r.iface, `${p}.iface`);
        if (iface < 0 || iface >= interfaces.length) throw new Invalid(`${p}.iface`);
        route.iface = iface;
      }
      return route;
    });
  }
  return device;
}

/** Nur syntaktisch geprüft: Fehlkonfigurationen für Übungen sind erlaubt. */
function ip(v: unknown, path: string): string {
  const text = str(v, path).trim();
  if (parseIp(text) === null) throw new Invalid(path);
  return text;
}

function readEndpoint(v: unknown, path: string, devices: Map<string, Device>, used: Set<string>): Endpoint {
  const o = obj(v, path);
  const device = devices.get(str(o.device, `${path}.device`));
  if (!device) throw new Invalid(`${path}.device`);
  const iface = int(o.iface, `${path}.iface`);
  if (iface < 0 || iface >= device.interfaces.length) throw new Invalid(`${path}.iface`);
  const key = `${device.id}:${iface}`;
  if (used.has(key)) throw new Invalid(`${path}.iface`);
  used.add(key);
  return { device: device.id, iface };
}
