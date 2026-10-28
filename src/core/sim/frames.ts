// Pakete sind verschachtelte, unveränderliche Objekte statt Bytefolgen:
// Ethernet-Rahmen enthält ARP oder IPv4, IPv4 enthält ICMP (später UDP/TCP).

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
}

export interface Ipv4Packet {
  kind: 'ipv4';
  src: string;
  dst: string;
  ttl: number;
  id: number;
  payload: IcmpMessage;
}

export interface EthernetFrame {
  src: string;
  dst: string;
  payload: ArpPacket | Ipv4Packet;
}
