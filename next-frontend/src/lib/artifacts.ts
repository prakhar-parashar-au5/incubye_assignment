import manifest from '@/artifacts/files.json';

// The Artifacts section (Admin HR only): static pages about how the system works and how it was
// built. No employee data and no backend API. The generated architecture pages are copied into
// src/artifacts/generated/ by `npm run artifacts:sync` and served by /artifacts/raw/[name].

export const ARTIFACTS_HREF = '/artifacts';
export const REPO_BLOB = 'https://github.com/prakhar-parashar-au5/incubye_assignment/blob/master/';

/** A link to a file in the GitHub repository, at master. */
export function repoHref(path: string): string {
  return `${REPO_BLOB}${path.replace(/^\/+/, '')}`;
}

/** The only file names the raw route will read. Everything else is rejected before any file access. */
export const ARTIFACT_FILES: readonly string[] = Object.freeze([...manifest.files]);

export function isArtifactFile(name: string): boolean {
  return ARTIFACT_FILES.includes(name);
}

export function rawHref(file: string): string {
  return `${ARTIFACTS_HREF}/raw/${file}`;
}

export type FlowSlug = 'employees-click' | 'assistant-tool-call' | 'salary-request';
export type Flow = { slug: FlowSlug; code: string; file: string; title: string; summary: string };

export const FLOWS: readonly Flow[] = [
  {
    slug: 'employees-click',
    code: 'F1',
    file: 'F1.html',
    title: 'Opening the employee directory',
    summary: 'Every hop when an Admin clicks Employees: browser, Next server, Express, MySQL, and back.',
  },
  {
    slug: 'assistant-tool-call',
    code: 'F2',
    file: 'F2.html',
    title: 'An assistant question with a tool call',
    summary: 'How a question reaches OpenAI, calls a tool limited to the HR user’s access, and is recorded.',
  },
  {
    slug: 'salary-request',
    code: 'F3',
    file: 'F3.html',
    title: 'A salary request and its approval',
    summary: 'A Scoped HR user requests a salary change, and Admin HR approves and applies it.',
  },
];

export function flowBySlug(slug: string): Flow | undefined {
  return FLOWS.find((flow) => flow.slug === slug);
}

export const SCHEMA_FILE = 'schema.html';

export type ArtifactGroup = 'Thinking' | 'How it works' | 'Quality and history';
export type ArtifactCard = { href: string; title: string; summary: string; label: string; group: ArtifactGroup; file?: string; pending?: boolean };

export const ARTIFACT_GROUPS: readonly ArtifactGroup[] = ['Thinking', 'How it works', 'Quality and history'];

const flowCard = (flow: Flow): ArtifactCard => ({
  href: `${ARTIFACTS_HREF}/flows/${flow.slug}`,
  title: flow.title,
  summary: flow.summary,
  label: `Request flow ${flow.code}`,
  group: 'How it works',
  file: flow.file,
});

/**
 * Overview cards, in reading order: the thinking first, then how it works, then quality and
 * history. `file` marks a card whose page embeds a generated file; `pending` marks a page whose
 * source document does not exist yet.
 */
export const ARTIFACT_CARDS: readonly ArtifactCard[] = [
  { href: `${ARTIFACTS_HREF}/requirements`, title: 'Requirements', summary: 'The one-page requirements, written before any code, and where the build later moved away from them.', label: 'Written', group: 'Thinking' },
  { href: `${ARTIFACTS_HREF}/decisions`, title: 'Decisions and trade-offs', summary: 'Thirteen decisions, each with the options considered, the reason, and the cost.', label: 'Written', group: 'Thinking' },
  { href: `${ARTIFACTS_HREF}/tech-stack`, title: 'Tech stack', summary: 'Each layer, its version, and why it was chosen, plus the main trade-offs.', label: 'Written', group: 'Thinking' },
  { href: `${ARTIFACTS_HREF}/how-it-was-built`, title: 'How it was built', summary: 'One orchestrator and several builder agents, how they were kept apart, and two worked examples.', label: 'Written', group: 'Thinking' },
  { href: `${ARTIFACTS_HREF}/specs`, title: 'Human specs and AI specs', summary: 'Which agent documents grew from each human spec, with salary adjustments as the example.', label: 'Written', group: 'Thinking' },
  { href: `${ARTIFACTS_HREF}/database`, title: 'Database schema', summary: 'Every MySQL table and foreign key, generated from the migration files.', label: 'Database', group: 'How it works', file: SCHEMA_FILE },
  ...FLOWS.map(flowCard),
  { href: `${ARTIFACTS_HREF}/ai-evaluation`, title: 'AI evaluation', summary: 'How the live assistant was tested, the two hard-gate failures found, and their fix.', label: 'Written', group: 'Quality and history' },
  { href: `${ARTIFACTS_HREF}/testing`, title: 'Testing', summary: 'Each test layer with its measured counts and run times, coverage, and five tests that matter.', label: 'Written', group: 'Quality and history' },
  { href: `${ARTIFACTS_HREF}/performance`, title: 'Performance', summary: 'Measured query times and plans on 10,000 employees, and the risks they show.', label: 'Written', group: 'Quality and history' },
  { href: `${ARTIFACTS_HREF}/evolution`, title: 'Evolution', summary: 'Every commit and merge on master, oldest first, each linked to GitHub.', label: 'Timeline', group: 'Quality and history' },
];
