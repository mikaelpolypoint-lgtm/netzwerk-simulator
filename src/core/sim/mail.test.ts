import { describe as group, expect, it } from 'vitest';
import { Simulation } from './simulation';
import { NetBuilder, describe } from './testing';

/** Mailserver (zugleich DNS) für schule.ch, Anna holt per POP3, Ben per IMAP ab. */
function network() {
  const net = new NetBuilder();
  const mail = net.host('Mail', '192.168.0.2', '24');
  net.mailServer(mail, 'schule.ch', ['anna', 'ben']);
  net.dnsRecord(mail, 'mail.schule.ch', 'A', '192.168.0.2');
  net.dnsRecord(mail, 'schule.ch', 'MX', 'mail.schule.ch');
  const anna = net.host('Anna', '192.168.0.10', '24');
  const ben = net.host('Ben', '192.168.0.11', '24');
  for (const id of [anna, ben]) net.setDns(id, '192.168.0.2');
  net.mailAccount(anna, 'anna@schule.ch', 'mail.schule.ch', 'pop3');
  net.mailAccount(ben, 'ben@schule.ch', 'mail.schule.ch', 'imap');
  const sw = net.add('switch', 'S1');
  for (const id of [mail, anna, ben]) net.link(id, sw);
  return { net, mail, anna, ben };
}

const mailState = (sim: Simulation, id: string) => sim.getDeviceState(id).mail!;
const lastStep = (sim: Simulation, id: string) => mailState(sim, id).steps.at(-1)?.code;
const mailboxes = (sim: Simulation, id: string) => Object.fromEntries((sim.getDeviceState(id).mailboxes ?? []).map((m) => [m.user, m.count]));

group('E-Mail im eigenen Netz', () => {
  it('sendet per SMTP und holt per IMAP ab; die Nachricht bleibt auf dem Server', () => {
    const { net, mail, anna, ben } = network();
    const sim = new Simulation(net.topology);
    sim.sendMail(anna, { to: ['ben@schule.ch'], subject: 'Hallo', body: 'Wie geht es?' });
    sim.runUntilIdle();
    expect(lastStep(sim, anna)).toBe('mail.sent');
    expect(mailboxes(sim, mail)).toEqual({ anna: 0, ben: 1 });

    sim.fetchMail(ben);
    sim.runUntilIdle();
    sim.fetchMail(ben);
    sim.runUntilIdle();
    expect(mailState(sim, ben).inbox).toMatchObject([{ from: 'anna@schule.ch', to: ['ben@schule.ch'], subject: 'Hallo', body: 'Wie geht es?' }]);
    expect(mailboxes(sim, mail)).toEqual({ anna: 0, ben: 1 });
  });

  it('holt per POP3 ab und löscht dabei auf dem Server', () => {
    const { net, mail, anna, ben } = network();
    const sim = new Simulation(net.topology);
    sim.sendMail(ben, { to: ['anna@schule.ch'], subject: 'Re: Hallo', body: 'Gut, danke.' });
    sim.runUntilIdle();
    sim.fetchMail(anna);
    sim.runUntilIdle();
    expect(mailState(sim, anna).inbox).toHaveLength(1);
    expect(lastStep(sim, anna)).toBe('mail.fetched');
    expect(mailboxes(sim, mail)).toEqual({ anna: 0, ben: 0 });
    sim.fetchMail(anna);
    sim.runUntilIdle();
    expect(mailState(sim, anna).inbox).toHaveLength(1);
  });

  it('macht den SMTP-Dialog in der Paketliste sichtbar', () => {
    const { net, anna } = network();
    const sim = new Simulation(net.topology);
    sim.sendMail(anna, { to: ['ben@schule.ch'], subject: 'x', body: 'y' });
    sim.runUntilIdle();
    const log = sim.getPacketLog().map((e) => describe(net.topology, e));
    for (const line of ['"220 schule.ch ESMTP Netzwerk-Simulator"', '"HELO anna"', '"MAIL FROM:<anna@schule.ch>"', '"RCPT TO:<ben@schule.ch>"', '"DATA"', '"QUIT"']) {
      expect(log.some((l) => l.includes(line))).toBe(true);
    }
    const dialog = mailState(sim, anna).steps.filter((s) => s.code === 'mail.dialog').map((s) => `${s.params?.dir}: ${s.params?.line}`);
    expect(dialog.slice(0, 4)).toEqual(['S: 220 schule.ch ESMTP Netzwerk-Simulator', 'C: HELO anna', 'S: 250 schule.ch', 'C: MAIL FROM:<anna@schule.ch>']);
  });

  it('weist unbekannte Postfächer ab', () => {
    const { net, anna } = network();
    const sim = new Simulation(net.topology);
    sim.sendMail(anna, { to: ['carl@schule.ch'], subject: 'x', body: 'y' });
    sim.runUntilIdle();
    expect(lastStep(sim, anna)).toBe('mail.notSent');
    expect(mailState(sim, anna).steps.some((s) => s.params?.line === '550 Postfach unbekannt')).toBe(true);
  });

  it('meldet ein falsches Passwort', () => {
    const { net, ben } = network();
    net.mailAccount(ben, 'ben@schule.ch', 'mail.schule.ch', 'pop3', 'falsch');
    const sim = new Simulation(net.topology);
    sim.fetchMail(ben);
    sim.runUntilIdle();
    expect(mailState(sim, ben).steps.some((s) => s.code === 'mail.serverError')).toBe(true);
    expect(mailState(sim, ben).steps.some((s) => s.params?.line === 'PASS ********')).toBe(true);
  });

  it('überträgt Zeilen, die mit einem Punkt beginnen, unverändert (Dot-Stuffing)', () => {
    const { net, anna, ben } = network();
    const sim = new Simulation(net.topology);
    const body = 'Zeile 1\r\n.\r\n..zwei Punkte\r\nEnde';
    sim.sendMail(anna, { to: ['ben@schule.ch'], subject: 'Punkte', body });
    sim.runUntilIdle();
    sim.fetchMail(ben);
    sim.runUntilIdle();
    expect(mailState(sim, ben).inbox[0]?.body).toBe(body);
  });
});

