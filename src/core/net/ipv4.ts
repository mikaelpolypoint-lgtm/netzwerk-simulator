// IPv4-Adressen werden intern als vorzeichenlose 32-Bit-Zahlen gerechnet,
// in Topologie und Paketen aber als lesbarer Text "192.168.0.1" geführt.

export function parseIp(text: string): number | null {
  const parts = text.trim().split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

export function formatIp(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 0xff).join('.');
}

export function prefixToMask(prefix: number): number {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

export function maskToText(prefix: number): string {
  return formatIp(prefixToMask(prefix));
}

/** Akzeptiert "255.255.255.0", "/24" und "24"; liefert die Präfixlänge. */
export function parseMask(text: string): number | null {
  const trimmed = text.trim();
  const cidr = /^\/?(\d{1,2})$/.exec(trimmed);
  if (cidr) {
    const prefix = Number(cidr[1]);
    return prefix <= 32 ? prefix : null;
  }
  const mask = parseIp(trimmed);
  if (mask === null) return null;
  const inverted = ~mask >>> 0;
  // Gültig sind nur zusammenhängende Einsen von links: Das Inverse ist dann 2^k - 1.
  if ((inverted & (inverted + 1)) !== 0) return null;
  return 32 - Math.log2(inverted + 1);
}

export function networkOf(ip: number, prefix: number): number {
  return (ip & prefixToMask(prefix)) >>> 0;
}

export function broadcastOf(ip: number, prefix: number): number {
  return (networkOf(ip, prefix) | ~prefixToMask(prefix)) >>> 0;
}

export function sameSubnet(a: number, b: number, prefix: number): boolean {
  return networkOf(a, prefix) === networkOf(b, prefix);
}

export const LIMITED_BROADCAST = 0xffffffff;

/** 0.x, 127.x (Loopback) und ab 224.x (Multicast/reserviert) sind keine Geräteadressen. */
export function isReserved(ip: number): boolean {
  const first = ip >>> 24;
  return first === 0 || first === 127 || first >= 224;
}

/** Private Adressbereiche nach RFC 1918: im Internet nicht geroutet. */
export function isPrivate(ip: number): boolean {
  const a = ip >>> 24;
  const b = (ip >>> 16) & 0xff;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** Gemeinsam genutzter Adressraum für Carrier-Grade NAT (RFC 6598): 100.64.0.0/10. */
export function isCgnatRange(ip: number): boolean {
  return ip >>> 22 === (100 << 2) + 1;
}

/** Link-Local (169.254.0.0/16, APIPA): Adresse ohne DHCP-Antwort. */
export function isLinkLocal(ip: number): boolean {
  return ip >>> 16 === (169 << 8) + 254;
}

/**
 * Art einer Adresse für die Anzeige: privat (RFC 1918), CGNAT (RFC 6598),
 * öffentlich (im Internet geroutet) oder speziell (Loopback, Link-Local, Multicast …).
 */
export type AddressScope = 'private' | 'cgnat' | 'public' | 'special';

export function addressScope(ip: number): AddressScope {
  if (isPrivate(ip)) return 'private';
  if (isCgnatRange(ip)) return 'cgnat';
  if (isReserved(ip) || isLinkLocal(ip)) return 'special';
  return 'public';
}

export interface AddressIssue {
  code: string;
  field: 'ip' | 'mask' | 'gateway' | 'dns';
  params?: Record<string, string | number>;
}

export interface HostConfigInput {
  ip: string;
  mask: string;
  gateway?: string;
  dns?: string;
  /** Adresse per DHCP beziehen; die übrigen Felder werden dann ignoriert. */
  dhcp?: boolean;
}

/**
 * Prüft eine Endgeräte-Konfiguration. Fehler verhindern das Übernehmen
 * (Eingabe nicht lesbar). Warnungen beschreiben fachlich fragwürdige, aber
 * mögliche Einstellungen: Für Fehlersuche-Aufgaben müssen Lehrpersonen
 * genau solche Konfigurationen bauen können.
 */
export function checkHostConfig(input: HostConfigInput): { errors: AddressIssue[]; warnings: AddressIssue[] } {
  const errors: AddressIssue[] = [];
  const warnings: AddressIssue[] = [];
  if (input.dhcp) return { errors, warnings };
  const ipText = input.ip.trim();
  const maskText = input.mask.trim();
  const gatewayText = input.gateway?.trim() ?? '';
  const dnsText = input.dns?.trim() ?? '';

  const ip = ipText ? parseIp(ipText) : null;
  if (ipText && ip === null) errors.push({ code: 'invalidIp', field: 'ip', params: { value: ipText } });
  const prefix = maskText ? parseMask(maskText) : null;
  if (maskText && prefix === null) errors.push({ code: 'invalidMask', field: 'mask', params: { value: maskText } });
  if (ipText && !maskText) errors.push({ code: 'maskRequired', field: 'mask' });

  const gateway = gatewayText ? parseIp(gatewayText) : null;
  if (gatewayText && gateway === null) errors.push({ code: 'invalidIp', field: 'gateway', params: { value: gatewayText } });
  if (gatewayText && !ipText) errors.push({ code: 'gatewayWithoutAddress', field: 'gateway' });
  if (dnsText && parseIp(dnsText) === null) errors.push({ code: 'invalidIp', field: 'dns', params: { value: dnsText } });

  if (errors.length || ip === null || prefix === null) return { errors, warnings };

  const net = `${formatIp(networkOf(ip, prefix))}/${prefix}`;
  if (isReserved(ip)) warnings.push({ code: 'reservedAddress', field: 'ip', params: { ip: ipText } });
  // Bei /31 und /32 gibt es keine eigene Netz- und Broadcastadresse.
  if (prefix <= 30 && ip === networkOf(ip, prefix)) {
    warnings.push({ code: 'networkAddress', field: 'ip', params: { ip: ipText, net } });
  }
  if (prefix <= 30 && ip === broadcastOf(ip, prefix)) {
    warnings.push({ code: 'broadcastAddress', field: 'ip', params: { ip: ipText, net } });
  }
  if (gateway !== null) {
    if (gateway === ip) warnings.push({ code: 'gatewayIsSelf', field: 'gateway' });
    else if (!sameSubnet(ip, gateway, prefix)) {
      warnings.push({ code: 'gatewayOutsideSubnet', field: 'gateway', params: { gateway: gatewayText, net } });
    }
  }
  return { errors, warnings };
}
