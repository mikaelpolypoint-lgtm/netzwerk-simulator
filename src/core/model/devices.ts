import type { DeviceRole, DeviceType } from './types';

export interface DeviceSpec {
  role: DeviceRole;
  defaultInterfaces: number;
  minInterfaces: number;
  maxInterfaces: number;
}

export const DEVICE_TYPES: readonly DeviceType[] = ['notebook', 'pc', 'switch', 'router', 'modem'];

export const DEVICE_SPECS: Record<DeviceType, DeviceSpec> = {
  notebook: { role: 'endpoint', defaultInterfaces: 1, minInterfaces: 1, maxInterfaces: 1 },
  pc: { role: 'endpoint', defaultInterfaces: 1, minInterfaces: 1, maxInterfaces: 1 },
  switch: { role: 'distribution', defaultInterfaces: 8, minInterfaces: 2, maxInterfaces: 24 },
  router: { role: 'routing', defaultInterfaces: 2, minInterfaces: 2, maxInterfaces: 8 },
  modem: { role: 'routing', defaultInterfaces: 2, minInterfaces: 2, maxInterfaces: 2 },
};

export function isDeviceType(value: unknown): value is DeviceType {
  return typeof value === 'string' && (DEVICE_TYPES as readonly string[]).includes(value);
}
