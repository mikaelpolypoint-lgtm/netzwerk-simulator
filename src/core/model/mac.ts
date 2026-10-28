export const MAC_PATTERN = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/;

/**
 * Deterministische MAC-Adresse aus Gerätenummer und Interface-Index.
 * Präfix 02:00 = lokal administriert, kollidiert also nie mit echten Herstellern.
 */
export function macFor(deviceSeq: number, ifaceIndex: number): string {
  const bytes = [0x02, 0x00, (deviceSeq >> 16) & 0xff, (deviceSeq >> 8) & 0xff, deviceSeq & 0xff, ifaceIndex & 0xff];
  return bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(':');
}
