/** Display grace only. Core's due times and timers do not change. */
export function dueStatus(due: string, now = new Date().toISOString()): 'future' | 'now' | 'overdue' {
  const elapsed = Date.parse(now) - Date.parse(due);
  return elapsed > 5 * 60 * 1000 ? 'overdue' : elapsed >= 0 ? 'now' : 'future';
}

type Line = { key: string; label: string; value: string };

/** Keep authoring metadata out of the clinician view. Keep the source values unchanged. */
export function clinicalContext(lines: Line[], secondMedicine?: unknown): Line[] {
  const noSecondMedicine = secondMedicine === 'none';
  return lines.filter(c => c.key !== 'printed_line' && !(noSecondMedicine && ['second_dose', 'second_frequency'].includes(c.key)));
}

/** Only these effect-free retention rules have no care change to explain. */
export function clinicalDecisions<T extends { table: string; rule: string; hasEffects?: boolean }>(decisions: T[]): T[] {
  return decisions.filter(d => d.hasEffects !== false || !(
    (d.table === 'retain_completion' && d.rule === 'finish_work') ||
    (d.table === 'stop_on_execution_end' && d.rule === 'retain_independent_work')
  ));
}
