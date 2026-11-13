import { analyzeSelection, type SelectionAnalysis, type SelectionSpec } from './analyze.ts';

// Bound retained edits in long-lived Studio workers. The byte budget counts UTF-16 JSON,
// not the engine's object overhead; the entry limit bounds that overhead separately.
const MAX_ENTRIES = 512, MAX_BYTES = 8 * 1024 * 1024;
const cache = new Map<string, { result: SelectionAnalysis; bytes: number }>();
let bytes = 0;
const freeze = <T>(value: T): T => {
 if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
 return value;
};

/** Reuse only byte-identical, validated JSON table inputs. Nothing is saved to disk. */
export function analyzeSelectionCached(spec: SelectionSpec): SelectionAnalysis {
 let reusable = true;
 const key = JSON.stringify(spec, (_name, value) => {
  // JSON loses signed zero and non-finite numbers. Preserve their exact fresh witnesses.
  if (typeof value === 'number' && (Object.is(value, -0) || !Number.isFinite(value))) reusable = false;
  return value;
 });
 const found = reusable ? cache.get(key) : undefined;
 if (found) {
  cache.delete(key); cache.set(key, found);
  return found.result;
 }
 // Witness values can refer to caller-owned parameters. Detach before freezing them.
 const result = freeze(structuredClone(analyzeSelection(spec)));
 const size = 2 * (key.length + JSON.stringify(result).length);
 if (reusable && size <= MAX_BYTES) {
  while (cache.size >= MAX_ENTRIES || bytes + size > MAX_BYTES) {
   const oldest = cache.keys().next().value!;
   bytes -= cache.get(oldest)!.bytes;
   cache.delete(oldest);
  }
  cache.set(key, { result, bytes: size }); bytes += size;
 }
 return result;
}
