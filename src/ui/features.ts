import type { DeviceType, Medium, Topology } from '../core';

/**
 * Funktionsumfang: Jede Funktion des Simulators lässt sich ausblenden, damit
 * Lernende im ersten Lehrjahr nur sehen, was sie brauchen, und Studierende
 * alles einschalten können.
 *
 * Profile 1–5 schalten Funktionen stufenweise frei; «custom» erlaubt eine
 * eigene Auswahl. Was der Admin (Webversion) sperrt, bleibt immer aus.
 * Lehrpersonen können eine Auswahl als Datei speichern und verteilen.
 */
export type ProfileLevel = 1 | 2 | 3 | 4 | 5;
export const PROFILE_LEVELS: readonly ProfileLevel[] = [1, 2, 3, 4, 5];

export type FeatureGroup = 'devices' | 'media' | 'services' | 'network' | 'routing' | 'tools';

export interface FeatureSpec {
  id: string;
  group: FeatureGroup;
  /** Ab diesem Profil eingeschaltet. */
  level: ProfileLevel;
}

const f = (id: string, group: FeatureGroup, level: ProfileLevel): FeatureSpec => ({ id, group, level });

export const FEATURES: readonly FeatureSpec[] = [
  // Geräte
  f('device.notebook', 'devices', 1),
  f('device.pc', 'devices', 1),
  f('device.switch', 'devices', 1),
  f('device.router', 'devices', 1),
  f('device.server', 'devices', 1),
  f('device.accesspoint', 'devices', 2),
  f('device.internet', 'devices', 2),
  f('device.clientgroup', 'devices', 3),
  f('device.modem', 'devices', 3),
  f('device.l3switch', 'devices', 4),
  // Verbindungen
  f('medium.fiber', 'media', 2),
  f('medium.wireless', 'media', 2),
  f('medium.access', 'media', 3),
  f('medium.serial', 'media', 4),
  // Dienste
  f('service.dhcp', 'services', 1),
  f('service.dns', 'services', 2),
  f('service.web', 'services', 2),
  f('service.mail', 'services', 3),
  // Netzwerk
  f('net.portShutdown', 'network', 2),
  f('net.cableDamage', 'network', 3),
  f('net.vlan', 'network', 3),
  f('net.stp', 'network', 3),
  f('net.wlanMesh', 'network', 3),
  f('net.dhcpRelay', 'network', 3),
  f('net.nat', 'network', 3),
  f('net.subinterfaces', 'network', 4),
  f('net.staticNat', 'network', 4),
  f('net.cgnat', 'network', 4),
  f('net.cli', 'network', 3),
  f('net.ssh', 'network', 4),
  // Routing
  f('routing.static', 'routing', 2),
  f('routing.rip', 'routing', 4),
  f('routing.ospf', 'routing', 4),
  f('routing.bgp', 'routing', 5),
  // Werkzeuge und Ansichten
  f('tool.sniffer', 'tools', 1),
  f('tool.osi', 'tools', 1),
  f('tool.hex', 'tools', 4),
  f('tool.pcap', 'tools', 4),
  f('tool.ipCalculator', 'tools', 1),
  f('tool.areas', 'tools', 1),
  f('tool.snapshots', 'tools', 1),
  f('tool.addressBadges', 'tools', 2),
  f('tool.floors', 'tools', 2),
  f('tool.costs', 'tools', 2),
  f('tool.racks', 'tools', 3),
  f('tool.taskEditor', 'tools', 1),
];

export type FeatureId = (typeof FEATURES)[number]['id'];
export const FEATURE_GROUPS: readonly FeatureGroup[] = ['devices', 'media', 'services', 'network', 'routing', 'tools'];

const byId = new Map(FEATURES.map((spec) => [spec.id, spec]));

export function isFeature(id: string): boolean {
  return byId.has(id);
}

/** Ist die Funktion im Profil enthalten (ohne Admin-Sperren und eigene Auswahl)? */
export function inLevel(id: string, level: ProfileLevel): boolean {
  const spec = byId.get(id);
  return !!spec && spec.level <= level;
}

/** Welche Funktion braucht ein Gerätetyp? */
export function deviceFeature(type: DeviceType): string {
  return `device.${type}`;
}

