import { describe as group, expect, it } from 'vitest';
import { setCliConfig } from '../model/topology';
import { Simulation } from './simulation';
import { seal, unseal } from './ssh';
import { NetBuilder, describe, unwrap } from './testing';

function build(ssh = true) {
  const net = new NetBuilder();
  const pc = net.host('PC', '192.168.1.10', '24', '192.168.1.1');
  const r = net.router('R1', ['192.168.1.1/24', '10.0.0.1/30']);
  net.link(pc, r);
  net.topology = unwrap(setCliConfig(net.topology, r, { ssh, users: [{ name: 'admin', password: 'Sicher123' }] }));
  return { net, pc, r };
}

const codes = (sim: Simulation, id: string) => sim.getDeviceState(id).console.map((l) => l.code);

group('SSH', () => {
  it('verschleiert Inhalte umkehrbar', () => {
    expect(unseal(seal('AUTH admin Grüezi 123'))).toBe('AUTH admin Grüezi 123');
    expect(seal('AUTH admin x')).not.toContain('admin');
  });

  it('meldet sich mit Benutzer und Passwort am Router an', () => {
    const { net, pc, r } = build();
    const sim = new Simulation(net.topology);
    sim.ssh(pc, '192.168.1.1', 'admin', 'Sicher123');
    sim.runUntilIdle();
    const open = sim.getDeviceState(pc).console.find((l) => l.code === 'ssh.open');
    expect(open?.params).toMatchObject({ device: r, user: 'admin' });
    expect(codes(sim, r)).toContain('ssh.server.login');
    const log = sim.getPacketLog().map((e) => describe(net.topology, e));
    expect(log.some((l) => l.includes('TCP') && l.includes('>22 [SYN]'))).toBe(true);
    // Passwort nie im Klartext auf der Leitung.
    expect(log.some((l) => l.includes('Sicher123'))).toBe(false);

    sim.sshSend(pc, 'show ip route');
    sim.sshClose(pc);
    sim.runUntilIdle();
    expect(codes(sim, pc)).toContain('ssh.closed');
  });

  it('weist ein falsches Passwort ab', () => {
    const { net, pc } = build();
    const sim = new Simulation(net.topology);
    sim.ssh(pc, '192.168.1.1', 'admin', 'falsch');
    sim.runUntilIdle();
    expect(codes(sim, pc)).toContain('ssh.denied');
    expect(codes(sim, pc)).not.toContain('ssh.open');
  });

  it('wird ohne SSH-Dienst abgewiesen', () => {
    const { net, pc } = build(false);
    const sim = new Simulation(net.topology);
    sim.ssh(pc, '192.168.1.1', 'admin', 'Sicher123');
    sim.runUntilIdle();
    expect(codes(sim, pc)).toContain('ssh.refused');
  });

  it('erreicht auch eine entfernte Router-Adresse über das Gateway', () => {
    const { net, pc } = build();
    const sim = new Simulation(net.topology);
    sim.ssh(pc, '10.0.0.1', 'admin', 'Sicher123');
    sim.runUntilIdle();
    expect(codes(sim, pc)).toContain('ssh.open');
  });
});
