/**
 * The forms name CIEL concepts by mapping. These tests run the host and the install against a fake OpenMRS server
 * whose dictionary holds CIEL concepts under its own UUIDs, as the PIH EMR does.
 */
import { describe, expect, test } from 'bun:test';
import bundleJson from '../../../protocols/rwanda-htn/build/protocol.json';
import bindingJson from '../../../protocols/rwanda-htn/build/binding.json';
import cielJson from '../../../protocols/rwanda-htn/build/ciel.json';
import hints from '../../../protocols/rwanda-htn/forms.hints.json';
import { bindToServer, installCiel, mappingsOf, type CielConcept, type Rest } from './dictionary.ts';
import { NexoHost, readAnswers, type Binding, type FormBinding, type O3Encounter } from './host.ts';
import { prepareBundle, type LogEntry, type ProtocolBundle } from './session.ts';

const prepared = prepareBundle(bundleJson as unknown as ProtocolBundle);
const binding = bindingJson as unknown as Binding;
const ciel = (cielJson as { concepts: CielConcept[] }).concepts;

interface Concept { uuid: string; name: string; datatype: string; maps: { code: string; type: string }[]; retired?: boolean }

/**
 * Enough of the OpenMRS REST API for the dictionary: the concept reference lookup (getConceptByMapping, which fails
 * when two concepts map one code), concepts, reference terms and mappings. It records each call that changes data.
 */
class FakeServer {
  concepts: Concept[] = [];
  terms = new Map<string, string>();
  writes: string[] = [];

  /** A concept under the server's own UUID, mapped SAME-AS to a CIEL code, as on the PIH EMR. */
  own(code: string, uuid = `pih-${code}`, datatype = 'N/A') {
    this.concepts.push({ uuid, name: `PIH concept ${code}`, datatype, maps: [{ code, type: 'SAME-AS' }] });
    return this;
  }

  rest: Rest = async (method, path, body: any) => {
    const [route, query = ''] = path.split('?');
    const params = new URLSearchParams(query);
    const results = (list: unknown[]) => ({ status: 200, body: { results: list } });
    if (method === 'GET' && route === '/conceptreferences') {
      const out: Record<string, unknown> = {};
      for (const ref of params.get('references')!.split(',')) {
        const [source, code] = ref.split(':');
        const hits = source === 'CIEL' ? this.concepts.filter(c => c.maps.some(m => m.code === code)) : [];
        if (hits.length > 1) return { status: 500, body: { error: { message: `Multiple non-retired concepts found for mapping ${ref}` } } };
        if (hits[0]) out[ref] = { uuid: hits[0].uuid, display: hits[0].name, datatype: { name: hits[0].datatype } };
      }
      return { status: 200, body: out };
    }
    if (method === 'GET' && route === '/concept' && params.get('source') === 'CIEL') {
      // getConceptsByMapping: every concept with a mapping to the code. It does not fail on two.
      return results(this.concepts.filter(c => c.maps.some(m => m.code === params.get('code'))).map(c => ({ uuid: c.uuid })));
    }
    if (method === 'GET' && route === '/conceptsource') return results([{ uuid: 'source-ciel', name: 'CIEL' }]);
    if (method === 'GET' && route === '/conceptmaptype') return results([{ uuid: 'map-same-as', name: 'SAME-AS' }, { uuid: 'map-narrower', name: 'NARROWER-THAN' }]);
    if (method === 'GET' && route === '/conceptdatatype') return results(['N/A', 'Coded', 'Numeric', 'Text'].map(name => ({ uuid: `dt-${name}`, name })));
    if (method === 'GET' && route === '/conceptclass') return results(['Misc', 'Finding', 'Question', 'Drug', 'Diagnosis', 'Test'].map(name => ({ uuid: `cc-${name}`, name })));
    if (method === 'POST' && route === '/conceptreferenceterm') {
      if (this.terms.has(body.code)) return { status: 400, body: { error: { message: 'duplicate code' } } };
      this.terms.set(body.code, `term-${body.code}`);
      return { status: 201, body: { uuid: `term-${body.code}` } };
    }
    if (method === 'GET' && route === '/conceptreferenceterm') {
      const code = params.get('codeOrName')!;
      return results(this.terms.has(code) ? [{ uuid: this.terms.get(code), code }] : []);
    }
    const one = /^\/concept\/([^/]+)(\/mapping)?$/.exec(route);
    if (one) {
      const c = this.concepts.find(x => x.uuid === one[1]);
      if (!c) return { status: 404, body: { error: { message: 'not found' } } };
      if (method === 'GET' && !one[2]) return { status: 200, body: { uuid: c.uuid, display: c.name, retired: !!c.retired } };
      if (method === 'POST' && one[2]) {
        this.writes.push(`map ${c.uuid}`);
        c.maps.push({ code: body.conceptReferenceTerm.replace('term-', ''), type: body.conceptMapType === 'map-same-as' ? 'SAME-AS' : 'other' });
        return { status: 201, body: {} };
      }
    }
    if (method === 'POST' && route === '/concept') {
      const name = body.names[0].name;
      if (this.concepts.some(c => c.name === name)) return { status: 400, body: { error: { message: `Invalid Submission: duplicate name ${name}` } } };
      this.writes.push(`create ${body.uuid}`);
      this.concepts.push({ uuid: body.uuid, name, datatype: body.datatype.replace('dt-', ''), maps: (body.mappings ?? []).map((m: any) => ({ code: m.conceptReferenceTerm.replace('term-', ''), type: 'SAME-AS' })) });
      return { status: 201, body: { uuid: body.uuid } };
    }
    return { status: 404, body: { error: { message: `${method} ${path} is not in the fake server` } } };
  };
}

