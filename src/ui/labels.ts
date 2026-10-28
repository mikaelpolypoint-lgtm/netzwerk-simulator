import { DEVICE_SPECS, type Device, type DeviceType } from '../core';
import { t } from '../i18n';

export function typeLabel(type: DeviceType): string {
  return t(`device.${type}`);
}

export function roleLabel(type: DeviceType): string {
  return t(`role.${DEVICE_SPECS[type].role}`);
}

/** Endgeräte und Router zählen ab eth0, Switches und Modems ab Port 1. */
export function interfaceLabel(device: Device, index: number): string {
  return device.type === 'switch' || device.type === 'modem'
    ? t('iface.port', { n: index + 1 })
    : t('iface.eth', { index });
}

export function errorText(error: { code: string; params?: Record<string, string | number> }): string {
  return t(`error.${error.code}`, error.params);
}
