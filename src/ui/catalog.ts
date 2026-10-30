/**
 * Vordefinierte Aufgaben, nach Schwierigkeit (1–5 Sterne) geordnet.
 * Jede Aufgabe baut ihr Startnetz mit denselben Operationen wie der Editor
 * und bringt Lernziele mit automatischer Prüfung mit. Texte kommen aus den
 * Sprachdateien, damit der Katalog auf Deutsch und Englisch funktioniert.
 */
import {
  addDevice,
  addStaticRoute,
  configureHost,
  connect,
  emptyTopology,
  setDhcpServer,
  setDnsServerEnabled,
  setInterfaceAddress,
  setInterfaceCount,
  setInterfaceNat,
  setPortVlan,
  setWebServerEnabled,
  saveWebFile,
  type Check,
  type DeviceOptions,
  type DeviceType,
  type Medium,
  type Goal,
  type Result,
  type TaskSet,
  type Topology,
} from '../core';
import { t } from '../i18n';

export interface CatalogEntry {
  id: string;
  stars: 1 | 2 | 3 | 4 | 5;
  /** Funktionen, die die Aufgabe braucht (werden beim Start eingeschaltet). */
  features?: string[];
  /** Empfohlenes Profil (Lehrjahr). */
  level?: number;
  build(): { topology: Topology; tasks: TaskSet };
}

function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(r.error.code);
  return r.value;
}

/** Kleiner Baukasten für Startnetze. */
class Start {
  topology = emptyTopology();
  #ids = new Map<string, string>();

  add(type: DeviceType, name: string, x: number, y: number, options: DeviceOptions = {}): this {
    const { topology, id } = unwrap(addDevice(this.topology, type, name, { x, y }, options));
    this.topology = topology;
    this.#ids.set(name, id);
    return this;
  }

  id(name: string): string {
    return this.#ids.get(name)!;
  }

  link(a: string, b: string, medium: Medium = 'tp'): this {
    this.topology = unwrap(connect(this.topology, this.id(a), this.id(b), medium)).topology;
    return this;
  }

  /** Router mit Adressen in CIDR-Schreibweise, z.B. ["192.168.1.1/24", "10.0.0.1/30"]. */
  router(name: string, x: number, y: number, addresses: string[], type: 'router' | 'internet' = 'router'): this {
    this.add(type, name, x, y);
    if (addresses.length > 2) this.topology = unwrap(setInterfaceCount(this.topology, this.id(name), addresses.length));
    addresses.forEach((cidr, index) => {
      const [ip, prefix] = cidr.split('/');
      this.topology = unwrap(setInterfaceAddress(this.topology, this.id(name), index, ip!, prefix!));
    });
    return this;
  }

  route(router: string, network: string, mask: string, gateway: string): this {
    this.topology = unwrap(addStaticRoute(this.topology, this.id(router), { network, mask, gateway }));
    return this;
  }

  nat(router: string, index: number): this {
    this.topology = unwrap(setInterfaceNat(this.topology, this.id(router), index, true));
    return this;
  }

  web(server: string, page: string): this {
    let next = unwrap(setWebServerEnabled(this.topology, this.id(server), true));
    next = unwrap(saveWebFile(next, this.id(server), { path: '/index.html', content: page }));
    this.topology = next;
    return this;
  }

  host(name: string, ip: string, mask: string, gateway?: string, dns?: string): this {
    this.topology = unwrap(configureHost(this.topology, this.id(name), { ip, mask, ...(gateway ? { gateway } : {}), ...(dns ? { dns } : {}) }));
    return this;
  }

  apply(change: (t: Topology, id: (name: string) => string) => Topology): this {
    this.topology = change(this.topology, (n) => this.id(n));
    return this;
  }
}

function goal(key: string, n: number, check: Check, params: Record<string, string | number> = {}): Goal {
  const hintKey = `catalog.${key}.hint${n}`;
  const hint = t(hintKey, params);
  return { id: `ziel-${n}`, text: t(`catalog.${key}.goal${n}`, params), check, ...(hint !== hintKey ? { hint } : {}) };
}