/** A server that holds every CIEL concept of the forms under its own UUIDs. */
const pihLike = () => { const s = new FakeServer(); for (const c of ciel) s.own(c.code); return s; };

describe('the host reads the server\'s own concepts', () => {
  test('the binding names 16 CIEL concepts by mapping, and the host resolves them to the server\'s UUIDs', async () => {
    const mappings = mappingsOf(binding);
    expect(mappings).toEqual(ciel.map(c => `CIEL:${c.code}`).sort());
    const resolved = await bindToServer(binding, pihLike().rest);
    const reading = resolved.forms.find(f => f.name === 'event_measurement_recorded')!;
    expect(reading.questions.find(q => q.id === 'reading__systolic')!.concept).toBe('pih-5085');
    const pregnant = reading.questions.find(q => q.id === 'reading__encounter__pregnant')!;
    expect(pregnant.answers).toMatchObject({ yes: 'pih-1065', no: 'pih-1066' });
    expect(pregnant.unknownAnswer).toBe('pih-1067');
    // A local Nexo concept keeps its UUID.
    const setting = reading.questions.find(q => q.id === 'reading__setting')!;
    expect(setting.concept).toBe(binding.forms.find(f => f.name === 'event_measurement_recorded')!.questions.find(q => q.id === 'reading__setting')!.concept);
    expect(mappingsOf(resolved)).toEqual([]);
  });

  test('a server that lacks a CIEL concept stops the load, naming it', async () => {
    const server = pihLike();
    server.concepts = server.concepts.filter(c => !c.maps.some(m => m.code === '77985'));
    await expect(bindToServer(binding, server.rest)).rejects.toThrow('The server has no concept for CIEL:77985. Run scripts/install-ciel.ts on it.');
  });

  test('a saved encounter reads back through the server\'s UUIDs, and the pathway goes on', async () => {
    const host = new NexoHost(prepared, await bindToServer(binding, pihLike().rest), hints.labels);
    const patient = { id: 'patient-on-pih', birth_date: '1978-05-10', sex: 'male' as const };
    const log: LogEntry[] = [];
    const s = () => host.session(patient, log, log.at(-1)?.event.received_at ?? '2026-11-03T07:00:00Z');
    const start = host.starts(s()).find(o => o.workflow === 'htn_screening_assessment')!;
    // What the form engine saves on this server: obs under the server's concepts, coded values as its concept objects.
    const answers: Record<string, string | number> = { reading__systolic: 150, reading__diastolic: 95, reading__setting: 'office', reading__encounter__hypertension_symptoms: 'no',
      reading__encounter__organ_damage_evidence: 'no', reading__encounter__pregnant: 'no', reading__encounter__diabetes: 'no', reading__encounter__coronary_artery_disease: 'no',
      reading__encounter__chronic_kidney_disease: 'no', reading__encounter__care_level: 'health_center' };
    const saved = encounter(start.form, answers, '2026-11-03T07:00:00.000+0000');
    expect(saved.obs!.find(o => o.formFieldPath === 'rfe-forms-reading__systolic')!.concept).toEqual({ uuid: 'pih-5085' });
    const read = readAnswers(start.form, saved);
    expect(read.get('reading__encounter__pregnant')).toBe('no');
    expect(read.get('reading__systolic')).toEqual({ value: 150, unit: 'mm[Hg]' });
    log.push({ ...host.entryFor(s(), start.form, saved, { start }), seq: 0 } as LogEntry);
    expect(host.tasks(s()).map(t => t.work.template)).toContain('repeat_office_visit');
    // A prefill names the server's answer, which the form engine shows as chosen.
    const next = host.forms.get('event_measurement_recorded')!;
    expect(host.prefill(s(), next).reading__encounter__diabetes).toBe('pih-1066');
  });
});

