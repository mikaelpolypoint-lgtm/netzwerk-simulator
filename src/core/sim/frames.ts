import type { DnsRecord, DnsType } from '../model/types';

export type { DnsRecord, DnsType };

// Pakete sind verschachtelte, unveränderliche Objekte statt Bytefolgen:
// Ethernet-Rahmen enthält ARP oder IPv4, IPv4 enthält ICMP oder UDP,
// UDP enthält Anwendungsdaten (DHCP, später DNS).

export const BROADCAST_MAC = 'FF:FF:FF:FF:FF:FF';
export const ZERO_MAC = '00:00:00:00:00:00';

export interface ArpPacket {
  kind: 'arp';
  op: 'request' | 'reply';
  senderMac: string;
  senderIp: string;
  targetMac: string;
  targetIp: string;
}

export type IcmpType = 'echoRequest' | 'echoReply' | 'destUnreachable' | 'timeExceeded';

export interface IcmpMessage {
  kind: 'icmp';
  type: IcmpType;
  id: number;
  seq: number;
  /** Nutzdaten in Byte (nur die Länge wird simuliert). */
  size: number;
  /** Bei "destUnreachable": Netz oder einzelner Host nicht erreichbar. */
  code?: 'net' | 'host';
  /** Bei Fehlermeldungen: Kopfdaten des auslösenden Pakets. */
  original?: { src: string; dst: string; id: number; seq: number };
}

export type DhcpOp = 'discover' | 'offer' | 'request' | 'ack' | 'nak' | 'release';

export interface DhcpMessage {
  kind: 'dhcp';
  op: DhcpOp;
  /** Transaktionsnummer: ordnet Antworten der Anfrage zu. */
  xid: number;
  clientMac: string;
  /** Angebotene bzw. zugewiesene Adresse ("yiaddr"). */
  yourIp?: string;
  /** Vom Client gewünschte Adresse (Request). */
  requestedIp?: string;
  /** Adresse des DHCP-Servers ("Server Identifier"). */
  serverIp?: string;
  mask?: string;
  gateway?: string;
  dns?: string;
  /** Lease-Dauer in Sekunden. */
  leaseTime?: number;
  /** Adresse des DHCP-Relays, über das die Anfrage kam ("giaddr"); fehlt bei direkter Anfrage. */
  giaddr?: string;
}

export interface DnsMessage {
  kind: 'dns';
  id: number;
  response: boolean;
  question: { name: string; type: DnsType };
  answers: DnsRecord[];
  /** "nxdomain": Name unbekannt. */
  rcode: 'ok' | 'nxdomain';
}

export type AppMessage = DhcpMessage | DnsMessage;

export interface UdpDatagram {
  kind: 'udp';
  srcPort: number;
  dstPort: number;
  payload: AppMessage;
}

export type TcpFlag = 'SYN' | 'ACK' | 'FIN' | 'RST' | 'PSH';

/**
 * TCP-Segment. Die Nutzdaten sind Text (z.B. eine HTTP-Anfrage); Sequenz-
 * nummern zählen Zeichen statt Bytes.
 */
export interface TcpSegment {
  kind: 'tcp';
  srcPort: number;
  dstPort: number;
  seq: number;
  ack: number;
  flags: TcpFlag[];
  data: string;
}

export interface Ipv4Packet {
  kind: 'ipv4';
  src: string;
  dst: string;
  ttl: number;
  id: number;
  payload: IcmpMessage | UdpDatagram | TcpSegment;
}

export interface EthernetFrame {
  src: string;
  dst: string;
  payload: ArpPacket | Ipv4Packet;
}

export const DHCP_SERVER_PORT = 67;
export const DHCP_CLIENT_PORT = 68;
export const DNS_PORT = 53;
export const HTTP_PORT = 80;
export const SMTP_PORT = 25;
export const POP3_PORT = 110;
export const IMAP_PORT = 143;
