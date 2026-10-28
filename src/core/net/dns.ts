import type { DnsRecord, DnsServerConfig } from '../model/types';
import { parseIp } from './ipv4';

export const DEFAULT_DNS_TTL = 300;
export const MAX_DNS_TTL = 86_400;

/** Kleinbuchstaben, ohne abschliessenden Punkt: "WWW.Schule.CH." → "www.schule.ch". */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\.$/, '');
}

/** Hostnamen nach RFC 1123: Labels aus Buchstaben, Ziffern und Bindestrich, getrennt durch Punkte. */
export function isValidName(name: string): boolean {
  const n = normalizeName(name);
  if (!n || n.length > 253) return false;
  return n.split('.').every((label) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}

export interface DnsIssue {
  code: string;
  field: 'name' | 'type' | 'value' | 'ttl';
  params?: Record<string, string | number>;
}

export function checkDnsRecord(config: DnsServerConfig | undefined, record: DnsRecord): DnsIssue | null {
  if (!isValidName(record.name)) return { code: 'invalidDnsName', field: 'name', params: { value: record.name } };
  if (record.type === 'A' && parseIp(record.value) === null) {
    return { code: 'invalidIp', field: 'value', params: { value: record.value } };
  }
  if (record.type === 'MX' && !isValidName(record.value)) {
    return { code: 'invalidDnsName', field: 'value', params: { value: record.value } };
  }
  if (!Number.isInteger(record.ttl) || record.ttl < 0 || record.ttl > MAX_DNS_TTL) {
    return { code: 'dnsTtl', field: 'ttl', params: { max: MAX_DNS_TTL } };
  }
  const normalized = normalizeRecord(record);
  const duplicate = (config?.records ?? []).some(
    (r) => r.name === normalized.name && r.type === normalized.type && r.value === normalized.value,
  );
  if (duplicate) return { code: 'duplicateRecord', field: 'name', params: { name: normalized.name } };
  return null;
}

export function normalizeRecord(record: DnsRecord): DnsRecord {
  return {
    name: normalizeName(record.name),
    type: record.type,
    value: record.type === 'MX' ? normalizeName(record.value) : record.value.trim(),
    ttl: record.ttl,
  };
}

/** Antwort eines DNS-Servers aus seiner Zone (ohne Rekursion). */
export function lookupRecords(config: DnsServerConfig, name: string, type: DnsRecord['type']): DnsRecord[] {
  const wanted = normalizeName(name);
  return config.records.filter((r) => r.name === wanted && r.type === type);
}
