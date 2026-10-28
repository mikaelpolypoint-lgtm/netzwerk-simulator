# Befehlszeile (CLI) für Router und Switches

Router, Switches und Layer-3-Switches lassen sich zusätzlich zu den Formularen über eine Befehlszeile konfigurieren. Die Syntax ist an **FRRouting (vtysh)** angelehnt, mit den aus dem Unterricht bekannten Modi. Es ist eine eigene, vereinfachte Nachbildung (siehe [Lizenzen](#lizenzen)).

## Zugang

| Weg | So geht's |
|---|---|
| Konsole | Doppelklick auf Router oder Switch, oder im Eigenschaftenfenster **Befehlszeile (CLI)**. Geht in jedem Modus ausser Dokumentation. |
| SSH vom PC | Im Aktionsmodus Desktop eines PCs öffnen, `ssh benutzer@adresse` eingeben, Passwort eintippen. Am Router vorher `username …` und `ip ssh` einrichten. Die Verbindung läuft über simuliertes TCP (Port 22) und erscheint verschlüsselt in der Paketliste. |

Änderungen in der Befehlszeile wirken sofort, auch während die Simulation läuft. Im Entwurfsmodus lassen sie sich mit **Rückgängig** zurücknehmen.

## Bedienung

- **Abkürzen**: Jedes Wort darf abgekürzt werden, solange es eindeutig ist: `conf t`, `int eth0`, `sh ip ro`.
- **`?`** zeigt die möglichen nächsten Wörter mit Erklärung (`show ?`, `ip ?`).
- **Tab** ergänzt das angefangene Wort.
- **↑ / ↓** blättern durch frühere Befehle.
- **`do`** führt im Konfigurationsmodus Anzeigebefehle aus: `do show ip route`.
- Fehler zeigt ein `^` unter der Stelle, an der die Eingabe nicht passt.

## Modi

```
Router>                    enable
Router#                    configure terminal
Router(config)#            interface eth0          vlan 10          line vty
Router(config-if)#         Router(config-vlan)#    Router(config-line)#
```

`exit` geht eine Stufe zurück, `end` direkt zu `Router#`, `disable` zurück zu `Router>`.

## Interface-Namen

| Gerät | Namen |
|---|---|
| Router | `eth0`, `eth1` …; Subinterfaces `eth0.10` (VLAN 10) |
| Switch | `port1`, `port2` … (wie auf der Frontplatte); auch `gi0/1` oder `fa0/1`. SFP-Einschübe für Glasfaser zählen separat: `sfp1`, `sfp2` … (auch `te0/1`) |
| Layer-3-Switch | wie Switch, dazu `vlan10` bzw. `interface vlan 10` |

## Befehle

### Anzeigen (`Router>` und `Router#`)

| Befehl | Zeigt |
|---|---|
| `show running-config` | aktuelle Konfiguration (nur `#`) |
| `show ip route` | Routingtabelle (C = direkt verbunden, S = statisch) |
| `show ip interface brief` | Interfaces mit Adresse und Status |
| `show interface brief` | Kurzübersicht der Anschlüsse |
| `show ip arp` | ARP-Tabelle (nur im Aktionsmodus) |
| `show ip nat translations` | NAT-Tabelle (Router) |
| `show mac address-table` | MAC-Tabelle (Switch, Aktionsmodus) |
| `show vlan brief` | VLANs mit ihren Ports (Switch) |
| `show interfaces status` | Ports mit Status und VLAN (Switch) |
| `show spanning-tree` | Root-Bridge, Port-Rollen und -Zustände (Switch) |
| `ping 192.168.1.10` | vier Echo-Anfragen vom Gerät aus (Aktionsmodus) |
| `write memory` | «speichert» (die Konfiguration gilt ohnehin sofort) |

### Allgemein (`(config)#`)

```
hostname R1
username admin password Geheim123
enable secret Klasse!
banner motd Nur fuer berechtigte Personen
ip ssh                         ! SSH-Server ein (oder: line vty → transport input ssh)
line vty 0 4
 transport input ssh
 login local
```

### Router

```
interface eth0
 ip address 192.168.1.1/24     ! oder: ip address 192.168.1.1 255.255.255.0
 description Uplink LAN
 ip helper-address 10.0.0.5    ! DHCP-Relay
 ip nat outside                ! NAT auf diesem Interface
 shutdown / no shutdown
!
interface eth0.10              ! Router-on-a-Stick: Subinterface für VLAN 10
 encapsulation dot1q 10
 ip address 192.168.10.1/24
!
no interface eth0.10           ! Subinterface löschen
ip route 0.0.0.0/0 10.0.0.2
ip route 172.16.0.0 255.255.0.0 eth1
no ip route 172.16.0.0/16
```

### Switch

```
spanning-tree                  ! Spanning Tree ein
spanning-tree priority 4096
vlan 10
 name Verwaltung
!
interface range port1-4
 switchport mode access
 switchport access vlan 10
!
interface port24
 switchport mode trunk
 description Uplink zum Router
```

### Layer-3-Switch

```
ip routing                     ! Routing zwischen VLANs (Standard: ein)
interface vlan 10
 ip address 10.10.0.1/24
 ip helper-address 10.99.0.10
!
no interface vlan 10
ip route 0.0.0.0/0 10.99.0.254
```

## Lizenzen

Die Befehlszeile ist eine eigene Implementierung für den Unterricht. Sie enthält keinen Code und keine Texte aus FRRouting oder anderen Netzwerkbetriebssystemen. FRRouting ist ein eigenständiges Projekt unter GPL-2.0 und steht in keiner Verbindung zu diesem Simulator; der Name wird nur genannt, um die Herkunft der Syntax zu beschreiben. Befehlsnamen wie `show ip route` sind in der Netzwerktechnik allgemein üblich.
