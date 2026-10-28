/**
 * Befehlszeile für Router und Switches, angelehnt an die Syntax von
 * FRRouting (vtysh) mit den aus dem Unterricht bekannten Modi
 * (user → enable → configure terminal → interface …).
 *
 * Eigene, vereinfachte Nachbildung: Die Befehle ändern die Topologie über
 * dieselben Operationen wie die Formulare der Oberfläche. Ausgaben sind
 * englisch wie auf echten Geräten. Befehle dürfen abgekürzt werden
 * («conf t», «sh ip ro»), «?» zeigt Hilfe, «do» führt im
 * Konfigurationsmodus Anzeigebefehle aus.
 */
import { linkUpAt } from '../model/links';
import {
  addStaticRoute,
  getDevice,
  removeStaticRoute,
  renameDevice,
  setCliConfig,
  setInterfaceAddress,
  setInterfaceDescription,
  setInterfaceNat,
  setInterfaceRelay,
  setInterfaceShutdown,
  setIpRouting,
  setPortTrunk,
  setPortVlan,
  setStp,
  setStpPriority,
  setSubinterface,
  removeSubinterface,
  setSvi,
  removeSvi,
  setVlanName,
  type Result,
  type TopologyError,
} from '../model/topology';
import type { CliConfig, Device, DeviceType, Topology } from '../model/types';
import { formatIp, maskToText, networkOf, parseIp, parseMask } from '../net/ipv4';
import { buildRoutes, decodeIface, logicalInterfaces } from '../net/routing';
import type { DeviceState } from '../sim/simulation';
import { cliIfaceName, ifaceIdOf, parseIfaceName, usesPortNames } from './names';

export type CliMode = 'user' | 'enable' | 'config' | 'if' | 'vlan' | 'line';

export interface CliSession {
  device: string;
  mode: CliMode;
  /** Ziele im Interface-Modus (logische Interfaces); bei «interface range» mehrere. */
  targets?: number[];
  /** VLAN im VLAN-Modus. */
  vlan?: number;
  /** Nächste Eingabe ist ein Passwort (verdeckt eingeben). */
  awaiting?: 'enable-password';
  /** Über SSH angemeldet (sonst Konsole). */
  remote?: boolean;
}

export interface CliEnv {
  topology: Topology;
  /** Zustand aus der laufenden Simulation (ARP, MAC-Tabelle …); fehlt im Entwurfsmodus. */
  state?: DeviceState;
}

export interface CliOutput {
  session: CliSession;
  lines: string[];
  /** Geänderte Topologie, falls der Befehl die Konfiguration verändert hat. */
  topology?: Topology;
  /** Sitzung beendet («exit» im obersten Modus). */
  close?: boolean;
  /** Etwas, das die Simulation ausführen soll (z.B. ping). */
  action?: { kind: 'ping'; target: string };
}

/** Gerätetypen mit Befehlszeile. */
export function hasCli(type: DeviceType): boolean {
  return type === 'router' || type === 'switch' || type === 'l3switch';
}

export function startSession(device: Device, remote = false): { session: CliSession; lines: string[] } {
  const lines = [] as string[];
  if (device.cli?.banner) lines.push(...device.cli.banner.split('\n'), '');
  return { session: { device: device.id, mode: 'user', ...(remote ? { remote: true } : {}) }, lines };
}

export function hostname(device: Device): string {
  return device.name.replace(/\s+/g, '-');
}

export function prompt(topology: Topology, session: CliSession): string {
  const device = getDevice(topology, session.device);
  const name = device ? hostname(device) : '?';
  if (session.awaiting) return 'Password: ';
  switch (session.mode) {
    case 'user':
      return `${name}>`;
    case 'enable':
      return `${name}#`;
    case 'config':
      return `${name}(config)#`;
    case 'if':
      return (session.targets?.length ?? 0) > 1 ? `${name}(config-if-range)#` : `${name}(config-if)#`;
    case 'vlan':
      return `${name}(config-vlan)#`;
    case 'line':
      return `${name}(config-line)#`;
  }
}

// --- Befehlstabelle -------------------------------------------------------------

type Param = 'ip' | 'cidr' | 'mask' | 'iface' | 'vlan' | 'num' | 'word' | 'text';

interface Call {
  args: string[];
  device: Device;
  session: CliSession;
  env: CliEnv;
}

type Handler = (call: Call) => Partial<CliOutput> | string[] | void;

interface Command {
  modes: CliMode[];
  /** Gerätetypen; fehlt = alle mit Befehlszeile. */
  types?: DeviceType[];
  syntax: string;
  help: string;
  run: Handler;
}

const ROUTERS: DeviceType[] = ['router'];
const SWITCHES: DeviceType[] = ['switch', 'l3switch'];
const L3: DeviceType[] = ['router', 'l3switch'];
const EXEC: CliMode[] = ['user', 'enable'];
const CONFIG_ALL: CliMode[] = ['config', 'if', 'vlan', 'line'];

/** Kurze Erklärungen für Schlüsselwörter mitten in einem Befehl (für «?»). */
const KEYWORD_HELP: Record<string, string> = {
  show: 'Show running system information',
  ip: 'IP information',
  route: 'IP routing table / static route',
  interface: 'Interface information / configuration',
  brief: 'Brief summary',
  arp: 'ARP table',
  'running-config': 'Current operating configuration',
  mac: 'MAC address information',
  'address-table': 'MAC forwarding table',
  vlan: 'VLAN information / configuration',
  'spanning-tree': 'Spanning tree information / configuration',
  interfaces: 'Interface status',
  status: 'Port status',
  nat: 'NAT information / configuration',
  translations: 'Active NAT translations',
  no: 'Negate a command or set its defaults',
  switchport: 'Layer 2 port configuration',
  mode: 'Port mode',
  access: 'Access port / access VLAN',
  trunk: 'Trunk port (802.1Q)',
  address: 'Set the IP address',
  'helper-address': 'Forward DHCP requests to this server (DHCP relay)',
  inside: 'Inside (local) network',
  outside: 'Outside network (translated to this address)',
  encapsulation: 'Encapsulation type',
  dot1q: 'IEEE 802.1Q VLAN tag',
  range: 'Configure several ports at once',
  priority: 'Bridge priority',
  configure: 'Enter configuration mode',
  terminal: 'Configure from the terminal',
  write: 'Save the configuration',
  memory: 'Save to startup configuration',
  copy: 'Copy configuration',
  'startup-config': 'Startup configuration',
  transport: 'Allowed connection protocols',
  input: 'Incoming connections',
  ssh: 'Secure Shell',
  none: 'No incoming connections',
  login: 'Login settings',
  local: 'Use the local user database',
  enable: 'Privileged mode / password',
  secret: 'Password for privileged mode',
  username: 'Local user account',
  password: 'Password',
  banner: 'Login banner',
  motd: 'Message of the day',
  routing: 'Routing between VLANs',
  version: 'Software version',
  name: 'Name',
  vty: 'Remote (SSH) lines',
};

