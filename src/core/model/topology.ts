import { checkDhcpScope, checkDhcpServer, normalizeDhcpServer, normalizeScope } from '../net/dhcp';
import { checkDnsRecord, isValidName, normalizeName, normalizeRecord } from '../net/dns';
import { isValidPath } from '../net/http';
import { checkMailAccount, checkMailbox } from '../net/mail';
import { checkHostConfig, maskToText, parseIp, parseMask, type HostConfigInput } from '../net/ipv4';
import { checkStaticRoute, decodeIface, normalizeRoute } from '../net/routing';
import { DEVICE_SPECS, hasRoutingTable, isRackable, isSwitchType } from './devices';
import { macFor } from './mac';
import type {
  Cable,
  Device,
  DeviceType,
  DocArea,
  Medium,
  SfpModule,
  TagColor,
  CliConfig,
  WifiClient,
  WlanConfig,
  DhcpScope,
  DhcpServerConfig,
  DnsRecord,
  Endpoint,
  MailAccount,
  Mailbox,
  NetInterface,
  Point,
  PortForward,
  StaticRoute,
  SubInterface,
  Svi,
  Topology,
  WebFile,
} from './types';

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
  | 'interfaceInUse'
  | 'invalidLoss'
  | 'invalidPort'
  | 'duplicateForward'
  | 'notASwitch'
  | 'invalidVlan'
  | 'stpNeededForLoop'
  | 'invalidPriority'
  | 'notAnEndpoint'
  | 'unknownInterface'
  | 'invalidIp'
  | 'invalidMask'
  | 'maskRequired'
  | 'gatewayWithoutAddress'
  | 'switchLoop'
  | 'notARouter'
  | 'unknownRoute'
  | 'networkHasHostBits'
  | 'routeNeedsTarget'
  | 'duplicateRoute'
  | 'dhcpServerNeedsStatic'
  | 'notAServer'
  | 'dhcpServerNeedsAddress'
  | 'dhcpRangeOutsideSubnet'
  | 'dhcpRangeOrder'
  | 'dhcpRangeReserved'
  | 'dhcpLeaseTime'
  | 'invalidDnsName'
  | 'dnsTtl'
  | 'duplicateRecord'
  | 'unknownRecord'
  | 'invalidPath'
  | 'duplicatePath'
  | 'unknownFile'
  | 'serviceDisabled'
  | 'invalidMailUser'
  | 'passwordRequired'
  | 'duplicateMailbox'
  | 'unknownMailbox'
  | 'invalidMailAddress'
  | 'invalidHost'
  | 'duplicateSubinterface'
  | 'unknownSubinterface'
  | 'wirelessNeedsAccessPoint'
  | 'radioPortNeedsWireless'
  | 'invalidSsid'
  | 'invalidChannel'
  | 'invalidPassword'
  | 'unknownArea'
  | 'unknownFloor'
  | 'lastFloor'
  | 'invalidUser'
  | 'textTooLong'
  | 'noSfpModule'
  | 'notAnSfpSlot'
  | 'noFreeSfpSlot'
  | 'fiberNeedsSfp'
  | 'copperNeedsRj45'
  | 'notRackable'
  | 'notARack';

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

/** Erster freier RJ45-Anschluss (SFP-Einschübe sind für Glasfaser reserviert). */
export function freeInterface(t: Topology, device: Device): NetInterface | undefined {
  return device.interfaces.find((i) => !i.sfpSlot && !cableAt(t, { device: device.id, iface: i.index }));
}

