# Protokolle und Vereinfachungen

Der Simulator sendet Pakete, die den Standards folgen. Jeder Rahmen lässt sich in echte Bytes kodieren (`src/core/wire/encode.ts`) und als pcapng-Datei exportieren. Wireshark und Scapy lesen diese Dateien wie einen echten Mitschnitt, Prüfsummen (IPv4, ICMP, UDP, TCP, OSPF) sind korrekt berechnet. Wo der Unterricht es erfordert, sind Abläufe vereinfacht oder Zeiten verkürzt. Die Paketdetails vermerken das pro Schicht.

## Übersicht

| Schicht | Protokoll | Standard | Vereinfachung |
|---|---|---|---|
| 1 | Ethernet-PHY, 802.11-Funk, DOCSIS, GPON, DSL, LTE | IEEE 802.3, 802.11, ITU-T | Nur als Beschreibung (Medium, Rate, Modulation); keine Bitfehler ausser «beschädigtes Kabel» |
| 2 | Ethernet II, 802.1Q | IEEE 802.3, 802.1Q | Ohne Präambel und FCS, wie in den meisten Mitschnitten |
| 2 | STP | IEEE 802.1D | Verkürzte Zeiten; Ports zu Endgeräten leiten sofort weiter (wie PortFast) |
| 2 | ARP, Gratuitous ARP, Proxy-ARP | RFC 826, RFC 5227 | – |
| 2 | 802.11 Management, EAPOL | IEEE 802.11, 802.11i | Authentication, Association/Reassociation und 4-Way-Handshake als Ablauf; keine echte Verschlüsselung |
| 2 | PPP (LCP, IPCP), Cisco-HDLC | RFC 1661, RFC 1662, RFC 1332 | Keine Authentisierung auf seriellen Leitungen |
| 2 | PPPoE | RFC 2516 | Discovery (PADI/PADO/PADR/PADS) und Session; Anmeldung mit PAP |
| 3 | IPv4 | RFC 791 | Keine Fragmentierung (MSS 1460 verhindert sie), keine Optionen |
| 3 | ICMP | RFC 792 | Echo, Destination Unreachable, Time Exceeded |
| 3 | OSPFv2 | RFC 2328 | Router-LSAs und externe LSAs (Redistribution), keine Summary-LSAs zwischen Areas, kein DR/BDR (Nachbarn wie Punkt-zu-Punkt); Hello 2 s statt 10 s |
| 3 | NAT/PAT, statisches NAT, CGNAT | RFC 3022, RFC 6598 | Endpunktunabhängige Zuordnung; keine Application Layer Gateways |
| 4 | UDP | RFC 768 | – |
| 4 | TCP | RFC 9293 | Drei-Wege-Handshake, Sequenznummern in Bytes, MSS 1460, Wiederholung nach 1 s (höchstens dreimal), FIN/RST; feste Fenstergrösse, keine Staukontrolle |
| 7 | DHCP | RFC 2131, RFC 2132 | Discover/Offer/Request/Ack, Relay (giaddr); Erneuerung nach halber Lease-Dauer |
| 7 | DNS | RFC 1035 | A- und MX-Einträge, keine Rekursion; Cache nach TTL |
| 7 | HTTP/1.1 | RFC 9112 | GET, Content-Length in Bytes (UTF-8), Bilder als Binärdaten; kein HTTPS |
| 7 | SMTP, POP3, IMAP | RFC 5321, RFC 1939, RFC 9051 | Kleiner Befehlsumfang, keine Authentisierung per TLS |
| 7 | SSH | RFC 4253 | Versionsaustausch im Klartext, danach nur verschlüsselte Bytes |
| 7 | RIP v2 | RFC 2453 | Update alle 5 s statt 30 s, Timeout 30 s statt 180 s; Split Horizon |
| 7 | BGP-4 | RFC 4271 | Binär über TCP 179: OPEN, KEEPALIVE, UPDATE, NOTIFICATION; Pfadwahl nach AS-Pfad-Länge; keine Policies |

Die Routingtabelle nutzt die übliche **administrative Distanz**: direkt 0, statisch 1, eBGP 20, OSPF 110, RIP 120, iBGP 200. Gewinnt das längste Präfix, bei Gleichstand die kleinere Distanz.

## Zugangsleitungen (Modems)

Jedes Modem baut seine Verbindung nach dem passenden Standard auf. Die Schritte erscheinen in der Paketliste als eigene Rahmen. IP-Verkehr fliesst erst, wenn das Modem «online» ist.

| Art | Leitung | Ablauf im Simulator |
|---|---|---|
| Kabel (DOCSIS 3.1) | Koax | Downstream-Kanal suchen → Ranging (RNG-REQ/RSP) → DHCP und TFTP für die Konfigurationsdatei → Registration (REG-REQ/RSP) |
| Glasfaser (GPON, ITU-T G.984) | Glasfaser | Seriennummer melden → ONU-ID zuweisen (PLOAM) → Ranging → Konfiguration per OMCI → Daten in GEM-Rahmen |
| Mobilfunk (LTE) | Funk | RRC-Verbindung → Attach mit SIM (Authentisierung, Security Mode) → Default Bearer mit IP-Adresse; im pcap nur das IP-Paket |
| ADSL2+ (G.992.5), VDSL2 (G.993.2) | Telefonleitung | Training (G.994.1-Handshake) → PPPoE-Discovery → PPP LCP → PAP → IPCP |

Nicht simuliert: Dämpfung und Distanz der Leitung, Bandbreitenbegrenzung, Funkzellenwechsel im Mobilfunk.

## Broadcast-Sturm

Ein Switch erkennt, wenn derselbe Broadcast-Rahmen mehrmals bei ihm ankommt. Das passiert nur in einer Schleife. Er drosselt dann die Weiterleitung, damit die Simulation flüssig bleibt, und meldet den Sturm. Die Oberfläche zeigt ein Banner mit den betroffenen Geräten. Ein echter Switch würde die Leitungen vollständig auslasten.

## WLAN-Roaming

Die Signalstärke hängt vom Abstand zwischen Client und Access Point und von Stockwerken ab. Wird ein Client in der Simulation verschoben, sucht er einen Access Point mit derselben SSID und demselben Passwort, der mindestens 10 Prozentpunkte stärker ist (Hysterese gegen Hin und Her). Er meldet sich dort mit Reassociation an und sendet ein Gratuitous ARP, damit die Switches den neuen Weg lernen.

## Bewusst nicht simuliert

IPv6, HTTPS/TLS, VPN/IPsec, QoS, Multicast-Routing, Link-Aggregation, Rapid-STP, VRRP/HSRP, Firewalls mit Zugriffslisten. Einige davon sind Kandidaten für spätere Versionen.
