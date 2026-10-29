import type { ModemKind } from '../model/types';
import type { AccessTech, LinkControl } from './frames';

/**
 * Aufbau der Zugangsleitung zwischen Modem (Kundenseite, «cpe») und Provider,
 * wie ihn die jeweilige Norm beschreibt – stark verkürzt, aber in der
 * richtigen Reihenfolge und mit den richtigen Namen:
 *
 *  - Kabel (DOCSIS 3.1): Kanalbeschreibung, Ranging, DHCP/TFTP für das Modem, Registrierung
 *  - Glasfaser (GPON, ITU-T G.984): PLOAM-Seriennummer, ONU-ID, Ranging, OMCI-Konfiguration
 *  - ADSL2+/VDSL2: G.994.1-Handshake, Training, «Showtime», dann PPPoE und PPP
 *  - Mobilfunk (LTE): RRC-Verbindung, Attach, Authentisierung (AKA), Security Mode, Bearer
 *
 * Zeiten sind gerafft (echte DSL-Synchronisation dauert 30–90 s).
 */
export interface AccessStep {
  from: 'cpe' | 'provider';
  tech: LinkControl['tech'];
  message: string;
  /** Feldnamen sind Schlüssel (die Oberfläche übersetzt sie), Werte technische Angaben. */
  fields?: Record<string, string | number>;
  /** Wartezeit vor dieser Meldung in ms (z.B. Training). */
  delay?: number;
}

export interface AccessProfile {
  /** Technik im Rahmenkopf für Nutzdaten nach dem Aufbau. */
  data: AccessTech;
  /** Name der Technik für die Anzeige. */
  standard: string;
  downstream: number;
  upstream: number;
  steps: AccessStep[];
}

const docsis: AccessStep[] = [
  { from: 'provider', tech: 'docsis', message: 'MDD', fields: { downstreamChannels: '32 × SC-QAM + 1 × OFDM', primaryChannel: '474 MHz' } },
  { from: 'provider', tech: 'docsis', message: 'UCD', fields: { upstreamChannel: 1, frequency: '38 MHz', modulation: '64-QAM' } },
  { from: 'cpe', tech: 'docsis', message: 'RNG-REQ', fields: { sid: 0, downstreamChannel: 1 }, delay: 50 },
  { from: 'provider', tech: 'docsis', message: 'RNG-RSP', fields: { timingAdjust: '+1.2 µs', powerAdjust: '+3 dB', status: 'success' } },
  { from: 'cpe', tech: 'docsis', message: 'DHCPDISCOVER (CM)' },
  { from: 'provider', tech: 'docsis', message: 'DHCPOFFER (CM)', fields: { address: '10.200.0.17', tftpServer: '10.200.0.1', configFile: 'cm-1000M.cfg' } },
  { from: 'cpe', tech: 'docsis', message: 'DHCPREQUEST (CM)' },
  { from: 'provider', tech: 'docsis', message: 'DHCPACK (CM)' },
  { from: 'cpe', tech: 'docsis', message: 'TFTP RRQ', fields: { file: 'cm-1000M.cfg' } },
  { from: 'provider', tech: 'docsis', message: 'TFTP DATA', fields: { maxDownstream: '1000 Mbit/s', maxUpstream: '100 Mbit/s' } },
  { from: 'cpe', tech: 'docsis', message: 'REG-REQ-MP' },
  { from: 'provider', tech: 'docsis', message: 'REG-RSP-MP', fields: { serviceFlows: 'down 1, up 1', status: 'okay' } },
  { from: 'cpe', tech: 'docsis', message: 'REG-ACK' },
];

const gpon: AccessStep[] = [
  { from: 'provider', tech: 'gpon', message: 'PLOAM Upstream_Overhead', fields: { wavelength: '1490 nm ↓ / 1310 nm ↑' } },
  { from: 'cpe', tech: 'gpon', message: 'PLOAM Serial_Number_ONU', fields: { serialNumber: 'SMBS0A1B2C3D' }, delay: 20 },
  { from: 'provider', tech: 'gpon', message: 'PLOAM Assign_ONU-ID', fields: { onuId: 7 } },
  { from: 'provider', tech: 'gpon', message: 'PLOAM Ranging_Time', fields: { equalizationDelay: '42 µs', distance: '3.1 km' }, delay: 5 },
  { from: 'provider', tech: 'gpon', message: 'PLOAM Assign_Alloc-ID', fields: { allocId: 1031 } },
  { from: 'provider', tech: 'gpon', message: 'OMCI MIB Reset' },
  { from: 'cpe', tech: 'gpon', message: 'OMCI MIB Reset Response' },
  { from: 'provider', tech: 'gpon', message: 'OMCI Create GEM Port', fields: { gemPort: 1031, vlan: 'internet' } },
  { from: 'cpe', tech: 'gpon', message: 'OMCI Create GEM Port Response' },
];

