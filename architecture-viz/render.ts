// Renders each request flow (architecture-viz/flows/*.json) as one static, self-contained HTML
// page and a full-page PNG of it.
//
//   node architecture-viz/render.ts        (Node 22.18+ strips the types)
//
// Nothing about the flows is hard-coded here: every node, step, label, payload, and side note
// comes from the JSON. Playwright comes from next-frontend's installed dev dependencies.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { LANES, structuralProblems, type Flow, type FlowEdge, type FlowNode, type Lane } from './flows/schema.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const flowsDir = path.join(here, 'flows');
const outDir = path.join(here, 'out');

const LANE_LABELS: Record<Lane, string> = {
  browser: 'Browser',
  'next-server': 'Next server',
  express: 'Express',
  mysql: 'MySQL',
  openai: 'OpenAI',
};

const esc = (value: unknown): string =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const laneIndex = (lane: Lane): number => LANES.indexOf(lane);

/** A stable CSS class for a persona: the first one gets p-0, the second p-1, and so on. */
let personaOrder: string[] = [];
const personaClass = (persona: string): string => String(Math.max(0, personaOrder.indexOf(persona)) % 3);

/** Moving toward the browser, or arriving at a response/render step, is the way back. */
function isReturn(edge: FlowEdge, nodes: Map<string, FlowNode>): boolean {
  const from = nodes.get(edge.from)!;
  const to = nodes.get(edge.to)!;
  return laneIndex(to.lane) < laneIndex(from.lane) || to.kind === 'response' || to.kind === 'render';
}

function badges(node: FlowNode): string {
  const out: string[] = [];
  if (node.observability) out.push('<span class="badge obs">writes trace</span>');
  if (node.failClosed) out.push('<span class="badge fail">fails closed</span>');
  if (node.scopeRule) out.push('<span class="badge scope">scope rule</span>');
  return out.length ? `<div class="badges">${out.join('')}</div>` : '';
}

function nodeShape(node: FlowNode, opts: { pill: boolean; again: boolean }): string {
  const again = opts.again ? '<span class="again">again</span>' : '';
  const where = `<div class="where">${esc(node.file.replace(/^(next-frontend|express-backend)\/src\//, '$1/…/'))}:${node.line}</div>`;
  if (node.kind === 'db-table') {
    return `<div class="cyl" title="${esc(node.does)}">
      <div class="cyl-text"><span class="mono">${esc(node.table).replace(/_/g, "_<wbr>")}</span><span class="op">${esc(node.operation)}</span>${again}</div>
      ${badges(node)}
    </div>`;
  }
  if (node.kind === 'external-api') {
    return `<div class="hex" title="${esc(node.does)}">
      <svg viewBox="0 0 200 80" preserveAspectRatio="none" aria-hidden="true"><polygon points="22,2 178,2 198,40 178,78 22,78 2,40" class="hex-shape"/></svg>
      <div class="hex-text"><strong>${esc(node.label)}</strong><span class="mono">${esc(node.symbol)}</span>${again}</div>
    </div>`;
  }
  const cls = opts.pill ? 'pill' : 'card';
  const persona = node.persona ? `<div class="persona p-${personaClass(node.persona)}">${esc(node.persona)}</div>` : '';
  return `<div class="${cls} kind-${esc(node.kind)}" title="${esc(node.does)}">
    ${persona}<div class="label">${esc(node.label)}${again}</div>
    <div class="mono sym">${esc(node.symbol)}</div>
    ${where}
    ${badges(node)}
  </div>`;
}

