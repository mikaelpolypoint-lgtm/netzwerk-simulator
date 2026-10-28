import { cableAt, getDevice } from './topology';
import type { Cable, Device, Endpoint, Medium, Topology } from './types';

/**
 * Zustand einer Verbindung, wie ihn die LEDs an echten Geräten zeigen:
 * «up» nur, wenn beide Seiten eingeschaltet sind und (bei Funk) die
 * Anmeldung am Access Point klappt und das Signal reicht.
 */
export type LinkDownReason =
  | 'shutdown'
  | 'noWlan'
  | 'ssidMismatch'
  | 'wrongPassword'
  | 'outOfRange'
  | 'meshDisabled'
  | 'wirelessUnsupported';

export interface LinkStatus {
  up: boolean;
  reason?: LinkDownReason;
  /** Nur Funk: Signalqualität 0–100 %. */
  signal?: number;
}

export const mediumOf = (cable: Cable): Medium => cable.medium ?? 'tp';

/** Pixel auf der Zeichenfläche, ab denen das Funksignal nicht mehr reicht (gleiches Stockwerk). */
export const WIFI_RANGE = 700;
/** Signalverlust in Prozentpunkten pro Stockwerk Unterschied (Decken dämpfen stark). */
export const FLOOR_PENALTY = 35;
/** Unter dieser Signalqualität kommt keine Verbindung zustande. */
export const MIN_SIGNAL = 15;

/** Access Points: Anschluss 0 ist die Kabelbuchse (LAN), alle anderen sind Funkverbindungen. */
export function isRadioPort(device: Device, iface: number): boolean {
  return device.type === 'accesspoint' && iface > 0;
}

/** Endgeräte, die sich per WLAN verbinden können. */
export function canUseWifi(device: Device): boolean {
  return device.type === 'notebook' || device.type === 'pc';
}

export function signalBetween(a: Device, b: Device): number {
  const dx = a.position.x - b.position.x;
  const dy = a.position.y - b.position.y;
  const distance = Math.hypot(dx, dy);
  const floors = Math.abs((a.floor ?? 0) - (b.floor ?? 0));
  const signal = 100 - (distance / WIFI_RANGE) * (100 - MIN_SIGNAL) - floors * FLOOR_PENALTY;
  return Math.max(0, Math.min(100, Math.round(signal)));
}

function wirelessStatus(a: Device, b: Device): LinkStatus {
  const apA = a.type === 'accesspoint';
  const apB = b.type === 'accesspoint';
  if (!apA && !apB) return { up: false, reason: 'wirelessUnsupported' };
  const ap = apA ? a : b;
  const other = apA ? b : a;
  if (!ap.wlan) return { up: false, reason: 'noWlan' };
  const signal = signalBetween(a, b);
  if (other.type === 'accesspoint') {
    // Mesh: beide Access Points im Mesh-Betrieb mit gleicher SSID und gleichem Passwort.
    if (!other.wlan) return { up: false, reason: 'noWlan', signal };
    if (!ap.wlan.mesh || !other.wlan.mesh) return { up: false, reason: 'meshDisabled', signal };
    if (ap.wlan.ssid !== other.wlan.ssid) return { up: false, reason: 'ssidMismatch', signal };
    if ((ap.wlan.password ?? '') !== (other.wlan.password ?? '')) return { up: false, reason: 'wrongPassword', signal };
  } else {
    if (!canUseWifi(other)) return { up: false, reason: 'wirelessUnsupported' };
    if (!other.wifi || other.wifi.ssid !== ap.wlan.ssid) return { up: false, reason: 'ssidMismatch', signal };
    if ((other.wifi.password ?? '') !== (ap.wlan.password ?? '')) return { up: false, reason: 'wrongPassword', signal };
  }
  if (signal < MIN_SIGNAL) return { up: false, reason: 'outOfRange', signal };
  return { up: true, signal };
}

export function linkStatus(t: Topology, cable: Cable): LinkStatus {
  const a = getDevice(t, cable.a.device);
  const b = getDevice(t, cable.b.device);
  if (!a || !b) return { up: false };
  if (a.interfaces[cable.a.iface]?.shutdown || b.interfaces[cable.b.iface]?.shutdown) return { up: false, reason: 'shutdown' };
  if (mediumOf(cable) === 'wireless') return wirelessStatus(a, b);
  return { up: true };
}

/** Ist am Anschluss ein Kabel gesteckt und die Verbindung aktiv? */
export function linkUpAt(t: Topology, endpoint: Endpoint): boolean {
  const cable = cableAt(t, endpoint);
  return !!cable && linkStatus(t, cable).up;
}
