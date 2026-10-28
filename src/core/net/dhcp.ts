import type { Device, DhcpServerConfig } from '../model/types';
import { broadcastOf, formatIp, networkOf, parseIp, parseMask } from './ipv4';

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
  return result;
}
