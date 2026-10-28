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
  /** Nur Router: DHCP-Anfragen aus diesem Netz an diesen Server weiterleiten (DHCP-Relay). */
  dhcpRelay?: string;
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
  /** Nur Endgeräte: Adresse per DHCP beziehen statt statisch. */
  dhcp?: boolean;
  /** Nur Rechner: DHCP-Server-Dienst. */
  dhcpServer?: DhcpServerConfig;
  /** Nur Rechner: DNS-Server-Dienst mit seiner Zone. */
  dnsServer?: DnsServerConfig;
  /** Nur Rechner: Webserver mit seinen Seiten. */
  webServer?: WebServerConfig;
  /** Nur Rechner: Mailserver (SMTP, POP3, IMAP) mit Postfächern. */
  mailServer?: MailServerConfig;
  /** Endgeräte: E-Mail-Konto für die Anwendung "E-Mail". */
  mailAccount?: MailAccount;
  /** Nur Vermittlungsrechner: statische Routen. */
  routes?: StaticRoute[];
}

export type DnsType = 'A' | 'MX';

export interface DnsRecord {
  /** Name in Kleinbuchstaben, z.B. "webserver1" oder "www.schule.ch". */
  name: string;
  type: DnsType;
  /** Bei A eine IPv4-Adresse, bei MX der Name des Mailservers. */
  value: string;
  /** Gültigkeit im Cache der Clients in Sekunden. */
  ttl: number;
}

export interface DnsServerConfig {
  records: DnsRecord[];
}

export interface WebFile {
  /** Pfad mit führendem Schrägstrich, z.B. "/index.html". */
  path: string;
  content: string;
}

export interface WebServerConfig {
  files: WebFile[];
}

export interface Mailbox {
  /** Teil vor dem @, z.B. "anna". */
  user: string;
  /** Nur für die Simulation, im Klartext gespeichert: keine echten Passwörter verwenden. */
  password: string;
}

export interface MailServerConfig {
  /** Domain, für die der Server Post annimmt, z.B. "schule.ch". */
  domain: string;
  mailboxes: Mailbox[];
}

export type MailProtocol = 'pop3' | 'imap';

export interface MailAccount {
  address: string;
  password: string;
  /** Name oder IP des Servers für ausgehende Post (SMTP). */
  smtpServer: string;
  /** Name oder IP des Servers für eingehende Post (POP3 oder IMAP). */
  incomingServer: string;
  protocol: MailProtocol;
}

export interface DhcpServerConfig {
  /** Erste und letzte vergebene Adresse; die Maske ist die des Servers. */
  start: string;
  end: string;
  gateway?: string;
  dns?: string;
  /** Lease-Dauer in Sekunden. */
  leaseTime: number;
  /** Weitere Bereiche für entfernte Netze, die über ein DHCP-Relay angefragt werden. */
  scopes?: DhcpScope[];
}

export interface DhcpScope {
  start: string;
  end: string;
  mask: string;
  gateway?: string;
  dns?: string;
}

export interface StaticRoute {
  /** Zielnetz, z.B. "10.1.0.0". */
  network: string;
  /** Maske in Punktschreibweise. */
  mask: string;
  /** Nächster Router; fehlt, wenn das Ziel über `iface` direkt erreichbar ist. */
  gateway?: string;
  /** Ausgangsanschluss; fehlt er, ergibt er sich aus dem Gateway. */
  iface?: number;
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
  /** Beschädigtes Kabel: so viele Prozent der Rahmen gehen verloren (für Fehlersuche-Übungen). */
  loss?: number;
}

/** Unveränderlich: Jede Operation liefert eine neue Topologie. */
export interface Topology {
  devices: Device[];
  cables: Cable[];
  /** Nächste freie Nummer für Geräte- und Kabel-IDs, wird nie wiederverwendet. */
  nextId: number;
}
