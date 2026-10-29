import { BROADCAST_MAC, TCP_APPS, decodeBgp, getDevice, protocolOf, type EthernetFrame, type PacketLogEntry, type Topology } from '../core';
import { t } from '../i18n';
import { interfaceLabel } from './labels';

/**
 * Paketliste wie in einem Analysator: Zeilen, Kurzbeschreibung und ein
 * kleiner Anzeigefilter (ähnlich Wireshark, aber einfacher).
 */
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
  const names: Record<number, string> = { 53: 'DNS', 67: 'DHCP-Server', 68: 'DHCP-Client', 520: 'RIP', ...TCP_APPS };
  return names[port] ? `${port} (${names[port]})` : String(port);
}

function endpointLabel(topology: Topology, device: string, iface: number): string {
  const d = getDevice(topology, device);
  return d ? `${d.name} (${interfaceLabel(d, iface)})` : '?';
}

const hex = (n: number) => `0x${n.toString(16).padStart(8, '0')}`;

/** Kurzbeschreibung eines Rahmens für die Spalte «Info». */
export function infoOf(frame: EthernetFrame): string {
  const p = frame.payload;
  const tag = frame.vlan !== undefined ? `[VLAN ${frame.vlan}] ` : '';
  if (p.kind === 'arp') {
    const gratuitous = p.op === 'request' && p.senderIp === p.targetIp;
    return tag + (gratuitous ? t('packets.arp.gratuitous', { ...p }) : t(`packets.arp.${p.op}`, { ...p }));
  }
  if (p.kind === 'stp') return t('packets.stp', { root: p.rootId, cost: p.cost, bridge: p.bridgeId });
  if (p.kind === 'ppp') return `${p.protocol.toUpperCase()} ${p.code}${p.ip ? ` ${p.ip}` : ''}${p.magic !== undefined ? ` magic=${hex(p.magic)}` : ''}`;
  if (p.kind === 'link') {
    const fields = Object.entries(p.fields ?? {})
      .slice(0, 2)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    return `${p.message}${fields ? ` – ${fields}` : ''}`;
  }
  const inner = p.payload;
  const access = frame.access ? `[${frame.access.toUpperCase()}] ` : '';
  if (inner.kind === 'ospf') {
    const detail =
      inner.type === 'hello'
        ? t('packets.ospf.hello', { neighbors: inner.hello?.neighbors.join(', ') || '–' })
        : inner.type === 'lsu'
          ? t('packets.ospf.lsu', { n: inner.lsas?.length ?? 0 })
          : inner.type === 'dbd'
            ? t('packets.ospf.dbd', { n: inner.headers?.length ?? 0 })
            : inner.type.toUpperCase();
    return `${access}OSPF ${inner.routerId} · ${detail}`;
  }
  if (inner.kind === 'icmp') {
    return (
      access +
      t(`packets.icmp.${inner.type}`, {
        seq: inner.seq,
        ttl: p.ttl,
        target: inner.original?.dst ?? '',
        what: t(`packets.unreachable.${inner.code ?? 'net'}`),
      })
    );
  }
  if (inner.kind === 'tcp') {
    const flags = `[${inner.flags.join(', ')}]`;
    const numbers = t('packets.tcp.numbers', { seq: inner.seq, ack: inner.ack, len: inner.data.length });
    const app = protocolOf(frame);
    if (app === 'BGP') {
      const messages = decodeBgp(inner.data);
      return `${access}${messages.map((m) => (m.type === 'UPDATE' ? `UPDATE ${m.nlri.join(', ')}${m.withdrawn.length ? ` −${m.withdrawn.join(', ')}` : ''}` : m.type === 'OPEN' ? `OPEN AS ${m.asn}` : m.type === 'NOTIFICATION' ? `NOTIFICATION ${m.code}` : m.type)).join(' + ') || t('packets.tcp.continuation')} ${numbers}`;
    }
    if (app === 'TCP') return `${access}${portLabel(inner.srcPort)} → ${portLabel(inner.dstPort)} ${flags} ${numbers}`;
    if (app === 'SSH' && !inner.data.startsWith('SSH-')) return `${access}${t('packets.ssh.encrypted', { len: inner.data.length })} ${numbers}`;
    const first = (inner.data.split('\r\n')[0] ?? '').slice(0, 80);
    const continuation = app === 'HTTP' && !/^(GET|POST|HEAD|HTTP\/)/.test(first);
    return `${access}${continuation ? t('packets.tcp.continuation') : first} ${numbers}`;
  }
  const msg = inner.payload;
  if (msg.kind === 'dns') {
    if (!msg.response) return access + t('packets.dns.query', { type: msg.question.type, name: msg.question.name });
    if (msg.rcode === 'nxdomain') return access + t('packets.dns.nxdomain', { name: msg.question.name });
    return access + t('packets.dns.answer', { type: msg.question.type, name: msg.question.name, value: msg.answers.map((a) => a.value).join(', ') });
  }
  if (msg.kind === 'rip') {
    return access + t(msg.command === 'request' ? 'packets.rip.request' : 'packets.rip.response', { routes: msg.entries.map((e) => `${e.network}/${e.metric}`).join(', ') });
  }
  return access + t(`packets.dhcp.${msg.op}`, { ip: msg.yourIp ?? msg.requestedIp ?? '', xid: hex(msg.xid) });
}

