import type { DeviceRole, DeviceType } from './types';

export interface DeviceSpec {
  role: DeviceRole;
  defaultInterfaces: number;
  minInterfaces: number;
  maxInterfaces: number;
}

export const DEVICE_TYPES: readonly DeviceType[] = ['notebook', 'pc', 'switch', 'l3switch', 'router', 'accesspoint', 'modem', 'internet'];

export const DEVICE_SPECS: Record<DeviceType, DeviceSpec> = {
  notebook: { role: 'endpoint', defaultInterfaces: 1, minInterfaces: 1, maxInterfaces: 1 },
  pc: { role: 'endpoint', defaultInterfaces: 1, minInterfaces: 1, maxInterfaces: 1 },
  switch: { role: 'distribution', defaultInterfaces: 8, minInterfaces: 2, maxInterfaces: 24 },
  l3switch: { role: 'distribution', defaultInterfaces: 8, minInterfaces: 2, maxInterfaces: 48 },
  router: { role: 'routing', defaultInterfaces: 2, minInterfaces: 2, maxInterfaces: 8 },
  // Anschluss 0 ist der LAN-Port (Kabel), alle weiteren sind Funkverbindungen.
  accesspoint: { role: 'distribution', defaultInterfaces: 9, minInterfaces: 3, maxInterfaces: 33 },
  modem: { role: 'routing', defaultInterfaces: 2, minInterfaces: 2, maxInterfaces: 2 },
  internet: { role: 'routing', defaultInterfaces: 4, minInterfaces: 2, maxInterfaces: 8 },
};

export function isDeviceType(value: unknown): value is DeviceType {
  return typeof value === 'string' && (DEVICE_TYPES as readonly string[]).includes(value);
}

/** Router und Internet leiten IP-Pakete weiter und haben Routen, Interfaces mit Adressen usw. */
export function isRouterType(type: DeviceType): boolean {
  return type === 'router' || type === 'internet';
}

/** Switches im engeren Sinn: lernen MAC-Adressen, kennen VLANs und Spanning Tree. */
export function isSwitchType(type: DeviceType): boolean {
  return type === 'switch' || type === 'l3switch';
}

/** Geräte mit eigener Routingtabelle (statische Routen). */
export function hasRoutingTable(type: DeviceType): boolean {
  return isRouterType(type) || type === 'l3switch';
}
