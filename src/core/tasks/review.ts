// Auswertung von Abgaben: Lehrpersonen öffnen mehrere Projektdateien der
// Lernenden und prüfen sie gegen die Aufgabe.

import { parseProject, type ParseError } from '../io/project';
import { evaluateGoal, type GoalResult, type TaskSet } from './tasks';

/** Ergebnis je Ziel; "skipped": aus einer Datei nicht prüfbar (z.B. selbst ausgelöste Pakete). */
export type ReviewMark = (GoalResult & { skipped?: false }) | { id: string; passed: false; skipped: true };

export type SubmissionReview =
  | { ok: true; name: string; tasks: TaskSet; marks: ReviewMark[]; passed: number; assessable: number; ownTasks: boolean }
  | { ok: false; name: string; error: ParseError | { code: 'noTasks' | 'readFailed' } };

/**
 * Prüft eine Abgabe. Verwendet wird die Aufgabe der Lehrperson (`tasks`),
 * sonst die in der Datei mitgespeicherte.
 */
export function reviewSubmission(name: string, text: string, tasks: TaskSet | null): SubmissionReview {
  const parsed = parseProject(text);
  if (!parsed.ok) return { ok: false, name, error: parsed.error };
  const taskSet = tasks ?? parsed.tasks;
  if (!taskSet) return { ok: false, name, error: { code: 'noTasks' } };
  const marks: ReviewMark[] = taskSet.goals.map((goal) =>
    goal.check.type === 'packetSeen' ? { id: goal.id, passed: false, skipped: true } : evaluateGoal(parsed.topology, goal),
  );
  const assessable = marks.filter((m) => !m.skipped);
  return {
    ok: true,
    name,
    tasks: taskSet,
    marks,
    passed: assessable.filter((m) => m.passed).length,
    assessable: assessable.length,
    ownTasks: !tasks,
  };
}

/** Tabelle für Excel (Semikolon als Trennzeichen, wie in der Schweiz üblich). */
export function reviewCsv(tasks: TaskSet, reviews: SubmissionReview[], labels: { file: string; score: string; error: string }): string {
  const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const header = [labels.file, labels.score, ...tasks.goals.map((g) => g.text)].map(quote).join(';');
  const lines = reviews.map((r) => {
    if (!r.ok) return [quote(r.name), quote(labels.error)].join(';');
    const marks = tasks.goals.map((g) => {
      const mark = r.marks.find((m) => m.id === g.id);
      return mark?.skipped ? '–' : mark?.passed ? '1' : '0';
    });
    return [quote(r.name), quote(`${r.passed}/${r.assessable}`), ...marks].join(';');
  });
  return [header, ...lines].join('\r\n') + '\r\n';
}