function ok(lines: string[] = []): Partial<CliOutput> {
  return { lines };
}

/** Englische Fehlermeldung wie auf echten Geräten. */
function errorLine(error: TopologyError): string {
  const p = error.params ?? {};
  switch (error.code) {
    case 'invalidIp':
      return `% Invalid IP address: ${p.value ?? ''}`;
    case 'invalidMask':
      return `% Invalid netmask: ${p.value ?? ''}`;
    case 'maskRequired':
      return '% Netmask or prefix length required';
    case 'invalidVlan':
      return '% VLAN must be between 1 and 4094';
    case 'nameTaken':
      return `% Hostname already used by another device: ${p.name ?? ''}`;
    case 'nameTooLong':
      return `% Name too long (max. ${p.max ?? ''} characters)`;
    case 'nameEmpty':
      return '% Name must not be empty';
    case 'stpNeededForLoop':
      return '% Spanning tree cannot be disabled: the switches form a loop';
    case 'invalidPriority':
      return '% Priority must be a multiple of 4096 between 0 and 61440';
    case 'duplicateRoute':
      return `% Route already exists: ${p.net ?? ''}`;
    case 'networkHasHostBits':
      return `% Network address has host bits set (did you mean ${p.suggestion ?? ''}?)`;
    case 'unknownInterface':
      return '% Unknown interface';
    case 'invalidUser':
      return `% Invalid user name: ${p.name ?? ''}`;
    case 'passwordRequired':
      return '% Password required';
    default:
      return `% Error: ${error.code}`;
  }
}

function apply(result: Result<Topology>, lines: string[] = []): Partial<CliOutput> {
  return result.ok ? { topology: result.value, lines } : { lines: [errorLine(result.error)] };
}

/** Änderungen nacheinander anwenden (z.B. für «interface range»); beim ersten Fehler abbrechen. */
function applyAll(topology: Topology, steps: ((t: Topology) => Result<Topology>)[]): Partial<CliOutput> {
  let current = topology;
  for (const step of steps) {
    const result = step(current);
    if (!result.ok) return { lines: [errorLine(result.error)], ...(current !== topology ? { topology: current } : {}) };
    current = result.value;
  }
  return { topology: current, lines: [] };
}

function parseAddress(a: string, b?: string): { ip: string; mask: string } | null {
  if (b !== undefined) return parseIp(a) !== null && parseMask(b) !== null ? { ip: a, mask: b } : null;
  const [ip, prefix] = a.split('/');
  if (!ip || prefix === undefined || parseIp(ip) === null || parseMask(prefix) === null) return null;
  return { ip, mask: prefix };
}

function updateCli(call: Call, change: (cli: CliConfig) => CliConfig): Partial<CliOutput> {
  return apply(setCliConfig(call.env.topology, call.device.id, change({ ...(call.device.cli ?? {}) })));
}

const isPortTarget = (id: number) => decodeIface(id).kind === 'port';

function addressOn(call: Call, ip: string, mask: string): Partial<CliOutput> {
  const { topology } = call.env;
  return applyAll(
    topology,
    (call.session.targets ?? []).map((id) => (t: Topology) => {
      const ref = decodeIface(id);
      if (ref.kind === 'sub') return setSubinterface(t, call.device.id, ref.port, ref.vlan, ip, mask);
      if (ref.kind === 'svi') return setSvi(t, call.device.id, ref.vlan, ip, mask);
      if (usesPortNames(call.device)) return { ok: false, error: { code: 'unknownInterface' } };
      return setInterfaceAddress(t, call.device.id, ref.port, ip, mask);
    }),
  );
}

function forPorts(call: Call, step: (t: Topology, port: number) => Result<Topology>): Partial<CliOutput> {
  const targets = call.session.targets ?? [];
  if (!targets.every(isPortTarget)) return ok(['% Not supported on this interface']);
  return applyAll(
    call.env.topology,
    targets.map((id) => (t: Topology) => step(t, decodeIface(id).kind === 'port' ? id : 0)),
  );
}

function exitMode(session: CliSession): Partial<CliOutput> {
  switch (session.mode) {
    case 'if':
    case 'vlan':
    case 'line':
      return { session: { device: session.device, mode: 'config', ...(session.remote ? { remote: true } : {}) } };
    case 'config':
      return { session: { device: session.device, mode: 'enable', ...(session.remote ? { remote: true } : {}) } };
    default:
      return { close: true, lines: session.remote ? ['Connection closed.'] : [] };
  }
}

