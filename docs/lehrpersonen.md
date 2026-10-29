# Hinweise für Lehrpersonen

## Einsatz nach Lehrjahr

| Stufe | Profil | Typische Themen | Katalog |
|---|---|---|---|
| 1. Lehrjahr | 1 | Zwei PCs, Switch, Subnetze, Router, DHCP, erste Pakete (ARP, ICMP) | ★ – ★★ |
| 1.–2. Lehrjahr | 2 | DNS, Web, WLAN, Internet, statische Routen, Ports abschalten, VLSM, Offerten (Budget) | ★★ – ★★★ |
| 2.–3. Lehrjahr | 3 | VLANs mit Farben, STP und Broadcast-Sturm, NAT, Modems, Client-Gruppen, CLI | ★★★ |
| 3.–4. Lehrjahr | 4 | Serielle WAN-Leitungen, OSPF, RIP, statisches NAT/DMZ, CGNAT, SSH, Hex und pcap | ★★★★ |
| Fachhochschule | 5 | BGP zwischen autonomen Systemen | ★★★★★ |

Profile und Funktionsdateien: [funktionsprofile.md](funktionsprofile.md).

## Aufgabenkatalog

**Werkzeuge → Aufgaben-Katalog** enthält fertige Übungen mit automatischer Prüfung. Jede Übung schaltet beim Start die Funktionen ein, die sie braucht, sofern Profil und Admin das erlauben. Für jede gibt es im Code eine Musterlösung, die ein Test bei jedem Build prüft (`src/ui/catalog.test.ts`).

| Sterne | Übung | Inhalt |
|---|---|---|
| ★ | Zwei Rechner verbinden | direkt verkabeln, Adressen im selben Netz |
| ★ | Pakete mitschneiden | ARP-Anfrage und -Antwort in der Paketliste finden |
| ★ | Büro mit Budget | Switch wählen und verkabeln, Kosten unter einer Grenze |
| ★ | Gast aussperren | Switch-Port abschalten, ohne das Kabel zu ziehen |
| ★★ | Kleines LAN mit Switch | Switch und Adressen |
| ★★ | Zwei Netze mit einem Router | Router und Gateways |
| ★★ | Ein ganzes Schulzimmer | Client-Gruppe mit 25 PCs per DHCP versorgen |
| ★★ | VLANs dokumentieren | VLANs benennen und einfärben |
| ★★ | Glasfaseranschluss | ONT per Glasfaser mit dem Provider verbinden |
| ★★★ | Adressen per DHCP verteilen | DHCP-Server |
| ★★★ | Webseite über DNS aufrufen | DNS-Eintrag und Client-Konfiguration |
| ★★★ | WLAN im Klassenzimmer | Access Point und WLAN-Clients |
| ★★★ | Schleife ohne Sturm | Broadcast-Sturm erkennen und mit STP beheben |
| ★★★ | Ins Internet mit NAT | NAT und Standardroute |
| ★★★ | VDSL-Anschluss | Telefonleitung, Training und PPPoE |
| ★★★ | Subnetze nach Bedarf (VLSM) | VLSM mit dem IP-Rechner |
| ★★★ | RIP in der Kette | dynamisches Routing mit RIP |
| ★★★★ | Netze mit VLANs trennen | Access-Ports |
| ★★★★ | Router-on-a-Stick | Trunks und Subinterfaces |
| ★★★★ | Standorte über eine serielle Leitung | serielle Leitung mit PPP und statischen Routen |
| ★★★★ | Routing mit OSPF | Nachbarschaften und gelernte Routen |
| ★★★★ | Webserver mit eigener öffentlicher Adresse | statisches NAT |
| ★★★★★ | Campus mit Layer-3-Switch und Glasfaser | SVIs, DHCP-Relay, Glasfaser-Uplinks |
| ★★★★★ | Zwei autonome Systeme mit BGP | eBGP, angekündigte Netze |

## Eigene Aufgaben

Unter **Werkzeuge → Aufgabe erstellen** entsteht eine Aufgabe aus dem aktuellen Netz und Prüfbausteinen. Gespeichert wird sie als `.json`, die Lernende öffnen. Beschreibung aller Bausteine: [aufgaben.md](aufgaben.md).

Ideen für die neuen Funktionen:

- **Offerte:** «Plane das Netz für ein Büro mit 12 Arbeitsplätzen für höchstens 20 000 CHF» → Bausteine `budget`, `ping`, `groupLeases`.
- **Fehlersuche Schleife:** Netz mit Ring ohne STP abgeben → `noStorm` und `ping`.
- **Provider wechseln:** Gleiches Heimnetz mit Kabel-, Glasfaser- und Mobilfunkmodem → `modemOnline`, `linkUp` mit `medium`.
- **Dynamisches Routing:** statische Routen durch OSPF ersetzen → `routeLearned` mit `protocol: "ospf"`, `neighbors`.
- **Dokumentation:** alle VLANs benennen und einfärben → `vlanDocumented`.

## Abgaben auswerten

**Werkzeuge → Aufgabe prüfen …** prüft die abgegebenen Dateien einer ganzen Klasse gegen die Aufgabe und exportiert die Punkte als CSV. Alle Dateien bleiben auf dem Gerät der Lehrperson.

## Webversion mit Klassen

In der Webversion eröffnet die Lehrperson in der Admin-Konsole eine Klasse mit einer Bezeichnung ohne Personenbezug (z.B. «INF22a»). Lernende treten mit dem Klassencode bei. Die Lehrperson sieht Session-Codes, aber keine Namen. Wer welchen Code hat, klärt die Klasse selbst. Einrichtung: [plesk.md](plesk.md).

## Datenschutz im Unterricht

Lernende brauchen kein Konto und geben keine Namen ein. Projektdateien enthalten nur Technik (Geräte, Adressen, Konfiguration). Gerätenamen wie «PC Anna» sind möglich, aber nicht nötig. Am besten bittet man die Klasse, Geräte neutral zu benennen. Details und Vorlage für die Datenschutzerklärung: [datenschutz.md](datenschutz.md).
