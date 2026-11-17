# Blocker: schema.html fails axe colour contrast on "null" and "generated" column notes

Status: RESOLVED (2026-11-17). With master merged in, `architecture-viz/schema.ts:309` reads `.null { color: var(--muted); }`, matching `out/schema.html:29` and the synced copy. Axe finds no serious or critical issue on schema.html at 1440 px or 390 px, and `tests/e2e/artifacts.spec.ts` scans it with `noSeriousAxe`.
Original status: CROSS_LANE_DEFECT
Task: Frontend Task 07 follow-up (sync F3 and schema)
Agent lane: Frontend builder
Worktree: /Users/admin/Desktop/Projects/incubyte_take_home_artifacts (master merged in by the operator; I ran no Git command)
Time observed: 2026-11-17

## What I was trying to do

Axe-check the newly synced `schema.html`, as the follow-up asked, with the same rule as the rest of the app: no serious or critical findings.

## What blocked me

Nothing in my lane. The generated page has one serious finding, and its source is `architecture-viz/schema.ts`, which I do not own. I copy the page unchanged.

## Evidence

- Rule `color-contrast` (serious), 61 nodes at 1440 px and at 390 px.
  - 60 nodes: the ` null` / ` generated` note in the column-type cell (`td.ct > span.null`), `#8a8f99` on `#ffffff`, 11.5 px, 3.24:1.
  - 1 node: the same class in the legend, `#8a8f99` on `#f7f5f1`, 12 px, 2.98:1.
  - WCAG AA needs 4.5:1 for text this size.
- Source: `architecture-viz/schema.ts` line 309, `.null { color: #8a8f99; }` (the class is emitted on line 251).
- Run with `@axe-core/playwright` 4.14.0 on `next-frontend/src/artifacts/generated/schema.html`, and in the Playwright test on `/artifacts/raw/schema.html`.

## Expected

No serious or critical axe findings, like F1 to F3.

## Observed

`color-contrast` on every nullable or generated column note.

## What I verified

- F1, F2 and F3 have no serious or critical findings after the `.payload` fix.
- The only other schema.html findings are moderate: `landmark-one-main` and `region`. The flow pages have the same moderate findings, and the app does not fail on moderate.
- The Database page around the frame passes.
- The page's own `--muted` (`#4a5467`) gives about 7:1 on white, so using `var(--muted)` for `.null` would clear it.

## What I tried

I did not edit the generated copy. Editing it would make `npm run artifacts:check` fail, which is what that check is for.

## Decision or owner needed

Architecture-viz lane: change `.null` to a colour with at least 4.5:1 on white and on the ground (for example `var(--muted)`), regenerate `out/schema.html`, then the frontend runs `npm run artifacts:sync`.

## Files changed before stopping

`next-frontend/tests/e2e/artifacts.spec.ts` has a separate test, "schema.html on its own has no serious or critical axe findings", marked `test.fail` with this issue's name. Once the page is fixed, Playwright reports that test as unexpectedly passing. Then remove `test.fail` and the `file !== "schema.html"` exception in the journey test.

## Tests run and current results

See `builder_docs/frontend-builder/responses/07-artifacts-section.md`, section "Follow-up: F3 and schema synced".

## Safe next step

Fix the colour in `schema.ts`, regenerate, then sync and remove the expected-failure marker.

## Severity

Low. The notes are secondary text on a static diagram page, and the rest of the app passes.
