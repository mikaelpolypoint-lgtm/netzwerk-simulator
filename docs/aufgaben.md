# Aufgaben erstellen

Eine **Aufgabendatei** ist eine normale Projektdatei (`.json`) mit einem zusätzlichen Block `tasks`. Er enthält Lernziele, die der Simulator auf Knopfdruck automatisch prüft. Lernende öffnen die Datei, bauen und konfigurieren das Netz und klicken im Bereich **Aufgabe** auf **Prüfen**.

## So entsteht eine Aufgabe

1. Startnetz aufbauen, z.B. zwei PCs und einen Router, noch ohne Kabel und Adressen.
2. **Werkzeuge → Aufgabe erstellen …** wählen. Es öffnet sich ein Formular mit einer Vorlage: Pro Lernziel einen Prüfbaustein aus der Liste wählen und seine Felder ausfüllen (Gerätenamen werden vorgeschlagen). Ohne eigenen Lernziel-Text übernimmt der Simulator einen Vorschlag. Wer lieber direkt schreibt, wechselt oben rechts auf **JSON**.
3. Titel, Beschreibung und Lernziele anpassen (Bausteine siehe unten), mit **Übernehmen** bestätigen.
4. Mit **Speichern** (Strg+S) als Datei herunterladen und an die Klasse verteilen, z.B. über den Schul-Share.
5. Optional eine **Lösungsdatei** erstellen: dieselbe Aufgabe mit fertig gebautem Netz. Damit lässt sich prüfen, dass alle Ziele erreichbar sind.

Ein vollständiges Beispiel liegt in [aufgaben/zwei-subnetze.json](aufgaben/zwei-subnetze.json) (Lösung: [aufgaben/zwei-subnetze-loesung.json](aufgaben/zwei-subnetze-loesung.json)).

> Geräte werden in den Prüfungen über ihren **Namen** angesprochen (Gross-/Kleinschreibung egal). Schreibe in die Beschreibung, dass die Lernenden die vorgegebenen Namen nicht ändern sollen.

## Aufbau

```json
{
  "title": "Netz mit zwei Subnetzen aufbauen",
  "description": "Was die Lernenden tun sollen.",
  "goals": [
    {
      "id": "ping",
      "text": "PC 1 erreicht PC 2 per Ping.",
      "check": { "type": "ping", "from": "PC 1", "to": "PC 2" },
      "hint": "Zeigen die Gateways der PCs auf den Router?"
    }
  ]
}
```

| Feld | Bedeutung |
|---|---|
| `id` | Eindeutige Kennung des Ziels (frei wählbar, z.B. `ping`). |
| `text` | Lernziel, wie es die Lernenden sehen. |
| `check` | Prüfbaustein (siehe unten). |
| `hint` | Optionaler Tipp, der erscheint, solange das Ziel nicht erfüllt ist. |

## Prüfbausteine

Statische Prüfungen schauen nur auf das gebaute Netz. **Dynamische** Prüfungen (⚡) starten im Hintergrund eine eigene Simulation des aktuellen Netzes, warten 10 s virtuelle Zeit (z.B. für DHCP) und führen dann die Aktion aus. Sie sind deshalb unabhängig davon, was die Lernenden in der Simulation getan haben.

