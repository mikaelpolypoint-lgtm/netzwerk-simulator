/**
 * Vordefinierte Aufgaben, nach Schwierigkeit (1–5 Sterne) geordnet.
 * Jede Aufgabe baut ihr Startnetz mit denselben Operationen wie der Editor
 * und bringt Lernziele mit automatischer Prüfung mit. Texte kommen aus den
 * Sprachdateien, damit der Katalog auf Deutsch und Englisch funktioniert.
 */
import {
  addDevice,
  configureHost,
  connect,
  emptyTopology,
  setDhcpServer,
  setDnsServerEnabled,
  setWebServerEnabled,
  saveWebFile,
  type Check,
  type DeviceType,
  type Goal,
  type Result,
  type TaskSet,
  type Topology,
} from '../core';
import { t } from '../i18n';

export interface CatalogEntry {
  id: string;
  stars: 1 | 2 | 3 | 4 | 5;
  /** Braucht den Pro-Modus (VLANs, Layer-3-Switch …). */
  pro?: boolean;
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

  add(type: DeviceType, name: string, x: number, y: number): this {
    const { topology, id } = unwrap(addDevice(this.topology, type, name, { x, y }));
    this.topology = topology;
    this.#ids.set(name, id);
    return this;
  }

  id(name: string): string {
    return this.#ids.get(name)!;
  }

  link(a: string, b: string): this {
    this.topology = unwrap(connect(this.topology, this.id(a), this.id(b))).topology;
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
          goal('webDns', 3, { type: 'http', from: 'Notebook', url: 'http://www.schule.ch/index.html' }),
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
    pro: true,
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
    pro: true,
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
    pro: true,
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
];
