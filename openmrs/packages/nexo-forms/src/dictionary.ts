/**
 * The server's concept dictionary. The forms, the binding and the Initializer files name a CIEL concept by its mapping,
 * `CIEL:<code>`, because each server holds CIEL concepts under its own UUIDs: the PIH EMR holds most of them under PIH
 * UUIDs, with a SAME-AS mapping to CIEL. The form engine and Initializer resolve a mapping on the server. The host
 * resolves the same mappings once, when it loads the binding, so that it reads and prefills the server's own concepts.
 * A local Nexo concept is named by its UUID, which is the same on every server.
 *
 * Browser-safe: no Node import. The server is reached through a `Rest` function that the caller supplies.
 */
import type { Binding } from './host.ts';

/** A concept reference that each server resolves itself, such as "CIEL:5085". A local concept is a UUID. */
export const isMapping = (reference: string) => reference.includes(':');

/** A call to the OpenMRS REST API: a path under `/ws/rest/v1`, an optional JSON body, the status and the parsed body. */
export type Rest = (method: 'GET' | 'POST', path: string, body?: unknown) => Promise<{ status: number; body: any }>;

/** The mappings a binding names (question concepts, answers, "Not known" answers), sorted. */
export function mappingsOf(binding: Binding): string[] {
  const out = new Set<string>();
  for (const f of binding.forms) for (const q of f.questions)
    for (const ref of [q.concept, ...Object.values(q.answers ?? {}), q.unknownAnswer]) if (ref && isMapping(ref)) out.add(ref);
  return [...out].sort();
}

/**
 * The server's concept for each mapping, by the lookup that the form engine uses (`/conceptreferences`, which calls
 * `ConceptService.getConceptByMapping`). A mapping the server does not resolve is absent. The lookup fails when the
 * server maps one code to two concepts; that is a dictionary error to fix on the server, so this throws.
 */
export async function lookUp(rest: Rest, mappings: readonly string[], fields = 'uuid'): Promise<Map<string, any>> {
  const out = new Map<string, any>();
  if (!mappings.length) return out;
  const { status, body } = await rest('GET', `/conceptreferences?references=${mappings.map(encodeURIComponent).join(',')}&v=custom:(${fields})`);
  if (status >= 300) throw new Error(`The server could not look up ${mappings.join(', ')} (HTTP ${status}). A code that maps to two concepts makes the lookup fail.`);
  for (const m of mappings) if (body?.[m]?.uuid) out.set(m, body[m]);
  return out;
}

/**
 * The binding with each mapping replaced by the UUID of the server's concept. It throws when the server lacks a concept,
 * naming each missing mapping: the forms need it too (run scripts/install-ciel.ts).
 */
export async function bindToServer(binding: Binding, rest: Rest): Promise<Binding> {
  const mappings = mappingsOf(binding);
  const found = await lookUp(rest, mappings);
  const missing = mappings.filter(m => !found.has(m));
  if (missing.length) throw new Error(`The server has no concept for ${missing.join(', ')}. Run scripts/install-ciel.ts on it.`);
  const uuid = (ref: string) => (isMapping(ref) ? found.get(ref)!.uuid as string : ref);
  return {
    ...binding,
    forms: binding.forms.map(f => ({
      ...f,
      questions: f.questions.map(q => ({
        ...q, concept: uuid(q.concept),
        ...(q.answers ? { answers: Object.fromEntries(Object.entries(q.answers).map(([v, ref]) => [v, uuid(ref)])) } : {}),
        ...(q.unknownAnswer ? { unknownAnswer: uuid(q.unknownAnswer) } : {}),
      })),
    })),
  };
}

/** One CIEL concept that the forms use, as `build/ciel.json` lists it. */
export interface CielConcept { uuid: string; code: string; name: string; datatype: string; conceptClass: string; units?: string; used_as?: string }

/** What the install did for one CIEL concept. */
export interface Installed {
  code: string;
  /** "have": a concept on the server already maps to the code, and nothing changed. "mapped": the code was unmapped,
   * and a concept with the CIEL UUID got the SAME-AS mapping. "created": a new concept with the mapping. */
  action: 'have' | 'mapped' | 'created';
  uuid: string;
  name: string;
  /** A difference to check by hand, such as another datatype on the server. Nothing is changed for it. */
  warning?: string;
}

/**
 * Make each CIEL concept resolvable on the server, without a second concept or a second mapping for a code.
 *
 * First, before any change, it asks the server which concepts map to each code (`GET /concept?source=CIEL&code=`,
 * which lists every concept with a mapping to the code and never fails on two).
 * - When a concept maps to the code, it changes nothing: the forms use that concept. The lookup that the forms and
 *   Initializer use must resolve the code; when it fails (two concepts map the code), the install stops.
 * - Otherwise, when a concept has the CIEL UUID (for example from an earlier install), it gets the SAME-AS mapping.
 * - Otherwise it creates the concept with the CIEL UUID and the SAME-AS mapping. A name that a local concept already
 *   uses gets the suffix "(CIEL <code>)".
 *
 * It never adds a mapping to a code that a concept on the server maps already: a second SAME-AS mapping makes every
 * lookup of that code fail, and Initializer files on the server use those lookups. At the end it checks that every
 * code resolves.
 */
