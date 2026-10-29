import { DEVICE_SPECS, decodeIface, type Device, type DeviceType } from '../core';
import { t } from '../i18n';

export function typeLabel(type: DeviceType): string {
  return t(`device.${type}`);
}

export function roleLabel(type: DeviceType): string {
  return t(`role.${DEVICE_SPECS[type].role}`);
}

/**
 * Endgeräte und Router zählen ab eth0, Switches und Modems ab Port 1.
 * Access Points: Anschluss 0 ist die LAN-Buchse, die übrigen sind Funkplätze.
 * Logische Interfaces: Subinterface «eth0.10», VLAN-Interface «VLAN 10».
 */
export function interfaceLabel(device: Device, index: number): string {
  const ref = decodeIface(index);
  if (ref.kind === 'sub') return t('iface.sub', { index: ref.port, vlan: ref.vlan });
  if (ref.kind === 'svi') return t('iface.svi', { vlan: ref.vlan });
  if (device.type === 'accesspoint') return index === 0 ? t('iface.lan') : t('iface.radio', { n: index });
  if (device.interfaces[index]?.sfpSlot) {
    const n = device.interfaces.slice(0, index + 1).filter((i) => i.sfpSlot).length;
    return device.type === 'router' ? t('iface.ethSfp', { index }) : t('iface.sfp', { n });
  }
  return device.type === 'switch' || device.type === 'l3switch' || device.type === 'modem'
    ? t('iface.port', { n: index + 1 })
    : t('iface.eth', { index });
}

export function errorText(error: { code: string; params?: Record<string, string | number> }): string {
  return t(`error.${error.code}`, error.params);
}

/** Name einer Funktion (Funktionsumfang), z.B. «OSPF». */
export function featureName(id: string): string {
  return t(`feature.${id}`);
}
