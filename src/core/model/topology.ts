import { checkHostConfig, maskToText, parseIp, parseMask, type HostConfigInput } from '../net/ipv4';
import { DEVICE_SPECS } from './devices';
import { macFor } from './mac';
import type { Cable, Device, DeviceType, Endpoint, NetInterface, Point, Topology } from './types';

export const MAX_NAME_LENGTH = 32;

export type ErrorCode =
  | 'unknownDevice'
  | 'unknownCable'
  | 'sameDevice'
  | 'noFreeInterface'
  | 'alreadyConnected'
  | 'nameEmpty'
  | 'nameTooLong'
  | 'nameTaken'
  | 'interfaceCountOutOfRange'
  | 'interfaceConnected'
  | 'notAnEndpoint'
  | 'unknownInterface'
  | 'invalidIp'
  | 'invalidMask'
  | 'maskRequired'
  | 'gatewayWithoutAddress';

/** Fehler tragen nur Code und Parameter; die Oberfläche übersetzt sie. */
export interface TopologyError {
  code: ErrorCode;
  params?: Record<string, string | number>;
  /** Betroffenes Eingabefeld, damit die Oberfläche den Fehler dort anzeigen kann. */
  field?: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: TopologyError };

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = <T>(code: ErrorCode, params?: TopologyError['params']): Result<T> => ({
  ok: false,
  error: { code, params },
});

export function emptyTopology(): Topology {
  return { devices: [], cables: [], nextId: 1 };
}

export function getDevice(t: Topology, id: string): Device | undefined {
  return t.devices.find((d) => d.id === id);
}

export function getCable(t: Topology, id: string): Cable | undefined {
  return t.cables.find((c) => c.id === id);
}

export function cablesOf(t: Topology, deviceId: string): Cable[] {
  return t.cables.filter((c) => c.a.device === deviceId || c.b.device === deviceId);
}

export function cableAt(t: Topology, endpoint: Endpoint): Cable | undefined {
  const same = (e: Endpoint) => e.device === endpoint.device && e.iface === endpoint.iface;
  return t.cables.find((c) => same(c.a) || same(c.b));
}

/** Die Gegenseite eines Kabels aus Sicht von `deviceId`. */
export function otherEnd(cable: Cable, deviceId: string): Endpoint {
  return cable.a.device === deviceId ? cable.b : cable.a;
}

export function freeInterface(t: Topology, device: Device): NetInterface | undefined {
  return device.interfaces.find((i) => !cableAt(t, { device: device.id, iface: i.index }));
}

export function deviceSeq(id: string): number {
  return Number(id.slice(1));
}

/** Kleinster freier Name der Form "<base> <n>". */
export function suggestName(t: Topology, base: string): string {
  const taken = new Set(t.devices.map((d) => d.name.toLowerCase()));
  let n = 1;
  while (taken.has(`${base} ${n}`.toLowerCase())) n++;
  return `${base} ${n}`;
}

function checkName(t: Topology, name: string, selfId?: string): Result<string> {
  const trimmed = name.trim();
  if (!trimmed) return fail('nameEmpty');
  if (trimmed.length > MAX_NAME_LENGTH) return fail('nameTooLong', { max: MAX_NAME_LENGTH });
  const clash = t.devices.find((d) => d.id !== selfId && d.name.toLowerCase() === trimmed.toLowerCase());
  if (clash) return fail('nameTaken', { name: trimmed });
  return ok(trimmed);
}

function makeInterfaces(seq: number, from: number, to: number): NetInterface[] {
  const list: NetInterface[] = [];
  for (let i = from; i < to; i++) list.push({ index: i, mac: macFor(seq, i) });
  return list;
}

function updateDevice(t: Topology, id: string, change: (d: Device) => Device): Topology {
  return { ...t, devices: t.devices.map((d) => (d.id === id ? change(d) : d)) };
}

export function addDevice(
  t: Topology,
  type: DeviceType,
  name: string,
  position: Point,
): Result<{ topology: Topology; id: string }> {
  const checked = checkName(t, name);
  if (!checked.ok) return checked;
  const seq = t.nextId;
  const device: Device = {
    id: `d${seq}`,
    type,
    name: checked.value,
    position: { ...position },
    interfaces: makeInterfaces(seq, 0, DEVICE_SPECS[type].defaultInterfaces),
  };
  return ok({ topology: { ...t, devices: [...t.devices, device], nextId: seq + 1 }, id: device.id });
}

export function moveDevice(t: Topology, id: string, position: Point): Result<Topology> {
  const device = getDevice(t, id);
  if (!device) return fail('unknownDevice');
  if (device.position.x === position.x && device.position.y === position.y) return ok(t);
  return ok(updateDevice(t, id, (d) => ({ ...d, position: { ...position } })));
}

export function renameDevice(t: Topology, id: string, name: string): Result<Topology> {
  const device = getDevice(t, id);
  if (!device) return fail('unknownDevice');
  const checked = checkName(t, name, id);
  if (!checked.ok) return checked;
  if (checked.value === device.name) return ok(t);
  return ok(updateDevice(t, id, (d) => ({ ...d, name: checked.value })));
}

export function removeDevice(t: Topology, id: string): Result<Topology> {
  if (!getDevice(t, id)) return fail('unknownDevice');
  return ok({
    ...t,
    devices: t.devices.filter((d) => d.id !== id),
    cables: t.cables.filter((c) => c.a.device !== id && c.b.device !== id),
  });
}

