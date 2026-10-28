import type { Device, DhcpScope, DhcpServerConfig } from '../model/types';
import { broadcastOf, formatIp, maskToText, networkOf, parseIp, parseMask } from './ipv4';

export const DEFAULT_LEASE_TIME = 3600;
export const MIN_LEASE_TIME = 30;
export const MAX_LEASE_TIME = 7 * 24 * 3600;

export interface DhcpIssue {
  code: string;
  field: 'start' | 'end' | 'gateway' | 'dns' | 'leaseTime' | 'server';
  params?: Record<string, string | number>;
}

/** Ein DHCP-Server vergibt Adressen aus seinem eigenen Netz; dafür braucht er selbst eine feste Adresse. */
export function checkDhcpServer(device: Device, config: DhcpServerConfig): DhcpIssue | null {
  if (device.type !== 'pc') return { code: 'notAServer', field: 'server' };
  const ownIp = device.interfaces[0]?.ip ? parseIp(device.interfaces[0].ip) : null;
  const prefix = device.interfaces[0]?.mask ? parseMask(device.interfaces[0].mask) : null;
  if (device.dhcp || ownIp === null || prefix === null) return { code: 'dhcpServerNeedsAddress', field: 'server' };

  const start = parseIp(config.start);
  if (start === null) return { code: 'invalidIp', field: 'start', params: { value: config.start } };
  const end = parseIp(config.end);
  if (end === null) return { code: 'invalidIp', field: 'end', params: { value: config.end } };
  const net = `${formatIp(networkOf(ownIp, prefix))}/${prefix}`;
  for (const [field, ip, text] of [['start', start, config.start], ['end', end, config.end]] as const) {
    if (networkOf(ip, prefix) !== networkOf(ownIp, prefix)) {
      return { code: 'dhcpRangeOutsideSubnet', field, params: { ip: text, net } };
    }
  }
  if (start > end) return { code: 'dhcpRangeOrder', field: 'end' };
  if (prefix <= 30 && (start === networkOf(ownIp, prefix) || end === broadcastOf(ownIp, prefix))) {
    return { code: 'dhcpRangeReserved', field: start === networkOf(ownIp, prefix) ? 'start' : 'end', params: { net } };
  }
  if (config.gateway && parseIp(config.gateway) === null) {
    return { code: 'invalidIp', field: 'gateway', params: { value: config.gateway } };
  }
  if (config.dns && parseIp(config.dns) === null) return { code: 'invalidIp', field: 'dns', params: { value: config.dns } };
  if (!Number.isInteger(config.leaseTime) || config.leaseTime < MIN_LEASE_TIME || config.leaseTime > MAX_LEASE_TIME) {
    return { code: 'dhcpLeaseTime', field: 'leaseTime', params: { min: MIN_LEASE_TIME, max: MAX_LEASE_TIME } };
  }
  return null;
}

export function normalizeDhcpServer(config: DhcpServerConfig): DhcpServerConfig {
  const result: DhcpServerConfig = { start: config.start.trim(), end: config.end.trim(), leaseTime: config.leaseTime };
  if (config.gateway?.trim()) result.gateway = config.gateway.trim();
  if (config.dns?.trim()) result.dns = config.dns.trim();
  if (config.scopes?.length) result.scopes = config.scopes.map(normalizeScope);
  return result;
}

export interface ScopeIssue {
  code: string;
  field: 'start' | 'end' | 'mask' | 'gateway' | 'dns';
  params?: Record<string, string | number>;
}

/** Zusätzlicher Bereich für ein entferntes Netz: alle Adressen im selben Netz, ohne Netz- und Broadcastadresse. */
export function checkDhcpScope(scope: DhcpScope): ScopeIssue | null {
  const start = parseIp(scope.start);
  if (start === null) return { code: 'invalidIp', field: 'start', params: { value: scope.start } };
  const end = parseIp(scope.end);
  if (end === null) return { code: 'invalidIp', field: 'end', params: { value: scope.end } };
  const prefix = parseMask(scope.mask);
  if (prefix === null) return { code: 'invalidMask', field: 'mask', params: { value: scope.mask } };
  const net = `${formatIp(networkOf(start, prefix))}/${prefix}`;
  if (networkOf(end, prefix) !== networkOf(start, prefix)) {
    return { code: 'dhcpRangeOutsideSubnet', field: 'end', params: { ip: scope.end, net } };
  }
  if (start > end) return { code: 'dhcpRangeOrder', field: 'end' };
  if (prefix <= 30 && (start === networkOf(start, prefix) || end === broadcastOf(start, prefix))) {
    return { code: 'dhcpRangeReserved', field: 'start', params: { net } };
  }
  if (scope.gateway && parseIp(scope.gateway) === null) return { code: 'invalidIp', field: 'gateway', params: { value: scope.gateway } };
  if (scope.dns && parseIp(scope.dns) === null) return { code: 'invalidIp', field: 'dns', params: { value: scope.dns } };
  return null;
}

export function normalizeScope(scope: DhcpScope): DhcpScope {
  const result: DhcpScope = { start: scope.start.trim(), end: scope.end.trim(), mask: maskToText(parseMask(scope.mask) ?? 24) };
  if (scope.gateway?.trim()) result.gateway = scope.gateway.trim();
  if (scope.dns?.trim()) result.dns = scope.dns.trim();
  return result;
}

export interface ResolvedScope {
  start: number;
  end: number;
  prefix: number;
  gateway?: string;
  dns?: string;
}

/**
 * Bereich, aus dem der Server vergibt: ohne Relay der eigene, mit Relay
 * derjenige, in dessen Netz die Relay-Adresse (giaddr) liegt.
 */
export function scopeFor(device: Device, giaddr?: string): ResolvedScope | null {
  const config = device.dhcpServer;
  const ownIp = device.interfaces[0]?.ip ? parseIp(device.interfaces[0].ip) : null;
  const ownPrefix = device.interfaces[0]?.mask ? parseMask(device.interfaces[0].mask) : null;
  if (!config || ownIp === null || ownPrefix === null) return null;
  const relay = giaddr ? parseIp(giaddr) : null;
  if (relay === null || networkOf(relay, ownPrefix) === networkOf(ownIp, ownPrefix)) {
    const start = parseIp(config.start);
    const end = parseIp(config.end);
    if (start === null || end === null || networkOf(start, ownPrefix) !== networkOf(ownIp, ownPrefix)) return null;
    return { start, end, prefix: ownPrefix, ...(config.gateway ? { gateway: config.gateway } : {}), ...(config.dns ? { dns: config.dns } : {}) };
  }
  for (const scope of config.scopes ?? []) {
    const start = parseIp(scope.start);
    const end = parseIp(scope.end);
    const prefix = parseMask(scope.mask);
    if (start === null || end === null || prefix === null) continue;
    if (networkOf(relay, prefix) !== networkOf(start, prefix)) continue;
    return { start, end, prefix, ...(scope.gateway ? { gateway: scope.gateway } : {}), ...(scope.dns ? { dns: scope.dns } : {}) };
  }
  return null;
}
