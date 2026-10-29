import { describe as group, expect, it } from 'vitest';
import { removeCable, setDnsServerEnabled, addDnsRecord } from '../model/topology';
import { Simulation } from './simulation';
import { NetBuilder, describe, unwrap } from './testing';

/** Client, DNS-Server und Webserver an einem Switch. */
function network(page = '<h1>Hallo</h1>') {
  const net = new NetBuilder();
  const client = net.host('Client', '192.168.0.10', '24');
  net.topology = {
    ...net.topology,
    devices: net.topology.devices.map((d) => (d.id === client ? { ...d, dns: '192.168.0.2' } : d)),
  };
  const dns = net.host('DNS', '192.168.0.2', '24');
  const web = net.host('Web', '192.168.0.3', '24');
  net.dnsServer(dns, [['webserver1', '192.168.0.3']]);
  net.webServer(web, { '/index.html': page });
  const sw = net.add('switch', 'S1');
  for (const id of [client, dns, web]) net.link(id, sw);
  return { net, client, dns, web };
}

const browser = (sim: Simulation, id: string) => sim.getDeviceState(id).browser!;
const steps = (sim: Simulation, id: string) => browser(sim, id).steps.map((s) => s.code);
const clientLog = (net: NetBuilder, sim: Simulation) =>
  sim
    .getPacketLog()
    .map((e) => describe(net.topology, e))
    .filter((l) => l.startsWith('Client→') || l.startsWith('S1→Client'));

group('Webseite über einen Namen abrufen (Abnahme M5)', () => {
  it('löst den Namen auf, baut TCP auf, sendet GET und zeigt die Seite', () => {
    const { net, client } = network();
    const sim = new Simulation(net.topology);
    sim.browse(client, 'http://webserver1/index.html');
    sim.runUntilIdle();

    expect(browser(sim, client)).toMatchObject({ status: 'done', response: { status: 200, body: '<h1>Hallo</h1>' } });
    expect(steps(sim, client)).toEqual([
      'browser.resolve',
      'browser.resolved',
      'browser.connect',
      'browser.connected',
      'browser.request',
      'browser.response',
      'browser.closed',
    ]);

    const log = clientLog(net, sim).filter((l) => !l.includes('ARP'));
    expect(log.slice(0, 2)).toEqual([
      'Client→S1 DNS query webserver1',
      'S1→Client DNS response webserver1 → 192.168.0.3',
    ]);
    const tcp = log.filter((l) => l.includes(' TCP '));
    expect(tcp[0]).toMatch(/^Client→S1 TCP 49152>80 \[SYN\] seq=\d+ ack=0$/);
    expect(tcp[1]).toMatch(/^S1→Client TCP 80>49152 \[SYN,ACK\]/);
    expect(tcp[2]).toMatch(/^Client→S1 TCP 49152>80 \[ACK\]/);
    expect(tcp[3]).toContain('"GET /index.html HTTP/1.1"');
    expect(tcp.some((l) => l.includes('"HTTP/1.1 200 OK"'))).toBe(true);
    expect(tcp.filter((l) => l.includes('FIN'))).toHaveLength(2);
  });

  it('zählt Sequenz- und Bestätigungsnummern korrekt', () => {
    const { net, client } = network();
    const sim = new Simulation(net.topology);
    sim.browse(client, 'webserver1');
    sim.runUntilIdle();
    const segments = sim
      .getPacketLog()
      .filter((e) => e.from.device === client)
      .flatMap((e) => (e.frame.payload.kind === 'ipv4' && e.frame.payload.payload.kind === 'tcp' ? [e.frame.payload.payload] : []));
    const [syn, ack, request] = segments;
    expect(ack!.seq).toBe(syn!.seq + 1);
    expect(request!.seq).toBe(syn!.seq + 1);
    // Das letzte ACK des Clients bestätigt alle Zeichen der Antwort plus das FIN des Servers.
    const serverSegments = sim
      .getPacketLog()
      .filter((e) => e.to.device === client)
      .flatMap((e) => (e.frame.payload.kind === 'ipv4' && e.frame.payload.payload.kind === 'tcp' ? [e.frame.payload.payload] : []));
    const serverFin = serverSegments.find((s) => s.flags.includes('FIN'))!;
    expect(segments.some((s) => s.ack === serverFin.seq + 1)).toBe(true);
  });

  it('teilt lange Seiten in mehrere Segmente und setzt sie wieder zusammen', () => {
    const page = `<p>${'x'.repeat(4000)}</p>`;
    const { net, client, web } = network(page);
    const sim = new Simulation(net.topology);
    sim.browse(client, 'http://webserver1/');
    sim.runUntilIdle();
    expect(browser(sim, client).response?.body).toBe(page);
    const dataSegments = sim
      .getPacketLog()
      .filter((e) => e.from.device === web)
      .filter((e) => e.frame.payload.kind === 'ipv4' && e.frame.payload.payload.kind === 'tcp' && e.frame.payload.payload.data.length > 0);
    expect(dataSegments.length).toBeGreaterThanOrEqual(3);
  });
});

