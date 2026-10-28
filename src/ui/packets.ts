import { BROADCAST_MAC, getDevice, type PacketLogEntry, type Topology } from '../core';
import { t } from '../i18n';
import { interfaceLabel } from './labels';

export interface PacketRow {
  id: number;
  time: string;
  route: string;
  protocol: string;
  source: string;
  destination: string;
  info: string;
  lost: boolean;
}

export function protocolOf(entry: PacketLogEntry): string {
  const payload = entry.frame.payload;
  return payload.kind === 'arp' ? 'ARP' : payload.payload.kind.toUpperCase();
}

function endpointLabel(topology: Topology, device: string, iface: number): string {
  const d = getDevice(topology, device);
  return d ? `${d.name} (${interfaceLabel(d, iface)})` : '?';
}

/** Übersetzt einen Logeintrag in eine Tabellenzeile wie in einem Paketanalysator. */
export function toRow(topology: Topology, entry: PacketLogEntry): PacketRow {
  const frame = entry.frame;
  const payload = frame.payload;
  let source: string;
  let destination: string;
  let info: string;
  if (payload.kind === 'arp') {
    source = frame.src;
    destination = frame.dst === BROADCAST_MAC ? t('packets.broadcast') : frame.dst;
    info = t(`packets.arp.${payload.op}`, { ...payload });
  } else {
    source = payload.src;
    destination = payload.dst;
    const icmp = payload.payload;
    info = t(`packets.icmp.${icmp.type}`, {
      seq: icmp.seq,
      ttl: payload.ttl,
      target: icmp.original?.dst ?? '',
      what: t(`packets.unreachable.${icmp.code ?? 'net'}`),
    });
  }
  return {
    id: entry.id,
    time: (entry.sent / 1000).toFixed(3),
    route: `${endpointLabel(topology, entry.from.device, entry.from.iface)} → ${endpointLabel(topology, entry.to.device, entry.to.iface)}`,
    protocol: protocolOf(entry),
    source,
    destination,
    info: entry.status === 'lost' ? `${info} – ${t('packets.lost')}` : info,
    lost: entry.status === 'lost',
  };
}
