// Formular für Aufgaben: Lehrpersonen wählen Prüfbausteine aus einer Liste
// und füllen nur deren Felder aus, statt JSON zu schreiben.

import { readTasks, type Check, type TaskSet } from '../core';
import { t } from '../i18n';

export type FieldKind = 'device' | 'devices' | 'text' | 'number' | 'deviceType' | 'protocol' | 'choice';

export interface FieldSpec {
  key: string;
  kind: FieldKind;
  optional?: boolean;
  /** Abweichende Beschriftung (Schlüssel unter taskForm.field.), sonst `key`. */
  label?: string;
  /** Auswahl für `choice` (Werte, wie sie in der Datei stehen). */
  options?: readonly string[];
}

export const CHECK_FIELDS: Record<Check['type'], FieldSpec[]> = {
  deviceCount: [
    { key: 'deviceType', kind: 'deviceType', optional: true },
    { key: 'min', kind: 'number', optional: true },
    { key: 'max', kind: 'number', optional: true },
  ],
  connected: [
    { key: 'a', kind: 'device' },
    { key: 'b', kind: 'device' },
  ],
  inNetwork: [
    { key: 'device', kind: 'device' },
    { key: 'network', kind: 'text' },
  ],
  sameNetwork: [{ key: 'devices', kind: 'devices' }],
  differentNetworks: [{ key: 'devices', kind: 'devices' }],
  gateway: [
    { key: 'device', kind: 'device' },
    { key: 'gateway', kind: 'text', optional: true },
  ],
  ping: [
    { key: 'from', kind: 'device' },
    { key: 'to', kind: 'device', label: 'pingTo' },
  ],
  noPing: [
    { key: 'from', kind: 'device' },
    { key: 'to', kind: 'device', label: 'pingTo' },
  ],
  http: [
    { key: 'from', kind: 'device' },
    { key: 'url', kind: 'text' },
    { key: 'status', kind: 'number', optional: true },
  ],
  dhcpLease: [{ key: 'device', kind: 'device' }],
  mail: [
    { key: 'from', kind: 'device', label: 'mailFrom' },
    { key: 'to', kind: 'text', label: 'mailTo' },
  ],
  packetSeen: [
    { key: 'protocol', kind: 'protocol' },
    { key: 'from', kind: 'device', optional: true, label: 'fromOptional' },
    { key: 'to', kind: 'device', optional: true, label: 'toOptional' },
  ],
  routeLearned: [
    { key: 'device', kind: 'device' },
    { key: 'network', kind: 'text' },
    { key: 'protocol', kind: 'choice', optional: true, label: 'routingProtocol', options: ['ospf', 'rip', 'bgp'] },
  ],
  neighbors: [
    { key: 'device', kind: 'device' },
    { key: 'protocol', kind: 'choice', label: 'routingProtocol', options: ['ospf', 'bgp'] },
    { key: 'min', kind: 'number', optional: true },
  ],
  noStorm: [],
  modemOnline: [{ key: 'device', kind: 'device' }],
  groupLeases: [
    { key: 'device', kind: 'device' },
    { key: 'min', kind: 'number', optional: true },
  ],
  budget: [{ key: 'max', kind: 'number', label: 'budgetMax' }],
  linkUp: [
    { key: 'a', kind: 'device' },
    { key: 'b', kind: 'device' },
    { key: 'medium', kind: 'choice', optional: true, options: ['tp', 'fiber', 'wireless', 'serial', 'coax', 'dsl', 'cellular'] },
  ],
  vlanDocumented: [{ key: 'vlan', kind: 'number' }],
};

/** Protokollnamen, wie sie die Paketliste zeigt. */
export const PROTOCOLS = ['ARP', 'ICMP', 'DHCP', 'DNS', 'TCP', 'HTTP', 'SMTP', 'POP3', 'IMAP', 'SSH', 'STP', 'OSPF', 'RIP', 'BGP', 'PPP', '802.11'];

export interface GoalDraft {
  id: string;
  text: string;
  hint: string;
  type: Check['type'];
  fields: Record<string, string>;
}

export interface TaskDraft {
  title: string;
  description: string;
  goals: GoalDraft[];
}

export type DraftError = { goal?: number; field: string; code: 'required' | 'notANumber' | 'noGoals' };

export function toDraft(tasks: TaskSet): TaskDraft {
  return {
    title: tasks.title,
    description: tasks.description ?? '',
    goals: tasks.goals.map((goal) => {
      const fields: Record<string, string> = {};
      for (const [key, value] of Object.entries(goal.check)) {
        if (key !== 'type') fields[key] = Array.isArray(value) ? value.join(', ') : String(value);
      }
      return { id: goal.id, text: goal.text, hint: goal.hint ?? '', type: goal.check.type, fields };
    }),
  };
}

export function emptyGoal(draft: TaskDraft, type: Check['type'] = 'ping'): GoalDraft {
  const ids = new Set(draft.goals.map((g) => g.id));
  let n = draft.goals.length + 1;
  while (ids.has(`ziel-${n}`)) n++;
  return { id: `ziel-${n}`, text: '', hint: '', type, fields: {} };
}

/** Vorschlag für den Lernziel-Text aus den Feldern, z.B. «PC 1 erreicht PC 2 per Ping.» */
export function suggestedText(goal: GoalDraft): string {
  const params: Record<string, string> = {};
  for (const spec of CHECK_FIELDS[goal.type]) params[spec.key] = goal.fields[spec.key]?.trim() || '…';
  return t(`taskForm.text.${goal.type}`, params);
}

/** Wandelt das Formular in eine Aufgabe; leere Lernziel-Texte werden durch den Vorschlag ersetzt. */
export function fromDraft(draft: TaskDraft): { ok: true; tasks: TaskSet } | { ok: false; error: DraftError } {
  if (!draft.title.trim()) return { ok: false, error: { field: 'title', code: 'required' } };
  if (draft.goals.length === 0) return { ok: false, error: { field: 'goals', code: 'noGoals' } };
  const goals: unknown[] = [];
  for (const [i, goal] of draft.goals.entries()) {
    const check: Record<string, unknown> = { type: goal.type };
    for (const spec of CHECK_FIELDS[goal.type]) {
      const value = goal.fields[spec.key]?.trim() ?? '';
      if (!value) {
        if (spec.optional) continue;
        return { ok: false, error: { goal: i, field: spec.key, code: 'required' } };
      }
      if (spec.kind === 'number') {
        if (!/^\d+$/.test(value)) return { ok: false, error: { goal: i, field: spec.key, code: 'notANumber' } };
        check[spec.key] = Number(value);
      } else if (spec.kind === 'devices') {
        check[spec.key] = value.split(',').map((s) => s.trim()).filter(Boolean);
      } else {
        check[spec.key] = value;
      }
    }
    goals.push({
      id: goal.id,
      text: goal.text.trim() || suggestedText(goal),
      check,
      ...(goal.hint.trim() ? { hint: goal.hint.trim() } : {}),
    });
  }
  const raw = { title: draft.title.trim(), ...(draft.description.trim() ? { description: draft.description.trim() } : {}), goals };
  // Letzte Sicherung: dieselbe Prüfung wie beim Öffnen einer Datei.
  return {
    ok: true,
    tasks: readTasks(raw, (path) => {
      throw new Error(path);
    }),
  };
}
