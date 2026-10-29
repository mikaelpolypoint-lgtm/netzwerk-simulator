import { cableAt, getDevice } from './topology';
import type { Cable, Device, Endpoint, Medium, ModemKind, Topology } from './types';

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
  | 'wirelessUnsupported'
  | 'noSfp'
  | 'sfpMismatch'
  | 'wrongPort'
  | 'encapsulationMismatch'
  | 'wrongMedium';

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

/** Medium des WAN-Anschlusses je Zugangstechnik. */
export const WAN_MEDIUM: Record<ModemKind, Medium> = { cable: 'coax', fiber: 'fiber', mobile: 'cellular', adsl: 'dsl', vdsl: 'dsl' };

/** Anschluss 1 eines Modems ist die WAN-Seite (zum Provider), Anschluss 0 die LAN-Buchse. */
export const MODEM_WAN = 1;

export function isModemWan(device: Device, iface: number): boolean {
  return device.type === 'modem' && iface === MODEM_WAN;
}

/** Medium, das an diesem Anschluss passt (null = beliebig/mehrere). */
export function portMedium(device: Device, iface: number): Medium | null {
  const port = device.interfaces[iface];
  if (!port) return null;
  if (port.serial) return 'serial';
  if (port.sfpSlot) return 'fiber';
  if (device.type === 'accesspoint') return iface === 0 ? 'tp' : 'wireless';
  if (device.type === 'modem' && device.modem) return iface === MODEM_WAN ? WAN_MEDIUM[device.modem.kind] : 'tp';
  return null;
}

/** Provider-Seite: Das Internet nimmt jedes Zugangsmedium an (DSLAM, CMTS, OLT, Mobilfunkmast sind darin enthalten). */
const isProvider = (device: Device) => device.type === 'internet';

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
  const ia = a.interfaces[cable.a.iface];
  const ib = b.interfaces[cable.b.iface];
  if (ia?.shutdown || ib?.shutdown) return { up: false, reason: 'shutdown' };
  const medium = mediumOf(cable);
  // Feste Anschlüsse (Modem-WAN, serielle Ports) verlangen ihr Medium.
  for (const [device, iface] of [[a, cable.a.iface], [b, cable.b.iface]] as const) {
    const fixed = portMedium(device, iface);
    if (fixed && fixed !== medium) return { up: false, reason: fixed === 'fiber' || medium === 'fiber' ? 'wrongPort' : 'wrongMedium' };
  }
  if (medium === 'serial') {
    if (!ia?.serial || !ib?.serial) return { up: false, reason: 'wrongPort' };
    if ((ia.encapsulation ?? 'hdlc') !== (ib.encapsulation ?? 'hdlc')) return { up: false, reason: 'encapsulationMismatch' };
    return { up: true };
  }
  if (medium === 'coax' || medium === 'dsl' || medium === 'cellular') {
    // Zugangsleitungen verbinden ein Modem passender Technik mit dem Provider.
    const modem = a.type === 'modem' ? a : b.type === 'modem' ? b : null;
    const other = modem === a ? b : a;
    if (!modem || !isProvider(other)) return { up: false, reason: 'wrongMedium' };
    return { up: true };
  }
  if (medium === 'fiber' && (isProvider(a) || isProvider(b))) {
    // Glasfaser zum Provider: Das ONT-Modem hat einen festen PON-Anschluss, Router brauchen ein SFP-Modul.
    const customer = isProvider(a) ? b : a;
    const port = isProvider(a) ? ib : ia;
    if (isModemWan(customer, isProvider(a) ? cable.b.iface : cable.a.iface)) return { up: true };
    if (!port?.sfpSlot) return { up: false, reason: 'wrongPort' };
    if (!port.sfp) return { up: false, reason: 'noSfp' };
    return { up: true };
  }
  if (medium === 'fiber') {
    // Glasfaser: beide Enden im SFP-Einschub, mit Modul, und zwar demselben Typ.
    if (!ia?.sfpSlot || !ib?.sfpSlot) return { up: false, reason: 'wrongPort' };
    if (!ia.sfp || !ib.sfp) return { up: false, reason: 'noSfp' };
    if (ia.sfp !== ib.sfp) return { up: false, reason: 'sfpMismatch' };
    return { up: true };
  }
  if (ia?.sfpSlot || ib?.sfpSlot) return { up: false, reason: 'wrongPort' };
  if (medium === 'wireless') return wirelessStatus(a, b);
  return { up: true };
}

/** Ist am Anschluss ein Kabel gesteckt und die Verbindung aktiv? */
export function linkUpAt(t: Topology, endpoint: Endpoint): boolean {
  const cable = cableAt(t, endpoint);
  return !!cable && linkStatus(t, cable).up;
}