/** Welche Funktion braucht ein Medium? (TP-Kabel braucht nichts.) */
export function mediumFeature(medium: Medium): string | null {
  if (medium === 'tp') return null;
  if (medium === 'coax' || medium === 'dsl' || medium === 'cellular') return 'medium.access';
  return `medium.${medium}`;
}

/** Funktionen, die ein Projekt verwendet: Beim Laden werden sie eingeschaltet, damit nichts verborgen wirkt. */
export function usedFeatures(t: Topology): string[] {
  const used = new Set<string>();
  for (const d of t.devices) {
    used.add(deviceFeature(d.type));
    if (d.dhcpServer) used.add('service.dhcp');
    if (d.dnsServer) used.add('service.dns');
    if (d.webServer) used.add('service.web');
    if (d.mailServer || d.mailAccount) used.add('service.mail');
    if (d.stp) used.add('net.stp');
    if (d.subinterfaces?.length) used.add('net.subinterfaces');
    if (d.portForwards?.length) used.add('net.nat');
    if (d.staticNat?.length) used.add('net.staticNat');
    if (d.cgnatAddress) used.add('net.cgnat');
    if (d.ospf) used.add('routing.ospf');
    if (d.rip) used.add('routing.rip');
    if (d.bgp) used.add('routing.bgp');
    if (d.routes?.length) used.add('routing.static');
    if (d.vlanNames?.length) used.add('net.vlan');
    if (d.wlan?.mesh) used.add('net.wlanMesh');
    if (d.cli?.ssh) used.add('net.ssh');
    for (const i of d.interfaces) {
      if (i.trunk || (i.vlan && i.vlan !== 1)) used.add('net.vlan');
      if (i.nat) used.add('net.nat');
      if (i.dhcpRelay) used.add('net.dhcpRelay');
      if (i.serial) used.add('medium.serial');
      if (i.cgnat) used.add('net.cgnat');
      if (i.sfp) used.add('medium.fiber');
    }
  }
  for (const c of t.cables) {
    const feature = mediumFeature(c.medium ?? 'tp');
    if (feature) used.add(feature);
    if (c.loss) used.add('net.cableDamage');
  }
  if ((t.floors?.length ?? 0) > 1) used.add('tool.floors');
  if (t.areas?.some((a) => a.kind === 'rack')) used.add('tool.racks');
  return [...used].filter(isFeature);
}

// --- Datei zum Verteilen -------------------------------------------------------

export const FEATURE_FILE_FORMAT = 'netzwerk-simulator-features';

export interface FeatureFile {
  format: typeof FEATURE_FILE_FORMAT;
  version: 1;
  /** Profil 1–5 oder eigene Auswahl. */
  profile: ProfileLevel | 'custom';
  /** Bei «custom»: Abweichungen vom Profil `base`. */
  base?: ProfileLevel;
  features?: Record<string, boolean>;
  /** Auswahl sperren: Lernende können sie in der Oberfläche nicht ändern. */
  lock?: boolean;
  /** Freitext für die Lehrperson, z.B. «Modul 117, 1. Lehrjahr». */
  title?: string;
}

export function serializeFeatureFile(file: Omit<FeatureFile, 'format' | 'version'>): string {
  return JSON.stringify({ format: FEATURE_FILE_FORMAT, version: 1, ...file }, null, 2) + '\n';
}

export function parseFeatureFile(text: string): FeatureFile | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const o = data as Record<string, unknown>;
  if (o.format !== FEATURE_FILE_FORMAT || o.version !== 1) return null;
  const level = (v: unknown): v is ProfileLevel => typeof v === 'number' && (PROFILE_LEVELS as readonly number[]).includes(v);
  if (o.profile !== 'custom' && !level(o.profile)) return null;
  const features: Record<string, boolean> = {};
  if (o.features !== undefined) {
    if (typeof o.features !== 'object' || o.features === null) return null;
    for (const [k, v] of Object.entries(o.features as Record<string, unknown>)) if (isFeature(k) && typeof v === 'boolean') features[k] = v;
  }
  return {
    format: FEATURE_FILE_FORMAT,
    version: 1,
    profile: o.profile as ProfileLevel | 'custom',
    ...(level(o.base) ? { base: o.base } : {}),
    ...(Object.keys(features).length ? { features } : {}),
    ...(o.lock === true ? { lock: true } : {}),
    ...(typeof o.title === 'string' ? { title: o.title.slice(0, 80) } : {}),
  };
}
