import type { DeviceRole, DeviceType } from './types';

export interface DeviceSpec {
  role: DeviceRole;
  /** SFP-Einschübe für Glasfaser, zusätzlich zu den RJ45-Anschlüssen (bei neuen Geräten). */
  sfpSlots?: number;
  defaultInterfaces: number;
  minInterfaces: number;
  maxInterfaces: number;
}

export const DEVICE_TYPES: readonly DeviceType[] = [
  'notebook',
  'pc',
  'server',
  'clientgroup',
  'switch',
  'l3switch',
  'router',
  'accesspoint',
  'modem',
  'internet',
];

/** Client-Gruppe: so viele Rechner höchstens (eine /23 reicht dafür). */
export const MAX_GROUP_SIZE = 500;
export const DEFAULT_GROUP_SIZE = 20;

export const DEVICE_SPECS: Record<DeviceType, DeviceSpec> = {
  notebook: { role: 'endpoint', defaultInterfaces: 1, minInterfaces: 1, maxInterfaces: 1 },
  pc: { role: 'endpoint', defaultInterfaces: 1, minInterfaces: 1, maxInterfaces: 1 },
  server: { role: 'endpoint', defaultInterfaces: 1, minInterfaces: 1, maxInterfaces: 1 },
  clientgroup: { role: 'endpoint', defaultInterfaces: 1, minInterfaces: 1, maxInterfaces: 1 },
  switch: { role: 'distribution', sfpSlots: 2, defaultInterfaces: 8, minInterfaces: 2, maxInterfaces: 24 },
  l3switch: { role: 'distribution', sfpSlots: 4, defaultInterfaces: 8, minInterfaces: 2, maxInterfaces: 48 },
  router: { role: 'routing', sfpSlots: 1, defaultInterfaces: 2, minInterfaces: 2, maxInterfaces: 8 },
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

/** Geräte, die in ein Rack eingebaut werden können. */
export function isRackable(type: DeviceType): boolean {
  return type === 'switch' || type === 'l3switch' || type === 'router' || type === 'modem' || type === 'server';
}

/** Endgeräte mit Diensten (DHCP, DNS, Web, Mail): Server, und Rechner als Kompromiss für einfache Netze. */
export function canHostServices(type: DeviceType): boolean {
  return type === 'server' || type === 'pc';
}

/** Endgeräte, die per WLAN verbunden werden können. */
export function isWifiCapable(type: DeviceType): boolean {
  return type === 'notebook' || type === 'pc';
}

/** Geräte mit dynamischem Routing (OSPF, BGP, RIP). */
export function canRouteDynamically(type: DeviceType): boolean {
  return type === 'router' || type === 'l3switch' || type === 'internet';
}
