import { DEVICE_SPECS, isDeviceType } from '../model/devices';
import { maskToText, parseIp, parseMask } from '../net/ipv4';
import { MAC_PATTERN } from '../model/mac';
import { MAX_NAME_LENGTH, deviceSeq, findSwitchLoop } from '../model/topology';
import type { Cable, Device, DhcpServerConfig, Endpoint, NetInterface, StaticRoute, Topology } from '../model/types';

export const FORMAT_ID = 'netzwerk-simulator';
export const FORMAT_VERSION = 1;

export interface ProjectFile {
  meta: { format: typeof FORMAT_ID; version: number };
  topology: Topology;
  /** DHCP-Bereiche, DNS-Zonen, Routen usw. folgen in späteren Etappen. */
  configuration: Record<string, unknown>;
}

export type ParseErrorCode = 'invalidJson' | 'notAProject' | 'unsupportedVersion' | 'invalidStructure' | 'switchLoop';

export interface ParseError {
  code: ParseErrorCode;
  params?: Record<string, string | number>;
}

export type ParseResult = { ok: true; topology: Topology } | { ok: false; error: ParseError };

export function serializeProject(topology: Topology): string {
  const file: ProjectFile = {
    meta: { format: FORMAT_ID, version: FORMAT_VERSION },
    topology,
    configuration: {},
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
  try {
    topology = readTopology(migrate(data, version).topology);
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
  return { ok: true, topology };
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
    return { id, a, b };
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
    device.dhcpServer = server;
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
