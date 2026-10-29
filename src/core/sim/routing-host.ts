import type { Device } from '../model/types';
import type { IfaceAddress, Route } from '../net/routing';
import type { Ipv4Packet } from './frames';
import type { SendError, SendOptions } from './ip';
import type { NodeContext } from './simulation';
import type { TcpStack } from './tcp';

/** Was die Routingprotokolle vom Router brauchen. */
export interface RoutingHost {
  readonly ctx: NodeContext;
  readonly tcp: TcpStack;
  device(): Device | undefined;
  interfaces(): IfaceAddress[];
  /** Routingtabelle ohne die Routen des fragenden Protokolls (verhindert Rückkopplung). */
  routesExcept(kind: 'ospf' | 'rip' | 'bgp'): Route[];
  sendMulticast(index: number, group: string, payload: Ipv4Packet['payload']): void;
  sendIp(dst: string, payload: Ipv4Packet['payload'], options?: SendOptions, onError?: (e: SendError) => void): void;
  /** Ist das (logische) Interface verbunden? SVIs gelten als verbunden. */
  ifaceUp(index: number): boolean;
  /** Routen haben sich geändert (Zwischenspeicher leeren). */
  routesChanged(): void;
}

/** Router-ID: konfiguriert, sonst die höchste Interface-Adresse (wie FRRouting ohne Loopback). */
export function routerIdOf(host: RoutingHost, configured?: string): string {
  if (configured) return configured;
  const ips = host.interfaces().map((i) => i.ip);
  if (!ips.length) return '0.0.0.0';
  const max = Math.max(...ips);
  return [24, 16, 8, 0].map((s) => (max >>> s) & 0xff).join('.');
}
