/**
 * Baustein für die Kodierung: Bytes einer Schicht plus die Felder mit ihrer
 * Lage, damit die Paketansicht beim Klick auf ein Feld die Bytes markiert.
 */
export interface WireField {
  /** Schlüssel für die Übersetzung, z.B. "ip.ttl". */
  key: string;
  value: string;
  start: number;
  length: number;
}

export type OsiLayer = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface WireLayer {
  osi: OsiLayer;
  /** Protokollname, wie ihn ein Analysator zeigt, z.B. "IPv4" oder "802.1Q". */
  protocol: string;
  start: number;
  length: number;
  fields: WireField[];
  /** Erklärung zur Vereinfachung (Übersetzungsschlüssel). */
  note?: string;
  /** Anwendungsdaten als lesbarer Text (HTTP, SMTP …). */
  text?: string;
}

export class Part {
  readonly bytes: number[] = [];
  readonly fields: WireField[] = [];
  readonly layers: WireLayer[] = [];

  get length() {
    return this.bytes.length;
  }

  raw(values: ArrayLike<number>) {
    for (let i = 0; i < values.length; i++) this.bytes.push(values[i]! & 0xff);
    return this;
  }

  field(key: string, value: string | number, bytes: ArrayLike<number>) {
    this.fields.push({ key, value: String(value), start: this.bytes.length, length: bytes.length });
    return this.raw(bytes);
  }

  u8(key: string, n: number, shown: string | number = n) {
    return this.field(key, shown, [n]);
  }

  u16(key: string, n: number, shown: string | number = n) {
    return this.field(key, shown, u16(n));
  }

  u32(key: string, n: number, shown: string | number = n) {
    return this.field(key, shown, u32(n));
  }

  mac(key: string, mac: string, shown: string = mac) {
    return this.field(key, shown, macBytes(mac));
  }

  ip(key: string, ip: string, shown: string = ip) {
    return this.field(key, shown, ipBytes(ip));
  }

  /** Bytes an Position `at` überschreiben (für nachträglich berechnete Längen und Prüfsummen). */
  patch(at: number, values: number[]) {
    values.forEach((v, i) => (this.bytes[at + i] = v & 0xff));
  }

  /** Inneren Teil anhängen; dessen Felder und Schichten werden verschoben übernommen. */
  append(inner: Part) {
    const offset = this.bytes.length;
    this.raw(inner.bytes);
    for (const f of inner.fields) this.fields.push({ ...f, start: f.start + offset });
    for (const l of inner.layers) this.layers.push({ ...l, start: l.start + offset, fields: l.fields.map((f) => ({ ...f, start: f.start + offset })) });
    return this;
  }

  /** Alle bisher gesammelten Felder als Schicht abschliessen (und aus `fields` entfernen). */
  close(osi: OsiLayer, protocol: string, start: number, extra: Partial<WireLayer> = {}): WireLayer {
    const own = this.fields.splice(0, this.fields.length).filter((f) => f.start >= start);
    const layer: WireLayer = { osi, protocol, start, length: this.bytes.length - start, fields: own, ...extra };
    this.layers.unshift(layer);
    return layer;
  }
}

export const u16 = (n: number) => [(n >>> 8) & 0xff, n & 0xff];
export const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

export function macBytes(mac: string): number[] {
  const parts = mac.split(':').map((h) => parseInt(h, 16));
  return parts.length === 6 && parts.every((n) => Number.isFinite(n)) ? parts : [0, 0, 0, 0, 0, 0];
}

export function ipBytes(ip: string): number[] {
  const parts = ip.split('.').map(Number);
  return parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? parts : [0, 0, 0, 0];
}

/** UTF-8 ohne DOM-API (der Kern läuft auch ohne Browser). */
export function utf8(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    let c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else {
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
  }
  return out;
}

/** «Binärtext» (ein Zeichen = ein Byte), wie BGP ihn in TCP-Segmenten trägt. */
export const latin1 = (text: string) => Array.from(text, (ch) => ch.charCodeAt(0) & 0xff);

/** Internet-Prüfsumme (RFC 1071): Einerkomplement-Summe über 16-Bit-Wörter. */
export function internetChecksum(bytes: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 2) sum += ((bytes[i]! << 8) | (bytes[i + 1] ?? 0)) >>> 0;
  while (sum >> 16) sum = (sum & 0xffff) + (sum >> 16);
  return ~sum & 0xffff;
}

export const hex = (n: number, digits: number) => `0x${n.toString(16).padStart(digits, '0')}`;
