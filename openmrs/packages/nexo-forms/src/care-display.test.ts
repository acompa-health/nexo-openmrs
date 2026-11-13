import { describe, expect, test } from 'bun:test';
import { clinicalContext, clinicalDecisions, dueStatus } from '../../esm-nexo-care-app/src/display-rules.ts';

describe('clinician display', () => {
  test('due now has five minutes before the red overdue label, including the boundary', () => {
    const due = '2026-11-10T09:00:00Z';
    expect(dueStatus(due, '2026-11-10T08:59:59Z')).toBe('future');
    expect(dueStatus(due, due)).toBe('now');
    expect(dueStatus(due, '2026-11-10T09:05:00Z')).toBe('now');
    expect(dueStatus(due, '2026-11-10T09:05:01Z')).toBe('overdue');
  });
  test('absent second medicine has no dose or frequency and authoring fields stay hidden', () => {
    const line = (key: string, value: string) => ({ key, label: key, value });
    const lines = [line('medicine', 'Amlodipine'), line('second_medicine', 'None'), line('second_dose', '5 mg'), line('second_frequency', 'Once daily'), line('printed_line', 'CCB source quotation')];
    expect(clinicalContext(lines, 'none').map(c => c.key)).toEqual(['medicine', 'second_medicine']);
    expect(clinicalContext(lines.map(c => c.key === 'second_medicine' ? { ...c, value: 'Indapamide' } : c), 'indapamide_sr').map(c => c.key)).toEqual(['medicine', 'second_medicine', 'second_dose', 'second_frequency']);
  });
  for (const [table, rule] of [
    ['retain_completion', 'finish_work'],
    ['stop_on_execution_end', 'retain_independent_work'],
  ]) {
    test(`history hides only harmless ${table}/${rule}`, () => {
      const decision = { table, rule, evidence: [], hasEffects: false };
      expect(clinicalDecisions([decision])).toEqual([]);
      expect(clinicalDecisions([{ ...decision, hasEffects: true }])).toHaveLength(1);
      expect(clinicalDecisions([{ table, rule }])).toHaveLength(1);
      expect(clinicalDecisions([{ ...decision, table: 'clinical_table' }])).toHaveLength(1);
    });
  }
  test('history keeps cancellations, unmet need and other rules in those same tables', () => {
    const decisions = [
      { table: 'stop_on_execution_end', rule: 'cancel_owned_work' },
      { table: 'record_unmet_work', rule: 'report_unmet_need' },
      { table: 'retain_completion', rule: 'clinical_warning' },
    ];
    expect(clinicalDecisions(decisions)).toEqual(decisions);
    expect(decisions).toHaveLength(3);
  });
});
