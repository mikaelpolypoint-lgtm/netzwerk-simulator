import { describe as group, expect, it } from 'vitest';
import { getDevice } from '../model/topology';
import type { Topology } from '../model/types';
import { Simulation } from '../sim/simulation';
import { NetBuilder } from '../sim/testing';
import { complete, execute, networkInfo, prompt, runningConfig, startSession, type CliSession } from './cli';

/** Führt Zeilen nacheinander aus und liefert Topologie, Sitzung und alle Ausgaben. */
function run(topology: Topology, device: string, lines: string[], state?: () => ReturnType<Simulation['getDeviceState']>) {
  let session: CliSession = startSession(getDevice(topology, device)!).session;
  const output: string[] = [];
  for (const line of lines) {
    const result = execute(session, line, { topology, state: state?.() });
    output.push(...result.lines);
    if (result.topology) topology = result.topology;
    session = result.session;
  }
  return { topology, session, output };
}

group('CLI Router', () => {
  it('konfiguriert Interfaces und Routen mit abgekürzten Befehlen', () => {
    const net = new NetBuilder();
    const r = net.add('router', 'R1');
    const { topology, session, output } = run(net.topology, r, [
      'en',
      'conf t',
      'hostname Core',
      'int eth0',
      'ip addr 192.168.1.1/24',
      'desc Uplink LAN',
      'exit',
      'interface eth1',
      'ip address 10.0.0.1 255.255.255.252',
      'shutdown',
      'exit',
      'ip route 0.0.0.0/0 10.0.0.2',
      'end',
    ]);
    expect(output).toEqual([]);
    expect(session.mode).toBe('enable');
    const device = getDevice(topology, r)!;
    expect(device.name).toBe('Core');
    expect(device.interfaces[0]).toMatchObject({ ip: '192.168.1.1', mask: '255.255.255.0', description: 'Uplink LAN' });
    expect(device.interfaces[1]).toMatchObject({ ip: '10.0.0.1', mask: '255.255.255.252', shutdown: true });
    expect(device.routes).toEqual([{ network: '0.0.0.0', mask: '0.0.0.0', gateway: '10.0.0.2' }]);
    expect(prompt(topology, session)).toBe('Core#');
    const config = runningConfig(device);
    expect(config).toContain(' ip address 192.168.1.1/24');
    expect(config).toContain('ip route 0.0.0.0/0 10.0.0.2');
  });

  it('legt Subinterfaces für Router-on-a-Stick an', () => {
    const net = new NetBuilder();
    const r = net.add('router', 'R1');
    const { topology } = run(net.topology, r, ['enable', 'configure terminal', 'interface eth0.10', 'encapsulation dot1q 10', 'ip address 192.168.10.1/24', 'ip helper-address 192.168.10.5']);
    expect(getDevice(topology, r)!.subinterfaces).toEqual([{ parent: 0, vlan: 10, ip: '192.168.10.1', mask: '255.255.255.0', dhcpRelay: '192.168.10.5' }]);
  });

  it('zeigt die Routingtabelle im FRRouting-Stil', () => {
    const net = new NetBuilder();
    const r = net.router('R1', ['192.168.1.1/24', '10.0.0.1/30']);
    net.route(r, '172.16.0.0', '16', '10.0.0.2');
    const { output } = run(net.topology, r, ['show ip route']);
    expect(output).toContain('C>* 192.168.1.0/24 is directly connected, eth0');
    expect(output).toContain('S>* 172.16.0.0/16 [1/0] via 10.0.0.2, eth1');
  });

  it('meldet Fehler wie ein echtes Gerät', () => {
    const net = new NetBuilder();
    const r = net.add('router', 'R1');
    const { output } = run(net.topology, r, ['shw ip route', 'e', 'enable', 'configure', 'interface eth9', 'interface']);
    expect(output[0]).toMatch(/^ +\^$/);
    expect(output[1]).toBe("% Invalid input detected at '^' marker.");
    expect(output[2]).toBe('% Ambiguous command: "e"');
    expect(output).toContain('% Unknown interface: eth9');
    expect(output).toContain('% Incomplete command.');
  });

  it('fragt mit enable secret nach dem Passwort', () => {
    const net = new NetBuilder();
    const r = net.add('router', 'R1');
    let { topology } = run(net.topology, r, ['enable', 'conf t', 'enable secret Kl4sse!']);
    const wrong = run(topology, r, ['enable', 'falsch']);
    expect(wrong.output).toContain('% Access denied');
    expect(wrong.session.mode).toBe('user');
    const right = run(topology, r, ['enable', 'Kl4sse!']);
    expect(right.session.mode).toBe('enable');
    topology = right.topology;
  });

  it('hilft mit «?» und ergänzt mit Tab', () => {
    const net = new NetBuilder();
    const r = net.add('router', 'R1');
    const session: CliSession = { device: r, mode: 'enable' };
    const help = execute(session, 'show ip ?', { topology: net.topology }).lines.join('\n');
    expect(help).toContain('route');
    expect(help).toContain('arp');
    expect(complete(session, 'conf', { topology: net.topology })).toBe('configure ');
    expect(complete(session, 'show ip ro', { topology: net.topology })).toBe('show ip route ');
  });

  it('führt mit «do» Anzeigebefehle im Konfigurationsmodus aus', () => {
    const net = new NetBuilder();
    const r = net.router('R1', ['192.168.1.1/24', '10.0.0.1/30']);
    const { output, session } = run(net.topology, r, ['enable', 'conf t', 'do show ip interface brief']);
    expect(session.mode).toBe('config');
    expect(output.join('\n')).toMatch(/eth0\s+192\.168\.1\.1\/24\s+down\s+down/);
  });
});

