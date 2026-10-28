import type { Device } from '../model/types';
import { decodeIface, subifId, sviId } from '../net/routing';

/**
 * Interface-Namen in der Befehlszeile.
 * Router: eth0, eth1 … und Subinterfaces eth0.10 (wie unter Linux/FRRouting).
 * Switches: port1, port2 … (Zählung ab 1 wie auf der Frontplatte);
 *   zusätzlich verstanden: gi0/1, fa0/1, gigabitethernet0/1, fastethernet0/1.
 * Layer-3-Switch: vlan10 für das VLAN-Interface.
 */
export function cliIfaceName(device: Device, id: number): string {
  const ref = decodeIface(id);
  if (ref.kind === 'svi') return `vlan${ref.vlan}`;
  if (ref.kind === 'sub') return `eth${ref.port}.${ref.vlan}`;
  return usesPortNames(device) ? `port${ref.port + 1}` : `eth${ref.port}`;
}

export function usesPortNames(device: Device): boolean {
  return device.type === 'switch' || device.type === 'l3switch' || device.type === 'accesspoint';
}

export type ParsedIface =
  | { kind: 'port'; port: number }
  | { kind: 'sub'; port: number; vlan: number }
  | { kind: 'svi'; vlan: number };

/** Liest einen Interface-Namen; Gross-/Kleinschreibung egal, Leerzeichen vor der Nummer erlaubt. */
export function parseIfaceName(device: Device, raw: string): ParsedIface | null {
  const text = raw.toLowerCase().replace(/\s+/g, '');
  const ports = device.interfaces.length;
  const port = (n: number) => (Number.isInteger(n) && n >= 0 && n < ports ? n : null);

  const vlan = /^(?:vlan|vl)(\d+)$/.exec(text);
  if (vlan) {
    const v = Number(vlan[1]);
    return device.type === 'l3switch' && v >= 1 && v <= 4094 ? { kind: 'svi', vlan: v } : null;
  }
  if (usesPortNames(device)) {
    const m = /^(?:port|p|(?:gigabitethernet|gi|g|fastethernet|fa|f)0\/)?(\d+)$/.exec(text);
    if (!m) return null;
    const n = port(Number(m[1]) - 1);
    return n === null ? null : { kind: 'port', port: n };
  }
  const m = /^(?:eth|ethernet|e|gi(?:gabitethernet)?0\/|g0\/)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) return null;
  const n = port(Number(m[1]));
  if (n === null) return null;
  if (m[2] === undefined) return { kind: 'port', port: n };
  const v = Number(m[2]);
  return device.type === 'router' && v >= 1 && v <= 4094 ? { kind: 'sub', port: n, vlan: v } : null;
}

export function ifaceIdOf(ref: ParsedIface): number {
  if (ref.kind === 'svi') return sviId(ref.vlan);
  if (ref.kind === 'sub') return subifId(ref.port, ref.vlan);
  return ref.port;
}
