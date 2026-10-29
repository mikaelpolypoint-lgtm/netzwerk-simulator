import type { Medium } from '../model/types';
import { decodeBgp, isBgpData } from '../sim/bgp';
import { decodeUtf8 } from '../net/http';
import { TCP_APPS } from '../sim/protocol';
import {
  BROADCAST_MAC,
  type ArpPacket,
  type DhcpMessage,
  type DnsMessage,
  type EthernetFrame,
  type IcmpMessage,
  type Ipv4Packet,
  type LinkControl,
  type OspfPacket,
  type PppControl,
  type RipMessage,
  type StpBpdu,
  type TcpSegment,
  type UdpDatagram,
} from '../sim/frames';
import { Part, hex, internetChecksum, ipBytes, latin1, u16, u32, utf8, type WireField, type WireLayer } from './part';

export type { WireField, WireLayer, OsiLayer } from './part';

/**
 * pcap-Linktypen (tcpdump.org/linktypes.html), damit Wireshark die Datei lesen kann.
 * Steuermeldungen ohne eigenes Format (GPON-PLOAM, DSL-Training, LTE-RRC) haben keinen.
 */
export const LINKTYPE = { ethernet: 1, pppHdlc: 50, rawIp: 101, ciscoHdlc: 104, ieee80211: 105, docsis: 143 } as const;

export interface Dissection {
  bytes: Uint8Array;
  /** Schichten von aussen nach innen (Schicht 1 zuerst). */
  layers: WireLayer[];
  /** Für den pcap-Export; null = nicht exportierbar. */
  linkType: number | null;
  /** Bytes für den pcap-Export, falls sie von der Anzeige abweichen (z.B. LTE: nur das IP-Paket). */
  pcapBytes?: Uint8Array;
}

// --- Schicht 7 und 4 -------------------------------------------------------------

const DHCP_TYPES: Record<DhcpMessage['op'], number> = { discover: 1, offer: 2, request: 3, ack: 5, nak: 6, release: 7 };

function dhcp(m: DhcpMessage): Part {
  const p = new Part();
  const reply = m.op === 'offer' || m.op === 'ack' || m.op === 'nak';
  p.u8('dhcp.op', reply ? 2 : 1, reply ? '2 (BOOTREPLY)' : '1 (BOOTREQUEST)');
  p.u8('dhcp.htype', 1, '1 (Ethernet)');
  p.u8('dhcp.hlen', 6);
  p.u8('dhcp.hops', 0);
  p.u32('dhcp.xid', m.xid, hex(m.xid, 8));
  p.u16('dhcp.secs', 0);
  const broadcast = !reply || !m.giaddr;
  p.u16('dhcp.flags', broadcast ? 0x8000 : 0, broadcast ? '0x8000 (Broadcast)' : '0x0000');
  p.ip('dhcp.ciaddr', '0.0.0.0');
  p.ip('dhcp.yiaddr', m.yourIp ?? '0.0.0.0');
  p.ip('dhcp.siaddr', '0.0.0.0');
  p.ip('dhcp.giaddr', m.giaddr ?? '0.0.0.0');
  p.field('dhcp.chaddr', m.clientMac, [...macOrZero(m.clientMac), ...new Array(10).fill(0)]);
  p.field('dhcp.sname', '', new Array(64).fill(0));
  p.field('dhcp.file', '', new Array(128).fill(0));
  p.u32('dhcp.cookie', 0x63825363, '0x63825363 (DHCP)');
  const option = (key: string, code: number, value: string, data: number[]) => p.field(key, value, [code, data.length, ...data]);
  option('dhcp.opt53', 53, `DHCP${m.op.toUpperCase()}`, [DHCP_TYPES[m.op]]);
  if (m.requestedIp) option('dhcp.opt50', 50, m.requestedIp, ipBytes(m.requestedIp));
  if (m.serverIp) option('dhcp.opt54', 54, m.serverIp, ipBytes(m.serverIp));
  if (m.leaseTime !== undefined) option('dhcp.opt51', 51, `${m.leaseTime} s`, u32(m.leaseTime));
  if (m.mask) option('dhcp.opt1', 1, m.mask, ipBytes(m.mask));
  if (m.gateway) option('dhcp.opt3', 3, m.gateway, ipBytes(m.gateway));
  if (m.dns) option('dhcp.opt6', 6, m.dns, ipBytes(m.dns));
  p.u8('dhcp.end', 255, '255 (End)');
  p.close(7, 'DHCP', 0);
  return p;
}

function labels(name: string): number[] {
  const out: number[] = [];
  for (const label of name.split('.').filter(Boolean)) {
    const bytes = utf8(label);
    out.push(bytes.length, ...bytes);
  }
  out.push(0);
  return out;
}

function dns(m: DnsMessage): Part {
  const p = new Part();
  p.u16('dns.id', m.id, hex(m.id, 4));
  const flags = m.response ? (m.rcode === 'nxdomain' ? 0x8183 : 0x8180) : 0x0100;
  p.u16('dns.flags', flags, `${hex(flags, 4)} (${m.response ? (m.rcode === 'nxdomain' ? 'Response, NXDOMAIN' : 'Response, No error') : 'Standard query'})`);
  p.u16('dns.qdcount', 1);
  p.u16('dns.ancount', m.answers.length);
  p.u16('dns.nscount', 0);
  p.u16('dns.arcount', 0);
  const qtype = m.question.type === 'MX' ? 15 : 1;
  p.field('dns.question', `${m.question.name} ${m.question.type} IN`, [...labels(m.question.name), ...u16(qtype), ...u16(1)]);
  for (const a of m.answers) {
    const type = a.type === 'MX' ? 15 : 1;
    const rdata = a.type === 'MX' ? [...u16(10), ...labels(a.value)] : ipBytes(a.value);
    p.field('dns.answer', `${a.name} ${a.type} ${a.value} TTL ${a.ttl}`, [0xc0, 0x0c, ...u16(type), ...u16(1), ...u32(a.ttl), ...u16(rdata.length), ...rdata]);
  }
  p.close(7, 'DNS', 0);
  return p;
}

