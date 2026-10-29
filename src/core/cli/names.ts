import type { Device } from '../model/types';
import { decodeIface, subifId, sviId } from '../net/routing';

/**
 * Interface-Namen in der Befehlszeile.
 * Router: eth0, eth1 … und Subinterfaces eth0.10 (wie unter Linux/FRRouting).
 * Switches: port1, port2 … (Zählung ab 1 wie auf der Frontplatte), SFP-Einschübe sfp1, sfp2 …;
 *   zusätzlich verstanden: gi0/1, fa0/1, gigabitethernet0/1, fastethernet0/1.
 * Layer-3-Switch: vlan10 für das VLAN-Interface.
 */
export function cliIfaceName(device: Device, id: number): string {
  const ref = decodeIface(id);
  if (ref.kind === 'svi') return `vlan${ref.vlan}`;
  if (ref.kind === 'sub') return `eth${ref.port}.${ref.vlan}`;
  if (device.interfaces[ref.port]?.serial) return `serial${serialOrdinal(device, ref.port) - 1}`;
  if (!usesPortNames(device)) return `eth${ref.port}`;
  // SFP-Einschübe zählen separat: sfp1, sfp2 …
  if (device.interfaces[ref.port]?.sfpSlot) return `sfp${sfpOrdinal(device, ref.port)}`;
  return `port${ref.port + 1}`;
}

function serialOrdinal(device: Device, index: number): number {
  return device.interfaces.slice(0, index + 1).filter((i) => i.serial).length;
}

function sfpOrdinal(device: Device, index: number): number {
  return device.interfaces.slice(0, index + 1).filter((i) => i.sfpSlot).length;
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
    const sfp = /^(?:sfp|te|tengigabitethernet)(?:0\/)?(\d+)$/.exec(text);
    if (sfp) {
      const slot = device.interfaces.filter((i) => i.sfpSlot)[Number(sfp[1]) - 1];
      return slot ? { kind: 'port', port: slot.index } : null;
    }
    const m = /^(?:port|p|(?:gigabitethernet|gi|g|fastethernet|fa|f)0\/)?(\d+)$/.exec(text);
    if (!m) return null;
    const n = port(Number(m[1]) - 1);
    return n === null || device.interfaces[n]?.sfpSlot ? null : { kind: 'port', port: n };
  }
  const serial = /^(?:serial|se|s)(?:0\/0\/)?(\d+)$/.exec(text);
  if (serial) {
    const slot = device.interfaces.filter((i) => i.serial)[Number(serial[1])];
    return slot ? { kind: 'port', port: slot.index } : null;
  }
  const m = /^(?:eth|ethernet|e|gi(?:gabitethernet)?0\/|g0\/)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) return null;
  const n = port(Number(m[1]));
  if (n === null || device.interfaces[n]?.serial) return null;
  if (m[2] === undefined) return { kind: 'port', port: n };
  const v = Number(m[2]);
  return device.type === 'router' && v >= 1 && v <= 4094 ? { kind: 'sub', port: n, vlan: v } : null;
}

export function ifaceIdOf(ref: ParsedIface): number {
  if (ref.kind === 'svi') return sviId(ref.vlan);
  if (ref.kind === 'sub') return subifId(ref.port, ref.vlan);
  return ref.port;
}