const COMMANDS: Command[] = [
  // --- Ausführen (user / enable) -------------------------------------------
  {
    modes: ['user'],
    syntax: 'enable',
    help: 'Turn on privileged commands',
    run: ({ device, session }) => {
      if (device.cli?.enableSecret) return { session: { ...session, awaiting: 'enable-password' } };
      return { session: { ...session, mode: 'enable' } };
    },
  },
  { modes: ['enable'], syntax: 'disable', help: 'Turn off privileged commands', run: ({ session }) => ({ session: { ...session, mode: 'user' } }) },
  { modes: ['enable'], syntax: 'configure terminal', help: 'Enter configuration mode', run: ({ session }) => ({ session: { ...session, mode: 'config' } }) },
  { modes: ['enable'], syntax: 'configure', help: 'Enter configuration mode', run: ({ session }) => ({ session: { ...session, mode: 'config' } }) },
  { modes: [...EXEC, ...CONFIG_ALL], syntax: 'exit', help: 'Exit current mode / close the session', run: ({ session }) => exitMode(session) },
  { modes: EXEC, syntax: 'logout', help: 'Close the session', run: ({ session }) => ({ close: true, lines: session.remote ? ['Connection closed.'] : [] }) },
  { modes: CONFIG_ALL, syntax: 'end', help: 'Return to privileged mode', run: ({ session }) => ({ session: { device: session.device, mode: 'enable', ...(session.remote ? { remote: true } : {}) } }) },
  { modes: ['enable'], syntax: 'write memory', help: 'Save the running configuration', run: () => ok(['Building configuration...', '[OK]']) },
  { modes: ['enable'], syntax: 'write', help: 'Save the running configuration', run: () => ok(['Building configuration...', '[OK]']) },
  { modes: ['enable'], syntax: 'copy running-config startup-config', help: 'Save the running configuration', run: () => ok(['Building configuration...', '[OK]']) },
  {
    modes: EXEC,
    types: L3,
    syntax: 'ping <ip>',
    help: 'Send ICMP echo requests',
    run: ({ args }) => ({ lines: [`Sending 4 ICMP echos to ${args[0]}:`], action: { kind: 'ping', target: args[0]! } }),
  },
  { modes: EXEC, syntax: 'show version', help: 'Software version', run: ({ device }) => ok(showVersion(device)) },
  { modes: ['enable'], syntax: 'show running-config', help: 'Current operating configuration', run: ({ device }) => ok(runningConfig(device)) },
  { modes: EXEC, types: L3, syntax: 'show ip route', help: 'IP routing table', run: ({ device }) => ok(showIpRoute(device)) },
  { modes: EXEC, types: L3, syntax: 'show ip interface brief', help: 'Interface addresses and status', run: ({ device, env }) => ok(showIpInterfaceBrief(device, env)) },
  { modes: EXEC, syntax: 'show interface brief', help: 'Interface status summary', run: ({ device, env }) => ok(usesPortNames(device) ? showInterfacesStatus(device, env) : showIpInterfaceBrief(device, env)) },
  { modes: EXEC, types: L3, syntax: 'show ip arp', help: 'ARP table', run: ({ device, env }) => ok(showArp(device, env)) },
  { modes: EXEC, types: L3, syntax: 'show arp', help: 'ARP table', run: ({ device, env }) => ok(showArp(device, env)) },
  { modes: EXEC, types: ROUTERS, syntax: 'show ip nat translations', help: 'Active NAT translations', run: ({ env }) => ok(showNat(env)) },
  { modes: EXEC, types: SWITCHES, syntax: 'show mac address-table', help: 'MAC forwarding table', run: ({ device, env }) => ok(showMacTable(device, env)) },
  { modes: EXEC, types: SWITCHES, syntax: 'show vlan brief', help: 'VLAN summary', run: ({ device }) => ok(showVlanBrief(device)) },
  { modes: EXEC, types: SWITCHES, syntax: 'show vlan', help: 'VLAN summary', run: ({ device }) => ok(showVlanBrief(device)) },
  { modes: EXEC, types: SWITCHES, syntax: 'show interfaces status', help: 'Port status', run: ({ device, env }) => ok(showInterfacesStatus(device, env)) },
  { modes: EXEC, types: SWITCHES, syntax: 'show spanning-tree', help: 'Spanning tree state', run: ({ device, env }) => ok(showSpanningTree(device, env)) },

  // --- Konfiguration (global) ------------------------------------------------
  {
    modes: ['config'],
    syntax: 'hostname <word>',
    help: 'Set the device name',
    run: ({ args, device, env }) => apply(renameDevice(env.topology, device.id, args[0]!)),
  },
  {
    modes: ['config'],
    syntax: 'interface <iface>',
    help: 'Select an interface to configure',
    run: (call) => enterInterface(call, call.args[0]!),
  },
  {
    modes: ['config'],
    types: ['l3switch'],
    syntax: 'interface vlan <vlan>',
    help: 'Select or create a VLAN interface (SVI)',
    run: (call) => enterInterface(call, `vlan${call.args[0]}`),
  },
  {
    modes: ['config'],
    types: SWITCHES,
    syntax: 'interface range <word>',
    help: 'Configure several ports at once, e.g. port1-4',
    run: (call) => enterRange(call, call.args[0]!),
  },
  {
    modes: ['config'],
    types: ['router'],
    syntax: 'no interface <iface>',
    help: 'Delete a subinterface',
    run: ({ args, device, env }) => {
      const ref = parseIfaceName(device, args[0]!);
      if (ref?.kind !== 'sub') return ok(['% Only subinterfaces (e.g. eth0.10) can be deleted']);
      return apply(removeSubinterface(env.topology, device.id, ref.port, ref.vlan));
    },
  },
  {
    modes: ['config'],
    types: ['l3switch'],
    syntax: 'no interface vlan <vlan>',
    help: 'Delete a VLAN interface',
    run: ({ args, device, env }) => apply(removeSvi(env.topology, device.id, Number(args[0]))),
  },
  { modes: ['config'], types: L3, syntax: 'ip route <cidr> <word>', help: 'Static route: prefix, next hop or interface', run: (call) => addRoute(call, call.args[0]!, call.args[1]!) },
  { modes: ['config'], types: L3, syntax: 'ip route <ip> <mask> <word>', help: 'Static route: network, mask, next hop or interface', run: (call) => addRoute(call, `${call.args[0]}/${call.args[1]}`, call.args[2]!) },
  { modes: ['config'], types: L3, syntax: 'no ip route <cidr> <word>', help: 'Remove a static route', run: (call) => removeRoute(call, call.args[0]!) },
  { modes: ['config'], types: L3, syntax: 'no ip route <ip> <mask> <word>', help: 'Remove a static route', run: (call) => removeRoute(call, `${call.args[0]}/${call.args[1]}`) },
  { modes: ['config'], types: L3, syntax: 'no ip route <cidr>', help: 'Remove a static route', run: (call) => removeRoute(call, call.args[0]!) },
  { modes: ['config'], types: ['l3switch'], syntax: 'ip routing', help: 'Route between VLANs', run: ({ device, env }) => apply(setIpRouting(env.topology, device.id, true)) },
  { modes: ['config'], types: ['l3switch'], syntax: 'no ip routing', help: 'Stop routing between VLANs', run: ({ device, env }) => apply(setIpRouting(env.topology, device.id, false)) },
  { modes: ['config'], types: SWITCHES, syntax: 'spanning-tree', help: 'Enable spanning tree', run: ({ device, env }) => apply(setStp(env.topology, device.id, true)) },
  { modes: ['config'], types: SWITCHES, syntax: 'no spanning-tree', help: 'Disable spanning tree', run: ({ device, env }) => apply(setStp(env.topology, device.id, false)) },
  {
    modes: ['config'],
    types: SWITCHES,
    syntax: 'spanning-tree priority <num>',
    help: 'Bridge priority (0–61440, steps of 4096)',
    run: ({ args, device, env }) => apply(setStpPriority(env.topology, device.id, Number(args[0]))),
  },
  {
    modes: ['config'],
    types: SWITCHES,
    syntax: 'vlan <vlan>',
    help: 'Create or select a VLAN',
    run: ({ args, session }) => ({ session: { ...session, mode: 'vlan', vlan: Number(args[0]) } }),
  },
  {
    modes: ['config'],
    types: SWITCHES,
    syntax: 'no vlan <vlan>',
    help: 'Remove the VLAN name',
    run: ({ args, device, env }) => apply(setVlanName(env.topology, device.id, Number(args[0]), '')),
  },
  {
    modes: ['config'],
    syntax: 'username <word> password <word>',
    help: 'Create a local user for SSH logins',
    run: (call) => updateCli(call, (cli) => ({ ...cli, users: [...(cli.users ?? []).filter((u) => u.name !== call.args[0]), { name: call.args[0]!, password: call.args[1]! }] })),
  },
  {
    modes: ['config'],
    syntax: 'no username <word>',
    help: 'Delete a local user',
    run: (call) => updateCli(call, (cli) => ({ ...cli, users: (cli.users ?? []).filter((u) => u.name !== call.args[0]) })),
  },
  {
    modes: ['config'],
    syntax: 'enable secret <word>',
    help: 'Password for privileged mode',
    run: (call) => updateCli(call, (cli) => ({ ...cli, enableSecret: call.args[0]! })),
  },
  {
    modes: ['config'],
    syntax: 'no enable secret',
    help: 'Remove the enable password',
    run: (call) => updateCli(call, ({ enableSecret: _e, ...cli }) => cli),
  },
  { modes: ['config'], syntax: 'banner motd <text>', help: 'Text shown at login', run: (call) => updateCli(call, (cli) => ({ ...cli, banner: call.args[0]! })) },
  { modes: ['config'], syntax: 'no banner motd', help: 'Remove the login banner', run: (call) => updateCli(call, ({ banner: _b, ...cli }) => cli) },
  { modes: ['config'], types: L3, syntax: 'ip ssh', help: 'Enable the SSH server', run: (call) => updateCli(call, (cli) => ({ ...cli, ssh: true })) },
  { modes: ['config'], types: L3, syntax: 'no ip ssh', help: 'Disable the SSH server', run: (call) => updateCli(call, ({ ssh: _s, ...cli }) => cli) },
  { modes: ['config'], syntax: 'line vty', help: 'Configure remote (SSH) access', run: ({ session }) => ({ session: { ...session, mode: 'line' } }) },
  { modes: ['config'], syntax: 'line vty <num> <num>', help: 'Configure remote (SSH) access', run: ({ session }) => ({ session: { ...session, mode: 'line' } }) },

  // --- line vty ------------------------------------------------------------
  { modes: ['line'], types: L3, syntax: 'transport input ssh', help: 'Allow SSH logins', run: (call) => updateCli(call, (cli) => ({ ...cli, ssh: true })) },
  { modes: ['line'], syntax: 'transport input none', help: 'Allow no remote logins', run: (call) => updateCli(call, ({ ssh: _s, ...cli }) => cli) },
  {
    modes: ['line'],
    syntax: 'login local',
    help: 'Check logins against the local users',
    run: ({ device }) => ok(device.cli?.users?.length ? [] : ['% Warning: no local users yet – add one with "username NAME password PASSWORD"']),
  },

  // --- vlan ------------------------------------------------------------------
  {
    modes: ['vlan'],
    syntax: 'name <word>',
    help: 'Name of the VLAN',
    run: ({ args, device, env, session }) => apply(setVlanName(env.topology, device.id, session.vlan ?? 1, args[0]!)),
  },

  // --- interface -------------------------------------------------------------
  { modes: ['if'], types: L3, syntax: 'ip address <cidr>', help: 'Address with prefix length, e.g. 192.168.1.1/24', run: (call) => addressOn(call, ...splitCidr(call.args[0]!)) },
  { modes: ['if'], types: L3, syntax: 'ip address <ip> <mask>', help: 'Address and netmask', run: (call) => addressOn(call, call.args[0]!, call.args[1]!) },
  { modes: ['if'], types: L3, syntax: 'no ip address', help: 'Remove the IP address', run: (call) => addressOn(call, '', '') },
  {
    modes: ['if'],
    types: L3,
    syntax: 'ip helper-address <ip>',
    help: 'Forward DHCP requests to this server (DHCP relay)',
    run: (call) => applyAll(call.env.topology, (call.session.targets ?? []).map((id) => (t: Topology) => setInterfaceRelay(t, call.device.id, id, call.args[0]!))),
  },
  {
    modes: ['if'],
    types: L3,
    syntax: 'no ip helper-address',
    help: 'Remove the DHCP relay',
    run: (call) => applyAll(call.env.topology, (call.session.targets ?? []).map((id) => (t: Topology) => setInterfaceRelay(t, call.device.id, id, ''))),
  },
  { modes: ['if'], types: ROUTERS, syntax: 'ip nat outside', help: 'Translate outgoing traffic to this address', run: (call) => forPorts(call, (t, p) => setInterfaceNat(t, call.device.id, p, true)) },
  { modes: ['if'], types: ROUTERS, syntax: 'no ip nat outside', help: 'No address translation', run: (call) => forPorts(call, (t, p) => setInterfaceNat(t, call.device.id, p, false)) },
  { modes: ['if'], types: ROUTERS, syntax: 'ip nat inside', help: 'Inside network (nothing to configure)', run: () => ok() },
  {
    modes: ['if'],
    types: ROUTERS,
    syntax: 'encapsulation dot1q <vlan>',
    help: '802.1Q tag of this subinterface',
    run: ({ args, session }) => {
      const ref = decodeIface(session.targets?.[0] ?? 0);
      if (ref.kind !== 'sub') return ok(['% Use a subinterface, e.g. "interface eth0.10"']);
      if (ref.vlan !== Number(args[0])) return ok([`% The VLAN is given by the name: eth${ref.port}.${ref.vlan} uses VLAN ${ref.vlan}`]);
      return ok();
    },
  },
  { modes: ['if'], syntax: 'shutdown', help: 'Disable the interface', run: (call) => forPorts(call, (t, p) => setInterfaceShutdown(t, call.device.id, p, true)) },
  { modes: ['if'], syntax: 'no shutdown', help: 'Enable the interface', run: (call) => forPorts(call, (t, p) => setInterfaceShutdown(t, call.device.id, p, false)) },
  { modes: ['if'], syntax: 'description <text>', help: 'Interface description', run: (call) => forPorts(call, (t, p) => setInterfaceDescription(t, call.device.id, p, call.args[0]!)) },
  { modes: ['if'], syntax: 'no description', help: 'Remove the description', run: (call) => forPorts(call, (t, p) => setInterfaceDescription(t, call.device.id, p, '')) },
  { modes: ['if'], types: SWITCHES, syntax: 'switchport mode access', help: 'Access port (one VLAN, untagged)', run: (call) => forPorts(call, (t, p) => setPortTrunk(t, call.device.id, p, false)) },
  { modes: ['if'], types: SWITCHES, syntax: 'switchport mode trunk', help: 'Trunk port (all VLANs, 802.1Q)', run: (call) => forPorts(call, (t, p) => setPortTrunk(t, call.device.id, p, true)) },
  { modes: ['if'], types: SWITCHES, syntax: 'switchport access vlan <vlan>', help: 'VLAN of this access port', run: (call) => forPorts(call, (t, p) => setPortVlan(t, call.device.id, p, Number(call.args[0]))) },
  { modes: ['if'], types: SWITCHES, syntax: 'no switchport access vlan', help: 'Back to VLAN 1', run: (call) => forPorts(call, (t, p) => setPortVlan(t, call.device.id, p, 1)) },
  { modes: ['if'], types: SWITCHES, syntax: 'spanning-tree portfast', help: 'Ports with end devices forward at once (always on here)', run: () => ok() },
];