group('Fehlerfälle beim Abruf', () => {
  it('meldet 404 für unbekannte Seiten', () => {
    const { net, client } = network();
    const sim = new Simulation(net.topology);
    sim.browse(client, 'http://webserver1/fehlt.html');
    sim.runUntilIdle();
    expect(browser(sim, client).response?.status).toBe(404);
  });

  it('meldet unbekannte Namen', () => {
    const { net, client } = network();
    const sim = new Simulation(net.topology);
    sim.browse(client, 'http://gibtsnicht/');
    sim.runUntilIdle();
    expect(browser(sim, client).status).toBe('error');
    expect(steps(sim, client).at(-1)).toBe('browser.dns.nxdomain');
  });

  it('wird abgewiesen, wenn auf dem Ziel kein Webserver läuft', () => {
    const { net, client } = network();
    const sim = new Simulation(net.topology);
    sim.browse(client, 'http://192.168.0.2/');
    sim.runUntilIdle();
    expect(steps(sim, client).at(-1)).toBe('browser.tcp.refused');
    expect(clientLog(net, sim).some((l) => l.includes('[RST,ACK]'))).toBe(true);
  });

  it('wiederholt unbestätigte Segmente und gibt nach drei Versuchen auf', () => {
    const net = new NetBuilder();
    const client = net.host('Client', '10.0.0.1');
    const web = net.host('Web', '10.0.0.2');
    net.webServer(web, { '/index.html': 'ok' });
    const cable = net.link(client, web);
    const sim = new Simulation(net.topology);
    sim.browse(client, 'http://10.0.0.2/');
    sim.runUntil(4.5); // Handshake fertig, Anfrage unterwegs
    sim.updateTopology(unwrap(removeCable(net.topology, cable)));
    sim.runUntilIdle();
    expect(steps(sim, client).at(-1)).toBe('browser.tcp.timeout');
  });

  it('lehnt https und unlesbare Adressen ab', () => {
    const { net, client } = network();
    const sim = new Simulation(net.topology);
    sim.browse(client, 'https://webserver1/');
    expect(steps(sim, client)).toEqual(['browser.httpsUnsupported']);
    sim.browse(client, 'http://web server/');
    expect(steps(sim, client)).toEqual(['browser.invalidUrl']);
  });
});

group('DNS', () => {
  it('nutzt den Cache und hält veraltete Einträge bis zum Ablauf der TTL (DNS-Cache-Fehler)', () => {
    const { net, client, dns } = network();
    const sim = new Simulation(net.topology);
    sim.browse(client, 'webserver1');
    sim.runUntilIdle();
    expect(steps(sim, client)[1]).toBe('browser.resolved');

    // Der Eintrag zeigt nun auf eine andere Adresse; der Client merkt es wegen seines Caches nicht.
    let changed = unwrap(setDnsServerEnabled(net.topology, dns, false));
    changed = unwrap(setDnsServerEnabled(changed, dns, true));
    changed = unwrap(addDnsRecord(changed, dns, { name: 'webserver1', type: 'A', value: '192.168.0.99', ttl: 60 }));
    sim.updateTopology(changed);

    sim.browse(client, 'webserver1');
    sim.runUntilIdle();
    expect(browser(sim, client).steps[1]).toMatchObject({ code: 'browser.resolvedCached', params: { ip: '192.168.0.3' } });

    sim.runCommand(client, 'ipconfig /flushdns');
    sim.browse(client, 'webserver1');
    sim.runUntil(sim.now + 50);
    expect(browser(sim, client).steps[1]).toMatchObject({ code: 'browser.resolved', params: { ip: '192.168.0.99' } });
  });

  it('beantwortet nslookup direkt vom Server', () => {
    const { net, client } = network();
    const sim = new Simulation(net.topology);
    sim.runCommand(client, 'nslookup webserver1');
    sim.runCommand(client, 'nslookup niemand');
    sim.runUntilIdle();
    const lines = sim.getDeviceState(client).console.filter((l) => l.code.startsWith('nslookup.'));
    expect(lines).toMatchObject([
      { code: 'nslookup.server', params: { server: '192.168.0.2' } },
      { code: 'nslookup.server' },
      { code: 'nslookup.answer', params: { name: 'webserver1', ip: '192.168.0.3' } },
      { code: 'nslookup.nxdomain', params: { name: 'niemand' } },
    ]);
  });

  it('pingt über einen Namen', () => {
    const { net, client } = network();
    const sim = new Simulation(net.topology);
    sim.runCommand(client, 'ping webserver1');
    sim.runUntilIdle();
    const lines = sim.getDeviceState(client).console;
    expect(lines.find((l) => l.code === 'ping.startNamed')?.params).toMatchObject({ name: 'webserver1', target: '192.168.0.3' });
    expect(lines.filter((l) => l.code === 'ping.reply')).toHaveLength(4);
    sim.runCommand(client, 'ping niemand');
    sim.runUntilIdle();
    expect(sim.getDeviceState(client).console.at(-1)?.code).toBe('ping.unknownHost');
  });

  it('meldet fehlenden DNS-Server', () => {
    const net = new NetBuilder();
    const a = net.host('A', '10.0.0.1');
    const sim = new Simulation(net.topology);
    sim.runCommand(a, 'ping webserver1');
    expect(sim.getDeviceState(a).console.at(-1)?.code).toBe('ping.dns.noDnsServer');
  });

  it('zeigt Cache und Verbindungen auf der Befehlszeile', () => {
    const { net, client } = network();
    const sim = new Simulation(net.topology);
    sim.browse(client, 'webserver1');
    sim.runUntil(12);
    sim.runCommand(client, 'netstat');
    sim.runUntilIdle();
    sim.runCommand(client, 'ipconfig /displaydns');
    const codes = sim.getDeviceState(client).console.map((l) => l.code);
    expect(codes).toContain('netstat.entry');
    expect(codes).toContain('dnscache.entry');
  });
});
