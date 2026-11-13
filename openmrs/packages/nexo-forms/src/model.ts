/**
 * Read-only indexes over one Nexo document and its catalog: which templates a person completes, which tables read
 * their results, and what each table input reads. Nothing here decides care.
 */
import type { ProtocolDocument } from '../../../../core/protocol/types.ts';
import type { CatalogExtension } from '../../../../core/protocol/contracts.ts';

export type NexoType =
  | { type: 'yes_no' } | { type: 'listed'; values: string[] } | { type: 'quantity'; unit?: string }
  | { type: 'instant' } | { type: 'date' } | { type: 'datetime' } | { type: 'time' } | { type: 'text' } | { type: 'identifier' }
  | { type: 'reference'; target: string } | { type: 'list'; items: NexoType } | { type: string; [k: string]: unknown };

export interface FieldDecl { type: NexoType; optional?: boolean; role?: string }
export interface ObjectContract { fields: Record<string, FieldDecl> }
export interface Template {
  id: string; title: string; performer?: { role: string }; completion?: { evidence?: string };
  content?: Record<string, FieldDecl>; result?: Record<string, FieldDecl>;
}
export interface InputDecl { type?: NexoType; binding: unknown; required?: string }
export interface Rule { id: string; rank?: number; in: string[]; when: string; effects?: any[]; to?: any; evidence?: string[]; sops?: string[] }
export interface Table { id: string; purpose?: string; on: { event: string; work?: string; table?: string; for?: unknown }; inputs?: Record<string, InputDecl>; rules: Rule[]; calculations?: Record<string, any> }
export interface Workflow { id: string; initial: string; states: unknown[]; inputs: Record<string, InputDecl>; calculations?: Record<string, any>; tables: Table[] }

export class ProtocolModel {
  readonly templates: Record<string, Template>;
  readonly objects: Record<string, ObjectContract>;
  readonly events: Record<string, { payload: Record<string, FieldDecl> }>;
  readonly workflows: Workflow[];
  /** Work handle or template name → the templates it can name. */
  readonly handles = new Map<string, Set<string>>();

  constructor(readonly document: ProtocolDocument, readonly catalog: CatalogExtension) {
    const defs = (document as any).definitions ?? {};
    this.templates = Object.fromEntries(Object.entries(defs.work_templates ?? {}).map(([id, t]) => [id, { id, ...(t as object) } as Template]));
    this.objects = ((catalog as any).objects ?? {}) as Record<string, ObjectContract>;
    this.events = ((catalog as any).events ?? {}) as Record<string, { payload: Record<string, FieldDecl> }>;
    this.workflows = (document as any).workflows as Workflow[];
    for (const id of Object.keys(this.templates)) this.addHandle(id, id);
    walk(document, node => {
      if (node && typeof node === 'object' && (node as any).kind === 'task' && typeof (node as any).task === 'string') {
        const as = (node as any).as;
        const handle = typeof as === 'string' ? as : as && typeof as === 'object' ? as.handle : undefined;
        if (handle) this.addHandle(handle, (node as any).task);
      }
    });
  }

  private addHandle(handle: string, template: string) {
    if (!this.handles.has(handle)) this.handles.set(handle, new Set());
    this.handles.get(handle)!.add(template);
  }

  /** Templates a person completes: some rule creates the task, and its performer role is a document role. */
  personTemplates(): Template[] {
    const roles = Object.keys((this.document as any).roles ?? {});
    const created = new Set<string>();
    walk((this.document as any).workflows, n => { if (n && typeof n === 'object' && (n as any).kind === 'task' && typeof (n as any).task === 'string') created.add((n as any).task); });
    walk((this.document as any).definitions?.tables, n => { if (n && typeof n === 'object' && (n as any).kind === 'task' && typeof (n as any).task === 'string') created.add((n as any).task); });
    return Object.values(this.templates).filter(t => created.has(t.id) && t.performer?.role && roles.includes(t.performer.role));
  }

  /** Every table, with the workflow that holds it. Shared definition tables have no workflow. */
  *tables(): Generator<{ table: Table; workflow?: Workflow }> {
    for (const w of this.workflows) for (const t of w.tables) yield { table: t, workflow: w };
    for (const t of Object.values(((this.document as any).definitions?.tables ?? {}) as Record<string, Table>)) yield { table: t };
  }

  /** Tables that hear the completion of `template`. */
  consumers(template: string): { table: Table; workflow?: Workflow }[] {
    const out: { table: Table; workflow?: Workflow }[] = [];
    for (const x of this.tables()) {
      const on = x.table.on;
      if (on.event !== 'task.completed' || !on.work) continue;
      if (this.handles.get(on.work)?.has(template)) out.push(x);
    }
    return out;
  }

  /** Tables that hear a host event type, such as `measurement.recorded`. */
  listeners(event: string): { table: Table; workflow?: Workflow }[] {
    return [...this.tables()].filter(x => x.table.on.event === event);
  }

  /** The content and result declaration of every template that a handle can name. */
  handleTemplates(handle: string): Template[] {
    return [...(this.handles.get(handle) ?? [])].map(t => this.templates[t]).filter(Boolean);
  }
}

export function walk(node: unknown, visit: (n: unknown) => void) {
  visit(node);
  if (Array.isArray(node)) for (const x of node) walk(x, visit);
  else if (node && typeof node === 'object') for (const x of Object.values(node)) walk(x, visit);
}

export const objectTarget = (t: NexoType | undefined): string | undefined =>
  t && t.type === 'reference' && typeof (t as any).target === 'string' && (t as any).target.startsWith('object:')
    ? (t as any).target.slice('object:'.length) : undefined;
