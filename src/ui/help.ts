/**
 * Themen der Hilfe (F1). Titel und Text stehen in den Sprachdateien unter
 * help.<thema>.title und help.<thema>.body. Im Text gilt eine kleine Auszeichnung:
 * Leerzeile = neuer Absatz, «- » = Aufzählung, **fett**, [[thema]] = Verweis.
 */
export const HELP_GROUPS: { id: string; topics: string[] }[] = [
  { id: 'start', topics: ['overview', 'modes', 'shop', 'simulation', 'shortcuts', 'features', 'tasks', 'costs'] },
  {
    id: 'devices',
    topics: [
      'device.notebook',
      'device.pc',
      'device.server',
      'device.clientgroup',
      'device.switch',
      'device.l3switch',
      'device.router',
      'device.accesspoint',
      'device.modem',
      'device.internet',
    ],
  },
  { id: 'links', topics: ['cables', 'sfp', 'serial', 'wlan', 'roaming', 'access'] },
  { id: 'addressing', topics: ['ip', 'subnetting', 'ipcalc', 'scopes', 'dhcp', 'dns'] },
  { id: 'switching', topics: ['switching', 'vlan', 'trunk', 'stp', 'routerOnAStick'] },
  { id: 'routing', topics: ['routing', 'ospf', 'rip', 'bgp'] },
  { id: 'nat', topics: ['nat', 'staticNat', 'portForward', 'cgnat'] },
  { id: 'services', topics: ['web', 'mail', 'cli', 'ssh'] },
  { id: 'analysis', topics: ['sniffer', 'osi', 'filter', 'pcap'] },
  { id: 'documentation', topics: ['areas', 'racks', 'floors', 'snapshots'] },
];

export const HELP_TOPICS = HELP_GROUPS.flatMap((g) => g.topics);

export type HelpBlock = { kind: 'p'; parts: HelpPart[] } | { kind: 'ul'; items: HelpPart[][] };
export type HelpPart = { kind: 'text'; text: string } | { kind: 'bold'; text: string } | { kind: 'link'; topic: string } | { kind: 'code'; text: string };

function inline(text: string): HelpPart[] {
  const parts: HelpPart[] = [];
  const re = /\*\*(.+?)\*\*|\[\[([\w.]+)\]\]|`([^`]+)`/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) parts.push({ kind: 'text', text: text.slice(last, m.index) });
    if (m[1] !== undefined) parts.push({ kind: 'bold', text: m[1] });
    else if (m[2] !== undefined) parts.push({ kind: 'link', topic: m[2] });
    else parts.push({ kind: 'code', text: m[3]! });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) });
  return parts;
}

/** Text in Absätze und Aufzählungen zerlegen (ohne HTML, also sicher anzuzeigen). */
export function parseHelp(body: string): HelpBlock[] {
  return body
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk): HelpBlock => {
      const lines = chunk.split('\n');
      if (lines.every((l) => l.trim().startsWith('- '))) return { kind: 'ul', items: lines.map((l) => inline(l.trim().slice(2))) };
      return { kind: 'p', parts: inline(lines.join(' ')) };
    });
}