function rip(m: RipMessage): Part {
  const p = new Part();
  p.u8('rip.command', m.command === 'request' ? 1 : 2, m.command === 'request' ? '1 (Request)' : '2 (Response)');
  p.u8('rip.version', 2);
  p.u16('rip.zero', 0);
  if (m.command === 'request' && m.entries.length === 0) {
    p.field('rip.entry', 'whole table, metric 16', [...u16(0), ...u16(0), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...u32(16)]);
  }
  for (const e of m.entries) {
    p.field('rip.entry', `${e.network} ${e.mask} → ${e.nextHop}, metric ${e.metric}`, [...u16(2), ...u16(0), ...ipBytes(e.network), ...ipBytes(e.mask), ...ipBytes(e.nextHop), ...u32(e.metric)]);
  }
  p.close(7, 'RIPv2', 0);
  return p;
}

function bgp(data: string): Part {
  const p = new Part();
  const bytes = latin1(data);
  let offset = 0;
  for (const message of decodeBgp(data)) {
    const length = (bytes[offset + 16]! << 8) | bytes[offset + 17]!;
    const summary =
      message.type === 'OPEN'
        ? `OPEN AS ${message.asn}, Hold ${message.holdTime} s, ID ${message.bgpId}`
        : message.type === 'UPDATE'
          ? `UPDATE ${message.nlri.length ? `NLRI ${message.nlri.join(', ')} AS_PATH ${message.asPath.join(' ') || '–'} NEXT_HOP ${message.nextHop}` : ''}${message.withdrawn.length ? ` Withdrawn ${message.withdrawn.join(', ')}` : ''}`
          : message.type === 'NOTIFICATION'
            ? `NOTIFICATION ${message.code}`
            : 'KEEPALIVE';
    p.field('bgp.message', summary.trim(), bytes.slice(offset, offset + length));
    offset += length;
  }
  if (offset < bytes.length) p.field('bgp.fragment', `${bytes.length - offset} Bytes`, bytes.slice(offset));
  p.close(7, 'BGP-4', 0);
  return p;
}

const APP_NAMES: Record<number, string> = { ...TCP_APPS };

function tcp(segment: TcpSegment, srcIp: string, dstIp: string): Part {
  const p = new Part();
  const binary = isBgpData(segment.data);
  // TCP-Nutzdaten sind Bytes («Binärtext»); nur Zeichen über 255 (z.B. € in einer Mail) werden UTF-8-kodiert.
  const payload = binary || !/[^\u0000-\u00ff]/.test(segment.data) ? latin1(segment.data) : utf8(segment.data);
  const syn = segment.flags.includes('SYN');
  const headerLength = syn ? 24 : 20;
  p.u16('tcp.srcPort', segment.srcPort, portName(segment.srcPort));
  p.u16('tcp.dstPort', segment.dstPort, portName(segment.dstPort));
  p.u32('tcp.seq', segment.seq);
  p.u32('tcp.ack', segment.ack);
  const bits = { FIN: 1, SYN: 2, RST: 4, PSH: 8, ACK: 16 } as const;
  const flags = segment.flags.reduce((sum, f) => sum + bits[f], 0);
  p.field('tcp.offsetFlags', `${headerLength} Bytes, [${segment.flags.join(', ')}]`, [(headerLength / 4) << 4, flags]);
  p.u16('tcp.window', 64240);
  const checksumAt = p.length;
  p.u16('tcp.checksum', 0);
  p.u16('tcp.urgent', 0);
  if (syn) p.field('tcp.options', 'MSS 1460', [2, 4, ...u16(1460)]);
  const app = segment.data ? (binary ? bgp(segment.data) : appText(segment, payload)) : null;
  if (app) p.append(app);
  const sum = internetChecksum([...pseudoHeader(srcIp, dstIp, 6, p.length), ...p.bytes]);
  p.patch(checksumAt, u16(sum));
  p.fields.find((f) => f.key === 'tcp.checksum')!.value = hex(sum, 4);
  p.close(4, 'TCP', 0, { note: 'note.tcpSeq' });
  return p;
}

function appText(segment: TcpSegment, payload: number[]): Part {
  const p = new Part();
  const name = APP_NAMES[segment.dstPort] ?? APP_NAMES[segment.srcPort] ?? 'Data';
  const encrypted = name === 'SSH' && !segment.data.startsWith('SSH-');
  p.field(encrypted ? 'app.encrypted' : 'app.data', encrypted ? `${payload.length} Bytes` : (segment.data.split('\r\n')[0] ?? '').slice(0, 120), payload);
  p.close(7, name, 0, encrypted ? { note: 'note.sshEncrypted' } : { text: readable(segment.data) });
  return p;
}

/** Anwendungsdaten lesbar machen: UTF-8 dekodieren, Binäres (Bilder) abkürzen. */
function readable(data: string): string {
  const head = data.indexOf('\r\n\r\n');
  const type = /content-type:\s*([^\r\n;]+)/i.exec(data.slice(0, head > 0 ? head : 400))?.[1] ?? '';
  if (type.startsWith('image/') && !type.includes('svg') && head > 0) return `${data.slice(0, head)}\r\n\r\n[${data.length - head - 4} Bytes ${type}]`;
  // Nicht-druckbare Bytes in Fortsetzungssegmenten (Bilddaten) zusammenfassen.
  if (/[\u0000-\u0008\u000e-\u001f]/.test(data)) return `[${data.length} Bytes]`;
  return decodeUtf8(data);
}