function splitCidr(cidr: string): [string, string] {
  const [ip = '', prefix = ''] = cidr.split('/');
  return [ip, prefix];
}

function enterInterface(call: Call, name: string): Partial<CliOutput> {
  const { device, env, session } = call;
  const ref = parseIfaceName(device, name);
  if (!ref) return ok([`% Unknown interface: ${name}`]);
  let topology: Topology | undefined;
  // Subinterfaces und SVIs entstehen beim ersten Aufruf, wie auf echten Geräten.
  if (ref.kind === 'sub' && !device.subinterfaces?.some((s) => s.parent === ref.port && s.vlan === ref.vlan)) {
    const created = setSubinterface(env.topology, device.id, ref.port, ref.vlan, '', '');
    if (!created.ok) return ok([errorLine(created.error)]);
    topology = created.value;
  }
  if (ref.kind === 'svi' && !device.svis?.some((s) => s.vlan === ref.vlan)) {
    const created = setSvi(env.topology, device.id, ref.vlan, '', '');
    if (!created.ok) return ok([errorLine(created.error)]);
    topology = created.value;
  }
  return { session: { ...session, mode: 'if', targets: [ifaceIdOf(ref)] }, ...(topology ? { topology } : {}) };
}

/** «interface range port1-4» oder «port1-4,port7». */
function enterRange(call: Call, spec: string): Partial<CliOutput> {
  const targets: number[] = [];
  for (const part of spec.split(',')) {
    const m = /^(.*?)(\d+)(?:-(\d+))?$/.exec(part.trim());
    if (!m) return ok([`% Invalid range: ${part}`]);
    const [, prefix = 'port', fromText, toText] = m;
    const from = Number(fromText);
    const to = toText === undefined ? from : Number(toText);
    if (to < from) return ok([`% Invalid range: ${part}`]);
    for (let n = from; n <= to; n++) {
      const ref = parseIfaceName(call.device, `${prefix || 'port'}${n}`);
      if (ref?.kind !== 'port') return ok([`% Unknown interface: ${prefix}${n}`]);
      targets.push(ref.port);
    }
  }
  return { session: { ...call.session, mode: 'if', targets: [...new Set(targets)] } };
}

