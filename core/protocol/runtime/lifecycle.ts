/** Lifecycle ownership comes from each execution's pinned workflow and object binding, never from a second store. */
import type { ExecutionSnapshot, JsonValue, ObjectRef, Workflow } from '../types.ts';
import type { ContentRegistry } from './contents.ts';

const isMap = (value: JsonValue | undefined): value is Readonly<Record<string, JsonValue>> =>
 typeof value === 'object' && value !== null && !Array.isArray(value);

/** Read the declared entry path, which need not have the same name as the input. An unknown reserves no slot. */
export function lifecycleObject(workflow: Workflow | undefined, bindings: Readonly<Record<string, JsonValue>>): ObjectRef | undefined {
 const name = workflow?.lifecycle_of?.binding, source = name && workflow?.inputs[name]?.binding;
 const entry = typeof source === 'string' && source.startsWith('entry.') ? source.slice('entry.'.length) : undefined;
 const value = entry ? bindings[entry] : undefined;
 return isMap(value) && typeof value.type === 'string' && value.type === workflow?.subject && typeof value.id === 'string'
  ? { type: value.type, id: value.id, ...(typeof value.revision === 'string' ? { revision: value.revision } : {}) } : undefined;
}

/** Match type and ID across object revisions. An ended owner still blocks a new lifecycle until successors exist. */
export function lifecycleOwner(contents: ContentRegistry, object: ObjectRef, executions: Iterable<ExecutionSnapshot>): ExecutionSnapshot | undefined {
 let ended: ExecutionSnapshot | undefined;
 for (const execution of executions) {
  const workflow = contents.resolve(execution.content)?.document.workflows.find(w => w.id === execution.workflow);
  const subject = lifecycleObject(workflow, execution.bindings);
  if (subject?.type !== object.type || subject.id !== object.id) continue;
  if (!execution.ended) return execution;
  ended ??= execution;
 }
 return ended;
}
