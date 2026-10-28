import { DEVICE_SPECS } from '../model/devices';
import type { Device, StaticRoute } from '../model/types';
import { formatIp, maskToText, networkOf, parseIp, parseMask } from './ipv4';

export interface IfaceAddress {
  /** Logisches Interface (siehe `ifaceId`); bei physischen Anschlüssen deren Index. */
  index: number;
  mac: string;
  ip: number;
  prefix: number;
}

// --- Logische Interfaces -------------------------------------------------------
//
// Routen, ARP und Pakete beziehen sich auf logische Interfaces. Die Nummer
// verrät, worum es sich handelt, und bleibt stabil, wenn andere Subinterfaces
// hinzukommen oder wegfallen:
//   0 … 9999          physischer Anschluss (Index)
//   10000·(p+1) + v   Subinterface von Anschluss p für VLAN v (Router-on-a-Stick)
//   100000 + v        VLAN-Interface (SVI) eines Layer-3-Switches

export const SUBIF_BASE = 10_000;
export const SVI_BASE = 100_000;

export type IfaceRef = { kind: 'port'; port: number } | { kind: 'sub'; port: number; vlan: number } | { kind: 'svi'; vlan: number };

export function subifId(port: number, vlan: number): number {
  return SUBIF_BASE * (port + 1) + vlan;
}

export function sviId(vlan: number): number {
  return SVI_BASE + vlan;
}

export function decodeIface(id: number): IfaceRef {
  if (id >= SVI_BASE) return { kind: 'svi', vlan: id - SVI_BASE };
  if (id >= SUBIF_BASE) return { kind: 'sub', port: Math.floor(id / SUBIF_BASE) - 1, vlan: id % SUBIF_BASE };
  return { kind: 'port', port: id };
}

/** MAC-Adresse der SVIs eines Layer-3-Switches: die des ersten Ports mit letztem Byte FF. */
export function sviMac(device: Device): string {
  const base = device.interfaces[0]?.mac ?? '02:00:00:00:00:00';
  return base.slice(0, 15) + 'FF';
}

/** MAC eines logischen Interfaces (Subinterfaces teilen sich die MAC ihres Anschlusses). */
export function macOfIface(device: Device, id: number): string | undefined {
  const ref = decodeIface(id);
  if (ref.kind === 'svi') return sviMac(device);
  return device.interfaces[ref.port]?.mac;
}

/** Alle logischen Interfaces eines Geräts, auch unkonfigurierte (für Auswahllisten). */
export function logicalInterfaces(device: Device): number[] {
  if (device.type === 'l3switch') return (device.svis ?? []).map((s) => sviId(s.vlan));
  return [...device.interfaces.map((i) => i.index), ...(device.subinterfaces ?? []).map((s) => subifId(s.parent, s.vlan))];
}

/** Ziel des DHCP-Relays auf einem logischen Interface. */
export function relayOf(device: Device, id: number): string | undefined {
  const ref = decodeIface(id);
  if (ref.kind === 'port') return device.interfaces[ref.port]?.dhcpRelay;
  if (ref.kind === 'sub') return device.subinterfaces?.find((s) => s.parent === ref.port && s.vlan === ref.vlan)?.dhcpRelay;
  return device.svis?.find((s) => s.vlan === ref.vlan)?.dhcpRelay;
}

export type RouteKind = 'connected' | 'static' | 'default';

export interface Route {
  network: number;
  prefix: number;
  iface: number;
  /** Nächster Router; null = Ziel liegt im direkt angeschlossenen Netz. */
  via: number | null;
  kind: RouteKind;
}

/** Alle Anschlüsse eines Geräts mit gültiger IP-Konfiguration. */
export function interfaceAddresses(device: Device): IfaceAddress[] {
  const addr = (index: number, mac: string | undefined, ipText?: string, maskText?: string): IfaceAddress[] => {
    const ip = ipText ? parseIp(ipText) : null;
    const prefix = maskText ? parseMask(maskText) : null;
    return mac && ip !== null && prefix !== null ? [{ index, mac, ip, prefix }] : [];
  };
  if (device.type === 'l3switch') {
    const mac = sviMac(device);
    return (device.svis ?? []).flatMap((s) => addr(sviId(s.vlan), mac, s.ip, s.mask));
  }
  return [
    ...device.interfaces.flatMap((i) => addr(i.index, i.mac, i.ip, i.mask)),
    ...(device.subinterfaces ?? []).flatMap((s) => addr(subifId(s.parent, s.vlan), device.interfaces[s.parent]?.mac, s.ip, s.mask)),
  ];
}

