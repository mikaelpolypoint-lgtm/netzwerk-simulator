import { broadcastOf, formatIp, networkOf, parseIp, parseMask } from '../core';
import { t } from '../i18n';

/** Kurzbeschreibung eines Subnetzes für Lernende: Netz, nutzbare Adressen, Broadcast. */
export function subnetSummary(ipText: string | undefined, maskText: string | undefined): string | null {
  const ip = ipText ? parseIp(ipText) : null;
  const prefix = maskText ? parseMask(maskText) : null;
  if (ip === null || prefix === null) return null;
  const network = networkOf(ip, prefix);
  const broadcast = broadcastOf(ip, prefix);
  const net = `${formatIp(network)}/${prefix}`;
  if (prefix >= 31) return t('subnet.pointToPoint', { net, hosts: prefix === 31 ? 2 : 1 });
  return t('subnet.summary', {
    net,
    first: formatIp(network + 1),
    last: formatIp(broadcast - 1),
    hosts: broadcast - network - 1,
    broadcast: formatIp(broadcast),
  });
}
