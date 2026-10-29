import type { PacketLogEntry } from '../sim/simulation';
import type { Topology } from '../model/types';
import { cableAt, getCable, getDevice } from '../model/topology';
import { dissect } from './encode';
import { utf8 } from './part';

/**
 * Export im Format pcapng (IETF-Entwurf «PCAP Next Generation»), das
 * Wireshark direkt öffnet. Jeder Linktyp erhält ein eigenes Interface;
 * jeder Rahmen trägt als Kommentar, über welches Kabel er lief.
 * Steuermeldungen ohne Format (GPON-PLOAM, DSL-Training, LTE-RRC) fehlen.
 */
export function toPcapng(topology: Topology, log: readonly PacketLogEntry[]): Uint8Array {
  const out: number[] = [];
  const le16 = (n: number) => [n & 0xff, (n >>> 8) & 0xff];
  const le32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
  const pad = (bytes: number[]) => [...bytes, ...new Array((4 - (bytes.length % 4)) % 4).fill(0)];
  const option = (code: number, value: number[]) => [...le16(code), ...le16(value.length), ...pad(value)];
  const block = (type: number, body: number[]) => {
    const length = 12 + body.length;
    out.push(...le32(type), ...le32(length), ...body, ...le32(length));
  };

  // Section Header Block
  block(0x0a0d0d0a, [...le32(0x1a2b3c4d), ...le16(1), ...le16(0), 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, ...option(4, utf8('Netzwerk-Simulator')), ...option(0, [])]);

  const interfaces = new Map<number, number>();
  const interfaceFor = (linkType: number) => {
    let id = interfaces.get(linkType);
    if (id === undefined) {
      id = interfaces.size;
      interfaces.set(linkType, id);
      // Interface Description Block mit Zeitauflösung Mikrosekunden (Standard).
      block(0x00000001, [...le16(linkType), ...le16(0), ...le32(0), ...option(0, [])]);
    }
    return id;
  };

  const name = (id: string) => getDevice(topology, id)?.name ?? id;
  for (const entry of log) {
    const cable = getCable(topology, entry.cable) ?? cableAt(topology, entry.from);
    const d = dissect(entry.frame, cable?.medium ?? 'tp');
    if (d.linkType === null) continue;
    const data = Array.from(d.pcapBytes ?? d.bytes);
    const id = interfaceFor(d.linkType);
    const micros = Math.round(entry.sent * 1000);
    const high = Math.floor(micros / 2 ** 32);
    const low = micros >>> 0;
    const comment = utf8(`${entry.id}: ${name(entry.from.device)} → ${name(entry.to.device)}${entry.status === 'lost' ? ' (lost)' : ''}`);
    block(0x00000006, [...le32(id), ...le32(high), ...le32(low), ...le32(data.length), ...le32(data.length), ...pad(data), ...option(1, comment), ...option(0, [])]);
  }
  return Uint8Array.from(out);
}