/** RJ45-Anschlüsse eines Geräts (ohne SFP-Einschübe). */
export function copperPorts(device: Device): NetInterface[] {
  return device.interfaces.filter((i) => !i.sfpSlot);
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

/** Neues Gerät: RJ45-Anschlüsse, danach die SFP-Einschübe. */
function initialInterfaces(seq: number, type: DeviceType): NetInterface[] {
  const spec = DEVICE_SPECS[type];
  const copper = makeInterfaces(seq, 0, spec.defaultInterfaces);
  const slots = makeInterfaces(seq, spec.defaultInterfaces, spec.defaultInterfaces + (spec.sfpSlots ?? 0)).map((i) => ({ ...i, sfpSlot: true }));
  return [...copper, ...slots];
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
    interfaces: initialInterfaces(seq, type),
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

/** Passender freier Anschluss für ein Medium: Funk nur an Funk-Ports des Access Points, Kabel nur an Buchsen. */
export function freeInterfaceFor(t: Topology, device: Device, medium: Medium): NetInterface | undefined {
  return device.interfaces.find((i) => {
    if (cableAt(t, { device: device.id, iface: i.index })) return false;
    // Glasfaser nur in SFP-Einschüben mit Modul, Kupfer und Funk nie dort.
    if (medium === 'fiber') return !!i.sfpSlot && !!i.sfp;
    if (i.sfpSlot) return false;
    if (device.type !== 'accesspoint') return true;
    return medium === 'wireless' ? i.index > 0 : i.index === 0;
  });
}

function checkMedium(a: Device, b: Device, medium: Medium): ErrorCode | null {
  if (medium !== 'wireless') return null;
  const wifiCapable = (d: Device) => d.type === 'accesspoint' || d.type === 'notebook' || d.type === 'pc';
  if (!(a.type === 'accesspoint' || b.type === 'accesspoint') || !wifiCapable(a) || !wifiCapable(b)) return 'wirelessNeedsAccessPoint';
  return null;
}

/** Verbindet zwei Geräte über deren jeweils ersten freien (zum Medium passenden) Anschluss. */
export function connect(t: Topology, aId: string, bId: string, medium: Medium = 'tp'): Result<{ topology: Topology; id: string }> {
  const a = getDevice(t, aId);
  const b = getDevice(t, bId);
  if (!a || !b) return fail('unknownDevice');
  if (a.id === b.id) return fail('sameDevice');
  const direct = cablesOf(t, a.id).some((c) => otherEnd(c, a.id).device === b.id);
  if (direct) return fail('alreadyConnected', { a: a.name, b: b.name });
  const mediumIssue = checkMedium(a, b, medium);
  if (mediumIssue) return fail(mediumIssue);
  if (isBridge(a) && isBridge(b) && bridged(t, a.id, b.id) && !stpProtects(t, a.id)) {
    return fail('switchLoop', { a: a.name, b: b.name });
  }
  const ia = freeInterfaceFor(t, a, medium);
  if (!ia) return fail(medium === 'fiber' ? 'noSfpModule' : 'noFreeInterface', { device: a.name });
  const ib = freeInterfaceFor(t, b, medium);
  if (!ib) return fail(medium === 'fiber' ? 'noSfpModule' : 'noFreeInterface', { device: b.name });
  const cable: Cable = {
    id: `c${t.nextId}`,
    a: { device: a.id, iface: ia.index },
    b: { device: b.id, iface: ib.index },
    ...(medium !== 'tp' ? { medium } : {}),
  };
  return ok({ topology: { ...t, cables: [...t.cables, cable], nextId: t.nextId + 1 }, id: cable.id });
}

/** Medium einer bestehenden Verbindung ändern (Kabel ↔ Glasfaser; Funk nur, wo es passt). */
export function setCableMedium(t: Topology, id: string, medium: Medium): Result<Topology> {
  const cable = getCable(t, id);
  if (!cable) return fail('unknownCable');
  const a = getDevice(t, cable.a.device);
  const b = getDevice(t, cable.b.device);
  if (!a || !b) return fail('unknownDevice');
  const issue = checkMedium(a, b, medium);
  if (issue) return fail(issue);
  for (const [d, iface] of [[a, cable.a.iface], [b, cable.b.iface]] as const) {
    const slot = !!d.interfaces[iface]?.sfpSlot;
    if (medium === 'fiber' && !slot) return fail('fiberNeedsSfp', { device: d.name });
    if (medium !== 'fiber' && slot) return fail('copperNeedsRj45', { device: d.name });
  }
  const radio = (d: Device, iface: number) => d.type === 'accesspoint' && iface > 0;
  const wantsRadio = medium === 'wireless';
  if (radio(a, cable.a.iface) !== wantsRadio && a.type === 'accesspoint') return fail('radioPortNeedsWireless');
  if (radio(b, cable.b.iface) !== wantsRadio && b.type === 'accesspoint') return fail('radioPortNeedsWireless');
  return ok({
    ...t,
    cables: t.cables.map((c) => {
      if (c.id !== id) return c;
      const { medium: _m, ...rest } = c;
      return medium === 'tp' ? rest : { ...rest, medium };
    }),
  });
}

/**
 * Switches und Modems leiten Broadcasts an alle Ports weiter. Ohne Spanning
 * Tree würde eine Schleife zwischen ihnen einen endlosen Broadcast-Sturm
 * auslösen, darum erlaubt der Editor Schleifen nur, wenn alle beteiligten
 * Switches Spanning Tree aktiv haben.
 */
export function isBridge(device: Device): boolean {
  return isSwitchType(device.type) || device.type === 'modem' || device.type === 'accesspoint';
}

/** Alle Switches und Modems, die über Switch-/Modem-Verbindungen mit `from` zusammenhängen. */
function bridgeComponent(t: Topology, from: string): Device[] {
  const seen = new Set([from]);
  const queue = [from];
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    for (const cable of cablesOf(t, id)) {
      const next = otherEnd(cable, id).device;
      const device = getDevice(t, next);
      if (device && isBridge(device) && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return [...seen].flatMap((id) => getDevice(t, id) ?? []);
}

/** Schleifen sind sicher, wenn jeder Switch im Verbund Spanning Tree spricht (Modems können das nicht). */
function stpProtects(t: Topology, from: string): boolean {
  return bridgeComponent(t, from).every((d) => isSwitchType(d.type) && d.stp);
}

function bridged(t: Topology, from: string, to: string): boolean {
  const seen = new Set([from]);
  const queue = [from];
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    if (id === to) return true;
    for (const cable of cablesOf(t, id)) {
      const next = otherEnd(cable, id).device;
      const device = getDevice(t, next);
      if (device && isBridge(device) && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

/** Erstes Kabel, das eine Schleife zwischen Switches/Modems schliesst (für geladene Dateien). */
export function findSwitchLoop(t: Topology): Cable | undefined {
  const parent = new Map<string, string>();
  const root = (id: string): string => {
    let r = id;
    while (parent.get(r) && parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  for (const cable of t.cables) {
    const a = getDevice(t, cable.a.device);
    const b = getDevice(t, cable.b.device);
    if (!a || !b || !isBridge(a) || !isBridge(b)) continue;
    const ra = root(a.id);
    const rb = root(b.id);
    if (ra === rb) {
      if (stpProtects(t, a.id)) continue;
      return cable;
    }
    parent.set(ra, rb);
  }
  return undefined;
}

// --- VLAN und Spanning Tree --------------------------------------------------

function switchDevice(t: Topology, id: string): Result<Device> {
  const device = getDevice(t, id);
  if (!device) return fail('unknownDevice');
  if (!isSwitchType(device.type)) return fail('notASwitch');
  return ok(device);
}

function updatePort(t: Topology, id: string, index: number, change: (i: NetInterface) => NetInterface): Topology {
  return updateDevice(t, id, (d) => ({ ...d, interfaces: d.interfaces.map((i) => (i.index === index ? change(i) : i)) }));
}

/** VLAN eines Access-Ports (1–4094); VLAN 1 wird nicht gespeichert. */
export function setPortVlan(t: Topology, id: string, index: number, vlan: number): Result<Topology> {
  const device = switchDevice(t, id);
  if (!device.ok) return device;
  if (!device.value.interfaces[index]) return fail('unknownInterface');
  if (!Number.isInteger(vlan) || vlan < 1 || vlan > 4094) return fail('invalidVlan');
  return ok(
    updatePort(t, id, index, (i) => {
      const { vlan: _v, ...base } = i;
      return vlan === 1 ? base : { ...base, vlan };
    }),
  );
}

export function setPortTrunk(t: Topology, id: string, index: number, trunk: boolean): Result<Topology> {
  const device = switchDevice(t, id);
  if (!device.ok) return device;
  if (!device.value.interfaces[index]) return fail('unknownInterface');
  return ok(
    updatePort(t, id, index, (i) => {
      const { trunk: _t, ...base } = i;
      return trunk ? { ...base, trunk: true } : base;
    }),
  );
}

/** Spanning Tree ein- oder ausschalten; ausschalten nur, wenn dadurch keine ungeschützte Schleife entsteht. */
export function setStp(t: Topology, id: string, enabled: boolean): Result<Topology> {
  const device = switchDevice(t, id);
  if (!device.ok) return device;
  const next = updateDevice(t, id, (d) => {
    const { stp: _s, ...rest } = d;
    return enabled ? { ...rest, stp: true } : rest;
  });
  if (!enabled && findSwitchLoop(next)) return fail('stpNeededForLoop', { name: device.value.name });
  return ok(next);
}

/** STP-Priorität in Schritten von 4096 (0–61440); die kleinste wird Root-Bridge. */
export function setStpPriority(t: Topology, id: string, priority: number): Result<Topology> {
  const device = switchDevice(t, id);
  if (!device.ok) return device;
  if (!Number.isInteger(priority) || priority < 0 || priority > 61440 || priority % 4096 !== 0) return fail('invalidPriority');
  return ok(
    updateDevice(t, id, (d) => {
      const { stpPriority: _p, ...rest } = d;
      return priority === 32768 ? rest : { ...rest, stpPriority: priority };
    }),
  );
}

/** Beschädigung eines Kabels in Prozent verlorener Rahmen (0 = intakt). */
export function setCableLoss(t: Topology, id: string, percent: number): Result<Topology> {
  if (!getCable(t, id)) return fail('unknownCable');
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) return fail('invalidLoss');
  return ok({
    ...t,
    cables: t.cables.map((c) => {
      if (c.id !== id) return c;
      const { loss: _l, ...rest } = c;
      return percent > 0 ? { ...rest, loss: percent } : rest;
    }),
  });
}

/** Steckt ein Kabelende am selben Gerät auf einen anderen, freien Anschluss um. */
export function replugCable(t: Topology, id: string, end: 'a' | 'b', iface: number): Result<Topology> {
  const cable = getCable(t, id);
  if (!cable) return fail('unknownCable');
  const device = getDevice(t, cable[end].device);
  if (!device) return fail('unknownDevice');
  if (!device.interfaces[iface]) return fail('unknownInterface');
  if (cable[end].iface === iface) return ok(t);
  // Access Point: Funk nur an Funk-Ports, Kabel nur an der LAN-Buchse.
  if (device.type === 'accesspoint' && (iface > 0) !== (cable.medium === 'wireless')) return fail('radioPortNeedsWireless');
  // Glasfaser gehört in einen SFP-Einschub, Kupfer in eine RJ45-Buchse.
  const slot = !!device.interfaces[iface]?.sfpSlot;
  if (cable.medium === 'fiber' && !slot) return fail('fiberNeedsSfp', { device: device.name });
  if (cable.medium !== 'fiber' && slot) return fail('copperNeedsRj45', { device: device.name });
  const occupied = cableAt(t, { device: device.id, iface });
  if (occupied) return fail('interfaceInUse', { device: device.name, index: iface });
  return ok({
    ...t,
    cables: t.cables.map((c) => (c.id === id ? { ...c, [end]: { device: device.id, iface } } : c)),
  });
}

export function removeCable(t: Topology, id: string): Result<Topology> {
  if (!getCable(t, id)) return fail('unknownCable');
  return ok({ ...t, cables: t.cables.filter((c) => c.id !== id) });
}

/**
 * Ändert die Anzahl RJ45-Ports; entfernt werden immer die höchsten, und nur
 * wenn sie frei sind. SFP-Einschübe bleiben erhalten und rücken ans Ende;
 * Kabel, Subinterfaces und Routen auf ihnen ziehen mit.
 */
export function setInterfaceCount(t: Topology, id: string, count: number): Result<Topology> {
  const device = getDevice(t, id);
  if (!device) return fail('unknownDevice');
  const spec = DEVICE_SPECS[device.type];
  if (!Number.isInteger(count) || count < spec.minInterfaces || count > spec.maxInterfaces) {
    return fail('interfaceCountOutOfRange', { min: spec.minInterfaces, max: spec.maxInterfaces });
  }
  const copper = copperPorts(device);
  const slots = device.interfaces.filter((i) => i.sfpSlot);
  if (count === copper.length) return ok(t);
  if (count < copper.length) {
    const busy = copper.slice(count).find((i) => cableAt(t, { device: id, iface: i.index }));
    if (busy) return fail('interfaceConnected', { device: device.name, index: busy.index });
  }
  // Neue Ports erhalten MAC-Adressen, die das Gerät noch nicht verwendet.
  const used = new Set(device.interfaces.map((i) => i.mac));
  const seq = deviceSeq(id);
  let next = 0;
  const fresh = () => {
    while (used.has(macFor(seq, next))) next++;
    const mac = macFor(seq, next);
    used.add(mac);
    return mac;
  };
  const keptCopper = copper.slice(0, count);
  const addedCopper = Array.from({ length: Math.max(0, count - copper.length) }, () => ({ mac: fresh() }));
  const ordered: Omit<NetInterface, 'index'>[] = [...keptCopper, ...addedCopper, ...slots];
  const mapping = new Map<number, number>();
  const interfaces = ordered.map((iface, index) => {
    if ('index' in iface && typeof iface.index === 'number') mapping.set(iface.index, index);
    return { ...iface, index } as NetInterface;
  });
  return ok(remapPorts({ ...t }, id, interfaces, mapping));
}

/** Setzt neue Anschlüsse und passt alle Verweise (Kabel, Subinterfaces, Routen) an. */
function remapPorts(t: Topology, id: string, interfaces: NetInterface[], mapping: Map<number, number>): Topology {
  const map = (index: number) => mapping.get(index) ?? index;
  return {
    ...t,
    devices: t.devices.map((d) => {
      if (d.id !== id) return d;
      const next: Device = { ...d, interfaces };
      if (d.subinterfaces) next.subinterfaces = d.subinterfaces.map((si) => ({ ...si, parent: map(si.parent) }));
      if (d.routes) next.routes = d.routes.map((r) => (r.iface !== undefined && decodeIface(r.iface).kind === 'port' ? { ...r, iface: map(r.iface) } : r));
      return next;
    }),
    cables: t.cables.map((c) => ({
      ...c,
      a: c.a.device === id ? { ...c.a, iface: map(c.a.iface) } : c.a,
      b: c.b.device === id ? { ...c.b, iface: map(c.b.iface) } : c.b,
    })),
  };
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
  if (input.dhcp && device.dhcpServer) return fail('dhcpServerNeedsStatic');
  const { errors } = checkHostConfig(input);
  const first = errors[0];
  if (first) return { ok: false, error: { code: first.code as ErrorCode, params: first.params, field: first.field } };

  // Per DHCP kommen Adresse, Maske, Gateway und DNS vom Server: statische Werte entfallen.
  const gateway = input.dhcp ? '' : (input.gateway?.trim() ?? '');
  const dns = input.dhcp ? '' : (input.dns?.trim() ?? '');
  return ok(
    updateDevice(t, id, (d) => {
      const { gateway: _g, dns: _d, dhcp: _dhcp, ...rest } = d;
      return {
        ...rest,
        interfaces: d.interfaces.map((i, n) => {
          if (n !== 0) return i;
          const { ip: _ip, mask: _mask, ...base } = i;
          return input.dhcp ? base : { ...base, ...normalized(input.ip, input.mask) };
        }),
        ...(gateway ? { gateway } : {}),
        ...(dns ? { dns } : {}),
        ...(input.dhcp ? { dhcp: true } : {}),
      };
    }),
  );
}

/** Richtet den DHCP-Server-Dienst eines Rechners ein oder entfernt ihn (`null`). */
export function setDhcpServer(t: Topology, id: string, config: DhcpServerConfig | null): Result<Topology> {
  const device = getDevice(t, id);
  if (!device) return fail('unknownDevice');
  if (config) {
    const issue = checkDhcpServer(device, config);
    if (issue) return { ok: false, error: { code: issue.code as ErrorCode, params: issue.params, field: issue.field } };
  }
  return ok(
    updateDevice(t, id, (d) => {
      const { dhcpServer: existing, ...rest } = d;
      // Zusätzliche Bereiche bleiben erhalten, wenn nur der Hauptbereich geändert wird.
      const scopes = config?.scopes ?? existing?.scopes;
      return config ? { ...rest, dhcpServer: normalizeDhcpServer({ ...config, ...(scopes ? { scopes } : {}) }) } : rest;
    }),
  );
}

export function addDhcpScope(t: Topology, id: string, scope: DhcpScope): Result<Topology> {
  const config = getDevice(t, id)?.dhcpServer;
  if (!config) return fail('serviceDisabled');
  const issue = checkDhcpScope(scope);
  if (issue) return { ok: false, error: { code: issue.code as ErrorCode, params: issue.params, field: issue.field } };
  const scopes = [...(config.scopes ?? []), normalizeScope(scope)];
  return ok(updateDevice(t, id, (d) => ({ ...d, dhcpServer: { ...config, scopes } })));
}

export function removeDhcpScope(t: Topology, id: string, index: number): Result<Topology> {
  const config = getDevice(t, id)?.dhcpServer;
  if (!config?.scopes?.[index]) return fail('unknownRoute');
  const scopes = config.scopes.filter((_, i) => i !== index);
  return ok(
    updateDevice(t, id, (d) => {
      const { scopes: _s, ...rest } = config;
      return { ...d, dhcpServer: scopes.length ? { ...rest, scopes } : rest };
    }),
  );
}

/** DHCP-Relay eines Router-Interfaces (auch Subinterface oder SVI) setzen (Server-IP) oder entfernen (""). */
export function setInterfaceRelay(t: Topology, id: string, index: number, server: string): Result<Topology> {
  const device = getDevice(t, id);
  if (!device) return fail('unknownDevice');
  if (!hasRoutingTable(device.type)) return fail('notARouter');
  const value = server.trim();
  if (value && parseIp(value) === null) return { ok: false, error: { code: 'invalidIp', params: { value }, field: 'relay' } };
  const withRelay = <T extends { dhcpRelay?: string }>(item: T): T => {
    const { dhcpRelay: _r, ...base } = item;
    return (value ? { ...base, dhcpRelay: value } : base) as T;
  };
  const ref = decodeIface(index);
  if (ref.kind === 'sub') {
    if (!device.subinterfaces?.some((s) => s.parent === ref.port && s.vlan === ref.vlan)) return fail('unknownSubinterface');
    return ok(
      updateDevice(t, id, (d) => ({
        ...d,
        subinterfaces: (d.subinterfaces ?? []).map((s) => (s.parent === ref.port && s.vlan === ref.vlan ? withRelay(s) : s)),
      })),
    );
  }
  if (ref.kind === 'svi') {
    if (!device.svis?.some((s) => s.vlan === ref.vlan)) return fail('unknownSubinterface');
    return ok(updateDevice(t, id, (d) => ({ ...d, svis: (d.svis ?? []).map((s) => (s.vlan === ref.vlan ? withRelay(s) : s)) })));
  }
  if (!device.interfaces[index]) return fail('unknownInterface');
  return ok(updateDevice(t, id, (d) => ({ ...d, interfaces: d.interfaces.map((i) => (i.index === index ? withRelay(i) : i)) })));
}

// --- Router-on-a-Stick und Layer-3-Switch --------------------------------------

function checkAddress(ip: string, mask: string): TopologyError | null {
  if (ip.trim() && parseIp(ip) === null) return { code: 'invalidIp', params: { value: ip.trim() }, field: 'ip' };
  if (mask.trim() && parseMask(mask) === null) return { code: 'invalidMask', params: { value: mask.trim() }, field: 'mask' };
  if (ip.trim() && !mask.trim()) return { code: 'maskRequired', field: 'mask' };
  return null;
}

const validVlan = (vlan: number) => Number.isInteger(vlan) && vlan >= 1 && vlan <= 4094;

/** Subinterface eines Router-Anschlusses anlegen oder seine Adresse ändern (z.B. eth0.10). */
export function setSubinterface(t: Topology, id: string, parent: number, vlan: number, ip: string, mask: string): Result<Topology> {
  const device = getDevice(t, id);
  if (!device) return fail('unknownDevice');
  if (device.type !== 'router') return fail('notARouter');
  if (!device.interfaces[parent]) return fail('unknownInterface');
  if (!validVlan(vlan)) return { ok: false, error: { code: 'invalidVlan', field: 'vlan' } };
  const issue = checkAddress(ip, mask);
  if (issue) return { ok: false, error: issue };
  const existing = device.subinterfaces ?? [];
  const old = existing.find((s) => s.parent === parent && s.vlan === vlan);
  const { ip: _ip, mask: _mask, ...rest } = old ?? { parent, vlan };
  const next: SubInterface = { ...rest, ...normalized(ip, mask) };
  const list = old
    ? existing.map((s) => (s === old ? next : s))
    : [...existing, next].sort((a, b) => a.parent - b.parent || a.vlan - b.vlan);
  return ok(updateDevice(t, id, (d) => ({ ...d, subinterfaces: list })));
}

export function removeSubinterface(t: Topology, id: string, parent: number, vlan: number): Result<Topology> {
  const device = getDevice(t, id);
  if (!device) return fail('unknownDevice');
  if (!device.subinterfaces?.some((s) => s.parent === parent && s.vlan === vlan)) return fail('unknownSubinterface');
  const list = device.subinterfaces.filter((s) => !(s.parent === parent && s.vlan === vlan));
  return ok(
    updateDevice(t, id, (d) => {
      const { subinterfaces: _s, ...rest } = d;
      return list.length ? { ...rest, subinterfaces: list } : rest;
    }),
  );
}

/** VLAN-Interface eines Layer-3-Switches anlegen oder seine Adresse ändern («interface vlan 10»). */
export function setSvi(t: Topology, id: string, vlan: number, ip: string, mask: string): Result<Topology> {
  const device = getDevice(t, id);
  if (!device) return fail('unknownDevice');
  if (device.type !== 'l3switch') return fail('notASwitch');
  if (!validVlan(vlan)) return { ok: false, error: { code: 'invalidVlan', field: 'vlan' } };
  const issue = checkAddress(ip, mask);
  if (issue) return { ok: false, error: issue };
  const existing = device.svis ?? [];
  const old = existing.find((s) => s.vlan === vlan);
  const { ip: _ip, mask: _mask, ...rest } = old ?? { vlan };
  const next: Svi = { ...rest, ...normalized(ip, mask) };
  const list = old ? existing.map((s) => (s === old ? next : s)) : [...existing, next].sort((a, b) => a.vlan - b.vlan);
  return ok(updateDevice(t, id, (d) => ({ ...d, svis: list })));
}

export function removeSvi(t: Topology, id: string, vlan: number): Result<Topology> {
  const device = getDevice(t, id);
  if (!device) return fail('unknownDevice');
  if (!device.svis?.some((s) => s.vlan === vlan)) return fail('unknownSubinterface');
  const list = device.svis.filter((s) => s.vlan !== vlan);
  return ok(
    updateDevice(t, id, (d) => {
      const { svis: _s, ...rest } = d;
      return list.length ? { ...rest, svis: list } : rest;
    }),
  );
}

/** Routing zwischen VLANs am Layer-3-Switch ein- oder ausschalten. */
export function setIpRouting(t: Topology, id: string, enabled: boolean): Result<Topology> {
  const device = getDevice(t, id);
  if (!device) return fail('unknownDevice');
  if (device.type !== 'l3switch') return fail('notASwitch');
  return ok(
    updateDevice(t, id, (d) => {
      const { ipRouting: _r, ...rest } = d;
      return enabled ? rest : { ...rest, ipRouting: false };
    }),
  );
}

// --- NAT ---------------------------------------------------------------------

/** Markiert ein Router-Interface als Internet-Seite: Ausgehendes erhält dessen Adresse (NAT). */
export function setInterfaceNat(t: Topology, id: string, index: number, nat: boolean): Result<Topology> {
  const device = getDevice(t, id);
  if (!device) return fail('unknownDevice');
  if (device.type !== 'router') return fail('notARouter');
  if (!device.interfaces[index]) return fail('unknownInterface');
  return ok(
    updateDevice(t, id, (d) => ({
      ...d,
      interfaces: d.interfaces.map((i) => {
        if (i.index !== index) return i;
        const { nat: _n, ...base } = i;
        return nat ? { ...base, nat: true } : base;
      }),
    })),
  );
}

export function addPortForward(t: Topology, id: string, forward: PortForward): Result<Topology> {
  const device = getDevice(t, id);
  if (!device) return fail('unknownDevice');
  if (device.type !== 'router') return fail('notARouter');
  const validPort = (p: number) => Number.isInteger(p) && p >= 1 && p <= 65535;
  if (!validPort(forward.port)) return { ok: false, error: { code: 'invalidPort', field: 'port' } };
  if (!validPort(forward.toPort)) return { ok: false, error: { code: 'invalidPort', field: 'toPort' } };
  if (parseIp(forward.to.trim()) === null) return { ok: false, error: { code: 'invalidIp', params: { value: forward.to }, field: 'to' } };
  const existing = device.portForwards ?? [];
  if (existing.some((f) => f.protocol === forward.protocol && f.port === forward.port)) {
    return { ok: false, error: { code: 'duplicateForward', params: { port: forward.port }, field: 'port' } };
  }
  const entry: PortForward = { protocol: forward.protocol, port: forward.port, to: forward.to.trim(), toPort: forward.toPort };
  return ok(updateDevice(t, id, (d) => ({ ...d, portForwards: [...existing, entry] })));
}

export function removePortForward(t: Topology, id: string, index: number): Result<Topology> {
  const device = getDevice(t, id);
  if (!device?.portForwards?.[index]) return fail('unknownRoute');
  const forwards = device.portForwards.filter((_, i) => i !== index);
  return ok(
    updateDevice(t, id, (d) => {
      const { portForwards: _p, ...rest } = d;
      return forwards.length ? { ...rest, portForwards: forwards } : rest;
    }),
  );
}

// --- DNS- und Webserver ------------------------------------------------------

function serverDevice(t: Topology, id: string): Result<Device> {
  const device = getDevice(t, id);
  if (!device) return fail('unknownDevice');
  if (device.type !== 'pc') return fail('notAServer');
  return ok(device);
}

export function setDnsServerEnabled(t: Topology, id: string, enabled: boolean): Result<Topology> {
  const device = serverDevice(t, id);
  if (!device.ok) return device;
  if (enabled === !!device.value.dnsServer) return ok(t);
  return ok(
    updateDevice(t, id, (d) => {
      const { dnsServer: _s, ...rest } = d;
      return enabled ? { ...rest, dnsServer: { records: [] } } : rest;
    }),
  );
}

export function addDnsRecord(t: Topology, id: string, record: DnsRecord): Result<Topology> {
  const device = serverDevice(t, id);
  if (!device.ok) return device;
  const config = device.value.dnsServer;
  if (!config) return fail('serviceDisabled');
  const issue = checkDnsRecord(config, record);
  if (issue) return { ok: false, error: { code: issue.code as ErrorCode, params: issue.params, field: issue.field } };
  return ok(updateDevice(t, id, (d) => ({ ...d, dnsServer: { records: [...config.records, normalizeRecord(record)] } })));
}

export function removeDnsRecord(t: Topology, id: string, index: number): Result<Topology> {
  const device = getDevice(t, id);
  if (!device?.dnsServer?.records[index]) return fail('unknownRecord');
  const records = device.dnsServer.records.filter((_, i) => i !== index);
  return ok(updateDevice(t, id, (d) => ({ ...d, dnsServer: { records } })));
}

/** Beim Einschalten erhält der Webserver eine Startseite, damit sofort etwas abrufbar ist. */
export function setWebServerEnabled(t: Topology, id: string, enabled: boolean, initial: WebFile[] = []): Result<Topology> {
  const device = serverDevice(t, id);
  if (!device.ok) return device;
  if (enabled === !!device.value.webServer) return ok(t);
  return ok(
    updateDevice(t, id, (d) => {
      const { webServer: _w, ...rest } = d;
      return enabled ? { ...rest, webServer: { files: initial.map((f) => ({ ...f })) } } : rest;
    }),
  );
}

/** Legt eine Seite an oder ersetzt sie; `previousPath` erlaubt das Umbenennen. */
export function saveWebFile(t: Topology, id: string, file: WebFile, previousPath?: string): Result<Topology> {
  const device = serverDevice(t, id);
  if (!device.ok) return device;
  const config = device.value.webServer;
  if (!config) return fail('serviceDisabled');
  const path = file.path.trim();
  if (!isValidPath(path)) return { ok: false, error: { code: 'invalidPath', params: { path }, field: 'path' } };
  if (path !== previousPath && config.files.some((f) => f.path === path)) {
    return { ok: false, error: { code: 'duplicatePath', params: { path }, field: 'path' } };
  }
  const others = config.files.filter((f) => f.path !== (previousPath ?? path));
  const files = [...others, { path, content: file.content }].sort((a, b) => a.path.localeCompare(b.path));
  return ok(updateDevice(t, id, (d) => ({ ...d, webServer: { files } })));
}

export function removeWebFile(t: Topology, id: string, path: string): Result<Topology> {
  const device = getDevice(t, id);
  if (!device?.webServer?.files.some((f) => f.path === path)) return fail('unknownFile');
  const files = device.webServer.files.filter((f) => f.path !== path);
  return ok(updateDevice(t, id, (d) => ({ ...d, webServer: { files } })));
}

// --- E-Mail ------------------------------------------------------------------

export function setMailServerEnabled(t: Topology, id: string, enabled: boolean, domain = 'schule.ch'): Result<Topology> {
  const device = serverDevice(t, id);
  if (!device.ok) return device;
  if (enabled === !!device.value.mailServer) return ok(t);
  return ok(
    updateDevice(t, id, (d) => {
      const { mailServer: _m, ...rest } = d;
      return enabled ? { ...rest, mailServer: { domain: normalizeName(domain), mailboxes: [] } } : rest;
    }),
  );
}

export function setMailDomain(t: Topology, id: string, domain: string): Result<Topology> {
  const device = getDevice(t, id);
  const config = device?.mailServer;
  if (!config) return fail('serviceDisabled');
  if (!isValidName(domain)) return { ok: false, error: { code: 'invalidDnsName', params: { value: domain }, field: 'domain' } };
  return ok(updateDevice(t, id, (d) => ({ ...d, mailServer: { ...config, domain: normalizeName(domain) } })));
}

export function addMailbox(t: Topology, id: string, mailbox: Mailbox): Result<Topology> {
  const config = getDevice(t, id)?.mailServer;
  if (!config) return fail('serviceDisabled');
  const issue = checkMailbox(config, mailbox);
  if (issue) return { ok: false, error: { code: issue.code as ErrorCode, params: issue.params, field: issue.field } };
  const entry = { user: mailbox.user.trim().toLowerCase(), password: mailbox.password };
  return ok(updateDevice(t, id, (d) => ({ ...d, mailServer: { ...config, mailboxes: [...config.mailboxes, entry] } })));
}

export function removeMailbox(t: Topology, id: string, user: string): Result<Topology> {
  const config = getDevice(t, id)?.mailServer;
  if (!config?.mailboxes.some((m) => m.user === user)) return fail('unknownMailbox');
  const mailboxes = config.mailboxes.filter((m) => m.user !== user);
  return ok(updateDevice(t, id, (d) => ({ ...d, mailServer: { ...config, mailboxes } })));
}

/** E-Mail-Konto eines Endgeräts einrichten oder entfernen (`null`). */
export function setMailAccount(t: Topology, id: string, account: MailAccount | null): Result<Topology> {
  const device = getDevice(t, id);
  if (!device) return fail('unknownDevice');
  if (DEVICE_SPECS[device.type].role !== 'endpoint') return fail('notAnEndpoint');
  if (account) {
    const issue = checkMailAccount(account);
    if (issue) return { ok: false, error: { code: issue.code as ErrorCode, params: issue.params, field: issue.field } };
  }
  return ok(
    updateDevice(t, id, (d) => {
      const { mailAccount: _a, ...rest } = d;
      if (!account) return rest;
      return {
        ...rest,
        mailAccount: {
          ...account,
          address: account.address.trim().toLowerCase(),
          smtpServer: account.smtpServer.trim().toLowerCase(),
          incomingServer: account.incomingServer.trim().toLowerCase(),
        },
      };
    }),
  );
}

export function addStaticRoute(t: Topology, id: string, route: StaticRoute): Result<Topology> {
  const device = getDevice(t, id);
  if (!device) return fail('unknownDevice');
  if (!hasRoutingTable(device.type)) return fail('notARouter');
  const issue = checkStaticRoute(device, route);
  if (issue) return { ok: false, error: { code: issue.code as ErrorCode, params: issue.params, field: issue.field } };
  return ok(updateDevice(t, id, (d) => ({ ...d, routes: [...(d.routes ?? []), normalizeRoute(route)] })));
}

export function removeStaticRoute(t: Topology, id: string, index: number): Result<Topology> {
  const device = getDevice(t, id);
  if (!device) return fail('unknownDevice');
  if (!device.routes?.[index]) return fail('unknownRoute');
  return ok(
    updateDevice(t, id, (d) => {
      const routes = (d.routes ?? []).filter((_, i) => i !== index);
      const { routes: _r, ...rest } = d;
      return routes.length ? { ...rest, routes } : rest;
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

// --- Anschlüsse: Abschalten, Farbe, Beschreibung -------------------------------

export function setInterfaceShutdown(t: Topology, id: string, index: number, shutdown: boolean): Result<Topology> {
  const device = getDevice(t, id);
  if (!device) return fail('unknownDevice');
  if (!device.interfaces[index]) return fail('unknownInterface');
  return ok(
    updatePort(t, id, index, (i) => {
      const { shutdown: _s, ...base } = i;
      return shutdown ? { ...base, shutdown: true } : base;
    }),
  );
}

export function setInterfaceColor(t: Topology, id: string, index: number, color: TagColor | null): Result<Topology> {
  const device = getDevice(t, id);
  if (!device) return fail('unknownDevice');
  if (!device.interfaces[index]) return fail('unknownInterface');
  return ok(
    updatePort(t, id, index, (i) => {
      const { color: _c, ...base } = i;
      return color ? { ...base, color } : base;
    }),
  );
}

export function setInterfaceDescription(t: Topology, id: string, index: number, description: string): Result<Topology> {
  const device = getDevice(t, id);
  if (!device) return fail('unknownDevice');
  if (!device.interfaces[index]) return fail('unknownInterface');
  const value = description.trim();
  if (value.length > 80) return fail('textTooLong', { max: 80 });
  return ok(
    updatePort(t, id, index, (i) => {
      const { description: _d, ...base } = i;
      return value ? { ...base, description: value } : base;
    }),
  );
}

// --- WLAN ----------------------------------------------------------------------

export const CHANNELS: Record<'2.4' | '5', number[]> = {
  '2.4': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
  '5': [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140],
};

function checkSsid(ssid: string): ErrorCode | null {
  const value = ssid.trim();
  return value.length < 1 || value.length > 32 ? 'invalidSsid' : null;
}

/** WPA2: leer (offen) oder 8–63 Zeichen. */
function checkWifiPassword(password: string | undefined): ErrorCode | null {
  if (!password) return null;
  return password.length < 8 || password.length > 63 ? 'invalidPassword' : null;
}

/** Funknetz eines Access Points einrichten oder ausschalten (`null`). */
export function setWlan(t: Topology, id: string, config: WlanConfig | null): Result<Topology> {
  const device = getDevice(t, id);
  if (!device) return fail('unknownDevice');
  if (device.type !== 'accesspoint') return fail('wirelessNeedsAccessPoint');
  if (config) {
    const ssid = checkSsid(config.ssid);
    if (ssid) return { ok: false, error: { code: ssid, field: 'ssid' } };
    const pw = checkWifiPassword(config.password);
    if (pw) return { ok: false, error: { code: pw, field: 'password' } };
    if (!CHANNELS[config.band]?.includes(config.channel)) return { ok: false, error: { code: 'invalidChannel', field: 'channel' } };
  }
  return ok(
    updateDevice(t, id, (d) => {
      const { wlan: _w, ...rest } = d;
      if (!config) return rest;
      const wlan: WlanConfig = { ssid: config.ssid.trim(), band: config.band, channel: config.channel };
      if (config.password) wlan.password = config.password;
      if (config.mesh) wlan.mesh = true;
      return { ...rest, wlan };
    }),
  );
}

/** WLAN-Profil eines Endgeräts (SSID und Passwort) setzen oder entfernen. */
export function setWifiClient(t: Topology, id: string, client: WifiClient | null): Result<Topology> {
  const device = getDevice(t, id);
  if (!device) return fail('unknownDevice');
  if (DEVICE_SPECS[device.type].role !== 'endpoint') return fail('notAnEndpoint');
  if (client) {
    const ssid = checkSsid(client.ssid);
    if (ssid) return { ok: false, error: { code: ssid, field: 'ssid' } };
  }
  return ok(
    updateDevice(t, id, (d) => {
      const { wifi: _w, ...rest } = d;
      if (!client) return rest;
      return { ...rest, wifi: { ssid: client.ssid.trim(), ...(client.password ? { password: client.password } : {}) } };
    }),
  );
}

// --- Stockwerke --------------------------------------------------------------

export function floorsOf(t: Topology): { name: string }[] {
  return t.floors?.length ? t.floors : [{ name: '' }];
}

export function addFloor(t: Topology, name: string): Result<Topology> {
  const value = name.trim();
  if (!value) return fail('nameEmpty');
  if (value.length > 40) return fail('nameTooLong', { max: 40 });
  const existing = t.floors?.length ? t.floors : [{ name: value === 'EG' ? 'UG' : 'EG' }];
  return ok({ ...t, floors: [...existing, { name: value }] });
}

export function renameFloor(t: Topology, index: number, name: string): Result<Topology> {
  const floors = floorsOf(t);
  if (!floors[index]) return fail('unknownFloor');
  const value = name.trim();
  if (!value) return fail('nameEmpty');
  if (value.length > 40) return fail('nameTooLong', { max: 40 });
  return ok({ ...t, floors: floors.map((f, i) => (i === index ? { name: value } : f)) });
}

/** Entfernt ein Stockwerk; Geräte und Bereiche darauf rutschen ins darunterliegende. */
export function removeFloor(t: Topology, index: number): Result<Topology> {
  const floors = floorsOf(t);
  if (!floors[index]) return fail('unknownFloor');
  if (floors.length <= 1) return fail('lastFloor');
  const shift = (floor: number | undefined) => {
    const f = floor ?? 0;
    return f > index ? f - 1 : f === index ? Math.max(0, index - 1) : f;
  };
  const rest = floors.filter((_, i) => i !== index);
  return ok({
    ...t,
    floors: rest,
    devices: t.devices.map((d) => {
      const { floor: _f, ...base } = d;
      const f = shift(d.floor);
      return f ? { ...base, floor: f } : base;
    }),
    areas: t.areas?.map((a) => (a.floor === undefined ? a : { ...a, floor: shift(a.floor) })),
  });
}

export function setDeviceFloor(t: Topology, id: string, floor: number): Result<Topology> {
  const device = getDevice(t, id);
  if (!device) return fail('unknownDevice');
  if (!floorsOf(t)[floor]) return fail('unknownFloor');
  return ok(
    updateDevice(t, id, (d) => {
      const { floor: _f, ...rest } = d;
      return floor ? { ...rest, floor } : rest;
    }),
  );
}

// --- Dokumentationsmodus: Bereiche ---------------------------------------------

export function addArea(t: Topology, area: Omit<DocArea, 'id'>): Result<{ topology: Topology; id: string }> {
  const id = `a${t.nextId}`;
  const checked = checkArea({ ...area, id });
  if (!checked.ok) return checked;
  return ok({ topology: { ...t, areas: [...(t.areas ?? []), checked.value], nextId: t.nextId + 1 }, id });
}

function checkArea(area: DocArea): Result<DocArea> {
  if (area.title.length > 80) return fail('textTooLong', { max: 80 });
  if ((area.note ?? '').length > 2000) return fail('textTooLong', { max: 2000 });
  if (area.vlan !== undefined && (!Number.isInteger(area.vlan) || area.vlan < 1 || area.vlan > 4094)) return fail('invalidVlan');
  const clean: DocArea = {
    id: area.id,
    ...(area.kind === 'rack' ? { kind: 'rack' as const } : {}),
    title: area.title,
    color: area.color,
    x: Math.round(area.x),
    y: Math.round(area.y),
    width: Math.max(40, Math.round(area.width)),
    height: Math.max(40, Math.round(area.height)),
  };
  if (area.network?.trim()) clean.network = area.network.trim();
  if (area.vlan !== undefined) clean.vlan = area.vlan;
  if (area.note?.trim()) clean.note = area.note;
  if (area.floor !== undefined) clean.floor = area.floor;
  return ok(clean);
}

export function updateArea(t: Topology, id: string, change: Partial<Omit<DocArea, 'id'>>): Result<Topology> {
  const area = t.areas?.find((a) => a.id === id);
  if (!area) return fail('unknownArea');
  const merged: DocArea = { ...area, ...change, id };
  for (const key of Object.keys(change) as (keyof DocArea)[]) {
    if (change[key as keyof typeof change] === undefined) delete merged[key];
  }
  const checked = checkArea(merged);
  if (!checked.ok) return checked;
  const next = { ...t, areas: t.areas!.map((a) => (a.id === id ? checked.value : a)) };
  // Ein verschobenes Rack nimmt seine Geräte mit.
  return ok(area.kind === 'rack' ? arrangeRack(next, id) : next);
}

export function removeArea(t: Topology, id: string): Result<Topology> {
  if (!t.areas?.some((a) => a.id === id)) return fail('unknownArea');
  const areas = t.areas.filter((a) => a.id !== id);
  const { areas: _a, ...rest } = t;
  // Geräte eines entfernten Racks bleiben an ihrem Platz, sind aber nicht mehr eingebaut.
  const devices = t.devices.map((d) => {
    if (d.rack !== id) return d;
    const { rack: _r, ...base } = d;
    return base;
  });
  return ok(areas.length ? { ...rest, devices, areas } : { ...rest, devices });
}

// --- Befehlszeile ---------------------------------------------------------------

export function setCliConfig(t: Topology, id: string, cli: CliConfig): Result<Topology> {
  const device = getDevice(t, id);
  if (!device) return fail('unknownDevice');
  for (const user of cli.users ?? []) {
    if (!/^[A-Za-z0-9._-]{1,32}$/.test(user.name)) return fail('invalidUser', { name: user.name });
    if (!user.password || user.password.length > 64) return fail('passwordRequired');
  }
  if ((cli.banner ?? '').length > 500) return fail('textTooLong', { max: 500 });
  const clean: CliConfig = {};
  if (cli.ssh) clean.ssh = true;
  if (cli.users?.length) clean.users = cli.users.map((u) => ({ name: u.name, password: u.password }));
  if (cli.enableSecret) clean.enableSecret = cli.enableSecret;
  if (cli.banner) clean.banner = cli.banner;
  return ok(
    updateDevice(t, id, (d) => {
      const { cli: _c, ...rest } = d;
      return Object.keys(clean).length ? { ...rest, cli: clean } : rest;
    }),
  );
}

/** Name eines VLANs am Switch setzen oder entfernen (""). */
export function setVlanName(t: Topology, id: string, vlan: number, name: string): Result<Topology> {
  const device = getDevice(t, id);
  if (!device) return fail('unknownDevice');
  if (!isSwitchType(device.type)) return fail('notASwitch');
  if (!Number.isInteger(vlan) || vlan < 1 || vlan > 4094) return fail('invalidVlan');
  const value = name.trim();
  if (value.length > 32) return fail('textTooLong', { max: 32 });
  const list = (device.vlanNames ?? []).filter((v) => v.vlan !== vlan);
  if (value) list.push({ vlan, name: value });
  list.sort((a, b) => a.vlan - b.vlan);
  return ok(
    updateDevice(t, id, (d) => {
      const { vlanNames: _v, ...rest } = d;
      return list.length ? { ...rest, vlanNames: list } : rest;
    }),
  );
}

// --- SFP-Module ------------------------------------------------------------------

/** Modul in einen bestimmten SFP-Einschub stecken oder entfernen (`null`). */
export function setSfpModule(t: Topology, id: string, index: number, module: SfpModule | null): Result<Topology> {
  const device = getDevice(t, id);
  if (!device) return fail('unknownDevice');
  const iface = device.interfaces[index];
  if (!iface) return fail('unknownInterface');
  if (!iface.sfpSlot) return fail('notAnSfpSlot');
  return ok(
    updatePort(t, id, index, (i) => {
      const { sfp: _s, ...base } = i;
      return module ? { ...base, sfp: module } : base;
    }),
  );
}

/** Modul in den ersten leeren SFP-Einschub stecken (aus der Palette). */
export function insertSfpModule(t: Topology, id: string, module: SfpModule): Result<{ topology: Topology; index: number }> {
  const device = getDevice(t, id);
  if (!device) return fail('unknownDevice');
  const slot = device.interfaces.find((i) => i.sfpSlot && !i.sfp);
  if (!slot) return fail('noFreeSfpSlot', { device: device.name });
  const next = setSfpModule(t, id, slot.index, module);
  return next.ok ? ok({ topology: next.value, index: slot.index }) : next;
}

// --- Racks -----------------------------------------------------------------------

/** Höhe einer Höheneinheit auf der Zeichenfläche und Kopfzeile des Racks. */
export const RACK_UNIT = 74;
export const RACK_HEADER = 44;

/** Geräte eines Racks von oben nach unten anordnen; das Rack wächst bei Bedarf mit. */
export function arrangeRack(t: Topology, rackId: string): Topology {
  const rack = t.areas?.find((a) => a.id === rackId && a.kind === 'rack');
  if (!rack) return t;
  const members = t.devices.filter((d) => d.rack === rackId).sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
  const height = Math.max(rack.height, RACK_HEADER + members.length * RACK_UNIT + 20);
  const slot = new Map(members.map((d, i) => [d.id, i]));
  return {
    ...t,
    areas: t.areas!.map((a) => (a.id === rackId ? { ...a, height } : a)),
    devices: t.devices.map((d) => {
      const i = slot.get(d.id);
      if (i === undefined) return d;
      const position = { x: Math.round(rack.x + rack.width / 2), y: Math.round(rack.y + RACK_HEADER + i * RACK_UNIT + RACK_UNIT / 2) };
      return { ...d, position, ...(rack.floor !== undefined && rack.floor > 0 ? { floor: rack.floor } : {}) };
    }),
  };
}

/**
 * Gerät in ein Rack einbauen oder ausbauen (`null`). Ohne `keepOrder` kommt es
 * zuunterst; mit `keepOrder` (beim Ablegen per Maus) zählt seine Höhe.
 */
export function setDeviceRack(t: Topology, id: string, rackId: string | null, keepOrder = false): Result<Topology> {
  const device = getDevice(t, id);
  if (!device) return fail('unknownDevice');
  if (rackId === null) {
    if (!device.rack) return ok(t);
    const previous = device.rack;
    const without = updateDevice(t, id, (d) => {
      const { rack: _r, ...rest } = d;
      return rest;
    });
    return ok(arrangeRack(without, previous));
  }
  if (!isRackable(device.type)) return fail('notRackable');
  const rack = t.areas?.find((a) => a.id === rackId);
  if (!rack || rack.kind !== 'rack') return fail('notARack');
  const bottom = { x: device.position.x, y: rack.y + rack.height + 10_000 };
  let next = updateDevice(t, id, (d) => ({ ...d, rack: rackId, ...(keepOrder || d.rack === rackId ? {} : { position: bottom }) }));
  if (device.rack && device.rack !== rackId) next = arrangeRack(next, device.rack);
  return ok(arrangeRack(next, rackId));
}

/** Rack, dessen Fläche den Punkt enthält (für Ziehen und Ablegen). */
export function rackAt(t: Topology, x: number, y: number, floor?: number): DocArea | undefined {
  return t.areas?.find(
    (a) =>
      a.kind === 'rack' &&
      (floor === undefined || a.floor === undefined || a.floor === floor) &&
      x >= a.x && x <= a.x + a.width && y >= a.y && y <= a.y + a.height,
  );
}