function portName(port: number): string {
  const names: Record<number, string> = { 53: 'DNS', 67: 'DHCP Server', 68: 'DHCP Client', 520: 'RIP', ...TCP_APPS };
  return names[port] ? `${port} (${names[port]})` : String(port);
}

function pseudoHeader(src: string, dst: string, protocol: number, length: number): number[] {
  return [...ipBytes(src), ...ipBytes(dst), 0, protocol, ...u16(length)];
}

function udp(d: UdpDatagram, srcIp: string, dstIp: string): Part {
  const p = new Part();
  const inner = d.payload.kind === 'dhcp' ? dhcp(d.payload) : d.payload.kind === 'dns' ? dns(d.payload) : rip(d.payload);
  p.u16('udp.srcPort', d.srcPort, portName(d.srcPort));
  p.u16('udp.dstPort', d.dstPort, portName(d.dstPort));
  p.u16('udp.length', 8 + inner.length);
  const checksumAt = p.length;
  p.u16('udp.checksum', 0);
  p.append(inner);
  const sum = internetChecksum([...pseudoHeader(srcIp, dstIp, 17, p.length), ...p.bytes]) || 0xffff;
  p.patch(checksumAt, u16(sum));
  p.fields.find((f) => f.key === 'udp.checksum')!.value = hex(sum, 4);
  p.close(4, 'UDP', 0);
  return p;
}

// --- Schicht 3 ------------------------------------------------------------------

const ICMP_TYPES: Record<IcmpMessage['type'], number> = { echoRequest: 8, echoReply: 0, destUnreachable: 3, timeExceeded: 11 };

function icmp(m: IcmpMessage): Part {
  const p = new Part();
  const type = ICMP_TYPES[m.type];
  p.u8('icmp.type', type, `${type} (${m.type})`);
  const code = m.type === 'destUnreachable' ? (m.code === 'host' ? 1 : 0) : 0;
  p.u8('icmp.code', code);
  p.u16('icmp.checksum', 0);
  if (m.original) {
    p.u32('icmp.unused', 0);
    // Kopf des auslösenden Pakets (IPv4 + erste 8 Bytes), wie RFC 792 es verlangt.
    const original = ipv4Header({ kind: 'ipv4', src: m.original.src, dst: m.original.dst, ttl: 1, id: 0, payload: { kind: 'icmp', type: 'echoRequest', id: m.original.id, seq: m.original.seq, size: 0 } }, 8, 1);
    p.field('icmp.original', `${m.original.src} → ${m.original.dst}`, [...original, 8, 0, 0, 0, ...u16(m.original.id), ...u16(m.original.seq)]);
  } else {
    p.u16('icmp.id', m.id, hex(m.id, 4));
    p.u16('icmp.seq', m.seq);
    p.field('icmp.data', `${m.size} Bytes`, Array.from({ length: m.size }, (_, i) => 0x61 + (i % 23)));
  }
  const sum = internetChecksum(p.bytes);
  p.patch(2, u16(sum));
  p.fields.find((f) => f.key === 'icmp.checksum')!.value = hex(sum, 4);
  p.close(3, 'ICMP', 0);
  return p;
}

const OSPF_TYPES: Record<OspfPacket['type'], number> = { hello: 1, dbd: 2, lsr: 3, lsu: 4, lsack: 5 };
const LSA_TYPES = { router: 1, external: 5 } as const;

function lsaHeader(h: { type: 'router' | 'external'; advertisingRouter: string; seq: number }, length: number, linkStateId = h.advertisingRouter): number[] {
  return [...u16(1), 0x02, LSA_TYPES[h.type], ...ipBytes(linkStateId), ...ipBytes(h.advertisingRouter), ...u32(h.seq >>> 0), ...u16(0), ...u16(length)];
}

