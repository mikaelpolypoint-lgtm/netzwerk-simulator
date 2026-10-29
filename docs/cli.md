# Befehlszeile (CLI) für Router und Switches

Router, Switches und Layer-3-Switches lassen sich zusätzlich zu den Formularen über eine Befehlszeile konfigurieren. Die Syntax ist an **FRRouting (vtysh)** angelehnt, mit den aus dem Unterricht bekannten Modi. Es ist eine eigene, vereinfachte Nachbildung (siehe [Lizenzen](#lizenzen)).

## Zugang

| Weg | So geht's |
|---|---|
| Konsole | Doppelklick auf Router oder Switch, oder im Eigenschaftenfenster **Befehlszeile (CLI)**. Geht im Entwurf und in der Simulation. |
| SSH vom PC | In der Simulation den Desktop eines PCs öffnen, `ssh benutzer@adresse` eingeben, Passwort eintippen. Am Router vorher `username …` und `ip ssh` einrichten. Die Verbindung läuft über simuliertes TCP (Port 22) und erscheint verschlüsselt in der Paketliste. |

Änderungen in der Befehlszeile wirken sofort, auch während die Simulation läuft. Im Entwurf lassen sie sich mit **Rückgängig** zurücknehmen.

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
Router(config)#            interface eth0          vlan 10          line vty               router ospf | rip | bgp 65001
Router(config-if)#         Router(config-vlan)#    Router(config-line)#   Router(config-router)#
```

`exit` geht eine Stufe zurück, `end` direkt zu `Router#`, `disable` zurück zu `Router>`.

## Interface-Namen

| Gerät | Namen |
|---|---|
| Router | `eth0`, `eth1` …; Subinterfaces `eth0.10` (VLAN 10); serielle Ports `serial0`, `serial1` … (auch `se0`, `s0/0/0`) |
| Switch | `port1`, `port2` … (wie auf der Frontplatte); auch `gi0/1` oder `fa0/1`. SFP-Einschübe für Glasfaser zählen separat: `sfp1`, `sfp2` … (auch `te0/1`) |
| Layer-3-Switch | wie Switch, dazu `vlan10` bzw. `interface vlan 10` |

## Befehle

### Anzeigen (`Router>` und `Router#`)

| Befehl | Zeigt |
|---|---|
| `show running-config` | aktuelle Konfiguration (nur `#`) |
| `show ip route` | Routingtabelle (C = direkt verbunden, S = statisch, O = OSPF, R = RIP, B = BGP; in Klammern Distanz/Metrik) |
| `show ip protocols` | aktive Routingprotokolle mit Netzen |
| `show ip ospf neighbor` | OSPF-Nachbarn und ihr Zustand (Simulation) |
| `show ip ospf database` | OSPF-Datenbank (LSAs, Simulation) |
| `show ip rip` | per RIP gelernte Routen (Simulation) |
| `show ip bgp summary` | BGP-Nachbarn mit Zustand und Anzahl Präfixe (Simulation) |
| `show ip bgp` | BGP-Tabelle mit AS-Pfad (Simulation) |
| `show ip interface brief` | Interfaces mit Adresse und Status |
| `show interface brief` | Kurzübersicht der Anschlüsse |
| `show ip arp` | ARP-Tabelle (nur in der Simulation) |
| `show ip nat translations` | NAT-Tabelle (Router) |
| `show mac address-table` | MAC-Tabelle (Switch, Simulation) |
| `show vlan brief` | VLANs mit ihren Ports (Switch) |
| `show interfaces status` | Ports mit Status und VLAN (Switch) |
| `show spanning-tree` | Root-Bridge, Port-Rollen und -Zustände (Switch) |
| `ping 192.168.1.10` | vier Echo-Anfragen vom Gerät aus (Simulation) |
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

### Serielle Leitungen (Router)

```
interface serial0              ! Port vorher im Formular auf «seriell» stellen
 encapsulation ppp             ! oder: encapsulation hdlc (Standard)
 ip address 10.0.0.1/30
```

Beide Enden brauchen dieselbe Kapselung, sonst bleibt die Leitung down.

### Statisches NAT (Router)

```
ip nat inside source static 192.168.0.80 203.0.113.5
no ip nat inside source static 192.168.0.80 203.0.113.5
```

### OSPF

```
router ospf
 router-id 1.1.1.1             ! optional, sonst höchste Adresse
 network 10.0.0.0/24 area 0    ! oder: network 10.0.0.0 0.0.0.255 area 0
 passive-interface eth0        ! keine Hellos ins LAN
 default-information originate
 redistribute static           ! connected | static | rip | bgp
!
interface eth1
 ip ospf cost 50               ! Standard 10
!
no router ospf
```

### RIP

```
router rip
 version 2
 network 192.168.1.0/24
 passive-interface eth0
 redistribute connected
```

### BGP

```
router bgp 65001
 bgp router-id 1.1.1.1
 neighbor 172.16.12.2 remote-as 65002
 network 10.1.0.0/16           ! oder: network 10.1.0.0 mask 255.255.0.0
 redistribute ospf
!
no router bgp
```

Ein Netz wird nur angekündigt, wenn es in der Routingtabelle steht.

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