group('CLI Switch', () => {
  it('setzt VLANs, Trunks und Namen, auch für Portbereiche', () => {
    const net = new NetBuilder();
    const sw = net.add('switch', 'S1');
    const { topology, output } = run(net.topology, sw, [
      'enable',
      'conf t',
      'vlan 10',
      'name Verwaltung',
      'exit',
      'interface range port1-3',
      'switchport mode access',
      'switchport access vlan 10',
      'exit',
      'interface gi0/8',
      'switchport mode trunk',
      'end',
      'show vlan brief',
    ]);
    const device = getDevice(topology, sw)!;
    expect(device.interfaces.slice(0, 3).map((p) => p.vlan)).toEqual([10, 10, 10]);
    expect(device.interfaces[7]!.trunk).toBe(true);
    expect(device.vlanNames).toEqual([{ vlan: 10, name: 'Verwaltung' }]);
    expect(output.join('\n')).toMatch(/10\s+Verwaltung\s+active\s+port1, port2, port3/);
    expect(output.join('\n')).toContain('Trunk ports (all VLANs): port8');
  });

  it('zeigt die MAC-Tabelle aus der laufenden Simulation', () => {
    const net = new NetBuilder();
    const a = net.host('A', '10.0.0.1');
    const b = net.host('B', '10.0.0.2');
    const sw = net.add('switch', 'S1');
    net.link(a, sw);
    net.link(b, sw);
    const sim = new Simulation(net.topology);
    sim.ping(a, '10.0.0.2');
    sim.runUntilIdle();
    const { output } = run(net.topology, sw, ['show mac address-table'], () => sim.getDeviceState(sw));
    expect(output.join('\n')).toMatch(/1\s+02:00:00:00:01:00\s+DYNAMIC\s+port1/);
    expect(output.at(-1)).toBe('Total Mac Addresses: 2');
  });

  it('richtet am Layer-3-Switch SVIs und Routing ein', () => {
    const net = new NetBuilder();
    const sw = net.add('l3switch', 'L3');
    const { topology } = run(net.topology, sw, ['en', 'conf t', 'ip routing', 'interface vlan 10', 'ip address 10.10.0.1/24', 'exit', 'int vlan20', 'ip addr 10.20.0.1 255.255.255.0']);
    expect(getDevice(topology, sw)!.svis).toEqual([
      { vlan: 10, ip: '10.10.0.1', mask: '255.255.255.0' },
      { vlan: 20, ip: '10.20.0.1', mask: '255.255.255.0' },
    ]);
  });

  it('kennt keine IP-Befehle am Layer-2-Switch', () => {
    const net = new NetBuilder();
    const sw = net.add('switch', 'S1');
    const { output } = run(net.topology, sw, ['enable', 'show ip route']);
    expect(output[1]).toBe("% Invalid input detected at '^' marker.");
  });
});

group('Netzinfo', () => {
  it('berechnet Netz, Broadcast und Hostbereich', () => {
    expect(networkInfo('192.168.10.77/26')).toEqual({
      network: '192.168.10.64/26',
      broadcast: '192.168.10.127',
      first: '192.168.10.65',
      last: '192.168.10.126',
      hosts: 62,
      mask: '255.255.255.192',
    });
    expect(networkInfo('kein Netz')).toBeNull();
  });
});