group('E-Mail zwischen zwei Domains', () => {
  it('leitet über den MX-Eintrag an den Server der anderen Domain weiter', () => {
    const { net, mail, anna } = network();
    // Zweites Netz mit Mailserver für firma.ch, verbunden über einen Router.
    const firma = net.host('Firma-Mail', '192.168.1.2', '24', '192.168.1.1');
    net.mailServer(firma, 'firma.ch', ['max']);
    const max = net.host('Max', '192.168.1.10', '24', '192.168.1.1');
    net.setDns(max, '192.168.0.2');
    net.setDns(mail, '192.168.0.2');
    net.setDns(firma, '192.168.0.2');
    net.mailAccount(max, 'max@firma.ch', '192.168.1.2', 'pop3');
    const router = net.router('R1', ['192.168.0.1/24', '192.168.1.1/24']);
    const sw = net.topology.devices.find((d) => d.name === 'S1')!.id;
    const sw2 = net.add('switch', 'S2');
    net.link(router, sw);
    net.link(router, sw2);
    net.link(firma, sw2);
    net.link(max, sw2);
    net.topology = {
      ...net.topology,
      devices: net.topology.devices.map((d) => (['Mail', 'Anna', 'Ben'].includes(d.name) ? { ...d, gateway: '192.168.0.1' } : d)),
    };
    net.dnsRecord(mail, 'firma.ch', 'MX', 'mail.firma.ch');
    net.dnsRecord(mail, 'mail.firma.ch', 'A', '192.168.1.2');

    const sim = new Simulation(net.topology);
    sim.sendMail(anna, { to: ['max@firma.ch'], subject: 'Angebot', body: 'Hallo Max' });
    sim.runUntilIdle();
    const mailLog = sim.getDeviceState(mail).console.map((l) => l.code);
    expect(mailLog).toEqual(expect.arrayContaining(['smtp.relayStart', 'smtp.relayConnect', 'smtp.relayed']));
    expect(mailboxes(sim, firma)).toEqual({ max: 1 });

    sim.fetchMail(max);
    sim.runUntilIdle();
    expect(mailState(sim, max).inbox[0]).toMatchObject({ from: 'anna@schule.ch', subject: 'Angebot' });
  });

  it('schickt eine Rückmeldung, wenn die fremde Domain keinen MX-Eintrag hat', () => {
    const { net, mail, anna } = network();
    net.setDns(mail, '192.168.0.2');
    const sim = new Simulation(net.topology);
    sim.sendMail(anna, { to: ['x@unbekannt.ch'], subject: 'Test', body: '...' });
    sim.runUntilIdle();
    expect(sim.getDeviceState(mail).console.map((l) => l.code)).toContain('smtp.relayFailed');
    sim.fetchMail(anna);
    sim.runUntilIdle();
    expect(mailState(sim, anna).inbox[0]).toMatchObject({ from: 'MAILER-DAEMON@schule.ch', subject: 'Undelivered Mail: Test' });
  });
});