/** Absender und Empfänger: bei IP die Adressen, sonst MAC-Adressen bzw. Gerätenamen. */
function addresses(topology: Topology, entry: PacketLogEntry): [string, string] {
  const frame = entry.frame;
  const p = frame.payload;
  if (p.kind === 'ipv4') return [p.src, p.dst];
  if (frame.l2 || p.kind === 'link' || !frame.src) {
    const name = (id: string) => getDevice(topology, id)?.name ?? id;
    return [name(entry.from.device), name(entry.to.device)];
  }
  return [frame.src, frame.dst === BROADCAST_MAC ? t('packets.broadcast') : frame.dst];
}

/** Übersetzt einen Logeintrag in eine Tabellenzeile wie in einem Paketanalysator. */
export function toRow(topology: Topology, entry: PacketLogEntry): PacketRow {
  const frame = entry.frame;
  const [source, destination] = addresses(topology, entry);
  const text = frame.payload.kind === 'ipv4' && frame.vlan !== undefined ? `[VLAN ${frame.vlan}] ${infoOf(frame)}` : infoOf(frame);
  return {
    id: entry.id,
    time: (entry.sent / 1000).toFixed(3),
    route: `${endpointLabel(topology, entry.from.device, entry.from.iface)} → ${endpointLabel(topology, entry.to.device, entry.to.iface)}`,
    protocol: protocolOf(frame),
    source,
    destination,
    info: entry.status === 'lost' ? `${text} – ${t(`packets.lost.${entry.lostBecause ?? 'removed'}`)}` : text,
    lost: entry.status === 'lost',
  };
}

// --- Anzeigefilter ---------------------------------------------------------------

type Predicate = (entry: PacketLogEntry, topology: Topology) => boolean;

export interface FilterResult {
  ok: boolean;
  test?: Predicate;
  error?: string;
}

const PROTOCOL_WORDS: Record<string, (proto: string, frame: EthernetFrame) => boolean> = {
  arp: (p) => p === 'ARP',
  icmp: (p) => p === 'ICMP',
  ip: (_p, f) => f.payload.kind === 'ipv4',
  tcp: (_p, f) => f.payload.kind === 'ipv4' && f.payload.payload.kind === 'tcp',
  udp: (_p, f) => f.payload.kind === 'ipv4' && f.payload.payload.kind === 'udp',
  dhcp: (p) => p === 'DHCP',
  dns: (p) => p === 'DNS',
  http: (p) => p === 'HTTP',
  smtp: (p) => p === 'SMTP',
  pop: (p) => p === 'POP3',
  pop3: (p) => p === 'POP3',
  imap: (p) => p === 'IMAP',
  mail: (p) => p === 'SMTP' || p === 'POP3' || p === 'IMAP',
  ssh: (p) => p === 'SSH',
  bgp: (p) => p === 'BGP',
  ospf: (p) => p === 'OSPF',
  rip: (p) => p === 'RIP',
  stp: (p) => p === 'STP',
  ppp: (p) => p.startsWith('PPP'),
  wlan: (p) => p === '802.11',
  wifi: (p) => p === '802.11',
  docsis: (p, f) => p === 'DOCSIS' || f.access === 'docsis',
  gpon: (p, f) => p === 'GPON' || f.access === 'gpon',
  dsl: (p, f) => p === 'DSL' || p === 'PPPoE' || f.access === 'adsl' || f.access === 'vdsl',
  pppoe: (p, f) => p === 'PPPoE' || f.access === 'adsl' || f.access === 'vdsl',
  lte: (p, f) => p === 'LTE' || f.access === 'lte',
  vlan: (_p, f) => f.vlan !== undefined,
  broadcast: (_p, f) => f.dst === BROADCAST_MAC || (f.payload.kind === 'ipv4' && f.payload.dst === '255.255.255.255'),
};

