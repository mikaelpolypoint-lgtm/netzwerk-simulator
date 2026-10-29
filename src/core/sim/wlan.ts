import type { LinkControl } from './frames';

/**
 * Anmeldung eines WLAN-Clients beim Access Point nach IEEE 802.11 mit
 * WPA2-PSK (802.11i): Probe, Authentisierung (Open System), Association und
 * der 4-Way-Handshake (EAPOL-Key), der die Schlüssel aushandelt.
 * Beim Roaming heisst die Anmeldung «Reassociation».
 */
export interface WlanStep {
  from: 'sta' | 'ap';
  message: string;
  fields?: Record<string, string | number>;
}

export function wlanSteps(secured: boolean, reassociation: boolean, ssid: string): WlanStep[] {
  const assoc = reassociation ? 'Reassociation' : 'Association';
  const steps: WlanStep[] = [
    { from: 'sta', message: 'Probe Request', fields: { ssid } },
    { from: 'ap', message: 'Probe Response', fields: { ssid, security: secured ? 'WPA2-PSK (CCMP)' : 'open' } },
    { from: 'sta', message: 'Authentication', fields: { algorithm: 'Open System', seq: 1 } },
    { from: 'ap', message: 'Authentication', fields: { algorithm: 'Open System', seq: 2, status: 'success' } },
    { from: 'sta', message: `${assoc} Request`, fields: { ssid } },
    { from: 'ap', message: `${assoc} Response`, fields: { status: 'success', aid: 1 } },
  ];
  if (secured) {
    steps.push(
      { from: 'ap', message: 'EAPOL-Key 1/4', fields: { anonce: 'a3f1…' } },
      { from: 'sta', message: 'EAPOL-Key 2/4', fields: { snonce: '7c02…', mic: 'yes' } },
      { from: 'ap', message: 'EAPOL-Key 3/4', fields: { gtk: 'encrypted', mic: 'yes' } },
      { from: 'sta', message: 'EAPOL-Key 4/4', fields: { mic: 'yes' } },
    );
  }
  return steps;
}

export function wlanStepIndex(steps: WlanStep[], message: LinkControl, from: WlanStep['from']): number {
  return steps.findIndex((s) => s.from === from && s.message === message.message);
}

/** Aufeinanderfolgende Schritte derselben Seite ab `index`. */
export function wlanRun(steps: WlanStep[], index: number, side: WlanStep['from']): WlanStep[] {
  const result: WlanStep[] = [];
  for (let i = index; i < steps.length && steps[i]!.from === side; i++) result.push(steps[i]!);
  return result;
}

export const toLink = (step: WlanStep): LinkControl => ({ kind: 'link', tech: 'wlan', message: step.message, ...(step.fields ? { fields: step.fields } : {}) });