/** Verbindet zwei Geräte über deren jeweils ersten freien Anschluss. */
export function connect(t: Topology, aId: string, bId: string): Result<{ topology: Topology; id: string }> {
  const a = getDevice(t, aId);
  const b = getDevice(t, bId);
  if (!a || !b) return fail('unknownDevice');
  if (a.id === b.id) return fail('sameDevice');
  const direct = cablesOf(t, a.id).some((c) => otherEnd(c, a.id).device === b.id);
  if (direct) return fail('alreadyConnected', { a: a.name, b: b.name });
  const ia = freeInterface(t, a);
  if (!ia) return fail('noFreeInterface', { device: a.name });
  const ib = freeInterface(t, b);
  if (!ib) return fail('noFreeInterface', { device: b.name });
  const cable: Cable = {
    id: `c${t.nextId}`,
    a: { device: a.id, iface: ia.index },
    b: { device: b.id, iface: ib.index },
  };
  return ok({ topology: { ...t, cables: [...t.cables, cable], nextId: t.nextId + 1 }, id: cable.id });
}

export function removeCable(t: Topology, id: string): Result<Topology> {
  if (!getCable(t, id)) return fail('unknownCable');
  return ok({ ...t, cables: t.cables.filter((c) => c.id !== id) });
}

/** Ändert die Anzahl Ports; entfernt werden immer die höchsten, und nur wenn sie frei sind. */
export function setInterfaceCount(t: Topology, id: string, count: number): Result<Topology> {
  const device = getDevice(t, id);
  if (!device) return fail('unknownDevice');
  const spec = DEVICE_SPECS[device.type];
  if (!Number.isInteger(count) || count < spec.minInterfaces || count > spec.maxInterfaces) {
    return fail('interfaceCountOutOfRange', { min: spec.minInterfaces, max: spec.maxInterfaces });
  }
  const current = device.interfaces.length;
  if (count === current) return ok(t);
  if (count < current) {
    const busy = device.interfaces.slice(count).find((i) => cableAt(t, { device: id, iface: i.index }));
    if (busy) return fail('interfaceConnected', { device: device.name, index: busy.index });
    return ok(updateDevice(t, id, (d) => ({ ...d, interfaces: d.interfaces.slice(0, count) })));
  }
  const added = makeInterfaces(deviceSeq(id), current, count);
  return ok(updateDevice(t, id, (d) => ({ ...d, interfaces: [...d.interfaces, ...added] })));
}

/** Leere Felder entfernen den Eintrag; Masken werden in Punktschreibweise gespeichert. */
function normalized(ip: string, mask: string): Pick<NetInterface, 'ip' | 'mask'> {
  const prefix = mask.trim() ? parseMask(mask) : null;
  return {
    ...(ip.trim() ? { ip: ip.trim() } : {}),
    ...(prefix !== null ? { mask: maskToText(prefix) } : {}),
  };
}

/**
 * Setzt IP, Maske, Gateway und DNS eines Endgeräts in einem Schritt.
 * Nur unlesbare Eingaben werden abgelehnt; fachliche Warnungen liefert
 * `checkHostConfig` getrennt.
 */
export function configureHost(t: Topology, id: string, input: HostConfigInput): Result<Topology> {
  const device = getDevice(t, id);
  if (!device) return fail('unknownDevice');
  if (DEVICE_SPECS[device.type].role !== 'endpoint') return fail('notAnEndpoint');
  const { errors } = checkHostConfig(input);
  const first = errors[0];
  if (first) return { ok: false, error: { code: first.code as ErrorCode, params: first.params, field: first.field } };

  const gateway = input.gateway?.trim() ?? '';
  const dns = input.dns?.trim() ?? '';
  return ok(
    updateDevice(t, id, (d) => {
      const { gateway: _g, dns: _d, ...rest } = d;
      return {
        ...rest,
        interfaces: d.interfaces.map((i, n) => {
          if (n !== 0) return i;
          const { ip: _ip, mask: _mask, ...base } = i;
          return { ...base, ...normalized(input.ip, input.mask) };
        }),
        ...(gateway ? { gateway } : {}),
        ...(dns ? { dns } : {}),
      };
    }),
  );
}

/** IP und Maske eines einzelnen Anschlusses, z.B. eines Router-Interfaces. */
export function setInterfaceAddress(t: Topology, id: string, index: number, ip: string, mask: string): Result<Topology> {
  const device = getDevice(t, id);
  if (!device) return fail('unknownDevice');
  if (!device.interfaces[index]) return fail('unknownInterface');
  if (ip.trim() && parseIp(ip) === null) return { ok: false, error: { code: 'invalidIp', params: { value: ip.trim() }, field: 'ip' } };
  if (mask.trim() && parseMask(mask) === null) {
    return { ok: false, error: { code: 'invalidMask', params: { value: mask.trim() }, field: 'mask' } };
  }
  if (ip.trim() && !mask.trim()) return { ok: false, error: { code: 'maskRequired', field: 'mask' } };
  return ok(
    updateDevice(t, id, (d) => ({
      ...d,
      interfaces: d.interfaces.map((i) => {
        if (i.index !== index) return i;
        const { ip: _ip, mask: _mask, ...base } = i;
        return { ...base, ...normalized(ip, mask) };
      }),
    })),
  );
}