/** Nächster Hop: IP-Adresse oder Interface-Name. */
function addRoute(call: Call, prefixText: string, via: string): Partial<CliOutput> {
  const { device, env } = call;
  const [network, prefix] = splitCidr(prefixText);
  if (parseIp(via) !== null) return apply(addStaticRoute(env.topology, device.id, { network, mask: prefix, gateway: via }));
  const ref = parseIfaceName(device, via);
  if (!ref) return ok([`% Invalid next hop: ${via}`]);
  return apply(addStaticRoute(env.topology, device.id, { network, mask: prefix, iface: ifaceIdOf(ref) }));
}

function removeRoute(call: Call, prefixText: string): Partial<CliOutput> {
  const { device, env } = call;
  const [network, prefixRaw] = splitCidr(prefixText);
  const prefix = parseMask(prefixRaw);
  const index = (device.routes ?? []).findIndex((r) => r.network === network && parseMask(r.mask) === prefix);
  if (index < 0) return ok(['% No such route']);
  return apply(removeStaticRoute(env.topology, device.id, index));
}

// --- Ausführen ------------------------------------------------------------------

const PARAM_PATTERN = /^<(\w+)>$/;

function paramOk(param: Param, token: string): boolean {
  switch (param) {
    case 'ip':
      return parseIp(token) !== null;
    case 'cidr':
      return /^\d+\.\d+\.\d+\.\d+\/\d{1,2}$/.test(token) && parseAddress(token) !== null;
    case 'mask':
      return parseMask(token) !== null;
    case 'vlan':
      return /^\d+$/.test(token) && Number(token) >= 1 && Number(token) <= 4094;
    case 'num':
      return /^\d+$/.test(token);
    default:
      return token.length > 0;
  }
}

