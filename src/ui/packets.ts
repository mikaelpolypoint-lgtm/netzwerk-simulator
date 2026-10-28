import { BROADCAST_MAC, TCP_APPS, getDevice, protocolOf, type EthernetFrame, type PacketLogEntry, type Topology } from '../core';
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

export { protocolOf };

function portLabel(port: number): string {
  const names: Record<number, string> = { 53: 'DNS', 67: 'DHCP-Server', 68: 'DHCP-Client', ...TCP_APPS };
  return names[port] ? `${port} (${names[port]})` : String(port);
}

function endpointLabel(topology: Topology, device: string, iface: number): string {
  const d = getDevice(topology, device);
  return d ? `${d.name} (${interfaceLabel(d, iface)})` : '?';
}

function info(frame: EthernetFrame): string {
  const p = frame.payload;
  if (p.kind === 'arp') return t(`packets.arp.${p.op}`, { ...p });
  const inner = p.payload;
  if (inner.kind === 'icmp') {
    return t(`packets.icmp.${inner.type}`, {
      seq: inner.seq,
      ttl: p.ttl,
      target: inner.original?.dst ?? '',
      what: t(`packets.unreachable.${inner.code ?? 'net'}`),
    });
  }
  if (inner.kind === 'tcp') {
    const flags = `[${inner.flags.join(', ')}]`;
    const numbers = t('packets.tcp.numbers', { seq: inner.seq, ack: inner.ack, len: inner.data.length });
    const app = protocolOf(frame);
    if (app === 'TCP') return `${portLabel(inner.srcPort)} → ${portLabel(inner.dstPort)} ${flags} ${numbers}`;
    // Bei Anwendungsdaten die erste Zeile zeigen, wie ein Paketanalysator; HTTP-Folgesegmente als Fortsetzung.
    const first = (inner.data.split('\r\n')[0] ?? '').slice(0, 80);
    const continuation = app === 'HTTP' && !/^(GET|POST|HEAD|HTTP\/)/.test(first);
    return `${continuation ? t('packets.tcp.continuation') : first} ${numbers}`;
  }
  const msg = inner.payload;
  if (msg.kind === 'dns') {
    if (!msg.response) return t('packets.dns.query', { type: msg.question.type, name: msg.question.name });
    if (msg.rcode === 'nxdomain') return t('packets.dns.nxdomain', { name: msg.question.name });
    return t('packets.dns.answer', { type: msg.question.type, name: msg.question.name, value: msg.answers.map((a) => a.value).join(', ') });
  }
  return t(`packets.dhcp.${msg.op}`, { ip: msg.yourIp ?? msg.requestedIp ?? '', xid: hex(msg.xid) });
}

const hex = (n: number) => `0x${n.toString(16).padStart(8, '0')}`;

/** Übersetzt einen Logeintrag in eine Tabellenzeile wie in einem Paketanalysator. */
export function toRow(topology: Topology, entry: PacketLogEntry): PacketRow {
  const frame = entry.frame;
  const p = frame.payload;
  const [source, destination] =
    p.kind === 'arp' ? [frame.src, frame.dst === BROADCAST_MAC ? t('packets.broadcast') : frame.dst] : [p.src, p.dst];
  const text = info(frame);
  return {
    id: entry.id,
    time: (entry.sent / 1000).toFixed(3),
    route: `${endpointLabel(topology, entry.from.device, entry.from.iface)} → ${endpointLabel(topology, entry.to.device, entry.to.iface)}`,
    protocol: protocolOf(frame),
    source,
    destination,
    info: entry.status === 'lost' ? `${text} – ${t('packets.lost')}` : text,
    lost: entry.status === 'lost',
  };
}

export interface Layer {
  title: string;
  fields: [string, string][];
  /** Anwendungsdaten als Text, z.B. eine HTTP-Anfrage. */
  text?: string;
  /** Was an dieser Schicht vereinfacht ist (Konzept: Vereinfachungen transparent machen). */
  note?: string;
}

const field = (key: string, value: string | number | undefined): [string, string][] =>
  value === undefined || value === '' ? [] : [[t(`layer.field.${key}`), String(value)]];

