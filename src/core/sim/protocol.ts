import type { EthernetFrame } from './frames';

/** Bekannte TCP-Ports und ihr Anwendungsprotokoll. */
export const TCP_APPS: Record<number, string> = { 80: 'HTTP', 25: 'SMTP', 110: 'POP3', 143: 'IMAP' };

/** Oberstes erkennbares Protokoll eines Rahmens, wie ein Paketanalysator es anzeigt. */
export function protocolOf(frame: EthernetFrame): string {
  const p = frame.payload;
  if (p.kind === 'arp') return 'ARP';
  if (p.kind === 'stp') return 'STP';
  const inner = p.payload;
  if (inner.kind === 'icmp') return 'ICMP';
  if (inner.kind === 'udp') return inner.payload.kind.toUpperCase();
  // TCP-Segmente mit Nutzdaten zählen zum Anwendungsprotokoll, reine Steuersegmente zu TCP.
  const app = TCP_APPS[inner.dstPort] ?? TCP_APPS[inner.srcPort];
  return inner.data && app ? app : 'TCP';
}