function ospf(m: OspfPacket): Part {
  const p = new Part();
  p.u8('ospf.version', 2);
  p.u8('ospf.type', OSPF_TYPES[m.type], `${OSPF_TYPES[m.type]} (${{ hello: 'Hello', dbd: 'Database Description', lsr: 'LS Request', lsu: 'LS Update', lsack: 'LS Acknowledge' }[m.type]})`);
  const lengthAt = p.length;
  p.u16('ospf.length', 0);
  p.ip('ospf.routerId', m.routerId);
  p.ip('ospf.area', `${(m.area >>> 24) & 255}.${(m.area >>> 16) & 255}.${(m.area >>> 8) & 255}.${m.area & 255}`, `${m.area}`);
  const checksumAt = p.length;
  p.u16('ospf.checksum', 0);
  p.u16('ospf.auType', 0, '0 (Null)');
  p.field('ospf.auth', '', new Array(8).fill(0));
  if (m.type === 'hello' && m.hello) {
    p.ip('ospf.mask', m.hello.mask);
    p.u16('ospf.helloInterval', m.hello.helloInterval, `${m.hello.helloInterval} s`);
    p.u8('ospf.options', 0x02, '0x02 (E)');
    p.u8('ospf.priority', 1);
    p.u32('ospf.deadInterval', m.hello.deadInterval, `${m.hello.deadInterval} s`);
    p.ip('ospf.dr', m.hello.dr ?? '0.0.0.0');
    p.ip('ospf.bdr', '0.0.0.0');
    for (const n of m.hello.neighbors) p.ip('ospf.neighbor', n);
  } else if (m.type === 'dbd') {
    p.u16('ospf.mtu', 1500);
    p.u8('ospf.options', 0x02, '0x02 (E)');
    p.u8('ospf.dbdFlags', 0x07, '0x07 (I, M, MS)');
    p.u32('ospf.ddSeq', 1);
    for (const h of m.headers ?? []) p.field('ospf.lsaHeader', `${h.type === 'router' ? 'Router-LSA' : 'AS-External-LSA'} ${h.advertisingRouter} seq ${hex(h.seq >>> 0, 8)}`, lsaHeader(h, 20));
  } else if (m.type === 'lsr') {
    for (const h of m.headers ?? []) p.field('ospf.request', `${h.type} ${h.advertisingRouter}`, [...u32(LSA_TYPES[h.type]), ...ipBytes(h.advertisingRouter), ...ipBytes(h.advertisingRouter)]);
  } else if (m.type === 'lsu') {
    const lsas = m.lsas ?? [];
    const encoded: { label: string; bytes: number[] }[] = [];
    for (const lsa of lsas) {
      if (lsa.type === 'router') {
        const links = lsa.links.flatMap((l) => [...ipBytes(l.id), ...ipBytes(l.data), l.kind === 'p2p' ? 1 : 3, 0, ...u16(l.cost)]);
        const body = [0, 0, ...u16(lsa.links.length), ...links];
        encoded.push({ label: `Router-LSA ${lsa.advertisingRouter}: ${lsa.links.map((l) => (l.kind === 'p2p' ? `→${l.id} (${l.cost})` : `${l.id}/${l.data} (${l.cost})`)).join(', ')}`, bytes: [...lsaHeader(lsa, 20 + body.length), ...body] });
      } else {
        for (const l of lsa.links) {
          const body = [...ipBytes(l.data), 0x80, 0, ...u16(l.cost), 0, 0, 0, 0, 0, 0, 0, 0];
          encoded.push({ label: `AS-External-LSA ${l.id}/${l.data} E2 ${l.cost}`, bytes: [...lsaHeader(lsa, 20 + body.length, l.id), ...body] });
        }
      }
    }
    p.u32('ospf.lsaCount', encoded.length);
    for (const e of encoded) p.field('ospf.lsa', e.label, e.bytes);
  } else if (m.type === 'lsack') {
    for (const h of m.headers ?? []) p.field('ospf.lsaHeader', `${h.type} ${h.advertisingRouter} seq ${hex(h.seq >>> 0, 8)}`, lsaHeader(h, 20));
  }
  p.patch(lengthAt, u16(p.length));
  p.fields.find((f) => f.key === 'ospf.length')!.value = String(p.length);
  // Prüfsumme über das ganze Paket ohne die 8 Bytes Authentisierung.
  const sum = internetChecksum([...p.bytes.slice(0, 16), ...p.bytes.slice(24)]);
  p.patch(checksumAt, u16(sum));
  p.fields.find((f) => f.key === 'ospf.checksum')!.value = hex(sum, 4);
  p.close(3, 'OSPFv2', 0, { note: 'note.ospf' });
  return p;
}

function ipv4Header(packet: Ipv4Packet, payloadLength: number, protocol: number, df = false): number[] {
  const header = [0x45, 0, ...u16(20 + payloadLength), ...u16(packet.id & 0xffff), ...u16(df ? 0x4000 : 0), packet.ttl & 0xff, protocol, 0, 0, ...ipBytes(packet.src), ...ipBytes(packet.dst)];
  const sum = internetChecksum(header);
  header[10] = sum >> 8;
  header[11] = sum & 0xff;
  return header;
}

function ipv4(packet: Ipv4Packet): Part {
  const inner = packet.payload;
  const payload =
    inner.kind === 'icmp' ? icmp(inner) : inner.kind === 'udp' ? udp(inner, packet.src, packet.dst) : inner.kind === 'tcp' ? tcp(inner, packet.src, packet.dst) : ospf(inner);
  const protocol = inner.kind === 'icmp' ? 1 : inner.kind === 'udp' ? 17 : inner.kind === 'tcp' ? 6 : 89;
  const df = inner.kind === 'tcp';
  const header = ipv4Header(packet, payload.length, protocol, df);
  const p = new Part();
  p.field('ip.versionIhl', '4, 20 Bytes', [header[0]!]);
  p.field('ip.dscp', '0x00 (Best Effort)', [header[1]!]);
  p.field('ip.totalLength', 20 + payload.length, header.slice(2, 4));
  p.field('ip.id', hex(packet.id & 0xffff, 4), header.slice(4, 6));
  p.field('ip.flags', df ? "0x4000 (Don't Fragment)" : '0x0000', header.slice(6, 8));
  p.field('ip.ttl', packet.ttl, [header[8]!]);
  p.field('ip.protocol', `${protocol} (${{ 1: 'ICMP', 6: 'TCP', 17: 'UDP', 89: 'OSPF' }[protocol]})`, [header[9]!]);
  p.field('ip.checksum', hex((header[10]! << 8) | header[11]!, 4), header.slice(10, 12));
  p.field('ip.src', packet.src, header.slice(12, 16));
  p.field('ip.dst', packet.dst, header.slice(16, 20));
  p.append(payload);
  p.close(3, 'IPv4', 0);
  return p;
}

function arp(a: ArpPacket): Part {
  const p = new Part();
  p.u16('arp.htype', 1, '1 (Ethernet)');
  p.u16('arp.ptype', 0x0800, '0x0800 (IPv4)');
  p.u8('arp.hlen', 6);
  p.u8('arp.plen', 4);
  p.u16('arp.op', a.op === 'request' ? 1 : 2, a.op === 'request' ? '1 (Request)' : '2 (Reply)');
  p.mac('arp.sha', a.senderMac);
  p.ip('arp.spa', a.senderIp);
  p.mac('arp.tha', a.targetMac);
  p.ip('arp.tpa', a.targetIp);
  // ARP liegt zwischen Schicht 2 und 3; Analysatoren ordnen es meist Schicht 2 zu.
  p.close(2, 'ARP', 0, { note: 'note.arp' });
  return p;
}

