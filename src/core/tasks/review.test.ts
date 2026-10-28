import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseProject } from '../io/project';
import { reviewCsv, reviewSubmission } from './review';

const file = (name: string) => readFileSync(join(__dirname, '../../../docs/aufgaben', name), 'utf8');
const start = file('zwei-subnetze.json');
const solution = file('zwei-subnetze-loesung.json');
const parsed = parseProject(start);
const tasks = parsed.ok ? parsed.tasks! : null;

describe('Abgaben auswerten', () => {
  it('prüft Abgaben gegen die Aufgabe und überspringt selbst ausgelöste Ziele', () => {
    const good = reviewSubmission('anna.json', solution, tasks);
    const empty = reviewSubmission('ben.json', start, tasks);
    expect(good).toMatchObject({ ok: true, passed: 8, assessable: 8 });
    expect(empty).toMatchObject({ ok: true, passed: 0, assessable: 8 });
    expect(good.ok && good.marks.at(-1)).toEqual({ id: 'selbst-gepingt', passed: false, skipped: true });
  });

  it('nimmt ohne geladene Aufgabe die aus der Datei', () => {
    expect(reviewSubmission('anna.json', solution, null)).toMatchObject({ ok: true, ownTasks: true, passed: 8 });
  });

  it('meldet kaputte Dateien und solche ohne Aufgabe', () => {
    expect(reviewSubmission('x.json', '{kaputt', tasks)).toMatchObject({ ok: false, error: { code: 'invalidJson' } });
    const plain = readFileSync(join(__dirname, '../../../docs/beispiele/zwei-subnetze.json'), 'utf8');
    expect(reviewSubmission('y.json', plain, null)).toMatchObject({ ok: false, error: { code: 'noTasks' } });
  });

  it('erzeugt eine CSV-Tabelle für Excel', () => {
    const reviews = [reviewSubmission('anna.json', solution, tasks), reviewSubmission('x.json', '{', tasks)];
    const csv = reviewCsv(tasks!, reviews, { file: 'Datei', score: 'Punkte', error: 'Fehler' });
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toMatch(/^"Datei";"Punkte";"PC 1 ist mit Router 1 verkabelt\."/);
    expect(lines[1]).toBe('"anna.json";"8/8";1;1;1;1;1;1;1;1;–');
    expect(lines[2]).toBe('"x.json";"Fehler"');
  });
});
