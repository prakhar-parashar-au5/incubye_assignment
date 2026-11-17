# Blocker: generated flow pages fail axe colour contrast on payload text

Status: RESOLVED (2026-11-17). The planner changed `.payload` to `var(--muted)` in `architecture-viz/render.ts` and regenerated F1 to F3. After `npm run artifacts:sync`, axe finds no serious or critical issue on F1, F2 or F3 at 1440 px and 390 px. `generatedPageAxe` was removed from the spec; the pages are now scanned with `noSeriousAxe`.
Original status: CROSS_LANE_DEFECT
Task: Frontend Task 07, Artifacts section
Agent lane: Frontend builder
Worktree: /Users/admin/Desktop/Projects/incubyte_take_home_artifacts
Candidate commit: branch `feat/artifacts-section` from master `d7fb50f`, plus uncommitted Task 07 files (I ran no Git command)
Time observed: 2026-11-17

## What I was trying to do

Run the required axe check (no serious or critical findings) on the Artifacts pages, including F1 and F2 opened on their own through "Open full page" (`/artifacts/raw/F1.html`, `/artifacts/raw/F2.html`).

## What blocked me

Nothing in Task 07. The generated pages, which I copy unchanged, have one serious axe finding. Fixing it means changing `architecture-viz/render.ts`, which is not in my lane.

## Evidence

- Rule `color-contrast` (serious). F1: 32 nodes; F2: 41 nodes. Every node is `.row > .edge > .payload`.
- Colours: text `#6b7280` on ground `#f7f5f1`, 11px monospace, ratio 4.43:1. WCAG AA needs 4.5:1 for text this size.
- Source: `/Users/admin/Desktop/Projects/incubyte_take_home_arch_viz/architecture-viz/render.ts` line 199: `.payload { font-family: var(--mono); font-size: 11px; color: #6b7280; … }`.
- Reproduced with `@axe-core/playwright` 4.14.0 on the synced `next-frontend/src/artifacts/generated/F1.html` and `F2.html`, and in the Playwright run on the raw route.

## Expected

The generated pages pass axe with no serious or critical findings, like the rest of the app.

## Observed

`color-contrast` on every payload line in F1 and F2.

## What I verified

- No other serious or critical finding on either page.
- The app pages around the frame (overview, flow pages, written pages) have none.
- The repository's own muted ink, `#4a5467` (DESIGN.md `ink-muted`, also `--muted` in the generated pages), gives about 7:1 on `#f7f5f1`, so using `var(--muted)` for `.payload` would clear it.

## What I tried

Nothing in the generated files. Editing the copy would make `npm run artifacts:check` fail against the source, which is the point of that check.

## Decision or owner needed

Architecture-viz lane: change `.payload` to a colour with at least 4.5:1 on the ground (for example `var(--muted)`), regenerate `out/`, and the frontend re-syncs with `npm run artifacts:sync`.

## Files changed before stopping

None outside Task 07. In `next-frontend/tests/e2e/artifacts.spec.ts`, `generatedPageAxe` sets aside only this exact finding (rule `color-contrast`, every node ending in `.payload`) and records a "known issue" annotation; any other serious or critical finding still fails. Remove that helper once the pages are regenerated.

## Tests run and current results

`npx playwright test tests/e2e/artifacts.spec.ts` in the lane: 8 passed, with the known-issue annotation on the two "every artifact page" tests.

## Safe next step

Fix the colour in `render.ts`, regenerate, then in this worktree run `npm run artifacts:sync` and replace `generatedPageAxe(page)` with `noSeriousAxe(page)`.

## Severity

Low. Text is readable (4.43:1, just under the AA threshold), affects only the static architecture pages, and does not block the section.