function task(key: string, stars: number, goals: Goal[]): TaskSet {
  return { title: t(`catalog.${key}.title`), description: t(`catalog.${key}.description`), difficulty: stars, goals };
}

export const CATALOG: CatalogEntry[] = [
  {
    id: 'two-pcs',
    stars: 1,
    build() {
      const s = new Start().add('pc', 'PC 1', -200, 0).add('pc', 'PC 2', 200, 0);
      return {
        topology: s.topology,
        tasks: task('twoPcs', 1, [
          goal('twoPcs', 1, { type: 'connected', a: 'PC 1', b: 'PC 2' }),
          goal('twoPcs', 2, { type: 'sameNetwork', devices: ['PC 1', 'PC 2'] }),
          goal('twoPcs', 3, { type: 'ping', from: 'PC 1', to: 'PC 2' }),
        ]),
      };
    },
  },
  {
    id: 'switch-lan',
    stars: 2,
    build() {
      const s = new Start().add('switch', 'Switch', 0, -120).add('pc', 'PC 1', -260, 120).add('pc', 'PC 2', 0, 120).add('notebook', 'Notebook', 260, 120);
      return {
        topology: s.topology,
        tasks: task('switchLan', 2, [
          goal('switchLan', 1, { type: 'connected', a: 'PC 1', b: 'Switch' }),
          goal('switchLan', 2, { type: 'connected', a: 'Notebook', b: 'Switch' }),
          goal('switchLan', 3, { type: 'sameNetwork', devices: ['PC 1', 'PC 2', 'Notebook'] }),
          goal('switchLan', 4, { type: 'ping', from: 'Notebook', to: 'PC 1' }),
        ]),
      };
    },
  },
  {
    id: 'two-subnets',
    stars: 2,
    build() {
      const s = new Start().add('pc', 'PC 1', -280, 0).add('router', 'Router', 0, 0).add('pc', 'PC 2', 280, 0);
      return {
        topology: s.topology,
        tasks: task('twoSubnets', 2, [
          goal('twoSubnets', 1, { type: 'differentNetworks', devices: ['PC 1', 'PC 2'] }),
          goal('twoSubnets', 2, { type: 'gateway', device: 'PC 1' }),
          goal('twoSubnets', 3, { type: 'gateway', device: 'PC 2' }),
          goal('twoSubnets', 4, { type: 'ping', from: 'PC 1', to: 'PC 2' }),
        ]),
      };
    },
  },
  {
    id: 'dhcp',
    stars: 3,
    build() {
      const s = new Start()
        .add('pc', 'Server', -300, -100)
        .add('switch', 'Switch', 0, -100)
        .add('notebook', 'Notebook 1', -200, 120)
        .add('notebook', 'Notebook 2', 0, 120)
        .add('notebook', 'Notebook 3', 200, 120)
        .link('Server', 'Switch')
        .link('Notebook 1', 'Switch')
        .link('Notebook 2', 'Switch')
        .link('Notebook 3', 'Switch')
        .host('Server', '192.168.50.2', '24');
      return {
        topology: s.topology,
        tasks: task('dhcp', 3, [
          goal('dhcp', 1, { type: 'dhcpLease', device: 'Notebook 1' }),
          goal('dhcp', 2, { type: 'dhcpLease', device: 'Notebook 2' }),
          goal('dhcp', 3, { type: 'dhcpLease', device: 'Notebook 3' }),
          goal('dhcp', 4, { type: 'ping', from: 'Notebook 3', to: 'Server' }),
        ]),
      };
    },
  },
  {
    id: 'web-dns',
    stars: 3,
    build() {
      const s = new Start()
        .add('notebook', 'Notebook', -300, 0)
        .add('switch', 'Switch', 0, 0)
        .add('pc', 'Webserver', 250, -120)
        .add('pc', 'DNS-Server', 250, 120)
        .link('Notebook', 'Switch')
        .link('Webserver', 'Switch')
        .link('DNS-Server', 'Switch')
        .host('Webserver', '10.1.1.80', '24')
        .host('DNS-Server', '10.1.1.53', '24')
        .host('Notebook', '10.1.1.10', '24')
        .apply((topology, id) => {
          let next = unwrap(setWebServerEnabled(topology, id('Webserver'), true));
          next = unwrap(saveWebFile(next, id('Webserver'), { path: '/index.html', content: t('catalog.webDns.page') }));
          return unwrap(setDnsServerEnabled(next, id('DNS-Server'), true));
        });
      return {
        topology: s.topology,
        tasks: task('webDns', 3, [
          goal('webDns', 1, { type: 'ping', from: 'Notebook', to: 'Webserver' }),
          goal('webDns', 2, { type: 'http', from: 'Notebook', url: 'http://10.1.1.80/index.html' }),
          goal('webDns', 3, { type: 'http', from: 'Notebook', url: 'http://www.schule.example/index.html' }),
        ]),
      };
    },
  },
  {
    id: 'wlan',
    stars: 3,
    build() {
      const s = new Start()
        .add('pc', 'Server', -320, 0)
        .add('switch', 'Switch', -120, 0)
        .add('accesspoint', 'Access Point', 100, 0)
        .add('notebook', 'Notebook 1', 300, -120)
        .add('notebook', 'Notebook 2', 300, 120)
        .link('Server', 'Switch')
        .link('Access Point', 'Switch')
        .host('Server', '172.16.0.1', '24');
      return {
        topology: s.topology,
        tasks: task('wlan', 3, [
          goal('wlan', 1, { type: 'ping', from: 'Notebook 1', to: 'Server' }),
          goal('wlan', 2, { type: 'ping', from: 'Notebook 2', to: 'Notebook 1' }),
        ]),
      };
    },
  },
  {
    id: 'vlans',
    stars: 4,
    features: ['net.vlan', 'net.stp', 'net.subinterfaces', 'device.l3switch'],
    build() {
      const s = new Start()
        .add('switch', 'Switch', 0, -120)
        .add('pc', 'Verwaltung 1', -330, 120)
        .add('pc', 'Verwaltung 2', -110, 120)
        .add('pc', 'Unterricht 1', 110, 120)
        .add('pc', 'Unterricht 2', 330, 120)
        .link('Verwaltung 1', 'Switch')
        .link('Verwaltung 2', 'Switch')
        .link('Unterricht 1', 'Switch')
        .link('Unterricht 2', 'Switch')
        .host('Verwaltung 1', '10.0.0.1', '24')
        .host('Verwaltung 2', '10.0.0.2', '24')
        .host('Unterricht 1', '10.0.0.3', '24')
        .host('Unterricht 2', '10.0.0.4', '24');
      return {
        topology: s.topology,
        tasks: task('vlans', 4, [
          goal('vlans', 1, { type: 'ping', from: 'Verwaltung 1', to: 'Verwaltung 2' }),
          goal('vlans', 2, { type: 'ping', from: 'Unterricht 1', to: 'Unterricht 2' }),
          goal('vlans', 3, { type: 'noPing', from: 'Verwaltung 1', to: 'Unterricht 1' }),
          goal('vlans', 4, { type: 'noPing', from: 'Unterricht 2', to: 'Verwaltung 2' }),
        ]),
      };
    },
  },
  {
    id: 'router-on-a-stick',
    stars: 4,
    features: ['net.vlan', 'net.stp', 'net.subinterfaces', 'device.l3switch'],
    build() {
      const s = new Start()
        .add('router', 'Router', 0, -230)
        .add('switch', 'Switch', 0, -60)
        .add('pc', 'PC VLAN 10', -220, 130)
        .add('pc', 'PC VLAN 20', 220, 130)
        .link('PC VLAN 10', 'Switch')
        .link('PC VLAN 20', 'Switch')
        .host('PC VLAN 10', '192.168.10.10', '24', '192.168.10.1')
        .host('PC VLAN 20', '192.168.20.10', '24', '192.168.20.1');
      return {
        topology: s.topology,
        tasks: task('roas', 4, [
          goal('roas', 1, { type: 'connected', a: 'Router', b: 'Switch' }),
          goal('roas', 2, { type: 'deviceCount', deviceType: 'router', max: 1 }),
          goal('roas', 3, { type: 'ping', from: 'PC VLAN 10', to: '192.168.10.1' }),
          goal('roas', 4, { type: 'ping', from: 'PC VLAN 10', to: 'PC VLAN 20' }),
        ]),
      };
    },
  },
  {
    id: 'l3-campus',
    stars: 5,
    features: ['net.vlan', 'net.stp', 'net.subinterfaces', 'device.l3switch'],
    build() {
      const s = new Start()
        .add('l3switch', 'Core', 0, -200)
        .add('pc', 'DHCP-Server', 0, -380)
        .add('switch', 'Gebäude A', -280, 0)
        .add('switch', 'Gebäude B', 280, 0)
        .add('notebook', 'Notebook A', -280, 180)
        .add('notebook', 'Notebook B', 280, 180)
        .link('DHCP-Server', 'Core')
        .link('Notebook A', 'Gebäude A')
        .link('Notebook B', 'Gebäude B')
        .host('DHCP-Server', '10.99.0.10', '24', '10.99.0.1')
        .apply((topology, id) => {
          let next = unwrap(configureHost(topology, id('Notebook A'), { ip: '', mask: '', dhcp: true }));
          next = unwrap(configureHost(next, id('Notebook B'), { ip: '', mask: '', dhcp: true }));
          return unwrap(setDhcpServer(next, id('DHCP-Server'), { start: '10.99.0.100', end: '10.99.0.150', gateway: '10.99.0.1', leaseTime: 3600 }));
        });
      return {
        topology: s.topology,
        tasks: task('l3', 5, [
          goal('l3', 1, { type: 'deviceCount', deviceType: 'l3switch', min: 1 }),
          goal('l3', 2, { type: 'connected', a: 'Core', b: 'Gebäude A' }),
          goal('l3', 3, { type: 'connected', a: 'Core', b: 'Gebäude B' }),
          goal('l3', 4, { type: 'dhcpLease', device: 'Notebook A' }),
          goal('l3', 5, { type: 'dhcpLease', device: 'Notebook B' }),
          goal('l3', 6, { type: 'ping', from: 'Notebook A', to: 'DHCP-Server' }),
          goal('l3', 7, { type: 'ping', from: 'Notebook A', to: 'Notebook B' }),
        ]),
      };
    },
  },

  // --- Neue Funktionen in v0.4 ---------------------------------------------------
  {
    id: 'sniff-arp',
    stars: 1,
    features: ['tool.sniffer'],
    level: 1,
    build() {
      const s = new Start()
        .add('pc', 'PC 1', -260, 120)
        .add('switch', 'Switch', 0, -60)
        .add('pc', 'PC 2', 260, 120)
        .link('PC 1', 'Switch')
        .link('PC 2', 'Switch')
        .host('PC 1', '192.168.1.10', '24')
        .host('PC 2', '192.168.1.20', '24');
      return {
        topology: s.topology,
        tasks: task('sniffArp', 1, [
          goal('sniffArp', 1, { type: 'packetSeen', protocol: 'ARP', from: 'PC 1' }),
          goal('sniffArp', 2, { type: 'packetSeen', protocol: 'ICMP', from: 'PC 2' }),
        ]),
      };
    },
  },
  {
    id: 'budget-office',
    stars: 1,
    features: ['tool.costs'],
    level: 2,
    build() {
      const s = new Start()
        .add('pc', 'PC 1', -330, 140)
        .add('pc', 'PC 2', -110, 140)
        .add('pc', 'PC 3', 110, 140)
        .add('pc', 'PC 4', 330, 140)
        .host('PC 1', '10.0.0.1', '24')
        .host('PC 2', '10.0.0.2', '24')
        .host('PC 3', '10.0.0.3', '24')
        .host('PC 4', '10.0.0.4', '24');
      return {
        topology: s.topology,
        tasks: task('budgetOffice', 1, [
          goal('budgetOffice', 1, { type: 'deviceCount', deviceType: 'switch', min: 1 }),
          goal('budgetOffice', 2, { type: 'ping', from: 'PC 1', to: 'PC 4' }),
          goal('budgetOffice', 3, { type: 'budget', max: 4800 }),
        ]),
      };
    },
  },
  {
    id: 'server-group',
    stars: 2,
    features: ['device.server', 'device.clientgroup', 'service.dhcp'],
    level: 3,
    build() {
      const s = new Start()
        .add('server', 'Server', -300, -100)
        .add('switch', 'Switch', 0, -100, { ports: 24, sfpSlots: 4 })
        .add('clientgroup', 'Schulzimmer', 0, 140, { groupSize: 25 })
        .link('Server', 'Switch')
        .host('Server', '192.168.10.2', '24');
      return {
        topology: s.topology,
        tasks: task('serverGroup', 2, [
          goal('serverGroup', 1, { type: 'connected', a: 'Schulzimmer', b: 'Switch' }),
          goal('serverGroup', 2, { type: 'groupLeases', device: 'Schulzimmer' }),
        ]),
      };
    },
  },
  {
    id: 'vlan-colors',
    stars: 2,
    features: ['net.vlan'],
    level: 3,
    build() {
      const s = new Start()
        .add('switch', 'Switch', 0, -120)
        .add('pc', 'Büro 1', -330, 120)
        .add('pc', 'Büro 2', -110, 120)
        .add('pc', 'Labor 1', 110, 120)
        .add('pc', 'Labor 2', 330, 120)
        .link('Büro 1', 'Switch')
        .link('Büro 2', 'Switch')
        .link('Labor 1', 'Switch')
        .link('Labor 2', 'Switch')
        .apply((topology, id) => {
          let next = topology;
          for (const port of [0, 1]) next = unwrap(setPortVlan(next, id('Switch'), port, 10));
          for (const port of [2, 3]) next = unwrap(setPortVlan(next, id('Switch'), port, 20));
          return next;
        });
      return {
        topology: s.topology,
        tasks: task('vlanColors', 2, [
          goal('vlanColors', 1, { type: 'vlanDocumented', vlan: 10 }),
          goal('vlanColors', 2, { type: 'vlanDocumented', vlan: 20 }),
        ]),
      };
    },
  },
  {
    id: 'stp-loop',
    stars: 3,
    features: ['net.stp'],
    level: 3,
    build() {
      const s = new Start()
        .add('switch', 'Switch A', -260, -120)
        .add('switch', 'Switch B', 260, -120)
        .add('switch', 'Switch C', 0, 120)
        .add('pc', 'PC A', -440, -120)
        .add('pc', 'PC C', 0, 300)
        .link('Switch A', 'Switch B')
        .link('Switch B', 'Switch C')
        .link('Switch C', 'Switch A')
        .link('PC A', 'Switch A')
        .link('PC C', 'Switch C')
        .host('PC A', '10.10.0.1', '24')
        .host('PC C', '10.10.0.3', '24');
      return {
        topology: s.topology,
        tasks: task('stpLoop', 3, [
          goal('stpLoop', 1, { type: 'noStorm' }),
          goal('stpLoop', 2, { type: 'ping', from: 'PC A', to: 'PC C' }),
          goal('stpLoop', 3, { type: 'deviceCount', deviceType: 'switch', min: 3 }),
        ]),
      };
    },
  },
  {
    id: 'internet-nat',
    stars: 3,
    features: ['device.internet', 'net.nat', 'routing.static'],
    level: 3,
    build() {
      const s = new Start()
        .add('pc', 'PC', -420, 0)
        .router('Heimrouter', -150, 0, ['192.168.1.1/24', '203.0.113.2/30'])
        .router('Internet', 150, 0, ['203.0.113.1/30', '198.51.100.1/24'], 'internet')
        .add('server', 'Webserver', 420, 0)
        .link('PC', 'Heimrouter')
        .link('Heimrouter', 'Internet')
        .link('Internet', 'Webserver')
        .host('PC', '192.168.1.10', '24', '192.168.1.1')
        .host('Webserver', '198.51.100.10', '24', '198.51.100.1')
        .web('Webserver', t('catalog.internetNat.page'));
      return {
        topology: s.topology,
        tasks: task('internetNat', 3, [
          goal('internetNat', 1, { type: 'ping', from: 'PC', to: '198.51.100.10' }),
          goal('internetNat', 2, { type: 'http', from: 'PC', url: 'http://198.51.100.10/' }),
        ]),
      };
    },
  },
  {
    id: 'modem-vdsl',
    stars: 3,
    features: ['device.modem', 'medium.access', 'device.internet', 'net.nat'],
    level: 3,
    build() {
      const s = new Start()
        .add('pc', 'PC', -480, 0)
        .router('Heimrouter', -240, 0, ['192.168.1.1/24', '203.0.113.2/30'])
        .add('modem', 'Modem', 0, 0, { modem: 'vdsl' })
        .router('Provider', 240, 0, ['198.51.100.1/24', '203.0.113.1/30'], 'internet')
        .add('server', 'Server', 480, 0)
        .link('PC', 'Heimrouter')
        .link('Heimrouter', 'Modem')
        .link('Provider', 'Server')
        .host('PC', '192.168.1.10', '24', '192.168.1.1')
        .host('Server', '198.51.100.10', '24', '198.51.100.1')
        .nat('Heimrouter', 1)
        .route('Heimrouter', '0.0.0.0', '0.0.0.0', '203.0.113.1');
      return {
        topology: s.topology,
        tasks: task('modemVdsl', 3, [
          goal('modemVdsl', 1, { type: 'linkUp', a: 'Modem', b: 'Provider', medium: 'dsl' }),
          goal('modemVdsl', 2, { type: 'modemOnline', device: 'Modem' }),
          goal('modemVdsl', 3, { type: 'ping', from: 'PC', to: '198.51.100.10' }),
        ]),
      };
    },
  },
  {
    id: 'serial-wan',
    stars: 4,
    features: ['medium.serial', 'routing.static'],
    level: 4,
    build() {
      const s = new Start()
        .add('pc', 'PC Zürich', -440, 0)
        .router('R Zürich', -160, 0, ['10.1.0.1/24'])
        .router('R Bern', 160, 0, ['10.2.0.1/24'])
        .add('pc', 'PC Bern', 440, 0)
        .link('PC Zürich', 'R Zürich')
        .link('PC Bern', 'R Bern')
        .host('PC Zürich', '10.1.0.10', '24', '10.1.0.1')
        .host('PC Bern', '10.2.0.10', '24', '10.2.0.1');
      return {
        topology: s.topology,
        tasks: task('serialWan', 4, [
          goal('serialWan', 1, { type: 'linkUp', a: 'R Zürich', b: 'R Bern', medium: 'serial' }),
          goal('serialWan', 2, { type: 'ping', from: 'PC Zürich', to: 'PC Bern' }),
        ]),
      };
    },
  },
  {
    id: 'ospf-triangle',
    stars: 4,
    features: ['routing.ospf'],
    level: 4,
    build() {
      const s = new Start()
        .add('pc', 'PC 1', -440, -160)
        .add('pc', 'PC 2', 440, -160)
        .router('R1', -220, -160, ['192.168.1.1/24', '10.0.12.1/30', '10.0.13.1/30'])
        .router('R2', 220, -160, ['192.168.2.1/24', '10.0.12.2/30', '10.0.23.2/30'])
        .router('R3', 0, 140, ['10.0.13.3/30', '10.0.23.3/30'])
        .link('PC 1', 'R1')
        .link('PC 2', 'R2')
        .link('R1', 'R2')
        .link('R1', 'R3')
        .link('R2', 'R3')
        .host('PC 1', '192.168.1.10', '24', '192.168.1.1')
        .host('PC 2', '192.168.2.10', '24', '192.168.2.1');
      return {
        topology: s.topology,
        tasks: task('ospfTriangle', 4, [
          goal('ospfTriangle', 1, { type: 'neighbors', device: 'R1', protocol: 'ospf', min: 2 }),
          goal('ospfTriangle', 2, { type: 'routeLearned', device: 'R1', network: '192.168.2.0/24', protocol: 'ospf' }),
          goal('ospfTriangle', 3, { type: 'ping', from: 'PC 1', to: 'PC 2' }),
        ]),
      };
    },
  },
  {
    id: 'static-nat-dmz',
    stars: 4,
    features: ['net.nat', 'net.staticNat', 'device.internet', 'service.web'],
    level: 4,
    build() {
      const s = new Start()
        .add('pc', 'PC', -420, -140)
        .add('server', 'Webserver', -420, 140)
        .add('switch', 'Switch', -220, 0)
        .router('Firmenrouter', 0, 0, ['192.168.0.1/24', '203.0.113.2/29'])
        .router('Internet', 240, 0, ['203.0.113.1/29', '198.51.100.1/24'], 'internet')
        .add('pc', 'Kunde', 460, 0)
        .link('PC', 'Switch')
        .link('Webserver', 'Switch')
        .link('Switch', 'Firmenrouter')
        .link('Firmenrouter', 'Internet')
        .link('Internet', 'Kunde')
        .host('PC', '192.168.0.10', '24', '192.168.0.1')
        .host('Webserver', '192.168.0.80', '24', '192.168.0.1')
        .host('Kunde', '198.51.100.20', '24', '198.51.100.1')
        .nat('Firmenrouter', 1)
        .route('Firmenrouter', '0.0.0.0', '0.0.0.0', '203.0.113.1')
        .web('Webserver', t('catalog.staticNat.page'));
      return {
        topology: s.topology,
        tasks: task('staticNat', 4, [
          goal('staticNat', 1, { type: 'http', from: 'Kunde', url: 'http://203.0.113.5/' }),
          goal('staticNat', 2, { type: 'ping', from: 'PC', to: '198.51.100.20' }),
        ]),
      };
    },
  },
  {
    id: 'port-shutdown',
    stars: 1,
    features: ['net.portShutdown'],
    level: 2,
    build() {
      const s = new Start()
        .add('pc', 'PC 1', -300, -120)
        .add('pc', 'PC 2', -300, 120)
        .add('notebook', 'Gast', 300, 0)
        .add('switch', 'Switch', 0, 0)
        .link('PC 1', 'Switch')
        .link('PC 2', 'Switch')
        .link('Gast', 'Switch')
        .host('PC 1', '10.0.0.1', '24')
        .host('PC 2', '10.0.0.2', '24')
        .host('Gast', '10.0.0.99', '24');
      return {
        topology: s.topology,
        tasks: task('portShutdown', 1, [
          goal('portShutdown', 1, { type: 'noPing', from: 'PC 1', to: 'Gast' }),
          goal('portShutdown', 2, { type: 'ping', from: 'PC 1', to: 'PC 2' }),
        ]),
      };
    },
  },
  {
    id: 'subnetting-vlsm',
    stars: 3,
    features: ['tool.ipCalculator'],
    level: 2,
    build() {
      const s = new Start()
        .add('pc', 'Verwaltung', -320, -160)
        .add('pc', 'Labor', -320, 160)
        .add('pc', 'Gäste', 320, 0)
        .add('router', 'Router', 0, 0, { ports: 3 })
        .link('Verwaltung', 'Router')
        .link('Labor', 'Router')
        .link('Gäste', 'Router');
      return {
        topology: s.topology,
        tasks: task('vlsm', 3, [
          goal('vlsm', 1, { type: 'inNetwork', device: 'Verwaltung', network: '192.168.10.0/25' }),
          goal('vlsm', 2, { type: 'inNetwork', device: 'Labor', network: '192.168.10.128/26' }),
          goal('vlsm', 3, { type: 'inNetwork', device: 'Gäste', network: '192.168.10.192/27' }),
          goal('vlsm', 4, { type: 'ping', from: 'Verwaltung', to: 'Gäste' }),
        ]),
      };
    },
  },
  {
    id: 'fiber-ont',
    stars: 2,
    features: ['device.modem', 'medium.access', 'medium.fiber', 'device.internet', 'net.nat'],
    level: 3,
    build() {
      const s = new Start()
        .add('pc', 'PC', -480, 0)
        .router('Heimrouter', -240, 0, ['192.168.1.1/24', '203.0.113.2/30'])
        .add('modem', 'ONT', 0, 0, { modem: 'fiber' })
        .router('Provider', 240, 0, ['198.51.100.1/24', '203.0.113.1/30'], 'internet')
        .add('server', 'Server', 480, 0)
        .link('PC', 'Heimrouter')
        .link('Heimrouter', 'ONT')
        .link('Provider', 'Server')
        .host('PC', '192.168.1.10', '24', '192.168.1.1')
        .host('Server', '198.51.100.10', '24', '198.51.100.1')
        .nat('Heimrouter', 1)
        .route('Heimrouter', '0.0.0.0', '0.0.0.0', '203.0.113.1');
      return {
        topology: s.topology,
        tasks: task('fiberOnt', 2, [
          goal('fiberOnt', 1, { type: 'linkUp', a: 'ONT', b: 'Provider', medium: 'fiber' }),
          goal('fiberOnt', 2, { type: 'modemOnline', device: 'ONT' }),
          goal('fiberOnt', 3, { type: 'ping', from: 'PC', to: '198.51.100.10' }),
        ]),
      };
    },
  },
  {
    id: 'rip-chain',
    stars: 3,
    features: ['routing.rip'],
    level: 4,
    build() {
      const s = new Start()
        .add('pc', 'PC 1', -520, 0)
        .router('R1', -260, 0, ['192.168.1.1/24', '10.0.12.1/30'])
        .router('R2', 0, 0, ['10.0.12.2/30', '10.0.23.1/30'])
        .router('R3', 260, 0, ['10.0.23.2/30', '192.168.3.1/24'])
        .add('pc', 'PC 3', 520, 0)
        .link('PC 1', 'R1')
        .link('R1', 'R2')
        .link('R2', 'R3')
        .link('R3', 'PC 3')
        .host('PC 1', '192.168.1.10', '24', '192.168.1.1')
        .host('PC 3', '192.168.3.10', '24', '192.168.3.1');
      return {
        topology: s.topology,
        tasks: task('ripChain', 3, [
          goal('ripChain', 1, { type: 'routeLearned', device: 'R1', network: '192.168.3.0/24', protocol: 'rip' }),
          goal('ripChain', 2, { type: 'ping', from: 'PC 1', to: 'PC 3' }),
        ]),
      };
    },
  },
  {
    id: 'bgp-two-as',
    stars: 5,
    features: ['routing.bgp'],
    level: 5,
    build() {
      const s = new Start()
        .add('pc', 'PC Firma', -440, 0)
        .router('R Firma', -160, 0, ['10.1.0.1/16', '172.16.12.1/30'])
        .router('R Provider', 160, 0, ['172.16.12.2/30', '10.2.0.1/16'])
        .add('pc', 'PC Provider', 440, 0)
        .link('PC Firma', 'R Firma')
        .link('R Firma', 'R Provider')
        .link('R Provider', 'PC Provider')
        .host('PC Firma', '10.1.0.10', '16', '10.1.0.1')
        .host('PC Provider', '10.2.0.10', '16', '10.2.0.1');
      return {
        topology: s.topology,
        tasks: task('bgpTwoAs', 5, [
          goal('bgpTwoAs', 1, { type: 'neighbors', device: 'R Firma', protocol: 'bgp' }),
          goal('bgpTwoAs', 2, { type: 'routeLearned', device: 'R Firma', network: '10.2.0.0/16', protocol: 'bgp' }),
          goal('bgpTwoAs', 3, { type: 'ping', from: 'PC Firma', to: 'PC Provider' }),
        ]),
      };
    },
  },
];