interface Match {
  command: Command;
  args: string[];
  exact: number;
  keywords: string;
}

function available(device: Device, mode: CliMode): Command[] {
  return COMMANDS.filter((c) => c.modes.includes(mode) && (!c.types || c.types.includes(device.type)));
}

/** Passt `tokens` vollständig auf den Befehl? Sonst die Position des ersten Fehlers. */
function matchCommand(command: Command, tokens: string[], raw: string): { match?: Match; failedAt: number; incomplete: boolean } {
  const parts = command.syntax.split(' ');
  const args: string[] = [];
  const keywords: string[] = [];
  let exact = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const token = tokens[i];
    if (token === undefined) return { failedAt: i, incomplete: true };
    const param = PARAM_PATTERN.exec(part)?.[1] as Param | undefined;
    if (param === 'text') {
      // Rest der Zeile im Original (Gross-/Kleinschreibung, Leerzeichen bleiben).
      args.push(restOfLine(raw, i));
      return { match: { command, args, exact, keywords: keywords.join(' ') }, failedAt: -1, incomplete: false };
    }
    if (param) {
      if (!paramOk(param, token)) return { failedAt: i, incomplete: false };
      args.push(token);
      keywords.push(`<${param}>`);
      continue;
    }
    const lower = token.toLowerCase();
    if (!part.startsWith(lower)) return { failedAt: i, incomplete: false };
    if (part === lower) exact++;
    keywords.push(part);
  }
  if (tokens.length > parts.length) return { failedAt: parts.length, incomplete: false };
  return { match: { command, args, exact, keywords: keywords.join(' ') }, failedAt: -1, incomplete: false };
}

function restOfLine(raw: string, skip: number): string {
  let rest = raw.trim();
  for (let i = 0; i < skip; i++) rest = rest.replace(/^\S+\s*/, '');
  return rest;
}

function tokenize(line: string): string[] {
  return line.trim().split(/\s+/).filter(Boolean);
}

/** Spalte, an der das Token `index` beginnt (für das «^» unter dem Fehler). */
function columnOf(line: string, index: number): number {
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(line))) {
    if (n === index) return m.index;
    n++;
  }
  return line.length;
}

export function execute(session: CliSession, line: string, env: CliEnv): CliOutput {
  const device = getDevice(env.topology, session.device);
  if (!device) return { session, lines: ['% Device no longer exists'], close: true };

  if (session.awaiting === 'enable-password') {
    const { awaiting: _a, ...rest } = session;
    if (line === device.cli?.enableSecret) return { session: { ...rest, mode: 'enable' }, lines: [] };
    return { session: rest, lines: ['% Access denied'] };
  }

  // Kommentare: ganze Zeile mit «!» oder angehängt mit « ! …» (wie in Konfigurationsdateien).
  const trimmed = line.replace(/\s+!\s.*$/, '').trim();
  if (!trimmed || trimmed.startsWith('!')) return { session, lines: [] };
  if (trimmed.endsWith('?')) return { session, lines: help(device, session, trimmed.slice(0, -1), line.slice(0, line.lastIndexOf('?'))) };

  const tokens = tokenize(trimmed);
  // «do show …» im Konfigurationsmodus.
  if (CONFIG_ALL.includes(session.mode) && tokens[0]?.toLowerCase() === 'do' && tokens.length > 1) {
    const inner = execute({ ...session, mode: 'enable' }, trimmed.replace(/^\S+\s+/, ''), env);
    return { ...inner, session, close: false };
  }

  const candidates = available(device, session.mode);
  const results = candidates.map((c) => matchCommand(c, tokens, trimmed));
  const matches = results.flatMap((r) => (r.match ? [r.match] : []));
  if (matches.length === 0) {
    const promptText = prompt(env.topology, session);
    if (results.some((r) => r.incomplete && r.failedAt === tokens.length)) return { session, lines: ['% Incomplete command.'] };
    const furthest = Math.max(0, ...results.map((r) => r.failedAt));
    const col = columnOf(trimmed, furthest);
    return { session, lines: [`${' '.repeat(promptText.length + col)}^`, "% Invalid input detected at '^' marker."] };
  }
  const best = Math.max(...matches.map((m) => m.exact));
  const top = matches.filter((m) => m.exact === best);
  const distinct = new Set(top.map((m) => m.keywords));
  if (distinct.size > 1) return { session, lines: [`% Ambiguous command: "${trimmed}"`] };
  const chosen = top[0]!;
  const out = chosen.command.run({ args: chosen.args, device, session, env });
  const result: Partial<CliOutput> = Array.isArray(out) ? { lines: out } : (out ?? {});
  return {
    session: result.session ?? session,
    lines: result.lines ?? [],
    ...(result.topology ? { topology: result.topology } : {}),
    ...(result.close ? { close: true } : {}),
    ...(result.action ? { action: result.action } : {}),
  };
}

/** Antwort auf «?»: mögliche nächste Wörter mit kurzer Erklärung. */
function help(device: Device, session: CliSession, before: string, raw: string): string[] {
  const endsWithSpace = /\s$/.test(raw) || raw.trim() === '';
  const tokens = tokenize(before);
  const partial = endsWithSpace ? '' : (tokens.pop() ?? '');
  const options = new Map<string, string>();
  const commands = available(device, session.mode);
  if (CONFIG_ALL.includes(session.mode) && tokens.length === 0) options.set('do', 'Run a show/exec command');
  for (const command of commands) {
    const parts = command.syntax.split(' ');
    if (tokens.length >= parts.length) {
      if (tokens.length === parts.length && endsWithSpace && matchCommand(command, tokens, before).match) options.set('<cr>', '');
      continue;
    }
    const prefix = matchCommand({ ...command, syntax: parts.slice(0, tokens.length).join(' ') || '' }, tokens, before);
    if (tokens.length > 0 && !prefix.match) continue;
    const next = parts[tokens.length]!;
    const isParam = PARAM_PATTERN.test(next);
    if (!isParam && !next.startsWith(partial.toLowerCase())) continue;
    const last = tokens.length === parts.length - 1;
    const text = isParam || last ? command.help : (KEYWORD_HELP[next] ?? command.help);
    if (!options.has(next)) options.set(next, text);
  }
  if (options.size === 0) return ['% Unrecognized command'];
  const width = Math.max(...[...options.keys()].map((k) => k.length)) + 2;
  return [...options.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `  ${k.padEnd(width)}${v}`);
}

