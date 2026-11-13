/**
 * The contents available to one harness. Content must be prepared under its own catalog and give exactly the identity
 * it claims; unrecognized objects are checked on deployment. A revision is immutable, so a second document
 * under an available protocol revision is refused. Deployment only makes content available to new launches; it changes
 * no execution, work or due. Each execution and work policy resolves its definitions by its exact pinned ContentRef.
 * Source: the resolved v1 contract, "Identity and scope" and "Shared serialized forms".
 */
import type { ComparisonReport, ContentRef, DeployReport, JsonPointer, JsonValue, PreparedProtocol } from '../types.ts';
import { isPreparedProtocol, prepareProtocol } from '../validate.ts';
import { sameJson } from './events.ts';

const isMap = (v: unknown): v is Readonly<Record<string, JsonValue>> => typeof v === 'object' && v !== null && !Array.isArray(v);
const label = (c: ContentRef) => `${c.protocol}@${c.revision}`;
const pointer = (at: JsonPointer, key: string | number) => `${at}/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`;
function check(protocol: PreparedProtocol): ReturnType<typeof prepareProtocol> {
 return isPreparedProtocol(protocol) ? { ok: true, protocol } : prepareProtocol(protocol.document, protocol.catalog);
}

export class ContentRegistry {
 readonly #available: PreparedProtocol[] = [];

 /** Make checked, immutable content available. Unrecognized objects are re-prepared before use. */
 deploy(protocol: PreparedProtocol): DeployReport {
  const refuse = (reason: string): DeployReport => ({ outcome: 'refused', reason });
  let checked: ReturnType<typeof prepareProtocol>;
  try { checked = check(protocol); }
  catch (error) { return refuse(`the content cannot be checked: ${(error as Error).message}`); }
  if (!checked.ok) return refuse(`the document does not prepare: ${checked.diagnostics.map(d => d.reason).join(', ') || 'no effective identity'}`);
  const content = checked.protocol.content;
  if (!sameJson(content, protocol.content)) return refuse(`the claimed content ${label(protocol.content)} is not the identity computed from its document`);
  const same = this.#available.find(p => p.content.protocol === content.protocol && p.content.revision === content.revision);
  if (same) return same.content.identity === content.identity ? { outcome: 'already_available', content: same.content }
   : refuse(`revision ${label(content)} is already available with other content`);
  this.#available.push(checked.protocol);
  return { outcome: 'deployed', content };
 }

 /** The content with exactly this protocol, revision and identity, or undefined. Never a newer or nearby revision. */
 resolve(ref: ContentRef | undefined): PreparedProtocol | undefined {
  return ref === undefined ? undefined : this.#available.find(p => sameJson(p.content, ref));
 }

 /** The available contents, in deployment order. */
 list(): readonly PreparedProtocol[] { return [...this.#available]; }

 /** A read-only view of the differences between two available contents, by JSON Pointer into the documents. */
 compare(from: ContentRef, to: ContentRef): ComparisonReport {
  const a = this.resolve(from), b = this.resolve(to);
  if (!a || !b) return { refused: `${!a ? label(from) : label(to)} is not an available content` };
  const changes: { at: JsonPointer; from?: JsonValue; to?: JsonValue }[] = [];
  const walk = (x: JsonValue | undefined, y: JsonValue | undefined, at: JsonPointer) => {
   if (sameJson(x, y)) return;
   if (Array.isArray(x) && Array.isArray(y)) {
    for (let i = 0; i < Math.max(x.length, y.length); i++) walk(x[i], y[i], pointer(at, i));
    return;
   }
   if (isMap(x) && isMap(y)) {
    for (const k of [...new Set([...Object.keys(x), ...Object.keys(y)])].sort()) walk(x[k], y[k], pointer(at, k));
    return;
   }
   changes.push({ at, ...(x !== undefined ? { from: structuredClone(x) } : {}), ...(y !== undefined ? { to: structuredClone(y) } : {}) });
  };
  walk(a.document as unknown as JsonValue, b.document as unknown as JsonValue, '');
  return { from: a.content, to: b.content, changes: changes.sort((p, q) => p.at < q.at ? -1 : p.at > q.at ? 1 : 0) };
 }
}
