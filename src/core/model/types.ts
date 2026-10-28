export type DeviceType = 'notebook' | 'pc' | 'switch' | 'l3switch' | 'router' | 'accesspoint' | 'modem' | 'internet';

/** Übertragungsmedium einer Verbindung. */
export type Medium = 'tp' | 'fiber' | 'wireless';

/** Farbmarkierung für Anschlüsse und Bereiche (Dokumentationsmodus). */
export type TagColor = 'red' | 'orange' | 'yellow' | 'green' | 'teal' | 'blue' | 'purple' | 'pink' | 'gray';

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
  /** Nur Router: Interface zeigt ins Internet; ausgehende Pakete erhalten dessen Adresse (NAT). */
  nat?: boolean;
  /** Nur Switch: VLAN eines Access-Ports (fehlt = VLAN 1). */
  vlan?: number;
  /** Nur Switch: Trunk-Port, überträgt alle VLANs mit 802.1Q-Tag (VLAN 1 ohne Tag). */
  trunk?: boolean;
  /** Administrativ abgeschaltet («shutdown»): Link ist aus, nichts wird gesendet oder empfangen. */
  shutdown?: boolean;
  /** Farbmarkierung des Anschlusses (z.B. für Patchfelder und Dokumentation). */
  color?: TagColor;
  /** Beschreibung, z.B. «Uplink Stock 2» («description» in der CLI). */
  description?: string;
}

/**
 * Router: logisches Interface auf einem physischen Anschluss für ein VLAN
 * (802.1Q-Subinterface, z.B. eth0.10). Grundlage für Router-on-a-Stick.
 */
export interface SubInterface {
  /** Physischer Anschluss (Index). */
  parent: number;
  vlan: number;
  ip?: string;
  mask?: string;
  dhcpRelay?: string;
}

/** Layer-3-Switch: virtuelles Interface eines VLANs (SVI, «interface vlan 10»). */
export interface Svi {
  vlan: number;
  ip?: string;
  mask?: string;
  dhcpRelay?: string;
}

export interface PortForward {
  protocol: 'tcp' | 'udp';
  /** Port auf der Internet-Adresse des Routers. */
  port: number;
  /** Interner Rechner und Port, an den weitergeleitet wird. */
  to: string;
  toPort: number;
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
  /** Nur Router mit NAT: Portweiterleitungen von aussen an interne Rechner. */
  portForwards?: PortForward[];
  /** Nur Switch: Spanning Tree aktiv; erst dann sind Schleifen zwischen Switches erlaubt. */
  stp?: boolean;
  /** Nur Switch: STP-Priorität (Standard 32768); kleiner = eher Root-Bridge. */
  stpPriority?: number;
  /** Nur Router: 802.1Q-Subinterfaces (Router-on-a-Stick). */
  subinterfaces?: SubInterface[];
  /** Nur Layer-3-Switch: VLAN-Interfaces mit Adresse. */
  svis?: Svi[];
  /** Nur Layer-3-Switch: false = Routing zwischen VLANs ausgeschaltet («no ip routing»). */
  ipRouting?: boolean;
  /** Nur Access Point: Funknetz, das er ausstrahlt (und Mesh-Verbund). */
  wlan?: WlanConfig;
  /** Endgeräte: Funknetz, mit dem sie sich verbinden. */
  wifi?: WifiClient;
  /** Stockwerk (Index in `Topology.floors`); fehlt = Stockwerk 0. */
  floor?: number;
  /** Zugang zur Befehlszeile (Router und Switches). */
  cli?: CliConfig;
  /** Nur Switches: Namen der VLANs («vlan 10» / «name Verwaltung»). */
  vlanNames?: VlanName[];
}

export interface VlanName {
  vlan: number;
  name: string;
}

export type WlanBand = '2.4' | '5';

export interface WlanConfig {
  ssid: string;
  /** WPA2-Passwort; leer = offenes Netz. Nur für die Simulation, Klartext. */
  password?: string;
  band: WlanBand;
  channel: number;
  /** Mesh: verbindet sich drahtlos mit anderen Mesh-Access-Points derselben SSID. */
  mesh?: boolean;
}

export interface WifiClient {
  ssid: string;
  password?: string;
}

export interface CliUser {
  name: string;
  /** Nur für die Simulation, Klartext. */
  password: string;
}

export interface CliConfig {
  /** SSH-Zugang aktiv («ip ssh» / «line vty … transport input ssh»). */
  ssh?: boolean;
  users?: CliUser[];
  /** Passwort für den privilegierten Modus («enable secret»). */
  enableSecret?: string;
  /** Banner, das beim Anmelden erscheint. */
  banner?: string;
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
  /** Medium; fehlt = Twisted-Pair-Kabel. */
  medium?: Medium;
}

/** Dokumentationsmodus: farbiger Bereich auf der Zeichenfläche, z.B. ein Subnetz oder ein Raum. */
export interface DocArea {
  /** Form "a<n>". */
  id: string;
  title: string;
  color: TagColor;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Netzadresse mit Präfix, z.B. "192.168.10.0/24"; die Oberfläche berechnet daraus die Netzinfos. */
  network?: string;
  /** VLAN-Nummer, falls der Bereich ein VLAN darstellt. */
  vlan?: number;
  /** Freitext, z.B. Zweck, Gateway, Verantwortliche. */
  note?: string;
  /** Stockwerk, auf dem der Bereich liegt; fehlt = auf allen sichtbar. */
  floor?: number;
}

export interface Floor {
  name: string;
}

/** Unveränderlich: Jede Operation liefert eine neue Topologie. */
export interface Topology {
  devices: Device[];
  cables: Cable[];
  /** Nächste freie Nummer für Geräte- und Kabel-IDs, wird nie wiederverwendet. */
  nextId: number;
  /** Dokumentationsmodus: Bereiche mit Farbe, Titel und Netzinfos. */
  areas?: DocArea[];
  /** Stockwerke; fehlt = nur ein Stockwerk. */
  floors?: Floor[];
}
