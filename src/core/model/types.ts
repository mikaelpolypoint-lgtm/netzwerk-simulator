export type DeviceType = 'notebook' | 'pc' | 'switch' | 'router' | 'modem';

/** Rolle eines Geräts, bestimmt u.a. die Farbe in der Oberfläche. */
export type DeviceRole = 'endpoint' | 'distribution' | 'routing';

export interface Point {
  x: number;
  y: number;
}

export interface NetInterface {
  index: number;
  mac: string;
  /** IPv4-Adresse als Text, z.B. "192.168.0.10"; fehlt, solange nicht konfiguriert. */
  ip?: string;
  /** Subnetzmaske in Punktschreibweise, z.B. "255.255.255.0". */
  mask?: string;
}

export interface Device {
  /** Form "d<n>"; n bestimmt die MAC-Adressen des Geräts. */
  id: string;
  type: DeviceType;
  name: string;
  position: Point;
  interfaces: NetInterface[];
  /** Nur Endgeräte: Standardgateway und DNS-Server. */
  gateway?: string;
  dns?: string;
}

export interface Endpoint {
  device: string;
  iface: number;
}

export interface Cable {
  /** Form "c<n>". */
  id: string;
  a: Endpoint;
  b: Endpoint;
}

/** Unveränderlich: Jede Operation liefert eine neue Topologie. */
export interface Topology {
  devices: Device[];
  cables: Cable[];
  /** Nächste freie Nummer für Geräte- und Kabel-IDs, wird nie wiederverwendet. */
  nextId: number;
}