/** Schichten eines Rahmens von aussen nach innen: Ethernet → ARP/IPv4 → ICMP/UDP → Anwendung. */
export function layersOf(frame: EthernetFrame): Layer[] {
  const p = frame.payload;
  const layers: Layer[] = [
    {
      title: t('layer.ethernet'),
      fields: [
        ...field('dstMac', frame.dst === BROADCAST_MAC ? `${frame.dst} (${t('packets.broadcast')})` : frame.dst),
        ...field('srcMac', frame.src),
        ...field('etherType', p.kind === 'arp' ? '0x0806 (ARP)' : '0x0800 (IPv4)'),
      ],
      note: t('layer.note.ethernet'),
    },
  ];

  if (p.kind === 'arp') {
    layers.push({
      title: t('layer.arp'),
      fields: [
        ...field('operation', p.op === 'request' ? `1 (${t('layer.arpRequest')})` : `2 (${t('layer.arpReply')})`),
        ...field('senderMac', p.senderMac),
        ...field('senderIp', p.senderIp),
        ...field('targetMac', p.targetMac),
        ...field('targetIp', p.targetIp),
      ],
    });
    return layers;
  }

  const inner = p.payload;
  layers.push({
    title: t('layer.ipv4'),
    fields: [
      ...field('version', 4),
      ...field('ttl', p.ttl),
      ...field('protocol', inner.kind === 'icmp' ? '1 (ICMP)' : inner.kind === 'tcp' ? '6 (TCP)' : '17 (UDP)'),
      ...field('ipId', p.id),
      ...field('srcIp', p.src),
      ...field('dstIp', p.dst),
    ],
    note: t('layer.note.ipv4'),
  });

  if (inner.kind === 'icmp') {
    const types = { echoRequest: 8, echoReply: 0, destUnreachable: 3, timeExceeded: 11 } as const;
    layers.push({
      title: t('layer.icmp'),
      fields: [
        ...field('icmpType', `${types[inner.type]} (${t(`layer.icmpType.${inner.type}`)})`),
        ...field('icmpCode', inner.type === 'destUnreachable' ? `${inner.code === 'host' ? 1 : 0} (${t(`packets.unreachable.${inner.code ?? 'net'}`)})` : 0),
        ...(inner.original
          ? [
              ...field('originalSrc', inner.original.src),
              ...field('originalDst', inner.original.dst),
            ]
          : [...field('icmpId', inner.id), ...field('icmpSeq', inner.seq), ...field('payloadSize', t('layer.bytes', { n: inner.size }))]),
      ],
    });
    return layers;
  }

  if (inner.kind === 'tcp') {
    layers.push({
      title: t('layer.tcp'),
      fields: [
        ...field('srcPort', portLabel(inner.srcPort)),
        ...field('dstPort', portLabel(inner.dstPort)),
        ...field('seq', inner.seq),
        ...field('ack', inner.flags.includes('ACK') ? inner.ack : undefined),
        ...field('flags', inner.flags.join(', ')),
        ...field('dataLength', t('layer.chars', { n: inner.data.length })),
      ],
      note: t('layer.note.tcp'),
    });
    if (inner.data) {
      layers.push({ title: `${protocolOf(frame)} (${t('layer.appData')})`, fields: [], text: inner.data });
    }
    return layers;
  }

  layers.push({
    title: t('layer.udp'),
    fields: [...field('srcPort', portLabel(inner.srcPort)), ...field('dstPort', portLabel(inner.dstPort))],
    note: t('layer.note.udp'),
  });

  const app = inner.payload;
  if (app.kind === 'dns') {
    layers.push({
      title: t('layer.dns'),
      fields: [
        ...field('dnsId', app.id),
        ...field('dnsKind', t(app.response ? 'layer.dnsResponse' : 'layer.dnsQuery')),
        ...field('question', `${app.question.name} (${app.question.type})`),
        ...(app.response ? field('rcode', app.rcode === 'ok' ? '0 (NOERROR)' : '3 (NXDOMAIN)') : []),
        ...app.answers.flatMap((a, i) => field('answer', `${i + 1}: ${a.name} ${a.type} ${a.value}, TTL ${a.ttl} s`)),
      ],
      note: t('layer.note.dns'),
    });
    return layers;
  }

  const dhcp = app;
  layers.push({
    title: t('layer.dhcp'),
    fields: [
      ...field('dhcpOp', `DHCP${dhcp.op.toUpperCase()}`),
      ...field('xid', hex(dhcp.xid)),
      ...field('clientMac', dhcp.clientMac),
      ...field('yourIp', dhcp.yourIp),
      ...field('requestedIp', dhcp.requestedIp),
      ...field('serverIp', dhcp.serverIp),
      ...field('mask', dhcp.mask),
      ...field('router', dhcp.gateway),
      ...field('dns', dhcp.dns),
      ...field('leaseTime', dhcp.leaseTime === undefined ? undefined : t('layer.seconds', { n: dhcp.leaseTime })),
    ],
    note: t('layer.note.dhcp'),
  });
  return layers;
}
