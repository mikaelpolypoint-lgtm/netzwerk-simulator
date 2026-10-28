import { describe as group, expect, it } from 'vitest';
import { parseProject, serializeProject } from '../io/project';
import { Simulation } from '../sim/simulation';
import { NetBuilder, unwrap } from '../sim/testing';
import { linkStatus } from './links';
import { addArea, connect, getDevice, insertSfpModule, moveDevice, removeArea, replugCable, setDeviceRack, setSfpModule, updateArea } from './topology';

const replies = (sim: Simulation, id: string) => sim.getDeviceState(id).console.filter((l) => l.code === 'ping.reply').length;

/** Zwei Gebäude: je ein Switch mit PC, verbunden über Glasfaser. */
function campus() {
  const net = new NetBuilder();
  const a = net.host('PC A', '10.0.0.1');
  const b = net.host('PC B', '10.0.0.2');
  const s1 = net.add('switch', 'S1');
  const s2 = net.add('switch', 'S2');
  net.link(a, s1);
  net.link(b, s2);
  return { net, a, b, s1, s2 };
}

group('SFP-Module und Glasfaser', () => {
  it('braucht in beiden Switches ein Modul, bevor Glasfaser gesteckt werden kann', () => {
    const { net, s1, s2 } = campus();
    expect(connect(net.topology, s1, s2, 'fiber')).toMatchObject({ ok: false, error: { code: 'noSfpModule' } });
    net.topology = unwrap(insertSfpModule(net.topology, s1, '1G-LX')).topology;
    net.topology = unwrap(insertSfpModule(net.topology, s2, '1G-LX')).topology;
    const { topology, id } = unwrap(connect(net.topology, s1, s2, 'fiber'));
    const cable = topology.cables.find((c) => c.id === id)!;
    // Glasfaser landet im SFP-Einschub (Index 8 nach den 8 RJ45-Ports).
    expect([cable.a.iface, cable.b.iface]).toEqual([8, 8]);
    expect(linkStatus(topology, cable)).toEqual({ up: true });
  });

  it('überträgt Pakete über Glasfaser und fällt bei verschiedenen Modulen aus', () => {
    const { net, a, s1, s2 } = campus();
    net.topology = unwrap(insertSfpModule(net.topology, s1, '1G-SX')).topology;
    net.topology = unwrap(insertSfpModule(net.topology, s2, '1G-SX')).topology;
    net.topology = unwrap(connect(net.topology, s1, s2, 'fiber')).topology;
    let sim = new Simulation(net.topology);
    sim.ping(a, '10.0.0.2');
    sim.runUntilIdle();
    expect(replies(sim, a)).toBe(4);

    // Multimode auf der einen, Singlemode auf der anderen Seite: kein Link.
    net.topology = unwrap(setSfpModule(net.topology, s2, 8, '1G-LX'));
    const cable = net.topology.cables.at(-1)!;
    expect(linkStatus(net.topology, cable)).toMatchObject({ up: false, reason: 'sfpMismatch' });
    net.topology = unwrap(setSfpModule(net.topology, s2, 8, null));
    expect(linkStatus(net.topology, cable)).toMatchObject({ up: false, reason: 'noSfp' });
    sim = new Simulation(net.topology);
    sim.ping(a, '10.0.0.2');
    sim.runUntilIdle();
    expect(replies(sim, a)).toBe(0);
  });

  it('steckt Kupfer nie in einen SFP-Einschub und Glasfaser nie in eine RJ45-Buchse', () => {
    const { net, s1, s2 } = campus();
    net.topology = unwrap(insertSfpModule(net.topology, s1, '10G-SR')).topology;
    net.topology = unwrap(insertSfpModule(net.topology, s2, '10G-SR')).topology;
    const fiber = unwrap(connect(net.topology, s1, s2, 'fiber'));
    expect(replugCable(fiber.topology, fiber.id, 'a', 3)).toMatchObject({ ok: false, error: { code: 'fiberNeedsSfp' } });
    const copper = net.topology.cables[0]!;
    const end = copper.a.device === s1 ? 'a' : 'b';
    expect(replugCable(net.topology, copper.id, end, 9)).toMatchObject({ ok: false, error: { code: 'copperNeedsRj45' } });
    expect(insertSfpModule(net.topology, net.topology.devices[0]!.id, '1G-SX')).toMatchObject({ ok: false, error: { code: 'noFreeSfpSlot' } });
  });
});

group('Racks', () => {
  it('baut Netzwerkgeräte untereinander ins Rack ein und verschiebt sie mit', () => {
    const { net, s1, s2, a } = campus();
    const { topology, id: rack } = unwrap(addArea(net.topology, { kind: 'rack', title: 'Rack EG', color: 'gray', x: 0, y: 0, width: 220, height: 120 }));
    net.topology = topology;
    net.topology = unwrap(setDeviceRack(net.topology, s1, rack));
    net.topology = unwrap(setDeviceRack(net.topology, s2, rack));
    const p1 = getDevice(net.topology, s1)!.position;
    const p2 = getDevice(net.topology, s2)!.position;
    expect(p1.x).toBe(110);
    expect(p2.y).toBeGreaterThan(p1.y);
    expect(net.topology.areas![0]!.height).toBeGreaterThanOrEqual(p2.y + 30);
    expect(setDeviceRack(net.topology, a, rack)).toMatchObject({ ok: false, error: { code: 'notRackable' } });

    // Rack verschieben nimmt die Geräte mit.
    net.topology = unwrap(moveDevice(net.topology, s1, p1));
    net.topology = unwrap(updateArea(net.topology, rack, { x: 100, y: 50 }));
    expect(getDevice(net.topology, s1)!.position).toEqual({ x: p1.x + 100, y: p1.y + 50 });

    const parsed = parseProject(serializeProject(net.topology));
    expect(parsed.ok && parsed.topology).toEqual(net.topology);

    // Rack entfernen: Geräte bleiben, sind aber nicht mehr eingebaut.
    net.topology = unwrap(removeArea(net.topology, rack));
    expect(getDevice(net.topology, s1)!.rack).toBeUndefined();
  });
});
