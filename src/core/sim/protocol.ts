import type { EthernetFrame } from './frames';

/** Bekannte TCP-Ports und ihr Anwendungsprotokoll. */
export const TCP_APPS: Record<number, string> = { 22: 'SSH', 80: 'HTTP', 25: 'SMTP', 110: 'POP3', 143: 'IMAP', 179: 'BGP' };

const LINK_NAMES = { docsis: 'DOCSIS', gpon: 'GPON', dsl: 'DSL', pppoe: 'PPPoE', lte: 'LTE', wlan: '802.11' } as const;

/** Oberstes erkennbares Protokoll eines Rahmens, wie ein Paketanalysator es anzeigt. */
export function protocolOf(frame: EthernetFrame): string {
  const p = frame.payload;
  if (p.kind === 'arp') return 'ARP';
  if (p.kind === 'stp') return 'STP';
  if (p.kind === 'ppp') return p.protocol === 'lcp' ? 'PPP LCP' : 'PPP IPCP';
  if (p.kind === 'link') return LINK_NAMES[p.tech];
  const inner = p.payload;
  if (inner.kind === 'icmp') return 'ICMP';
  if (inner.kind === 'ospf') return 'OSPF';
  if (inner.kind === 'udp') return inner.payload.kind.toUpperCase();
  // TCP-Segmente mit Nutzdaten zählen zum Anwendungsprotokoll, reine Steuersegmente zu TCP.
  const app = TCP_APPS[inner.dstPort] ?? TCP_APPS[inner.srcPort];
  return inner.data && app ? app : 'TCP';
}