function stp(b: StpBpdu): Part {
  const p = new Part();
  const bridge = (id: string) => {
    const [prio = '32768', mac = ''] = id.split('.');
    return [...u16(Number(prio)), ...macOrZero(mac)];
  };
  p.field('stp.llc', 'DSAP 0x42, SSAP 0x42, UI', [0x42, 0x42, 0x03]);
  p.u16('stp.protocol', 0, '0 (Spanning Tree)');
  p.u8('stp.version', 0, '0 (STP, IEEE 802.1D)');
  p.u8('stp.type', 0, '0x00 (Configuration)');
  p.u8('stp.flags', 0);
  p.field('stp.rootId', b.rootId, bridge(b.rootId));
  p.u32('stp.rootCost', b.cost);
  p.field('stp.bridgeId', b.bridgeId, bridge(b.bridgeId));
  p.u16('stp.portId', 0x8000 + b.portId + 1, hex(0x8000 + b.portId + 1, 4));
  p.u16('stp.messageAge', 0, '0 s');
  p.u16('stp.maxAge', 20 * 256, '20 s');
  p.u16('stp.helloTime', 2 * 256, '2 s');
  p.u16('stp.forwardDelay', 15 * 256, '15 s');
  p.close(2, 'STP', 0, { note: 'note.stp' });
  return p;
}

function macOrZero(mac: string): number[] {
  const parts = mac.split(':').map((h) => parseInt(h, 16));
  return parts.length === 6 && parts.every((n) => Number.isFinite(n)) ? parts : [0, 0, 0, 0, 0, 0];
}

// --- Schicht 2 ------------------------------------------------------------------

const PPP_CODES: Record<PppControl['code'], number> = { configureRequest: 1, configureAck: 2, terminateRequest: 5, terminateAck: 6, echoRequest: 9, echoReply: 10, configureNak: 3 };

function pppControl(c: PppControl): Part {
  const p = new Part();
  p.u8('ppp.code', PPP_CODES[c.code], `${PPP_CODES[c.code]} (${c.code})`);
  p.u8('ppp.id', c.id);
  const option = c.protocol === 'lcp' && c.magic !== undefined ? [5, 6, ...u32(c.magic)] : c.protocol === 'ipcp' && c.ip ? [3, 6, ...ipBytes(c.ip)] : [];
  p.u16('ppp.length', 4 + option.length);
  if (option.length) p.field(c.protocol === 'lcp' ? 'ppp.magic' : 'ppp.ipAddress', c.protocol === 'lcp' ? hex(c.magic!, 8) : c.ip!, option);
  p.close(2, c.protocol === 'lcp' ? 'PPP LCP' : 'PPP IPCP', 0);
  return p;
}

/** Innerer Teil eines Rahmens (alles oberhalb von Ethernet/HDLC/PPP). */
function payloadPart(frame: EthernetFrame): { part: Part; etherType: number; pppProtocol: number } {
  const p = frame.payload;
  if (p.kind === 'arp') return { part: arp(p), etherType: 0x0806, pppProtocol: 0 };
  if (p.kind === 'ipv4') return { part: ipv4(p), etherType: 0x0800, pppProtocol: 0x0021 };
  if (p.kind === 'stp') return { part: stp(p), etherType: 0, pppProtocol: 0 };
  if (p.kind === 'ppp') return { part: pppControl(p), etherType: 0, pppProtocol: p.protocol === 'lcp' ? 0xc021 : 0x8021 };
  return { part: new Part(), etherType: 0, pppProtocol: 0 };
}

function ethernet(frame: EthernetFrame, inner: Part, etherType: number, header = 'Ethernet II'): Part {
  const p = new Part();
  p.mac('eth.dst', frame.dst, frame.dst === BROADCAST_MAC ? `${frame.dst} (Broadcast)` : frame.dst.startsWith('01:') ? `${frame.dst} (Multicast)` : frame.dst);
  p.mac('eth.src', frame.src);
  if (frame.vlan !== undefined) {
    p.u16('eth.tpid', 0x8100, '0x8100 (802.1Q)');
    p.u16('eth.tci', frame.vlan & 0xfff, `PCP 0, VLAN ${frame.vlan}`);
  }
  if (etherType) p.u16('eth.type', etherType, `${hex(etherType, 4)} (${{ 0x0800: 'IPv4', 0x0806: 'ARP', 0x8863: 'PPPoE Discovery', 0x8864: 'PPPoE Session', 0x888e: '802.1X' }[etherType] ?? ''})`);
  else p.u16('eth.length', inner.length, `${inner.length} (IEEE 802.3)`);
  p.append(inner);
  p.close(2, frame.vlan !== undefined ? `${header} + 802.1Q` : header, 0, { note: 'note.ethernet' });
  return p;
}

// --- Steuermeldungen der Zugangstechniken und WLAN ---------------------------------

const DOCSIS_TYPES: Record<string, number> = { 'RNG-REQ': 4, 'RNG-RSP': 5, 'REG-ACK': 8, MDD: 33, UCD: 35, 'REG-REQ-MP': 44, 'REG-RSP-MP': 45 };
const PPPOE_CODES: Record<string, number> = { PADI: 0x09, PADO: 0x07, PADR: 0x19, PADS: 0x65 };
const SUBTYPES: Record<string, number> = { 'Association Request': 0, 'Association Response': 1, 'Reassociation Request': 2, 'Reassociation Response': 3, 'Probe Request': 4, 'Probe Response': 5, Authentication: 11 };

function tlvs(fields: Record<string, string | number> | undefined): Part {
  const p = new Part();
  let type = 1;
  for (const [key, value] of Object.entries(fields ?? {})) {
    const data = utf8(String(value));
    p.field(`link.${key}`, String(value), [type++, data.length & 0xff, ...data]);
  }
  return p;
}

function ie(id: number, data: number[]) {
  return [id, data.length, ...data];
}