/** The O3 encounter that the form engine saves for these answers (by Nexo word or number). */
function encounter(form: FormBinding, answers: Record<string, string | number>, at: string): O3Encounter {
  const obs = Object.entries(answers).map(([id, v]) => {
    const q = form.questions.find(q => q.id === id)!;
    const value = typeof v === 'string' && q.answers?.[v] ? { uuid: q.answers[v], display: v } : v;
    return { concept: { uuid: q.concept }, value, formFieldPath: `rfe-forms-${id}` };
  });
  return { uuid: `enc-${id++}`, encounterDatetime: at, obs };
}
let id = 0;

describe('install-ciel maps to the server\'s dictionary and never duplicates it', () => {
  const only = (...codes: string[]) => ciel.filter(c => codes.includes(c.code));
  const cielUuid = (code: string) => ciel.find(c => c.code === code)!.uuid;

  test('a code the server already maps under its own UUID: nothing is created or mapped', async () => {
    const server = new FakeServer().own('1065').own('5085', 'pih-5085', 'Numeric');
    const done = await installCiel(server.rest, only('1065', '5085'));
    expect(done.map(d => [d.code, d.action, d.uuid])).toEqual([['5085', 'have', 'pih-5085'], ['1065', 'have', 'pih-1065']]);
    expect(server.writes).toEqual([]);
  });

  test('after the PIH trial: a code mapped by the server and an unmapped copy under the CIEL UUID get no second mapping', async () => {
    const server = new FakeServer().own('1065');
    server.concepts.push({ uuid: cielUuid('1065'), name: 'Yes (CIEL 1065)', datatype: 'N/A', maps: [] });
    const done = await installCiel(server.rest, only('1065'));
    expect(done[0]).toMatchObject({ action: 'have', uuid: 'pih-1065' });
    expect(server.writes).toEqual([]);
    expect((await server.rest('GET', '/conceptreferences?references=CIEL%3A1065&v=custom:(uuid)')).status).toBe(200);
  });

  test('an unmapped code: an existing concept under the CIEL UUID gets the mapping, otherwise a new concept is made', async () => {
    const server = new FakeServer();
    server.concepts.push({ uuid: cielUuid('1066'), name: 'No', datatype: 'N/A', maps: [] });
    server.concepts.push({ uuid: 'local-yes', name: 'Yes', datatype: 'N/A', maps: [] });
    const done = await installCiel(server.rest, only('1065', '1066', '77985'));
    expect(done.map(d => [d.code, d.action, d.name])).toEqual([
      ['1065', 'created', 'Yes (CIEL 1065)'],
      ['1066', 'mapped', 'No'],
      ['77985', 'created', 'Indapamide'],
    ]);
    expect(server.writes).toEqual([`create ${cielUuid('1065')}`, `map ${cielUuid('1066')}`, `create ${cielUuid('77985')}`]);
    // A second run changes nothing.
    server.writes = [];
    expect((await installCiel(server.rest, only('1065', '1066', '77985'))).map(d => d.action)).toEqual(['have', 'have', 'have']);
    expect(server.writes).toEqual([]);
  });

  test('a code that the server already maps to two concepts stops the install before any change', async () => {
    // 5085 comes first and is missing: it is not created, because the lookup of 1065 fails first.
    const server = new FakeServer().own('1065').own('1065', 'other-yes');
    await expect(installCiel(server.rest, only('5085', '1065'))).rejects.toThrow(
      'CIEL:1065: 2 concepts map to this code on the server (pih-1065, other-yes), but the lookup that the forms use does not resolve it (The server could not look up CIEL:1065 (HTTP 500).');
    expect(server.writes).toEqual([]);
  });

  test('a retired concept under the CIEL UUID of an unmapped code stops the install before any change', async () => {
    const server = new FakeServer();
    server.concepts.push({ uuid: cielUuid('1066'), name: 'No', datatype: 'N/A', maps: [], retired: true });
    await expect(installCiel(server.rest, only('1065', '1066'))).rejects.toThrow(`CIEL:1066: no concept maps to this code, and the concept with its CIEL UUID ${cielUuid('1066')} is retired.`);
    expect(server.writes).toEqual([]);
  });

  test('a concept that the server accepts but does not resolve afterwards fails the install', async () => {
    const server = new FakeServer();
    const rest = server.rest;
    // A server that drops the mapping of a new concept.
    server.rest = async (method, path, body: any) => rest(method, path, method === 'POST' && path === '/concept' ? { ...body, mappings: [] } : body);
    await expect(installCiel(server.rest, only('1065'))).rejects.toThrow('After the install, the server still does not resolve CIEL:1065.');
  });

  test('a datatype that differs from the forms is reported, not changed', async () => {
    const server = new FakeServer().own('5085', 'pih-5085', 'Text');
    const [done] = await installCiel(server.rest, only('5085'));
    expect(done.warning).toBe("the server's concept is Text; the forms expect Numeric");
    expect(server.writes).toEqual([]);
  });
});