function renderFlow(flow: Flow, file: string): string {
  personaOrder = flow.personas ?? [];
  const nodes = new Map(flow.nodes.map((n) => [n.id, n]));
  const edges = [...flow.edges].sort((a, b) => a.order - b.order);
  const first = nodes.get(edges[0].from)!;
  const lastTo = edges.at(-1)!.to;
  const seen = new Set<string>([first.id]);

  // Side notes: each alternative sits at the first step that reaches its branch node.
  const notesAt = new Map<number, typeof flow.alternatives>();
  for (const alt of flow.alternatives) {
    const step = edges.find((e) => e.to === alt.at) ?? edges.find((e) => e.from === alt.at);
    const key = step ? step.order : 0;
    notesAt.set(key, [...(notesAt.get(key) ?? []), alt]);
  }
  const altHtml = (order: number) =>
    (notesAt.get(order) ?? [])
      .map((alt) => `<aside class="alt"><div class="alt-title">Branch: ${esc(alt.label)}</div><div>If ${esc(alt.condition)}.</div><div class="alt-result">${esc(alt.result)}</div></aside>`)
      .join('');

  const stepNotes = (node: FlowNode) =>
    [node.failClosed ? `<div class="note fail-note"><b>Fails closed:</b> ${esc(node.failClosed)}</div>` : '', node.scopeRule ? `<div class="note scope-note"><b>Scope:</b> ${esc(node.scopeRule)}</div>` : '']
      .filter(Boolean)
      .join('');

  const segment = (prev: number, cur: number, dashed: boolean) => {
    const lo = Math.min(prev, cur);
    const hi = Math.max(prev, cur);
    const style = dashed ? 'dashed' : 'solid';
    // A move toward the browser is always the way back, even when the next call starts there.
    const hStyle = dashed || cur < prev ? 'dashed' : 'solid';
    const horizontal = hi > lo ? `<div class="h ${hStyle}" style="left:${lo * 20 + 10}%;width:${(hi - lo) * 20}%"></div>` : '';
    return `${horizontal}<div class="v ${style}" style="left:${cur * 20 + 10}%"></div>`;
  };

  const rows: string[] = [];
  // Row 0: the click, a pill at the top.
  rows.push(`<div class="row start">
    <div class="num"></div>
    <div class="edge"><div class="trigger">${esc(flow.trigger)}</div>${altHtml(0)}</div>
    <div class="lanes"><div class="cell" style="grid-column:${laneIndex(first.lane) + 1}">${nodeShape(first, { pill: true, again: false })}</div></div>
  </div>`);

  let prevLane = laneIndex(first.lane);
  let prevNode = first.id;
  for (const edge of edges) {
    const to = nodes.get(edge.to)!;
    const from = nodes.get(edge.from)!;
    const dashed = isReturn(edge, nodes);
    const cur = laneIndex(to.lane);
    const again = seen.has(to.id);
    seen.add(to.id);
    const who = to.persona && to.persona !== 'System' && to.persona !== from.persona ? `<div class="who p-${personaClass(to.persona)}">${esc(to.persona)}</div>` : '';
    const fromNote = (edge.from !== prevNode ? `<div class="from">from ${esc(from.label)}</div>` : '') + who;
    rows.push(`<div class="row${dashed ? ' back' : ''}">
      <div class="num"><span class="dot${dashed ? ' dot-back' : ''}">${edge.order}</span></div>
      <div class="edge">
        ${fromNote}
        <div class="elabel">${esc(edge.label)}${edge.async ? '' : ' <span class="sync">sync</span>'}</div>
        <div class="payload">${esc(edge.payload)}</div>
        ${again ? '' : stepNotes(to)}
        ${altHtml(edge.order)}
      </div>
      <div class="lanes">
        ${segment(prevLane, cur, dashed)}
        <div class="cell" style="grid-column:${cur + 1}">${nodeShape(to, { pill: edge.to === lastTo && to.kind === 'render', again })}</div>
      </div>
    </div>`);
    prevLane = cur;
    prevNode = to.id;
  }

  const laneHeads = LANES.map((lane) => `<div class="lane-head lane-${lane}">${LANE_LABELS[lane]}</div>`).join('');
  const laneBands = LANES.map((lane) => `<div class="band lane-${lane}"></div>`).join('');
  const evidence = flow.evidence
    ? `<p>Step order confirmed against trace <span class="mono">${esc(flow.evidence.traceId)}</span>. ${esc(flow.evidence.source)}</p>`
    : '';
  const notes = (flow.notes ?? []).map((n) => `<li>${esc(n)}</li>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(flow.id)}: ${esc(flow.title)}</title>
<style>
  :root {
    --ground: #f7f5f1; --ink: #18233a; --muted: #4a5467; --line: #dcd7cd; --surface: #ffffff;
    --accent: #2a57c0; --db: #8a5a00; --db-wash: #fbf4e4; --ai: #6b4fa0; --ai-wash: #f1edf8;
    --error: #b3261e; --ok: #1d6e46;
    --t-browser: #efece6; --t-next-server: #e9eef8; --t-express: #edf5f0; --t-mysql: #faf4e6; --t-openai: #f3effa;
    --sans: "Public Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: var(--ground); color: var(--ink); font-family: var(--sans); font-size: 14px; line-height: 1.45; }
  .page { max-width: 1440px; margin: 0 auto; padding: 32px 32px 40px; }
  header h1 { font-size: 26px; line-height: 1.2; margin: 0 0 6px; letter-spacing: -0.01em; }
  header p { margin: 0; color: var(--muted); font-size: 15px; max-width: 72ch; }
  .legend { display: flex; flex-wrap: wrap; gap: 6px 18px; margin: 16px 0 20px; font-size: 12px; color: var(--muted); }
  .legend span { display: inline-flex; align-items: center; gap: 6px; }
  .sw { display: inline-block; width: 22px; height: 0; border-top: 2px solid var(--ink); }
  .sw.dashed { border-top-style: dashed; border-color: var(--accent); }
  .grid { --gutter: 3rem; --edgecol: 19rem; position: relative; }
  .heads, .row { display: grid; grid-template-columns: var(--gutter) var(--edgecol) 1fr; }
  .heads .lanes { display: grid; grid-template-columns: repeat(5, 1fr); }
  .lane-head { font-size: 12px; font-weight: 600; text-transform: none; color: var(--muted); padding: 8px 10px; border-bottom: 1px solid var(--line); text-align: center; }
  .bands { position: absolute; top: 0; bottom: 0; left: calc(var(--gutter) + var(--edgecol)); right: 0; display: grid; grid-template-columns: repeat(5, 1fr); z-index: 0; }
  .band { border-left: 1px solid var(--line); }
  .band:last-child { border-right: 1px solid var(--line); }
  .lane-browser { background: var(--t-browser); } .lane-next-server { background: var(--t-next-server); } .lane-express { background: var(--t-express); }
  .lane-mysql { background: var(--t-mysql); } .lane-openai { background: var(--t-openai); }
  .lane-head.lane-browser, .lane-head.lane-next-server, .lane-head.lane-express, .lane-head.lane-mysql, .lane-head.lane-openai { background: none; }
  .row { position: relative; z-index: 1; break-inside: avoid; page-break-inside: avoid; }
  .num { position: relative; }
  .num::before { content: ""; position: absolute; left: 50%; top: 0; bottom: 0; border-left: 2px solid var(--line); }
  .row.start .num::before { top: 50%; }
  .dot { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; margin: 12px 0 0 calc(50% - 13px); border-radius: 50%; background: var(--ink); color: #fff; font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .dot-back { background: var(--surface); color: var(--accent); border: 2px dashed var(--accent); }
  .edge { padding: 12px 14px 12px 4px; border-bottom: 1px solid #ebe7df; min-width: 0; }
  .trigger { font-weight: 600; padding-top: 14px; }
  .from { font-size: 11px; color: var(--muted); margin-bottom: 2px; }
  .elabel { font-size: 13px; font-weight: 500; overflow-wrap: anywhere; }
  .sync { font-size: 10px; color: var(--muted); border: 1px solid var(--line); border-radius: 4px; padding: 0 4px; font-weight: 400; }
  .payload { font-family: var(--mono); font-size: 11px; color: var(--muted); margin-top: 3px; overflow-wrap: anywhere; }
  .note { font-size: 11.5px; margin-top: 6px; padding: 5px 8px; border-radius: 6px; }
  .fail-note { background: #fcf1f0; color: #7d1a14; border: 1px solid #e3b3ae; }
  .scope-note { background: #e6ecf8; color: var(--ink); border: 1px solid #c3d0ec; }
  .alt { margin-top: 8px; padding: 6px 9px; font-size: 11.5px; border-left: 3px solid var(--muted); background: var(--surface); border-radius: 0 6px 6px 0; color: var(--ink); }
  .alt-title { font-weight: 600; }
  .alt-result { color: var(--muted); margin-top: 2px; }
  .lanes { position: relative; display: grid; grid-template-columns: repeat(5, 1fr); align-items: center; padding: 10px 0; min-height: 76px; }
  .cell { position: relative; z-index: 2; padding: 0 8px; display: flex; justify-content: center; }
  .h { position: absolute; top: 0; height: 0; border-top: 2px solid var(--ink); z-index: 1; }
  .v { position: absolute; top: 0; bottom: 0; width: 0; border-left: 2px solid var(--ink); z-index: 1; }
  .dashed { border-color: var(--accent) !important; border-style: dashed !important; }
  .row:last-child .v { bottom: 50%; }
  .card, .pill { width: 100%; max-width: 230px; background: var(--surface); border: 1px solid #c9c3b7; border-radius: 10px; padding: 7px 10px; }
  .pill { border-radius: 999px; text-align: center; border: 2px solid var(--ink); padding: 8px 16px; }
  .pill .where { display: none; }
  .label { font-size: 12.5px; font-weight: 600; line-height: 1.3; }
  .mono { font-family: var(--mono); }
  .sym { font-size: 11px; color: var(--accent); overflow-wrap: anywhere; margin-top: 2px; }
  .where { font-size: 10px; color: var(--muted); overflow-wrap: anywhere; margin-top: 1px; }
  .persona { display: inline-block; font-size: 9.5px; font-weight: 700; letter-spacing: 0.02em; border-radius: 4px; padding: 0 5px; margin-bottom: 3px; }
  .who { display: inline-block; font-size: 10.5px; font-weight: 700; border-radius: 4px; padding: 1px 6px; margin: 2px 0 4px; }
  .p-0 { background: #e6ecf8; color: #2249a3; border: 1px solid #c3d0ec; }
  .p-1 { background: #eef7f1; color: #1d6e46; border: 1px solid #b9dcc8; }
  .p-2 { background: #ece8e0; color: #4a5467; border: 1px solid #dcd7cd; }
  .pill .persona { display: block; width: fit-content; margin: 0 auto 3px; }
  .again { margin-left: 6px; font-size: 10px; font-weight: 500; color: var(--muted); border: 1px solid var(--line); border-radius: 4px; padding: 0 4px; }
  .badges { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; justify-content: inherit; }
  .badge { font-size: 9.5px; font-weight: 600; border-radius: 4px; padding: 1px 5px; }
  .badge.obs { background: var(--db-wash); color: var(--db); border: 1px solid #e5cf9f; }
  .badge.fail { background: #fcf1f0; color: var(--error); border: 1px solid #e3b3ae; }
  .badge.scope { background: #e6ecf8; color: var(--accent); border: 1px solid #c3d0ec; }
  /* Cylinder: a fixed-height elliptical cap over a body that grows with its text. */
  .cyl { position: relative; width: 100%; max-width: 210px; margin-top: 10px; background: var(--surface); border: 2px solid var(--db); border-top: none; border-radius: 0 0 50% 50% / 0 0 12px 12px; padding: 0 0 8px; }
  .cyl::before { content: ""; position: absolute; left: -2px; right: -2px; top: -10px; height: 20px; border: 2px solid var(--db); border-radius: 50%; background: var(--db-wash); }
  .cyl-text { position: relative; padding: 16px 12px 4px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 1px; }
  .cyl-text .mono { font-size: 11.5px; font-weight: 600; color: var(--ink); overflow-wrap: anywhere; }
  .op { font-size: 10px; font-weight: 700; letter-spacing: 0.04em; color: var(--db); }
  .cyl .badges { position: relative; justify-content: center; margin-top: 4px; }
  .hex { position: relative; width: 100%; max-width: 210px; height: 80px; }
  .hex svg { position: absolute; inset: 0; width: 100%; height: 100%; }
  .hex-shape { fill: var(--ai-wash); stroke: var(--ai); stroke-width: 2; vector-effect: non-scaling-stroke; }
  .hex-text { position: relative; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 0 26px; }
  .hex-text strong { font-size: 12.5px; color: var(--ai); }
  .hex-text .mono { font-size: 10.5px; color: var(--ink); }
  footer { margin-top: 28px; padding-top: 14px; border-top: 1px solid var(--line); font-size: 12px; color: var(--muted); }
  footer ul { margin: 8px 0 0; padding-left: 18px; }
  footer li { margin: 3px 0; }
  footer p { margin: 4px 0; }
  @media print {
    html, body { background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page { padding: 12px; max-width: none; }
  }
</style>
</head>
<body>
<div class="page">
  <header>
    <h1>${esc(flow.id)}: ${esc(flow.title)}</h1>
    <p>${esc(flow.actor)}${flow.personas ? `, on one thread; each box says who acts` : ''}. ${esc(flow.nodes.length)} code steps across ${esc(new Set(flow.nodes.map((n) => n.lane)).size)} layers, in ${esc(edges.length)} numbered calls from the click to the screen. In the HTML, hover a box to read what it does.</p>
  </header>
  <div class="legend">
    <span><i class="sw"></i> request going deeper</span>
    <span><i class="sw dashed"></i> response coming back</span>
    <span><span class="badge obs">writes trace</span> AI observability write</span>
    <span><span class="badge fail">fails closed</span> stops if this step fails</span>
    <span><span class="badge scope">scope rule</span> access scope applied</span>
    <span>Cylinder: MySQL table · Hexagon: OpenAI · <span class="sync">sync</span> no await</span>
  </div>
  <div class="grid">
    <div class="bands" aria-hidden="true">${laneBands}</div>
    <div class="heads"><div></div><div class="lane-head" style="text-align:left">Call and payload</div><div class="lanes" style="padding:0;min-height:0">${laneHeads}</div></div>
    ${rows.join('\n')}
  </div>
  <footer>
    <p>Traced at ${esc(flow.traceBase)}. Generated from flows/${esc(file)}.</p>
    ${evidence}
    ${notes ? `<ul>${notes}</ul>` : ''}
  </footer>
</div>
</body>
</html>
`;
}

const files = readdirSync(flowsDir).filter((f) => /^F\d.*\.json$/.test(f)).sort();
if (files.length === 0) throw new Error('no flow files found');
mkdirSync(outDir, { recursive: true });

const pages: { html: string; png: string }[] = [];
for (const file of files) {
  const flow = JSON.parse(readFileSync(path.join(flowsDir, file), 'utf8')) as Flow;
  const problems = structuralProblems(flow);
  if (problems.length > 0) throw new Error(`${file} is not a valid flow:\n  ${problems.join('\n  ')}`);
  const html = path.join(outDir, `${flow.id}.html`);
  writeFileSync(html, renderFlow(flow, file));
  pages.push({ html, png: path.join(outDir, `${flow.id}.png`) });
  console.log(`wrote ${path.relative(process.cwd(), html)}`);
}

const playwright = (await import(pathToFileURL(path.resolve(here, '../next-frontend/node_modules/@playwright/test/index.mjs')).href)) as typeof import('@playwright/test');
const browser = await playwright.chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  for (const { html, png } of pages) {
    await page.goto(pathToFileURL(html).href);
    await page.screenshot({ path: png, fullPage: true });
    console.log(`wrote ${path.relative(process.cwd(), png)}`);
  }
} finally {
  await browser.close();
}
