// Request-flow data for the architecture visualisation (Task 01 output, Task 02 input).
// Plain TypeScript types plus a small structural checker, so the files can be checked with Node's
// built-in type stripping (`node architecture-viz/flows/verify.ts`) and no dependencies.
// Every node points at real code: `symbol` must appear in `file` within 3 lines of `line`.

export const NODE_KINDS = [
  'ui-event',
  'browser',
  'next-route',
  'server-action',
  'api-client',
  'http',
  'middleware',
  'route-handler',
  'service',
  'repository',
  'db-table',
  'external-api',
  'response',
  'render',
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const LANES = ['browser', 'next-server', 'express', 'mysql', 'openai'] as const;
export type Lane = (typeof LANES)[number];

export const DB_OPERATIONS = ['SELECT', 'INSERT', 'UPDATE'] as const;
export type DbOperation = (typeof DB_OPERATIONS)[number];

export interface FlowNode {
  id: string;
  kind: NodeKind;
  /** Short display label. */
  label: string;
  /** Repository-relative path. */
  file: string;
  /** The exact function, component, constant, route expression, or (for db-table) table name. */
  symbol: string;
  /** 1-based line where `symbol` appears (verified within ±3). */
  line: number;
  /** One line: what this step does. */
  does: string;
  lane: Lane;
  /** db-table only. */
  table?: string;
  operation?: DbOperation;
  /** True when this step writes AI observability data (ai_* trace tables). */
  observability?: boolean;
  /** When set, the code stops here (fails closed) if this step fails; the text says what happens. */
  failClosed?: string;
  /** The access-scope rule is applied at this step. */
  scopeRule?: string;
  /** Who acts at this step, for flows with more than one persona (one of Flow.personas). */
  persona?: string;
}

export interface FlowEdge {
  from: string;
  to: string;
  /** Step number; an edge can repeat a pair at a later step (for example the second model call). */
  order: number;
  /** The call, query, or HTTP request (method and path). */
  label: string;
  /** What moves along the edge, using contract.ts schema names where they exist. */
  payload: string;
  async: boolean;
}

export interface FlowAlternative {
  id: string;
  label: string;
  /** Node where the branch leaves the main path. */
  at: string;
  condition: string;
  /** Nodes the branch passes through (all must exist in `nodes`). */
  via: string[];
  result: string;
}

export interface Flow {
  /** F1, F2, F3, … */
  id: string;
  title: string;
  actor: string;
  /** Set when the thread has more than one actor; every node then names its persona. */
  personas?: string[];
  trigger: string;
  /** Repository commit the flow was traced against. */
  traceBase: string;
  /** For F2: the real trace read through the Admin UI to confirm step order. */
  evidence?: { traceId: string; source: string; observedSteps: string[]; note: string };
  nodes: FlowNode[];
  edges: FlowEdge[];
  alternatives: FlowAlternative[];
  notes?: string[];
}

/** Structural problems in a flow (empty when valid). Code locations are checked by verify.ts. */
export function structuralProblems(flow: Flow): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  if (!/^F\d+$/.test(flow.id)) problems.push(`flow id ${flow.id} must look like F1`);
  for (const node of flow.nodes) {
    if (ids.has(node.id)) problems.push(`duplicate node id ${node.id}`);
    ids.add(node.id);
    if (!(NODE_KINDS as readonly string[]).includes(node.kind)) problems.push(`${node.id}: unknown kind ${node.kind}`);
    if (!(LANES as readonly string[]).includes(node.lane)) problems.push(`${node.id}: unknown lane ${node.lane}`);
    for (const key of ['label', 'file', 'symbol', 'does'] as const) {
      if (typeof node[key] !== 'string' || node[key].trim() === '') problems.push(`${node.id}: missing ${key}`);
    }
    if (!Number.isInteger(node.line) || node.line < 1) problems.push(`${node.id}: bad line`);
    if (flow.personas) {
      if (!node.persona || !flow.personas.includes(node.persona)) problems.push(`${node.id}: persona must be one of ${flow.personas.join(', ')}`);
    } else if (node.persona !== undefined) {
      problems.push(`${node.id}: persona set but the flow declares no personas`);
    }
    if (node.kind === 'db-table') {
      if (!node.table) problems.push(`${node.id}: db-table needs table`);
      if (!node.operation || !(DB_OPERATIONS as readonly string[]).includes(node.operation)) problems.push(`${node.id}: db-table needs operation`);
      if (node.lane !== 'mysql') problems.push(`${node.id}: db-table must be in the mysql lane`);
    } else if (node.table !== undefined || node.operation !== undefined) {
      problems.push(`${node.id}: table/operation only on db-table`);
    }
  }
  if (flow.nodes.length < 15 || flow.nodes.length > 35) problems.push(`node count ${flow.nodes.length} is outside 15–35`);
  for (const edge of flow.edges) {
    if (!ids.has(edge.from)) problems.push(`edge ${edge.order}: unknown from ${edge.from}`);
    if (!ids.has(edge.to)) problems.push(`edge ${edge.order}: unknown to ${edge.to}`);
    if (!Number.isInteger(edge.order) || edge.order < 1) problems.push(`edge ${edge.from}->${edge.to}: bad order`);
    if (!edge.label || !edge.payload) problems.push(`edge ${edge.order}: missing label or payload`);
    if (typeof edge.async !== 'boolean') problems.push(`edge ${edge.order}: async must be boolean`);
  }
  const orders = flow.edges.map((e) => e.order);
  if (new Set(orders).size !== orders.length) problems.push('edge orders must be unique');
  const sorted = [...orders].sort((a, b) => a - b);
  sorted.forEach((order, i) => {
    if (order !== i + 1) problems.push(`edge orders must run 1..${orders.length} without gaps (found ${order} at position ${i + 1})`);
  });
  const used = new Set(flow.edges.flatMap((e) => [e.from, e.to]));
  for (const id of ids) if (!used.has(id)) problems.push(`node ${id} is not on any edge`);
  if (flow.alternatives.length > 3) problems.push('at most 3 alternatives');
  for (const alt of flow.alternatives) {
    if (!ids.has(alt.at)) problems.push(`alternative ${alt.id}: unknown at ${alt.at}`);
    for (const via of alt.via) if (!ids.has(via)) problems.push(`alternative ${alt.id}: unknown via ${via}`);
  }
  return problems;
}
