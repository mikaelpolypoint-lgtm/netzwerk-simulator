# Funktionsprofile und Funktionsdatei

Der Simulator kann vom ersten Lehrjahr bis ins Studium eingesetzt werden. Damit Einsteiger nicht von Optionen erschlagen werden, lässt sich **jede Funktion ausblenden**. Ausgeblendete Funktionen verschwinden aus Shop, Menüs, Formularen und Hilfe. Daten im Projekt bleiben aber erhalten.

## Profile

Die Auswahl öffnet sich über den Profil-Chip in der Werkzeugleiste oder **Werkzeuge → Funktionsumfang**.

| Profil | Zielgruppe | Neu freigeschaltet |
|---|---|---|
| 1 Einstieg | 1. Lehrjahr | PC, Notebook, Switch, Router, Server, DHCP, Paketliste, OSI-Ansicht, IP-Rechner, Bereiche, Snapshots, Aufgaben erstellen |
| 2 Grundlagen | 1.–2. Lehrjahr | Access Point, Internet, Glasfaser, WLAN, DNS, Web, Ports abschalten, statische Routen, Adressanzeige, Stockwerke, Kosten |
| 3 Fortgeschritten | 2.–3. Lehrjahr | Client-Gruppen, Modems, Zugangsleitungen, E-Mail, Kabelschäden, VLANs, STP, WLAN-Mesh/Roaming, DHCP-Relay, NAT, CLI, Racks |
| 4 Profi | 3.–4. Lehrjahr | L3-Switch, serielle Leitungen, Subinterfaces, statisches NAT, CGNAT, SSH, RIP, OSPF, Hex-Ansicht, pcap-Export |
| 5 Studium | Fachhochschule | BGP |

Die genaue Zuordnung steht in [`src/ui/features.ts`](../src/ui/features.ts).

**Eigene Auswahl:** Ausgehend von einem Profil lassen sich einzelne Funktionen ein- oder ausschalten, z.B. Profil 2 plus VLANs.

**Projekte, die mehr brauchen:** Öffnet man ein Projekt oder eine Aufgabe mit Funktionen ausserhalb des Profils, schaltet der Simulator sie ein und meldet das. Ist eine Funktion gesperrt (Admin oder gesperrte Datei), bleibt sie sichtbar, lässt sich aber nicht bearbeiten.

## Funktionsdatei für die Klasse

Lehrpersonen speichern ihre Auswahl unter **Werkzeuge → Funktionsumfang → Datei speichern** als kleine JSON-Datei und verteilen sie. Lernende laden sie mit **Werkzeuge → Funktionsauswahl laden …**.

```json
{
  "format": "netzwerk-simulator-features",
  "version": 1,
  "profile": "custom",
  "base": 2,
  "features": { "net.vlan": true, "tool.costs": false },
  "lock": true,
  "title": "Modul 117, 1. Lehrjahr"
}
```

| Feld | Bedeutung |
|---|---|
| `profile` | `1` bis `5` oder `"custom"` |
| `base` | bei `custom`: Ausgangsprofil |
| `features` | Abweichungen vom Profil; Schlüssel siehe Tabelle unten |
| `lock` | `true`: Lernende können die Auswahl in der Oberfläche nicht ändern. Entsperren geht nur mit derselben Datei. |
| `title` | Anzeige für die Lehrperson (max. 80 Zeichen) |

Unbekannte Schlüssel werden ignoriert. Die Datei enthält keine Personendaten.

> Die Sperre ist eine Unterrichtshilfe, kein Sicherheitsmechanismus: Wer die Browserdaten löscht, beginnt wieder mit dem Standardprofil.

## Admin-Richtlinie (Webversion)

In der Webversion legt der Admin unter **Admin-Konsole → Einstellungen** fest:

- **Standardprofil**, mit dem der Simulator startet (Standard 2)
- **Höchstes Profil**: höhere sind gesperrt (Standard 5)
- **Gesperrte Funktionen**: für alle aus, unabhängig vom Profil und von Funktionsdateien
- erlaubte **Modi** (Entwurf, Simulation)

Die Richtlinie gilt sofort für alle Sitzungen. In der lokalen Datei und der Desktop-Version gibt es keinen Admin, dort ist alles erlaubt.

## Funktionsschlüssel

| Gruppe | Schlüssel |
|---|---|
| Geräte | `device.notebook`, `device.pc`, `device.switch`, `device.router`, `device.server`, `device.accesspoint`, `device.internet`, `device.clientgroup`, `device.modem`, `device.l3switch` |
| Verbindungen | `medium.fiber`, `medium.wireless`, `medium.access` (Koax, DSL, Mobilfunk), `medium.serial` |
| Dienste | `service.dhcp`, `service.dns`, `service.web`, `service.mail` |
| Netzwerk | `net.portShutdown`, `net.cableDamage`, `net.vlan`, `net.stp`, `net.wlanMesh`, `net.dhcpRelay`, `net.nat`, `net.subinterfaces`, `net.staticNat`, `net.cgnat`, `net.cli`, `net.ssh` |
| Routing | `routing.static`, `routing.rip`, `routing.ospf`, `routing.bgp` |
| Werkzeuge | `tool.sniffer`, `tool.osi`, `tool.hex`, `tool.pcap`, `tool.ipCalculator`, `tool.areas`, `tool.snapshots`, `tool.addressBadges`, `tool.floors`, `tool.costs`, `tool.racks`, `tool.taskEditor` |
