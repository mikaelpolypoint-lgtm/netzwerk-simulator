import type { ErrorCode, TopologyError } from '../model/topology';
import type { BgpConfig, OspfConfig, RedistributeSource, RipConfig, RoutedNetwork } from '../model/types';
import { formatIp, maskToText, networkOf, parseIp, parseMask } from './ipv4';

/**
 * Prüfung und Vereinheitlichung der Konfiguration für dynamisches Routing
 * (OSPF, BGP, RIP). Die Protokolle selbst laufen in sim/ospf.ts usw.
 */

const issue = (code: ErrorCode, field: string, params?: TopologyError['params']): TopologyError => ({ code, field, ...(params ? { params } : {}) });

export const REDISTRIBUTE_SOURCES: readonly RedistributeSource[] = ['connected', 'static', 'ospf', 'bgp', 'rip'];

/** Netz mit Präfix: Hostbits sind nicht erlaubt (wie «network 10.0.0.0/24» in FRRouting). */
function checkNetwork(n: RoutedNetwork, field: string): TopologyError | null {
  const ip = parseIp(n.network);
  if (ip === null) return issue('invalidIp', field, { value: n.network });
  const prefix = parseMask(n.mask);
  if (prefix === null) return issue('invalidMask', field, { value: n.mask });
  if (networkOf(ip, prefix) !== ip) return issue('networkHasHostBits', field, { value: n.network, suggestion: `${formatIp(networkOf(ip, prefix))}/${prefix}` });
  return null;
}

function normalizeNetwork<T extends RoutedNetwork>(n: T): T {
  return { ...n, network: n.network.trim(), mask: maskToText(parseMask(n.mask) ?? 0) };
}

function checkNetworks(list: RoutedNetwork[], field: string): TopologyError | null {
  const seen = new Set<string>();
  for (const [i, n] of list.entries()) {
    const problem = checkNetwork(n, `${field}.${i}`);
    if (problem) return problem;
    const key = `${n.network.trim()}/${parseMask(n.mask)}`;
    if (seen.has(key)) return issue('duplicateNetwork', field, { net: key });
    seen.add(key);
  }
  return null;
}

function checkRouterId(id: string | undefined): TopologyError | null {
  return id !== undefined && id.trim() !== '' && parseIp(id) === null ? issue('invalidIp', 'routerId', { value: id }) : null;
}

const cleanRedistribute = (list: RedistributeSource[] | undefined, self: RedistributeSource) =>
  [...new Set((list ?? []).filter((s) => REDISTRIBUTE_SOURCES.includes(s) && s !== self))];

export function checkOspf(c: OspfConfig): TopologyError | null {
  const id = checkRouterId(c.routerId);
  if (id) return id;
  for (const [i, n] of c.networks.entries()) {
    if (!Number.isInteger(n.area) || n.area < 0 || n.area > 4294967295) return issue('invalidArea', `networks.${i}`);
  }
  return checkNetworks(c.networks, 'networks');
}

export function normalizeOspf(c: OspfConfig): OspfConfig {
  const redistribute = cleanRedistribute(c.redistribute, 'ospf');
  return {
    ...(c.routerId?.trim() ? { routerId: c.routerId.trim() } : {}),
    networks: c.networks.map(normalizeNetwork),
    ...(c.passive?.length ? { passive: [...new Set(c.passive)].sort((a, b) => a - b) } : {}),
    ...(c.defaultOriginate ? { defaultOriginate: true } : {}),
    ...(redistribute.length ? { redistribute } : {}),
  };
}

export const isValidAsn = (asn: number) => Number.isInteger(asn) && asn >= 1 && asn <= 4294967295;

export function checkBgp(c: BgpConfig): TopologyError | null {
  if (!isValidAsn(c.asn)) return issue('invalidAsn', 'asn', { value: c.asn });
  const id = checkRouterId(c.routerId);
  if (id) return id;
  const seen = new Set<string>();
  for (const [i, n] of c.neighbors.entries()) {
    if (parseIp(n.ip) === null) return issue('invalidIp', `neighbors.${i}`, { value: n.ip });
    if (!isValidAsn(n.remoteAs)) return issue('invalidAsn', `neighbors.${i}`, { value: n.remoteAs });
    if (seen.has(n.ip.trim())) return issue('duplicateNeighbor', `neighbors.${i}`, { ip: n.ip });
    seen.add(n.ip.trim());
  }
  return checkNetworks(c.networks, 'networks');
}

export function normalizeBgp(c: BgpConfig): BgpConfig {
  const redistribute = cleanRedistribute(c.redistribute, 'bgp');
  return {
    asn: c.asn,
    ...(c.routerId?.trim() ? { routerId: c.routerId.trim() } : {}),
    neighbors: c.neighbors.map((n) => ({ ip: n.ip.trim(), remoteAs: n.remoteAs })),
    networks: c.networks.map(normalizeNetwork),
    ...(redistribute.length ? { redistribute } : {}),
  };
}

export function checkRip(c: RipConfig): TopologyError | null {
  return checkNetworks(c.networks, 'networks');
}

export function normalizeRip(c: RipConfig): RipConfig {
  const redistribute = cleanRedistribute(c.redistribute, 'rip');
  return {
    networks: c.networks.map(normalizeNetwork),
    ...(c.passive?.length ? { passive: [...new Set(c.passive)].sort((a, b) => a - b) } : {}),
    ...(c.defaultOriginate ? { defaultOriginate: true } : {}),
    ...(redistribute.length ? { redistribute } : {}),
  };
}

/** Liegt die Adresse in einem der Netze? (Interfaces nehmen dann am Protokoll teil.) */
export function inNetworks<T extends RoutedNetwork>(ip: number, list: readonly T[]): T | undefined {
  return list.find((n) => {
    const net = parseIp(n.network);
    const prefix = parseMask(n.mask);
    return net !== null && prefix !== null && networkOf(ip, prefix) === net;
  });
}