function ports(frame: EthernetFrame): number[] {
  if (frame.payload.kind !== 'ipv4') return [];
  const inner = frame.payload.payload;
  return inner.kind === 'tcp' || inner.kind === 'udp' ? [inner.srcPort, inner.dstPort] : [];
}

/**
 * Filter lesen: Protokollnamen (arp, dhcp, http …), Vergleiche
 * (ip.addr == 10.0.0.1, ip.src, ip.dst, eth.addr, port == 80, tcp.port, udp.port,
 * vlan == 10), «host PC1» (Gerätename), «lost», verknüpft mit and/or/not
 * (auch &&, ||, !) und Klammern.
 */
export function parseFilter(text: string): FilterResult {
  const tokens = text.match(/\(|\)|==|!=|&&|\|\||!|[^\s()=!&|]+/g) ?? [];
  if (tokens.length === 0) return { ok: true };
  let i = 0;
  const peek = () => tokens[i]?.toLowerCase();
  const next = () => tokens[i++];

  const fail = (message: string): never => {
    throw new Error(message);
  };

  function primary(): Predicate {
    const token = next();
    if (token === undefined) return fail(t('filter.error.end'));
    const lower = token.toLowerCase();
    if (lower === '(') {
      const inner = or();
      if (next() !== ')') fail(t('filter.error.paren'));
      return inner;
    }
    if (lower === '!' || lower === 'not') {
      const inner = primary();
      return (e, topo) => !inner(e, topo);
    }
    if (lower === 'lost') return (e) => e.status === 'lost';
    if (lower === 'host') {
      const name = next();
      if (!name) return fail(t('filter.error.value', { field: 'host' }));
      const wanted = name.toLowerCase();
      return (e, topo) => [e.from.device, e.to.device].some((id) => getDevice(topo, id)?.name.toLowerCase().replace(/\s+/g, '') === wanted.replace(/\s+/g, ''));
    }
    const field = lower;
    if (peek() === '==' || peek() === '!=') {
      const negate = next() === '!=';
      const value = next();
      if (value === undefined) return fail(t('filter.error.value', { field }));
      const v = value.toLowerCase();
      const compare = (test: Predicate): Predicate => (negate ? (e, topo) => !test(e, topo) : test);
      const ip = (e: PacketLogEntry) => (e.frame.payload.kind === 'ipv4' ? e.frame.payload : null);
      switch (field) {
        case 'ip.addr':
          return compare((e) => !!ip(e) && (ip(e)!.src === value || ip(e)!.dst === value));
        case 'ip.src':
          return compare((e) => ip(e)?.src === value);
        case 'ip.dst':
          return compare((e) => ip(e)?.dst === value);
        case 'eth.addr':
          return compare((e) => e.frame.src.toLowerCase() === v || e.frame.dst.toLowerCase() === v);
        case 'eth.src':
          return compare((e) => e.frame.src.toLowerCase() === v);
        case 'eth.dst':
          return compare((e) => e.frame.dst.toLowerCase() === v);
        case 'port':
        case 'tcp.port':
        case 'udp.port': {
          const n = Number(value);
          const kind = field.split('.')[0];
          return compare((e) => {
            const p = e.frame.payload;
            if (p.kind !== 'ipv4') return false;
            if (kind !== 'port' && p.payload.kind !== kind) return false;
            return ports(e.frame).includes(n);
          });
        }
        case 'vlan':
          return compare((e) => e.frame.vlan === Number(value));
        case 'proto':
        case 'protocol':
          return compare((e) => protocolOf(e.frame).toLowerCase() === v);
        default:
          return fail(t('filter.error.field', { field }));
      }
    }
    const word = PROTOCOL_WORDS[lower] ?? (lower === '802.11' ? PROTOCOL_WORDS.wlan : undefined);
    if (!word) return fail(t('filter.error.unknown', { word: token }));
    return (e) => word(protocolOf(e.frame), e.frame);
  }

  function and(): Predicate {
    let left = primary();
    while (peek() === 'and' || peek() === '&&') {
      next();
      const right = primary();
      const l = left;
      left = (e, topo) => l(e, topo) && right(e, topo);
    }
    return left;
  }

  function or(): Predicate {
    let left = and();
    while (peek() === 'or' || peek() === '||') {
      next();
      const right = and();
      const l = left;
      left = (e, topo) => l(e, topo) || right(e, topo);
    }
    return left;
  }

  try {
    const test = or();
    if (i < tokens.length) fail(t('filter.error.extra', { word: tokens[i] ?? '' }));
    return { ok: true, test };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