function wlan80211(frame: EthernetFrame, c: LinkControl, from: string): { part: Part; linkType: number } {
  const p = new Part();
  const eapol = c.message.startsWith('EAPOL');
  const subtype = SUBTYPES[c.message] ?? 0;
  const fc = eapol ? 0x08 : subtype << 4;
  p.field('wlan.fc', eapol ? 'Data' : `Management, ${c.message}`, [fc, eapol ? (frame.dst === from ? 0x02 : 0x01) : 0]);
  p.u16('wlan.duration', 0x013a, '314 µs');
  p.mac('wlan.addr1', frame.dst || 'FF:FF:FF:FF:FF:FF');
  p.mac('wlan.addr2', frame.src);
  p.mac('wlan.bssid', c.fields?.bssid ? String(c.fields.bssid) : frame.dst || frame.src);
  p.u16('wlan.seq', 0x0010);
  const ssid = utf8(String(c.fields?.ssid ?? ''));
  const rates = ie(1, [0x8c, 0x12, 0x98, 0x24, 0xb0, 0x48, 0x60, 0x6c]);
  const rsn = ie(48, [1, 0, 0x00, 0x0f, 0xac, 4, 1, 0, 0x00, 0x0f, 0xac, 4, 1, 0, 0x00, 0x0f, 0xac, 2, 0, 0]);
  const secured = c.fields?.security !== 'open';
  if (eapol) {
    const n = Number(c.message.slice(-3, -2));
    const info = [0x008a, 0x010a, 0x13ca, 0x030a][n - 1] ?? 0;
    const key = [2, ...u16(info), ...u16(16), ...u32(0), ...u32(n), ...new Array(32).fill(n === 1 || n === 3 ? 0x5a : n === 2 ? 0x3c : 0), ...new Array(16).fill(0), ...new Array(8).fill(0), ...new Array(8).fill(0), ...new Array(16).fill(n > 1 ? 0x77 : 0), ...u16(0)];
    p.field('wlan.llc', 'SNAP, 802.1X (0x888e)', [0xaa, 0xaa, 0x03, 0, 0, 0, 0x88, 0x8e]);
    p.field('wlan.eapol', `${c.message} (WPA2 4-Way-Handshake)`, [2, 3, ...u16(key.length), ...key]);
  } else if (c.message === 'Authentication') {
    p.u16('wlan.authAlgorithm', 0, '0 (Open System)');
    p.u16('wlan.authSeq', Number(c.fields?.seq ?? 1));
    p.u16('wlan.status', 0, '0 (Successful)');
  } else if (c.message.endsWith('Response') && c.message.includes('ssociation')) {
    p.u16('wlan.capability', secured ? 0x0011 : 0x0001);
    p.u16('wlan.status', 0, '0 (Successful)');
    p.u16('wlan.aid', 0xc001, '1');
    p.field('wlan.rates', '6, 9, 12, 18, 24, 36, 48, 54 Mbit/s', rates);
  } else {
    if (c.message === 'Probe Response') {
      p.field('wlan.timestamp', '', new Array(8).fill(0));
      p.u16('wlan.beaconInterval', 100, '100 TU (102.4 ms)');
      p.u16('wlan.capability', secured ? 0x0011 : 0x0001, secured ? '0x0011 (ESS, Privacy)' : '0x0001 (ESS)');
    }
    if (c.message.endsWith('ssociation Request')) {
      p.u16('wlan.capability', 0x0011);
      p.u16('wlan.listenInterval', 10);
      if (c.message.startsWith('Reassociation')) p.mac('wlan.currentAp', frame.dst);
    }
    p.field('wlan.ssid', String(c.fields?.ssid ?? ''), ie(0, ssid));
    p.field('wlan.rates', '6, 9, 12, 18, 24, 36, 48, 54 Mbit/s', rates);
    if (c.message === 'Probe Response' && secured) p.field('wlan.rsn', 'WPA2, CCMP, PSK', rsn);
  }
  p.close(2, eapol ? 'IEEE 802.11 + EAPOL' : 'IEEE 802.11', 0, { note: 'note.wlan' });
  return { part: p, linkType: LINKTYPE.ieee80211 };
}

