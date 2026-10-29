import { addressScope, broadcastOf, formatIp, maskToText, networkOf, parseIp, parseMask, prefixToMask, type AddressScope } from './ipv4';

/** Ergebnis des IP-Rechners für eine Adresse mit Präfix. */
export interface SubnetInfo {
  ip: string;
  prefix: number;
  network: string;
  broadcast: string;
  first: string;
  last: string;
  /** Nutzbare Adressen (bei /31 zwei, bei /32 eine). */
  hosts: number;
  mask: string;
  wildcard: string;
  /** Binärdarstellung mit Punkten, z.B. "11000000.10101000.00000001.00001010". */
  ipBinary: string;
  maskBinary: string;
  scope: AddressScope;
  /** Historische Adressklasse (A–E), nur zur Information. */
  addressClass: 'A' | 'B' | 'C' | 'D' | 'E';
}

const binary = (n: number) => [24, 16, 8, 0].map((s) => ((n >>> s) & 0xff).toString(2).padStart(8, '0')).join('.');

/** Liest «192.168.1.10/24», «192.168.1.10 255.255.255.0» oder Adresse und Maske getrennt. */
export function parseAddressInput(text: string, maskText = ''): { ip: number; prefix: number } | null {
  const [left = '', right = ''] = text.trim().split(/[\s/]+/);
  const ip = parseIp(left);
  const prefix = parseMask(right || maskText);
  return ip === null || prefix === null ? null : { ip, prefix };
}

export function subnetInfo(ip: number, prefix: number): SubnetInfo {
  const network = networkOf(ip, prefix);
  const broadcast = broadcastOf(ip, prefix);
  const size = 2 ** (32 - prefix);
  const first = prefix >= 31 ? network : network + 1;
  const last = prefix >= 31 ? broadcast : broadcast - 1;
  const firstOctet = ip >>> 24;
  return {
    ip: formatIp(ip),
    prefix,
    network: formatIp(network),
    broadcast: formatIp(broadcast),
    first: formatIp(first),
    last: formatIp(last),
    hosts: prefix >= 31 ? size : size - 2,
    mask: maskToText(prefix),
    wildcard: formatIp(~prefixToMask(prefix) >>> 0),
    ipBinary: binary(ip),
    maskBinary: binary(prefixToMask(prefix)),
    scope: addressScope(ip),
    addressClass: firstOctet < 128 ? 'A' : firstOctet < 192 ? 'B' : firstOctet < 224 ? 'C' : firstOctet < 240 ? 'D' : 'E',
  };
}

/** Kleinstes Präfix (grösstes Netz), das `hosts` nutzbare Adressen bietet. */
export function prefixForHosts(hosts: number): number | null {
  for (let prefix = 30; prefix >= 1; prefix--) if (2 ** (32 - prefix) - 2 >= hosts) return prefix;
  return null;
}

/** Netz in `count` gleich grosse Teilnetze aufteilen (count wird auf die nächste Zweierpotenz aufgerundet). */
export function splitEqual(network: number, prefix: number, count: number): SubnetInfo[] | null {
  const bits = Math.ceil(Math.log2(Math.max(1, count)));
  const next = prefix + bits;
  if (next > 30 || count < 1) return null;
  const base = networkOf(network, prefix);
  const size = 2 ** (32 - next);
  return Array.from({ length: 2 ** bits }, (_, i) => subnetInfo((base + i * size) >>> 0, next));
}

/**
 * VLSM: Teilnetze für die gewünschten Host-Zahlen, grösste zuerst, lückenlos
 * hintereinander. null, wenn der Platz nicht reicht.
 */
export function splitByHosts(network: number, prefix: number, needs: number[]): { hosts: number; subnet: SubnetInfo }[] | null {
  const base = networkOf(network, prefix);
  const end = base + 2 ** (32 - prefix);
  const order = needs.map((hosts, i) => ({ hosts, i })).sort((a, b) => b.hosts - a.hosts);
  let cursor = base;
  const result: { hosts: number; subnet: SubnetInfo; i: number }[] = [];
  for (const { hosts, i } of order) {
    const p = prefixForHosts(hosts);
    if (p === null || p < prefix) return null;
    const size = 2 ** (32 - p);
    cursor = Math.ceil(cursor / size) * size;
    if (cursor + size > end) return null;
    result.push({ hosts, subnet: subnetInfo(cursor >>> 0, p), i });
    cursor += size;
  }
  return result.sort((a, b) => a.i - b.i).map(({ hosts, subnet }) => ({ hosts, subnet }));
}