| `type` | Felder | Erfüllt, wenn … |
|---|---|---|
| `deviceCount` | `deviceType`? (`notebook`, `pc`, `server`, `clientgroup`, `switch`, `l3switch`, `router`, `accesspoint`, `modem`, `internet`), `min`?, `max`? | die Anzahl Geräte (des Typs) im Bereich liegt |
| `connected` | `a`, `b` | die beiden Geräte direkt verkabelt sind |
| `inNetwork` | `device`, `network` (z.B. `"192.168.1.0/24"`) | das Gerät eine statische Adresse in diesem Netz hat |
| `sameNetwork` | `devices` (Liste) | alle Geräte im selben Netz liegen |
| `differentNetworks` | `devices` (Liste) | alle Geräte in verschiedenen Netzen liegen |
| `gateway` | `device`, `gateway`? | ein Standardgateway eingetragen ist (optional: genau dieses) |
| `ping` ⚡ | `from`, `to` (Gerätename, IP oder DNS-Name) | mindestens eine Echo-Antwort ankommt |
| `http` ⚡ | `from`, `url`, `status`? (Standard 200) | der Webbrowser die Seite mit diesem Status erhält |
| `dhcpLease` ⚡ | `device` | das Gerät per DHCP eine Adresse erhält |
| `mail` ⚡ | `from` (Gerät mit E-Mail-Konto), `to` (Adresse) | der Mailserver eine Nachricht an diese Adresse annimmt |
| `noPing` ⚡ | `from`, `to` | **keine** Echo-Antwort ankommt (Netze getrennt) |
| `routeLearned` ⚡ | `device`, `network` (z.B. `"10.2.0.0/16"`), `protocol`? (`ospf`, `rip`, `bgp`) | der Router nach 25 s virtueller Zeit (Zeit für das Routingprotokoll) eine Route in dieses Netz kennt (optional: gelernt über dieses Protokoll) |
| `neighbors` ⚡ | `device`, `protocol` (`ospf` oder `bgp`), `min`? (Standard 1) | nach 25 s mindestens so viele OSPF-Nachbarn im Zustand *Full* bzw. BGP-Sitzungen *Established* bestehen |
| `noStorm` ⚡ | – | kurz nach dem Start kein Switch einen Broadcast-Sturm meldet |
| `modemOnline` ⚡ | `device` | das Modem seine Zugangsleitung aufgebaut hat |
| `groupLeases` ⚡ | `device` (Client-Gruppe), `min`? (Standard: alle) | so viele Mitglieder der Gruppe eine Adresse per DHCP haben |
| `budget` | `max` (CHF) | die Richtpreise aller Geräte, Kabel und Module zusammen höchstens `max` ergeben |
| `linkUp` | `a`, `b`, `medium`? (`tp`, `fiber`, `wireless`, `serial`, `coax`, `dsl`, `cellular`) | die beiden Geräte direkt verbunden sind, die Verbindung aktiv ist (keine abgeschalteten Ports, passende Kapselung …) und optional die Art stimmt |
| `vlanDocumented` | `vlan` (Nummer) | das VLAN unter **Werkzeuge → VLANs** einen Namen und eine Farbe hat |
| `packetSeen` | `protocol` (z.B. `"DNS"`, `"ICMP"`, `"HTTP"`), `from`?, `to`? | in der Simulation bereits ein solches Paket gesendet wurde |

`packetSeen` ist die einzige Prüfung, die auf das Handeln der Lernenden schaut. Beispiel: «Du hast selbst eine DNS-Anfrage ausgelöst» → `{ "type": "packetSeen", "protocol": "DNS" }`.

## Sicherheit

Aufgabendateien enthalten nur Daten. Unbekannte Prüfbausteine werden beim Öffnen abgelehnt, ausführbarer Code ist nicht möglich. Seiten von simulierten Webservern laufen ohne Skripte.

## Abgaben auswerten

Im Aufgabenbereich öffnet **«Abgaben auswerten …»** einen Dialog für Lehrpersonen: Dort wählt man alle `.json`-Dateien der Klasse auf einmal. Der Simulator prüft jede Datei gegen die geladene Aufgabe (ist keine geladen, gegen die Aufgabe in der Datei) und zeigt eine Tabelle Datei × Ziel mit Punktzahl. Fährt man mit der Maus über ein ✗, erscheint der Grund. «Als CSV speichern» erzeugt eine Tabelle für Excel (Semikolon-getrennt, 1 = erfüllt, 0 = nicht erfüllt, – = nicht prüfbar).

Ziele vom Typ `packetSeen` hängen davon ab, was die Lernenden in der Simulation selbst ausgelöst haben. Das steht nicht in der Datei, darum werden sie bei der Auswertung übersprungen und zählen nicht zur Punktzahl. Alle Dateien bleiben auf dem Gerät der Lehrperson.