function linkControl(frame: EthernetFrame, c: LinkControl): { part: Part; linkType: number | null } {
  if (c.tech === 'wlan') return wlan80211(frame, c, frame.src);
  if (c.tech === 'pppoe') {
    const discovery = PPPOE_CODES[c.message];
    const inner = new Part();
    if (discovery !== undefined) {
      inner.u8('pppoe.verType', 0x11, '1, 1');
      inner.u8('pppoe.code', discovery, `${hex(discovery, 2)} (${c.message})`);
      inner.u16('pppoe.session', c.message === 'PADS' ? 0x1a2b : 0, c.message === 'PADS' ? '0x1a2b' : '0x0000');
      const tags = Object.entries(c.fields ?? {}).flatMap(([k, v]) => {
        const data = utf8(String(v));
        return [...u16(k === 'acName' ? 0x0102 : 0x0101), ...u16(data.length), ...data];
      });
      const hostUniq = [...u16(0x0103), ...u16(4), 0x00, 0x00, 0x12, 0x34];
      inner.u16('pppoe.length', tags.length + hostUniq.length);
      inner.field('pppoe.tags', Object.values(c.fields ?? {}).join(', ') || 'Host-Uniq', [...tags, ...hostUniq]);
      inner.close(2, `PPPoE ${c.message}`, 0, { note: 'note.pppoe' });
      return { part: ethernet(frame, inner, 0x8863), linkType: LINKTYPE.ethernet };
    }
    // PPP über PPPoE-Session (LCP, PAP).
    const ppp = new Part();
    const isLcp = c.message.includes('LCP');
    const code = c.message.includes('Ack') ? 2 : 1;
    ppp.u16('ppp.protocol', isLcp ? 0xc021 : 0xc023, isLcp ? '0xc021 (LCP)' : '0xc023 (PAP)');
    const data = isLcp ? [1, 4, ...u16(1492)] : utf8(String(c.fields?.user ?? ''));
    ppp.u8('ppp.code', code, c.message.split(' ').pop() ?? '');
    ppp.u8('ppp.id', 1);
    ppp.u16('ppp.length', 4 + data.length);
    ppp.field(isLcp ? 'ppp.mru' : 'ppp.peerId', isLcp ? 'MRU 1492' : String(c.fields?.user ?? ''), data);
    ppp.close(2, isLcp ? 'PPP LCP' : 'PPP PAP', 0);
    const session = new Part();
    session.u8('pppoe.verType', 0x11, '1, 1');
    session.u8('pppoe.code', 0, '0x00 (Session Data)');
    session.u16('pppoe.session', 0x1a2b, '0x1a2b');
    session.u16('pppoe.length', ppp.length);
    session.append(ppp);
    session.close(2, 'PPPoE Session', 0, { note: 'note.pppoe' });
    return { part: ethernet(frame, session, 0x8864), linkType: LINKTYPE.ethernet };
  }
  if (c.tech === 'docsis' && DOCSIS_TYPES[c.message] !== undefined) {
    const mgmt = new Part();
    mgmt.mac('docsis.da', '01:E0:2F:00:00:01');
    mgmt.mac('docsis.sa', frame.src);
    const body = tlvs(c.fields);
    mgmt.u16('docsis.msgLength', 6 + body.length);
    mgmt.field('docsis.llc', 'DSAP 0, SSAP 0, Control 0x03', [0, 0, 0x03]);
    mgmt.u8('docsis.version', 5);
    mgmt.u8('docsis.type', DOCSIS_TYPES[c.message]!, `${DOCSIS_TYPES[c.message]} (${c.message})`);
    mgmt.u8('docsis.reserved', 0);
    mgmt.append(body);
    mgmt.close(2, `DOCSIS MAC-Management ${c.message}`, 0, { note: 'note.docsis' });
    const p = new Part();
    p.u8('docsis.fc', 0xc2, '0xc2 (MAC-specific, management)');
    p.u8('docsis.macParm', 0);
    p.u16('docsis.len', mgmt.length);
    p.u16('docsis.hcs', internetChecksum([0xc2, 0, ...u16(mgmt.length)]));
    p.append(mgmt);
    p.close(2, 'DOCSIS', 0);
    return { part: p, linkType: LINKTYPE.docsis };
  }
  // GPON-PLOAM/OMCI, DSL-Handshake und LTE-Signalisierung: angezeigt, aber ohne pcap-Format.
  const p = tlvs(c.fields);
  const osi = c.tech === 'dsl' && !c.message.startsWith('G.hs') ? 1 : c.tech === 'lte' && !c.message.startsWith('RRC') ? 3 : 2;
  const name = { gpon: 'GPON', dsl: 'DSL', lte: 'LTE', docsis: 'DOCSIS' }[c.tech as 'gpon' | 'dsl' | 'lte' | 'docsis'] ?? c.tech;
  p.close(osi as 1 | 2 | 3, `${name} ${c.message}`, 0, { note: `note.${c.tech}` });
  return { part: p, linkType: null };
}

// --- Schicht 1 ------------------------------------------------------------------

/** Physische Schicht: Medium, Norm und tatsächliche Bytes auf der Leitung. */
export function physicalLayer(medium: Medium, frameLength: number, frame: EthernetFrame): WireLayer {
  const ethernetLike = !frame.l2 && !frame.access && (frame.payload.kind !== 'link' || frame.payload.tech === 'pppoe');
  const describe: Record<Medium, { standard: string; rate: string; signal: string }> = {
    tp: { standard: '1000BASE-T (IEEE 802.3ab)', rate: '1 Gbit/s', signal: 'PAM-5, 4 pairs, RJ45' },
    fiber: { standard: '1000BASE-SX/LX (IEEE 802.3z)', rate: '1–10 Gbit/s', signal: 'light 850/1310 nm, 8b/10b' },
    wireless: { standard: 'IEEE 802.11ac (Wi-Fi 5)', rate: 'bis 867 Mbit/s', signal: 'OFDM, 5 GHz radio' },
    serial: { standard: 'V.35 / RS-449 (synchron)', rate: '2 Mbit/s (E1)', signal: 'clock from DCE, NRZ' },
    coax: { standard: 'DOCSIS 3.1 PHY', rate: '1 Gbit/s ↓ / 100 Mbit/s ↑', signal: 'OFDM on coax' },
    dsl: { standard: frame.access === 'adsl' ? 'ADSL2+ (G.992.5)' : 'VDSL2 (G.993.2)', rate: frame.access === 'adsl' ? '16/1 Mbit/s' : '100/40 Mbit/s', signal: 'DMT on telephone copper pair' },
    cellular: { standard: 'LTE (3GPP Rel. 8+)', rate: '150/50 Mbit/s', signal: 'OFDMA ↓ / SC-FDMA ↑, radio' },
  };
  const info = describe[frame.access === 'gpon' ? 'fiber' : medium];
  const standard = frame.access === 'gpon' ? 'GPON (ITU-T G.984)' : info.standard;
  // Ethernet: Präambel 7 + SFD 1 + Prüfsumme (FCS) 4 + Pause 12 Byte kommen auf der Leitung dazu; Mindestgrösse 60.
  const onWire = ethernetLike && medium !== 'wireless' ? Math.max(frameLength, 60) + 4 + 8 + 12 : frameLength;
  const fields: WireField[] = [
    { key: 'phy.standard', value: standard, start: 0, length: 0 },
    { key: 'phy.rate', value: info.rate, start: 0, length: 0 },
    { key: 'phy.signal', value: info.signal, start: 0, length: 0 },
    { key: 'phy.frameBytes', value: String(frameLength), start: 0, length: 0 },
  ];
  if (onWire !== frameLength) fields.push({ key: 'phy.wireBytes', value: `${onWire} (+ preamble, FCS, IFG)`, start: 0, length: 0 });
  return { osi: 1, protocol: standard, start: 0, length: 0, fields, note: ethernetLike ? 'note.phyEthernet' : undefined };
}