/** Tab-Ergänzung des letzten Worts; null, wenn nicht eindeutig. */
export function complete(session: CliSession, line: string, env: CliEnv): string | null {
  const device = getDevice(env.topology, session.device);
  if (!device || /\s$/.test(line)) return null;
  const tokens = tokenize(line);
  const partial = tokens.pop();
  if (partial === undefined) return null;
  const words = new Set<string>();
  for (const command of available(device, session.mode)) {
    const parts = command.syntax.split(' ');
    if (tokens.length >= parts.length) continue;
    const head = { ...command, syntax: parts.slice(0, tokens.length).join(' ') };
    if (tokens.length > 0 && !matchCommand(head, tokens, line).match) continue;
    const next = parts[tokens.length]!;
    if (!PARAM_PATTERN.test(next) && next.startsWith(partial.toLowerCase())) words.add(next);
  }
  if (words.size !== 1) return null;
  const word = [...words][0]!;
  return line.slice(0, line.length - partial.length) + word + ' ';
}

// --- Anzeigen ----------------------------------------------------------------

function showVersion(device: Device): string[] {
  return [
    'Netzwerk-Simulator – simulated network operating system',
    'Command syntax modelled on FRRouting (vtysh); not FRRouting software.',
    `Device: ${device.name} (${device.type}), ${device.interfaces.length} ports`,
  ];
}

const prefixText = (ip: number, prefix: number) => `${formatIp(networkOf(ip, prefix))}/${prefix}`;

export function showIpRoute(device: Device): string[] {
  const { routes } = buildRoutes(device);
  const lines = ['Codes: C - connected, S - static', '       > - selected route, * - FIB route', ''];
  const sorted = [...routes].sort((a, b) => (a.network >>> 0) - (b.network >>> 0) || a.prefix - b.prefix);
  for (const r of sorted) {
    const name = cliIfaceName(device, r.iface);
    const net = `${formatIp(r.network)}/${r.prefix}`;
    if (r.kind === 'connected') lines.push(`C>* ${net} is directly connected, ${name}`);
    else lines.push(`S>* ${net} [1/0] ${r.via !== null ? `via ${formatIp(r.via)}, ${name}` : `is directly connected, ${name}`}`);
  }
  if (sorted.length === 0) lines.push('(no routes)');
  return lines;
}

interface IfaceRow {
  id: number;
  name: string;
  address: string;
  status: string;
  protocol: string;
}

function ifaceRows(device: Device, env: CliEnv): IfaceRow[] {
  return logicalInterfaces(device).map((id) => {
    const ref = decodeIface(id);
    const port = ref.kind === 'svi' ? undefined : device.interfaces[ref.port];
    const config =
      ref.kind === 'port'
        ? port
        : ref.kind === 'sub'
          ? device.subinterfaces?.find((s) => s.parent === ref.port && s.vlan === ref.vlan)
          : device.svis?.find((s) => s.vlan === ref.vlan);
    const prefix = config?.mask ? parseMask(config.mask) : null;
    const address = config?.ip && prefix !== null ? `${config.ip}/${prefix}` : 'unassigned';
    const down = port?.shutdown;
    const up = ref.kind === 'svi' ? true : linkUpAt(env.topology, { device: device.id, iface: ref.port });
    return {
      id,
      name: cliIfaceName(device, id),
      address,
      status: down ? 'admin down' : up ? 'up' : 'down',
      protocol: down || !up ? 'down' : 'up',
    };
  });
}

function table(header: string[], rows: string[][]): string[] {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)) + 2);
  const fmt = (cells: string[]) => cells.map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i]!))).join('').trimEnd();
  return [fmt(header), ...rows.map(fmt)];
}

export function showIpInterfaceBrief(device: Device, env: CliEnv): string[] {
  return table(
    ['Interface', 'IP-Address', 'Status', 'Protocol'],
    ifaceRows(device, env).map((r) => [r.name, r.address, r.status, r.protocol]),
  );
}

function showArp(device: Device, env: CliEnv): string[] {
  const arp = env.state?.arp;
  if (!arp) return ['% ARP table is only available while the simulation runs (action mode)'];
  if (arp.length === 0) return ['(ARP table is empty)'];
  return table(
    ['Address', 'Hardware Addr', 'Interface'],
    arp.map((e) => [e.ip, e.mac.toLowerCase(), cliIfaceName(device, e.iface)]),
  );
}

function showNat(env: CliEnv): string[] {
  const nat = env.state?.nat;
  if (!nat) return ['% NAT table is only available while the simulation runs (action mode)'];
  if (nat.length === 0) return ['(no active translations)'];
  return table(
    ['Pro', 'Inside local', 'Inside global', 'Type'],
    nat.map((e) => [e.protocol, `${e.inside}:${e.insidePort}`, `${e.outside}:${e.outsidePort}`, e.forwarded ? 'static' : 'dynamic']),
  );
}

function showMacTable(device: Device, env: CliEnv): string[] {
  const table_ = env.state?.macTable;
  if (!table_) return ['% MAC table is only available while the simulation runs (action mode)'];
  const rows = table_.map((e) => [String(e.vlan), e.mac.toLowerCase(), 'DYNAMIC', cliIfaceName(device, e.port)]);
  return [...table(['Vlan', 'Mac Address', 'Type', 'Ports'], rows), `Total Mac Addresses: ${rows.length}`];
}

export function vlansOf(device: Device): number[] {
  const set = new Set<number>([1]);
  for (const p of device.interfaces) if (!p.trunk) set.add(p.vlan ?? 1);
  for (const v of device.vlanNames ?? []) set.add(v.vlan);
  for (const s of device.svis ?? []) set.add(s.vlan);
  return [...set].sort((a, b) => a - b);
}

