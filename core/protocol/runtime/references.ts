import { REFERENCE_KINDS } from '../contracts.ts';

export const OBJECT_REFERENCE_FIELDS: readonly string[] = [...REFERENCE_KINDS.object.required, ...REFERENCE_KINDS.object.optional];

/** Only identity and declared reference metadata travel on an object reference. */
export function objectReferenceShapeError(ref: Readonly<Record<string, unknown>>): string | undefined {
 const extra = Object.keys(ref).find(key => !OBJECT_REFERENCE_FIELDS.includes(key));
 if (extra !== undefined) return `object reference ${ref.type}:${ref.id} has undeclared field ${extra}; allowed fields: ${OBJECT_REFERENCE_FIELDS.join(', ')}`;
 if (ref.revision !== undefined && typeof ref.revision !== 'string') return `object reference ${ref.type}:${ref.id} revision must be text`;
 return undefined;
}

/** Check nested references, including lists and untyped captured data. Known envelopes are containers, not references. */
export function objectReferencesProblem(value: unknown, path: string, containers: ReadonlySet<string> = new Set()): string | undefined {
 if (typeof value !== 'object' || value === null) return undefined;
 if (!Array.isArray(value) && !containers.has(path)) {
  const ref = value as Record<string, unknown>;
  if (typeof ref.type === 'string' && typeof ref.id === 'string') {
   const error = objectReferenceShapeError(ref);
   if (error) return `${path}: ${error}`;
  }
 }
 for (const [key, child] of Object.entries(value)) {
  const error = objectReferencesProblem(child, `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`, containers);
  if (error) return error;
 }
 return undefined;
}