function dsl(standard: 'ADSL2+' | 'VDSL2', down: number, up: number): AccessStep[] {
  const profile = standard === 'ADSL2+' ? 'G.992.5 Annex B' : 'G.993.2 Profil 17a, Vectoring';
  return [
    { from: 'cpe', tech: 'dsl', message: 'G.hs CLR', fields: { standard: 'G.994.1', capabilities: 'ADSL2+, VDSL2' } },
    { from: 'provider', tech: 'dsl', message: 'G.hs CL', fields: { offer: standard } },
    { from: 'cpe', tech: 'dsl', message: 'G.hs MS', fields: { selected: profile } },
    { from: 'provider', tech: 'dsl', message: 'G.hs ACK' },
    { from: 'provider', tech: 'dsl', message: 'Training', fields: { phase: 'channel discovery, SNR measurement' }, delay: 200 },
    { from: 'provider', tech: 'dsl', message: 'Showtime', fields: { downstream: `${down} Mbit/s`, upstream: `${up} Mbit/s`, snrMargin: '9 dB' }, delay: 800 },
    { from: 'cpe', tech: 'pppoe', message: 'PADI', fields: { serviceName: 'internet' } },
    { from: 'provider', tech: 'pppoe', message: 'PADO', fields: { acName: 'BRAS-ZH-01' } },
    { from: 'cpe', tech: 'pppoe', message: 'PADR' },
    { from: 'provider', tech: 'pppoe', message: 'PADS', fields: { sessionId: '0x1a2b' } },
    { from: 'cpe', tech: 'pppoe', message: 'PPP LCP Configure-Request', fields: { mru: 1492 } },
    { from: 'provider', tech: 'pppoe', message: 'PPP LCP Configure-Ack' },
    { from: 'provider', tech: 'pppoe', message: 'PPP LCP Configure-Request', fields: { mru: 1492, authentication: 'PAP' } },
    { from: 'cpe', tech: 'pppoe', message: 'PPP LCP Configure-Ack' },
    { from: 'cpe', tech: 'pppoe', message: 'PPP PAP Authenticate-Request', fields: { user: 'kunde@provider.ch' } },
    { from: 'provider', tech: 'pppoe', message: 'PPP PAP Authenticate-Ack' },
  ];
}

const lte: AccessStep[] = [
  { from: 'cpe', tech: 'lte', message: 'RRC Connection Request', fields: { cause: 'mo-Data' } },
  { from: 'provider', tech: 'lte', message: 'RRC Connection Setup' },
  { from: 'cpe', tech: 'lte', message: 'RRC Setup Complete + Attach Request', fields: { imsi: '228 01 0123456789', apn: 'internet' } },
  { from: 'provider', tech: 'lte', message: 'Authentication Request', fields: { rand: '3f9a…', autn: 'c27d…' } },
  { from: 'cpe', tech: 'lte', message: 'Authentication Response', fields: { res: '8e1b…' } },
  { from: 'provider', tech: 'lte', message: 'Security Mode Command', fields: { ciphering: '128-EEA2 (AES)', integrity: '128-EIA2' } },
  { from: 'cpe', tech: 'lte', message: 'Security Mode Complete' },
  { from: 'provider', tech: 'lte', message: 'Attach Accept + Default EPS Bearer', fields: { apn: 'internet', qci: 9 } },
  { from: 'cpe', tech: 'lte', message: 'Attach Complete' },
];

export const ACCESS_PROFILES: Record<ModemKind, AccessProfile> = {
  cable: { data: 'docsis', standard: 'DOCSIS 3.1', downstream: 1000, upstream: 100, steps: docsis },
  fiber: { data: 'gpon', standard: 'GPON (G.984)', downstream: 1000, upstream: 1000, steps: gpon },
  adsl: { data: 'adsl', standard: 'ADSL2+', downstream: 16, upstream: 1, steps: dsl('ADSL2+', 16, 1) },
  vdsl: { data: 'vdsl', standard: 'VDSL2 17a', downstream: 100, upstream: 40, steps: dsl('VDSL2', 100, 40) },
  mobile: { data: 'lte', standard: 'LTE (4G)', downstream: 150, upstream: 50, steps: lte },
};

/** Index der Meldung in der Abfolge (für die Antwort der Gegenseite). */
export function stepIndex(kind: ModemKind, message: LinkControl, from: AccessStep['from']): number {
  return ACCESS_PROFILES[kind].steps.findIndex((s) => s.from === from && s.tech === message.tech && s.message === message.message);
}

/** Folgeschritte einer Seite ab `index`, bis die andere Seite an der Reihe ist. */
export function nextSteps(kind: ModemKind, index: number, side: AccessStep['from']): AccessStep[] {
  const steps = ACCESS_PROFILES[kind].steps;
  const result: AccessStep[] = [];
  for (let i = index; i < steps.length && steps[i]!.from === side; i++) result.push(steps[i]!);
  return result;
}