function vlanName(device: Device, vlan: number): string {
  return device.vlanNames?.find((v) => v.vlan === vlan)?.name ?? (vlan === 1 ? 'default' : `VLAN${String(vlan).padStart(4, '0')}`);
}

function showVlanBrief(device: Device): string[] {
  const rows = vlansOf(device).map((vlan) => [
    String(vlan),
    vlanName(device, vlan),
    'active',
    device.interfaces
      .filter((p) => !p.trunk && (p.vlan ?? 1) === vlan)
      .map((p) => cliIfaceName(device, p.index))
      .join(', '),
  ]);
  const trunks = device.interfaces.filter((p) => p.trunk).map((p) => cliIfaceName(device, p.index));
  return [...table(['VLAN', 'Name', 'Status', 'Ports'], rows), ...(trunks.length ? ['', `Trunk ports (all VLANs): ${trunks.join(', ')}`] : [])];
}

function showInterfacesStatus(device: Device, env: CliEnv): string[] {
  const rows = device.interfaces.map((p) => {
    const up = linkUpAt(env.topology, { device: device.id, iface: p.index });
    const status = p.shutdown ? 'disabled' : up ? 'connected' : 'notconnect';
    return [cliIfaceName(device, p.index), p.description ?? '', status, p.trunk ? 'trunk' : String(p.vlan ?? 1)];
  });
  return table(['Port', 'Name', 'Status', 'Vlan'], rows);
}

function showSpanningTree(device: Device, env: CliEnv): string[] {
  if (!device.stp) return ['Spanning tree is disabled. Enable it with "spanning-tree" in configuration mode.'];
  const stp = env.state?.stp;
  if (!stp) return ['% Spanning tree state is only available while the simulation runs (action mode)'];
  const isRoot = stp.rootId === stp.bridgeId;
  return [
    `Root ID     ${stp.rootId}${isRoot ? '  (this bridge is the root)' : ''}`,
    `Root cost   ${stp.rootCost}`,
    `Root port   ${stp.rootPort === null ? '-' : cliIfaceName(device, stp.rootPort)}`,
    `Bridge ID   ${stp.bridgeId}`,
    '',
    ...table(
      ['Interface', 'Role', 'State'],
      stp.ports.map((p) => [cliIfaceName(device, p.port), p.role, p.state]),
    ),
  ];
}

// --- running-config ------------------------------------------------------------

export function runningConfig(device: Device): string[] {
  const lines = ['!', '! Netzwerk-Simulator – running configuration', '!', `hostname ${hostname(device)}`];
  const cli = device.cli;
  for (const u of cli?.users ?? []) lines.push(`username ${u.name} password ${u.password}`);
  if (cli?.enableSecret) lines.push(`enable secret ${cli.enableSecret}`);
  if (cli?.banner) lines.push(`banner motd ${cli.banner}`);
  if (device.type === 'l3switch') lines.push(device.ipRouting === false ? 'no ip routing' : 'ip routing');
  if (device.type === 'switch' || device.type === 'l3switch') {
    if (device.stp) {
      lines.push('spanning-tree');
      if (device.stpPriority !== undefined) lines.push(`spanning-tree priority ${device.stpPriority}`);
    }
    for (const v of device.vlanNames ?? []) lines.push('!', `vlan ${v.vlan}`, ` name ${v.name}`);
  }
  lines.push('!');
  for (const p of device.interfaces) {
    lines.push(`interface ${cliIfaceName(device, p.index)}`);
    if (p.description) lines.push(` description ${p.description}`);
    if (usesPortNames(device)) {
      if (p.trunk) lines.push(' switchport mode trunk');
      else if (p.vlan && p.vlan !== 1) lines.push(' switchport mode access', ` switchport access vlan ${p.vlan}`);
    } else {
      if (p.ip && p.mask) lines.push(` ip address ${p.ip}/${parseMask(p.mask)}`);
      if (p.dhcpRelay) lines.push(` ip helper-address ${p.dhcpRelay}`);
      if (p.nat) lines.push(' ip nat outside');
    }
    if (p.shutdown) lines.push(' shutdown');
    lines.push('!');
  }
  for (const s of device.subinterfaces ?? []) {
    lines.push(`interface eth${s.parent}.${s.vlan}`, ` encapsulation dot1q ${s.vlan}`);
    if (s.ip && s.mask) lines.push(` ip address ${s.ip}/${parseMask(s.mask)}`);
    if (s.dhcpRelay) lines.push(` ip helper-address ${s.dhcpRelay}`);
    lines.push('!');
  }
  for (const s of device.svis ?? []) {
    lines.push(`interface vlan${s.vlan}`);
    if (s.ip && s.mask) lines.push(` ip address ${s.ip}/${parseMask(s.mask)}`);
    if (s.dhcpRelay) lines.push(` ip helper-address ${s.dhcpRelay}`);
    lines.push('!');
  }
  for (const r of device.routes ?? []) {
    const prefix = parseMask(r.mask);
    const via = r.gateway ?? (r.iface !== undefined ? cliIfaceName(device, r.iface) : '');
    lines.push(`ip route ${r.network}/${prefix} ${via}`);
  }
  if (device.routes?.length) lines.push('!');
  lines.push('line vty', cli?.ssh ? ' transport input ssh' : ' transport input none');
  if (cli?.users?.length) lines.push(' login local');
  lines.push('!', 'end');
  return lines;
}

/** Netzinfo für Bereiche im Dokumentationsmodus: Netz, Broadcast, nutzbare Hosts. */
export function networkInfo(cidr: string): { network: string; broadcast: string; first: string; last: string; hosts: number; mask: string } | null {
  const parsed = parseAddress(cidr);
  if (!parsed) return null;
  const ip = parseIp(parsed.ip)!;
  const prefix = parseMask(parsed.mask)!;
  const net = networkOf(ip, prefix);
  const size = 2 ** (32 - prefix);
  const broadcast = (net + size - 1) >>> 0;
  const hosts = prefix >= 31 ? size : size - 2;
  return {
    network: prefixText(ip, prefix),
    broadcast: formatIp(broadcast),
    first: formatIp(prefix >= 31 ? net : net + 1),
    last: formatIp(prefix >= 31 ? broadcast : broadcast - 1),
    hosts,
    mask: maskToText(prefix),
  };
}