/** Längster Präfix gewinnt; bei Gleichstand die zuerst eingetragene Route. */
export function lookupRoute(routes: readonly Route[], dst: number): Route | undefined {
  let best: Route | undefined;
  for (const route of routes) {
    if (networkOf(dst, route.prefix) !== route.network) continue;
    if (!best || route.prefix > best.prefix) best = route;
  }
  return best;
}

/**
 * Routingtabelle eines Geräts: direkt verbundene Netze, dazu bei Endgeräten
 * das Standardgateway und bei Vermittlungsrechnern die statischen Routen.
 * `unusable` nennt statische Routen, deren Gateway in keinem angeschlossenen Netz liegt.
 */
export function buildRoutes(device: Device): { routes: Route[]; unusable: number[] } {
  const connected: Route[] = interfaceAddresses(device).map((i) => ({
    network: networkOf(i.ip, i.prefix),
    prefix: i.prefix,
    iface: i.index,
    via: null,
    kind: 'connected',
  }));
  const routes = [...connected];
  const unusable: number[] = [];

  if (DEVICE_SPECS[device.type].role === 'endpoint') {
    const gateway = device.gateway ? parseIp(device.gateway) : null;
    const towards = gateway !== null ? lookupRoute(connected, gateway) : undefined;
    if (gateway !== null && towards) {
      routes.push({ network: 0, prefix: 0, iface: towards.iface, via: gateway, kind: 'default' });
    }
    return { routes, unusable };
  }

  // Layer-3-Switch mit «no ip routing»: nur die eigenen Netze, keine Routen.
  if (device.type === 'l3switch' && device.ipRouting === false) return { routes, unusable };

  (device.routes ?? []).forEach((r, n) => {
    const network = parseIp(r.network);
    const prefix = parseMask(r.mask);
    const gateway = r.gateway ? parseIp(r.gateway) : null;
    if (network === null || prefix === null) return void unusable.push(n);
    // Ohne Gateway: Ziel ist über den Anschluss direkt erreichbar.
    const iface = gateway !== null ? (r.iface ?? lookupRoute(connected, gateway)?.iface) : r.iface;
    const ifaceOk = iface !== undefined && connected.some((c) => c.iface === iface);
    if (!ifaceOk) return void unusable.push(n);
    routes.push({ network: networkOf(network, prefix), prefix, iface, via: gateway, kind: 'static' });
  });
  return { routes, unusable };
}

export interface RouteIssue {
  code: string;
  field: 'network' | 'mask' | 'gateway' | 'iface';
  params?: Record<string, string | number>;
}

/** Prüft eine statische Route vor dem Eintragen. */
export function checkStaticRoute(device: Device, route: StaticRoute): RouteIssue | null {
  const network = parseIp(route.network);
  if (network === null) return { code: 'invalidIp', field: 'network', params: { value: route.network } };
  const prefix = parseMask(route.mask);
  if (prefix === null) return { code: 'invalidMask', field: 'mask', params: { value: route.mask } };
  if (networkOf(network, prefix) !== network) {
    return {
      code: 'networkHasHostBits',
      field: 'network',
      params: { value: route.network, suggestion: `${formatIp(networkOf(network, prefix))}/${prefix}` },
    };
  }
  if (route.gateway && parseIp(route.gateway) === null) {
    return { code: 'invalidIp', field: 'gateway', params: { value: route.gateway } };
  }
  if (route.iface !== undefined && !logicalInterfaces(device).includes(route.iface)) return { code: 'unknownInterface', field: 'iface' };
  if (!route.gateway && route.iface === undefined) return { code: 'routeNeedsTarget', field: 'gateway' };
  const duplicate = (device.routes ?? []).some((r) => r.network === route.network && parseMask(r.mask) === prefix);
  if (duplicate) return { code: 'duplicateRoute', field: 'network', params: { net: `${route.network}/${prefix}` } };
  return null;
}

/** Vereinheitlicht die Schreibweise einer geprüften Route. */
export function normalizeRoute(route: StaticRoute): StaticRoute {
  const prefix = parseMask(route.mask) ?? 0;
  const result: StaticRoute = { network: route.network.trim(), mask: maskToText(prefix) };
  if (route.gateway?.trim()) result.gateway = route.gateway.trim();
  if (route.iface !== undefined) result.iface = route.iface;
  return result;
}