/**
 * Kodiert einen Rahmen in Bytes nach den jeweiligen Normen und liefert die
 * Schichten mit ihren Feldern. Prüfsummen (IPv4, ICMP, UDP, TCP, OSPF) sind echt.
 */
export function dissect(frame: EthernetFrame, medium: Medium = 'tp'): Dissection {
  let result: { part: Part; linkType: number | null };
  const c = frame.payload;
  if (c.kind === 'link') {
    result = linkControl(frame, c);
  } else if (frame.l2) {
    const { part, pppProtocol } = payloadPart(frame);
    const p = new Part();
    if (frame.l2 === 'ppp') {
      p.u8('ppp.address', 0xff, '0xff (all stations)');
      p.u8('ppp.control', 0x03, '0x03 (UI)');
      p.u16('ppp.protocol', pppProtocol, `${hex(pppProtocol, 4)} (${{ 0x0021: 'IPv4', 0xc021: 'LCP', 0x8021: 'IPCP' }[pppProtocol] ?? ''})`);
      p.append(part);
      p.close(2, 'PPP (RFC 1662)', 0, { note: 'note.serial' });
      result = { part: p, linkType: LINKTYPE.pppHdlc };
    } else {
      p.u8('hdlc.address', 0x0f, '0x0f (Unicast)');
      p.u8('hdlc.control', 0x00);
      p.u16('hdlc.protocol', 0x0800, '0x0800 (IPv4)');
      p.append(part);
      p.close(2, 'Cisco HDLC', 0, { note: 'note.serial' });
      result = { part: p, linkType: LINKTYPE.ciscoHdlc };
    }
  } else {
    const { part, etherType } = payloadPart(frame);
    if (frame.access === 'lte' && c.kind === 'ipv4') {
      // Mobilfunk: IP-Pakete ohne Ethernet, mit PDCP-Kopf (Sequenznummer) über die Funkschnittstelle.
      const p = new Part();
      p.u16('lte.pdcp', 0x8000 | (c.id & 0xfff), `D/C=data, SN ${c.id & 0xfff}`);
      p.close(2, 'LTE PDCP/RLC/MAC', 0, { note: 'note.lte' });
      const inner = new Part().append(part);
      result = { part: new Part().append(p).append(inner), linkType: LINKTYPE.rawIp };
      // Für pcap: nur das IP-Paket (Linktyp «Raw IP»).
      const ip = new Part().append(part);
      return finish({ part: result.part, linkType: null }, medium, frame, { pcap: ip.bytes, linkType: LINKTYPE.rawIp });
    }
    if ((frame.access === 'adsl' || frame.access === 'vdsl') && c.kind === 'ipv4') {
      const ppp = new Part();
      ppp.u16('ppp.protocol', 0x0021, '0x0021 (IPv4)');
      ppp.append(part);
      ppp.close(2, 'PPP', 0);
      const session = new Part();
      session.u8('pppoe.verType', 0x11, '1, 1');
      session.u8('pppoe.code', 0, '0x00 (Session Data)');
      session.u16('pppoe.session', 0x1a2b, '0x1a2b');
      session.u16('pppoe.length', ppp.length);
      session.append(ppp);
      session.close(2, 'PPPoE Session', 0, { note: frame.access === 'adsl' ? 'note.adsl' : 'note.vdsl' });
      result = { part: ethernet(frame, session, 0x8864), linkType: LINKTYPE.ethernet };
    } else {
      const eth = ethernet(frame, part, etherType, c.kind === 'stp' ? 'IEEE 802.3' : 'Ethernet II');
      if (frame.access === 'docsis') {
        const p = new Part();
        p.u8('docsis.fc', 0x00, '0x00 (packet data)');
        p.u8('docsis.macParm', 0);
        p.u16('docsis.len', eth.length);
        p.u16('docsis.hcs', internetChecksum([0, 0, ...u16(eth.length)]));
        p.append(eth);
        p.close(2, 'DOCSIS', 0, { note: 'note.docsis' });
        result = { part: p, linkType: LINKTYPE.docsis };
      } else if (frame.access === 'gpon') {
        const p = new Part();
        const pli = eth.length;
        p.field('gpon.gem', `PLI ${pli}, Port-ID 1031, PTI 1`, [(pli >> 4) & 0xff, ((pli & 0xf) << 4) | ((1031 >> 8) & 0xf), 1031 & 0xff, 0x20 | 0x00, 0x00]);
        p.append(eth);
        p.close(2, 'GPON GEM', 0, { note: 'note.gpon' });
        return finish({ part: p, linkType: null }, medium, frame, { pcap: eth.bytes, linkType: LINKTYPE.ethernet });
      } else {
        result = { part: eth, linkType: LINKTYPE.ethernet };
      }
    }
  }
  return finish(result, medium, frame);
}

function finish(
  result: { part: Part; linkType: number | null },
  medium: Medium,
  frame: EthernetFrame,
  pcap?: { pcap: number[]; linkType: number },
): Dissection {
  const bytes = Uint8Array.from(result.part.bytes);
  const layers = [physicalLayer(medium, bytes.length, frame), ...result.part.layers];
  return { bytes, layers, linkType: pcap ? pcap.linkType : result.linkType, ...(pcap ? { pcapBytes: Uint8Array.from(pcap.pcap) } : {}) };
}
