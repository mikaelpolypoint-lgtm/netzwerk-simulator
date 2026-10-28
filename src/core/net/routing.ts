import { DEVICE_SPECS } from '../model/devices';
import type { Device, StaticRoute } from '../model/types';
import { formatIp, maskToText, networkOf, parseIp, parseMask } from './ipv4';

export interface IfaceAddress {
  index: number;
  mac: string;
  ip: number;
  prefix: number;
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
  return device.interfaces.flatMap((i) => {
    const ip = i.ip ? parseIp(i.ip) : null;
    const prefix = i.mask ? parseMask(i.mask) : null;
    return ip !== null && prefix !== null ? [{ index: i.index, mac: i.mac, ip, prefix }] : [];
  });
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
  if (route.iface !== undefined && !device.interfaces[route.iface]) return { code: 'unknownInterface', field: 'iface' };
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
