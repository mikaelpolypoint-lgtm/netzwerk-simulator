# Anleitung für Lernende

Diese Anleitung erklärt die Bedienung von leyoNET Schritt für Schritt. Im Programm selbst hilft **F1** jederzeit: Es öffnet die Hilfe zum gewählten Gerät oder Fenster. **?** zeigt alle Tastenkürzel.

## Der Bildschirm

```
┌ Datei  Bearbeiten  Einfügen  Ansicht  Simulation  Werkzeuge  Hilfe ─── [Entwurf | Simulation] ┐
├ Werkzeugleiste: Auswählen · Kabel · Bereich · Zoom · Profil · Kosten                           ┤
│ Shop     │                 Zeichenfläche                     │  Einstellungen des             │
│ (links)  │                                                   │  gewählten Elements (rechts)   │
├──────────┴───────────────────────────────────────────────────┴────────────────────────────────┤
│ Paketliste, Aufgaben, Zeitregler (unten, in der Simulation)                                   │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Menüleiste** oben, aufgebaut wie bei macOS. Jeder Eintrag zeigt sein Tastenkürzel.
- **Strg+K** (macOS: ⌘K) öffnet die Befehlssuche: Befehl oder Gerätenamen eintippen und Enter drücken.
- Oben rechts wechselt der Schalter zwischen **Entwurf** und **Simulation** (Taste **M** oder **F5**).

## Zwei Modi

| | Entwurf | Simulation |
|---|---|---|
| Geräte einfügen, löschen, verkabeln | ✔ | – |
| Konfigurieren (IP, Dienste, VLANs …) | ✔ | ✔ (wirkt sofort) |
| Dokumentieren (Bereiche, Farbtags, Beschreibungen) | ✔ | – |
| Geräte verschieben | ✔ | ✔ (WLAN-Geräte wechseln dabei den Access Point) |
| Ports ab- und einschalten | ✔ | ✔ |
| Ping, Browser, Mail, Befehlszeile | – | ✔ |
| Paketliste | – | ✔ |

Beim Start der Simulation wird automatisch ein Snapshot angelegt. Weitere entstehen alle fünf Minuten, wenn sich etwas geändert hat (**Datei → Snapshots**).

## Ein Netz bauen

1. **Gerät holen:** Im Shop links eine Kategorie anklicken (z.B. «Switches»). Es öffnet sich eine Liste mit Ausführungen, Anschlüssen und Richtpreis. Gerät auf die Fläche ziehen oder anklicken.
2. **Verkabeln:** Mit **K** (oder im Shop unter «Verbindungen») ein Kabel wählen und nacheinander zwei Geräte anklicken. Der Simulator nimmt den nächsten freien passenden Anschluss. Passt die Kabelart nicht, erscheint ein Hinweis.
3. **Konfigurieren:** Gerät anklicken; rechts erscheinen seine Einstellungen. Neben jedem Adressfeld öffnet der Rechner-Knopf den **IP-Rechner**. Dort zeigt «Übernehmen» die berechneten Werte direkt im Feld.
4. **Testen:** **M** drücken, ein Endgerät anklicken und im Desktop `ping 192.168.1.20` eingeben.

Nützlich: **Strg+D** dupliziert die Auswahl, **F2** benennt um, **Entf** löscht, **Strg+Z** macht rückgängig.

## Geräte im Überblick

| Gerät | Wofür |
|---|---|
| PC, Notebook | Endgeräte. Das Notebook hat zusätzlich WLAN. |
| Client-Gruppe | 10, 25 oder 50 gleiche PCs als ein Symbol; alle holen ihre Adresse per DHCP. |
| Server | DHCP, DNS, Web und Mail. Im Shop auch fertig eingerichtet erhältlich. |
| Switch, L3-Switch | Verbinden Geräte im selben Netz; der L3-Switch routet zusätzlich zwischen VLANs. |
| Router | Verbindet Netze. Ports wahlweise Ethernet oder seriell. NAT, OSPF, RIP, BGP. |
| Access Point | WLAN-Funkzelle. |
| Modem | Kabel, Glasfaser, Mobilfunk, ADSL oder VDSL zum Provider. |
| Internet | Provider mit öffentlichen Adressen und Webseiten. |

## Adressen sichtbar machen

**A** (oder **Ansicht → IP-Adressen anzeigen**) blendet an jedem Gerät die Adresse ein, farbig nach Art:

- **blau: privat** (10/8, 172.16/12, 192.168/16), nur im eigenen Netz
- **orange: CGNAT** (100.64/10), vom Provider vergeben
- **grün, fett: öffentlich**, im Internet erreichbar

Ein Bereich «Öffentliches Netz» (mit Weltkugel) markiert ein ganzes Netz als öffentlich, z.B. eine DMZ.

## VLANs mit Farben

Unter **Werkzeuge → VLANs** bekommt jedes VLAN eine Nummer, einen Namen und eine Farbe. Alle Switch-Ports dieses VLANs erscheinen dann in dieser Farbe, auf der Fläche wie in der Porttabelle. So sieht man auf einen Blick, welcher Port wohin gehört.

## Schleifen und Spanning Tree

Zwei Kabel zwischen denselben Switches oder ein Ring bilden eine Schleife. Ohne Spanning Tree (STP) kreisen Broadcasts darin endlos. Der Simulator erlaubt das absichtlich, zeigt beim Verkabeln eine Warnung und in der Simulation ein rotes Banner «Broadcast-Sturm». Abhilfe: STP auf den Switches einschalten, ein Kabel entfernen oder einen Port abschalten.

## Pakete mitschneiden

In der Simulation zeigt die Paketliste unten jeden Rahmen. Ein Klick öffnet die Details:

- **OSI-Ansicht** von Schicht 7 (Anwendung) bis 1 (Leitung). Leere Schichten sind grau.
- **Hex-Ansicht** (ab Profil 4): die echten Bytes. Ein Klick auf ein Feld markiert seine Bytes.
- **Filter** wie in Wireshark: `dhcp`, `ip.addr == 10.0.0.1`, `tcp.port == 80`, `host PC1`, verknüpft mit `and`, `or`, `not`. Die Knöpfe unter dem Filter setzen häufige Ausdrücke.
- **pcap**: speichert den Mitschnitt für Wireshark.

## Aufgaben

**Werkzeuge → Aufgaben-Katalog** enthält Übungen von ★ (Einstieg) bis ★★★★★ (Studium). Eine Aufgabe lädt ein Startnetz und zeigt unten ihre Lernziele. **Prüfen** sagt, was schon erfüllt ist und was fehlt. Viele Ziele haben einen Tipp.

## Kosten

Jedes Gerät hat einen Richtpreis. Der Betrag in der Werkzeugleiste und **Ansicht → Kosten** zeigen das Total in CHF, EUR oder USD. Manche Aufgaben verlangen ein Budget.

## Tastenkürzel

| Taste | Wirkung |
|---|---|
| M, F5 | Entwurf ↔ Simulation |
| Leertaste / N | Simulation anhalten / einen Schritt weiter |
| V, K, B | Auswählen, Kabel, Bereich |
| Strg+D, F2, Entf | Duplizieren, Umbenennen, Löschen |
| Strg+Z, Strg+Y | Rückgängig, Wiederholen |
| Strg+C, Strg+V | Kopieren, Einfügen |
| Strg+S, Strg+O, Alt+N | Speichern, Öffnen, Neues Netz |
| A, R, C | Adressen, Rack-Ansicht, auf Auswahl zentrieren |
| I | IP-Rechner |
| + / − / 0 | Vergrössern, Verkleinern, alles zeigen |
| F1, ?, Strg+K | Hilfe, Tastenkürzel, Befehlssuche |
| Esc | Abbrechen |

Kürzel wirken nicht, solange ein Eingabefeld aktiv ist.

## Speichern

- **Lokale Datei / Desktop:** Der Stand wird im Browser bzw. App-Ordner automatisch gesichert. **Datei → Speichern** legt zusätzlich eine `.json`-Datei ab, die man abgeben oder weitergeben kann.
- **Webversion:** Oben rechts steht der Session-Code. Wer ihn kennt, öffnet die Arbeit auch auf einem anderen Gerät. Eine neue Session beginnt immer leer.

Gespeichert wird nur die Netzwerk-Konfiguration: keine Namen, keine Konten (siehe [datenschutz.md](datenschutz.md)).
