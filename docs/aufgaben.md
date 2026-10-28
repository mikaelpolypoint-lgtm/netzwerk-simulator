# Aufgaben erstellen

Eine **Aufgabendatei** ist eine normale Projektdatei (`.json`) mit einem zusätzlichen Block `tasks`. Er enthält Lernziele, die der Simulator auf Knopfdruck automatisch prüft. Lernende öffnen die Datei, bauen und konfigurieren das Netz und klicken im Bereich **Aufgabe** auf **Prüfen**.

## So entsteht eine Aufgabe

1. Startnetz aufbauen, z.B. zwei PCs und einen Router, noch ohne Kabel und Adressen.
2. Links im Bereich **Aufgabe** auf **Erstellen** klicken. Es öffnet sich eine Vorlage im JSON-Format.
3. Titel, Beschreibung und Lernziele anpassen (siehe unten), mit **Übernehmen** bestätigen.
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

Statische Prüfungen schauen nur auf das gebaute Netz. **Dynamische** Prüfungen (⚡) starten im Hintergrund eine eigene Simulation des aktuellen Netzes, warten 10 s virtuelle Zeit (z.B. für DHCP) und führen dann die Aktion aus. Sie sind deshalb unabhängig davon, was die Lernenden im Aktionsmodus getan haben.

| `type` | Felder | Erfüllt, wenn … |
|---|---|---|
| `deviceCount` | `deviceType`? (`notebook`, `pc`, `switch`, `router`, `modem`), `min`?, `max`? | die Anzahl Geräte (des Typs) im Bereich liegt |
| `connected` | `a`, `b` | die beiden Geräte direkt verkabelt sind |
| `inNetwork` | `device`, `network` (z.B. `"192.168.1.0/24"`) | das Gerät eine statische Adresse in diesem Netz hat |
| `sameNetwork` | `devices` (Liste) | alle Geräte im selben Netz liegen |
| `differentNetworks` | `devices` (Liste) | alle Geräte in verschiedenen Netzen liegen |
| `gateway` | `device`, `gateway`? | ein Standardgateway eingetragen ist (optional: genau dieses) |
| `ping` ⚡ | `from`, `to` (Gerätename, IP oder DNS-Name) | mindestens eine Echo-Antwort ankommt |
| `http` ⚡ | `from`, `url`, `status`? (Standard 200) | der Webbrowser die Seite mit diesem Status erhält |
| `dhcpLease` ⚡ | `device` | das Gerät per DHCP eine Adresse erhält |
| `mail` ⚡ | `from` (Gerät mit E-Mail-Konto), `to` (Adresse) | der Mailserver eine Nachricht an diese Adresse annimmt |
| `packetSeen` | `protocol` (z.B. `"DNS"`, `"ICMP"`, `"HTTP"`), `from`?, `to`? | im Aktionsmodus bereits ein solches Paket gesendet wurde |

`packetSeen` ist die einzige Prüfung, die auf das Handeln der Lernenden schaut. Beispiel: «Du hast selbst eine DNS-Anfrage ausgelöst» → `{ "type": "packetSeen", "protocol": "DNS" }`.

## Sicherheit

Aufgabendateien enthalten nur Daten. Unbekannte Prüfbausteine werden beim Öffnen abgelehnt, ausführbarer Code ist nicht möglich. Seiten von simulierten Webservern laufen ohne Skripte.