export async function installCiel(rest: Rest, concepts: readonly CielConcept[]): Promise<Installed[]> {
  const list = async (path: string) => ((await rest('GET', path)).body?.results ?? []) as any[];
  const source = (await list('/conceptsource?q=CIEL&v=custom:(uuid,name)')).find(s => s.name === 'CIEL');
  const sameAs = (await list('/conceptmaptype?v=custom:(uuid,name)&limit=50')).find(t => t.name === 'SAME-AS');
  let datatypes: Map<string, string> | undefined, classes: Map<string, string> | undefined;
  const byName = async (resource: string) => new Map((await list(`/${resource}?v=custom:(uuid,name)&limit=100`)).map(x => [x.name as string, x.uuid as string]));

  /** The CIEL reference term for a code, created when missing. REST finds a term by `codeOrName` with an exact match. */
  const term = async (code: string): Promise<string> => {
    const made = await rest('POST', '/conceptreferenceterm', { code, conceptSource: source.uuid });
    if (made.status < 300) return made.body.uuid;
    const found = (await list(`/conceptreferenceterm?source=${source.uuid}&codeOrName=${encodeURIComponent(code)}&searchType=equal&v=custom:(uuid,code)`))
      .find(t => t.code === code);
    if (!found) throw new Error(`CIEL:${code}: no reference term, and the server refused to create one (HTTP ${made.status}).`);
    return found.uuid;
  };

  // Read every code before any change, so that a dictionary problem stops the install with nothing changed.
  const refs = concepts.map(c => `CIEL:${c.code}`);
  const known = new Map<string, Installed>();
  /** A concept that has the CIEL UUID of an unmapped code, which the install maps instead of creating one. */
  const withUuid = new Map<string, { display: string }>();
  for (const c of concepts) {
    const ref = `CIEL:${c.code}`;
    const search = await rest('GET', `/concept?source=CIEL&code=${encodeURIComponent(c.code)}&v=custom:(uuid)`);
    if (search.status >= 300) throw new Error(`${ref}: the server could not search concepts by this code (HTTP ${search.status}). Nothing was changed.`);
    const mapping = ((search.body?.results ?? []) as { uuid: string }[]).map(x => x.uuid);
    if (!mapping.length) {
      const existing = await rest('GET', `/concept/${c.uuid}?v=custom:(uuid,display,retired)`);
      if (existing.status === 200 && existing.body?.retired)
        throw new Error(`${ref}: no concept maps to this code, and the concept with its CIEL UUID ${c.uuid} is retired. Unretire it or retire it for good by hand. Nothing was changed.`);
      if (existing.status === 200) withUuid.set(c.code, existing.body);
      continue;
    }
    let have: any, why = '';
    try { have = (await lookUp(rest, [ref], 'uuid,display,datatype:(name)')).get(ref); } catch (e) { why = ` (${(e as Error).message})`; }
    if (!have) throw new Error(`${ref}: ${mapping.length} concepts map to this code on the server (${mapping.join(', ')}), but the lookup that the forms use does not resolve it${why}. Fix the server's dictionary first. Nothing was changed.`);
    const datatype = have.datatype?.name;
    const warnings = [
      ...(mapping.length > 1 ? [`${mapping.length} concepts map to this code; the forms use ${have.uuid}`] : []),
      ...(datatype && datatype !== c.datatype ? [`the server's concept is ${datatype}; the forms expect ${c.datatype}`] : []),
    ];
    known.set(c.code, { code: c.code, action: 'have', uuid: have.uuid, name: have.display, ...(warnings.length ? { warning: warnings.join('; ') } : {}) });
  }

  const out: Installed[] = [];
  for (const c of concepts) {
    const have = known.get(c.code);
    if (have) { out.push(have); continue; }
    if (!source || !sameAs) throw new Error(`CIEL:${c.code} is not on the server, and the server has no ${source ? 'SAME-AS map type' : 'CIEL concept source'} to map it.`);
    const mapping = { conceptReferenceTerm: await term(c.code), conceptMapType: sameAs.uuid };
    const existing = withUuid.get(c.code);
    if (existing) {
      const r = await rest('POST', `/concept/${c.uuid}/mapping`, mapping);
      if (r.status >= 300) throw new Error(`CIEL:${c.code}: the mapping was refused (HTTP ${r.status}) ${JSON.stringify(r.body).slice(0, 300)}`);
      out.push({ code: c.code, action: 'mapped', uuid: c.uuid, name: existing.display });
      continue;
    }
    datatypes ??= await byName('conceptdatatype');
    classes ??= await byName('conceptclass');
    const body: Record<string, unknown> = {
      uuid: c.uuid, names: [{ name: c.name, locale: 'en', localePreferred: true, conceptNameType: 'FULLY_SPECIFIED' }],
      datatype: datatypes.get(c.datatype) ?? datatypes.get('N/A'), conceptClass: classes.get(c.conceptClass) ?? classes.get('Misc'),
      ...(c.datatype === 'Numeric' ? { units: c.units ?? '', allowDecimal: true } : {}), mappings: [mapping],
    };
    let name = c.name;
    let r = await rest('POST', '/concept', body);
    if (r.status >= 300 && /duplicate name/i.test(JSON.stringify(r.body))) {
      // A local concept already uses the CIEL name without the CIEL code. Keep it unchanged; name ours apart.
      name = `${c.name} (CIEL ${c.code})`;
      body.names = [{ name, locale: 'en', localePreferred: true, conceptNameType: 'FULLY_SPECIFIED' }, { name: c.name, locale: 'en', conceptNameType: 'SHORT' }];
      r = await rest('POST', '/concept', body);
    }
    if (r.status >= 300) throw new Error(`CIEL:${c.code} ${c.name}: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 400)}`);
    out.push({ code: c.code, action: 'created', uuid: c.uuid, name });
  }
  const found = await lookUp(rest, refs);
  const missing = refs.filter(r => !found.has(r));
  if (missing.length) throw new Error(`After the install, the server still does not resolve ${missing.join(', ')}.`);
  return out;
}
