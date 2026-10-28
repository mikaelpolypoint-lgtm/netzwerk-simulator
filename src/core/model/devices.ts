import type { DeviceRole, DeviceType } from './types';

export interface DeviceSpec {
  role: DeviceRole;
  defaultInterfaces: number;
  minInterfaces: number;
  maxInterfaces: number;
}

export const DEVICE_TYPES: readonly DeviceType[] = ['notebook', 'pc', 'switch', 'router', 'modem', 'internet'];

export const DEVICE_SPECS: Record<DeviceType, DeviceSpec> = {
  notebook: { role: 'endpoint', defaultInterfaces: 1, minInterfaces: 1, maxInterfaces: 1 },
  pc: { role: 'endpoint', defaultInterfaces: 1, minInterfaces: 1, maxInterfaces: 1 },
  switch: { role: 'distribution', defaultInterfaces: 8, minInterfaces: 2, maxInterfaces: 24 },
  router: { role: 'routing', defaultInterfaces: 2, minInterfaces: 2, maxInterfaces: 8 },
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
