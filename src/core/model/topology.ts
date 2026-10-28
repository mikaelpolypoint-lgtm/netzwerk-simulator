import { checkDhcpServer, normalizeDhcpServer } from '../net/dhcp';
import { checkDnsRecord, isValidName, normalizeName, normalizeRecord } from '../net/dns';
import { isValidPath } from '../net/http';
import { checkMailAccount, checkMailbox } from '../net/mail';
import { checkHostConfig, maskToText, parseIp, parseMask, type HostConfigInput } from '../net/ipv4';
import { checkStaticRoute, normalizeRoute } from '../net/routing';
import { DEVICE_SPECS } from './devices';
import { macFor } from './mac';
import type {
  Cable,
  Device,
  DeviceType,
  DhcpServerConfig,
  DnsRecord,
  Endpoint,
  MailAccount,
  Mailbox,
  NetInterface,
  Point,
  StaticRoute,
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
  | 'invalidHost';

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
  if (isBridge(a) && isBridge(b) && bridged(t, a.id, b.id)) return fail('switchLoop', { a: a.name, b: b.name });
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

/**
 * Switches und Modems leiten Broadcasts an alle Ports weiter. Ohne Spanning
 * Tree würde eine Schleife zwischen ihnen einen endlosen Broadcast-Sturm
 * auslösen, darum verhindert der Editor solche Verbindungen.
 */
export function isBridge(device: Device): boolean {
  return device.type === 'switch' || device.type === 'modem';
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
    if (ra === rb) return cable;
    parent.set(ra, rb);
  }
  return undefined;
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
      const { dhcpServer: _s, ...rest } = d;
      return config ? { ...rest, dhcpServer: normalizeDhcpServer(config) } : rest;
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
  if (device.type !== 'router') return fail('notARouter');
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
