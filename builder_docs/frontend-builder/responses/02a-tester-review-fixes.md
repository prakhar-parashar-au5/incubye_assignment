# Frontend response 02a: Tester review fixes

**Task:** `builder_docs/frontend-builder/tasks/02a-tester-review-fixes.md`
**Status:** All five required fixes are applied and verified. Not committed. Waiting for review.
**Scope kept:** I made only the five fixes and the test and evidence work for them. No new features, no backend files, no Git commands.

**Read first:**
- `tester_docs/responses/01-hr-browser-review.md`
- `docs/code-reviews/01-tester-feedback-triage.md`
- the task file
- `builder_docs/responses/08-ai-assistant-mcp-fix.md`
- the installed Next.js guides `cacheComponents.md`, `migrating-to-cache-components.md`, and `preserving-ui-state.md`

## Fix 1: Sort icons stay attached to their labels

**Cause** (confirmed in code, matching the triage):
- The header link was `inline-flex items-start`, so the icon sat at the top of a wrapped label.
- Right-aligned money headers used `flex-row-reverse`, so the icon came *before* the label, next to the previous column. This is the "arrow belongs to Employment status" effect the tester saw.

**Change** (`src/app/employees/directory-results.tsx`, `SortHeader`):
- The label's last word and the icon are wrapped in one `whitespace-nowrap` span. The icon is an inline element 4px after that word, so it wraps with the word and always ends its own label, in left- and right-aligned headers alike.
- There is no reversed order.
- All header cells are bottom-aligned, so one-line and two-line headers share a baseline.
- Accessible names and `aria-sort` are unchanged.

**Verification:**
- New Playwright test `each sort icon sits directly after its own label at 1024, 1280, 1440, and 1920 px` (desktop project). For every sort icon at each width, for both the name sort and a salary sort, it measures the icon box against the text box of the label's last word. It asserts the icon is on the same line, 0–6px after the word, and inside its own header cell. Axe runs at the end.
- Header and table screenshots at all four widths: `02a-evidence/table-header-{1024,1280,1440,1920}.png` and `table-{…}.png`. At 1024px the table scrolls inside its own region, so that header capture shows the visible part only.
- **Not mutation-checked:** I did not run this test against the old header code. It does assert icon position directly.

## Fix 2: Conversation cleared after client-side navigation

**Cause:**
- With `cacheComponents: true`, Next.js 16 does not unmount a route on client-side navigation. It hides it with React `<Activity>`, so `useState` survives leaving and returning (`cacheComponents.md`, "Navigation with Activity").
- My Task 02 browser test returned with `page.goto` (a full reload), so it never exercised this path.

**Change** (`src/app/assistant/assistant-chat.tsx`):
- A `useLayoutEffect` cleanup runs when Activity hides the route. This is the pattern the installed `preserving-ui-state.md` guide gives for resetting stale form state. The cleanup clears the turns and the draft.
- It also increments a generation counter. A reply that arrives after the page was hidden belongs to an older generation and is dropped, so a late answer cannot reappear.
- The conversation is still memory-only; nothing was added to storage.

**Verification:**
- **Component test:** renders the chat inside a real React `<Activity>`. With one answered turn, one request still in flight, and an unsent draft, it switches to hidden, resolves the late reply, and switches back. It checks that the suggested prompts are back, there is no Conversation list, the late answer is absent, and the draft is empty.
  - Red check: I temporarily removed the three reset lines and the test **failed**; restored.
- **Browser regression:** `leaving Assistant through app navigation and returning starts a new conversation`, desktop and mobile, against the real backend. Rohan asks the tester's question, gets the real 503 state, and types a draft. He then goes to Employees and back to Assistant with the shell's navigation links.
  - A `window` marker set before leaving is still present after returning, which proves both navigations were client-side.
  - It asserts the prompts are back, there is no Conversation list, the question is absent, and the composer is empty.
  - Red check: with the reset removed and the app rebuilt, it **failed on both projects** ("element(s) not found"); restored and rebuilt.

## Fix 3: Rate-limit copy

The `RATE_LIMITED` state previously said "Too many questions in a short time / Wait a minute, then try again." The backend window is 15 minutes (08a), and the API returns no reset time.

It now says **"Too many assistant requests"** and **"The assistant has a request limit. Wait and try again later."** The component test asserts the new text and the absence of any minute or time promise.

## Fix 4: Hidden-record count not disclosed

- **Before:** `askAssistant` returned `removedOutOfScope: number`, and the page said "2 records outside your access were not shown".
- **Server side** (`src/server/actions/assistant.ts`): the defensive filter is unchanged. It still drops out-of-scope rows on the server before the response goes to the browser. The result now carries only `withheld: boolean`, so the number never crosses to the browser.
- **Page:** shows the generic **"Some results outside your access were not shown."**
- **Unit test:** the serialized result contains no count, and the fixture's Marcus Thompson rows (in the employee list and, new, in recent changes) are absent.
- **Component test:** the notice contains no digit.
- **Browser test** (Rohan, test-only fake backend): asserts the generic text and that no "N records outside your access" text exists.

## Fix 5: Contract regenerated; `recordedAt` supported

- **Regeneration:** `npm run api:check` reported "current" before I regenerated. My Task 02 contract had been generated after the backend's 08a OpenAPI change, so `src/generated/` already contained the required `RecentChangesCard.changes[].recordedAt`. The UI did not use it yet, and the test fixture had no change rows, so nothing exercised it. I ran `npm run api:generate` again from the current `express-backend/openapi/openapi.json`; the drift check passes.
- **Rendering** (`src/components/assistant/assistant-cards.tsx`): each change now reads "Recorded 15 Nov 2026, 09:12 UTC. Effective 1 Jan 2027." with `<time>` elements. Each date is kept on one line; the critique below found a split date.
- **Copy:** follows the backend's new meaning ("recent" means recently recorded). The footer reads "N changes recorded in the last N days, including any that take effect later. The initial import is not counted as a change." The empty state matches.
- **Formatting:** new `formatDateTime` (UTC, so the server and browser render the same text).
- **Fixtures:** now include two contract-valid recent changes, one future-effective and one out of scope. A unit test asserts that the fixture without `recordedAt` fails the generated validator.

## Impeccable

- **Context.** I did not rerun the Impeccable context command. It runs once per session, and it already ran in this session for Task 02. The loaded PRODUCT.md and DESIGN.md are unchanged.
- **Critique pass on the changed surfaces** (table header at four widths, mobile and desktop assistant answer with the new recent-changes card):
  - Found: the effective date split across lines on mobile ("Effective 1 / Jan 2027"). Fixed with `whitespace-nowrap` on both `<time>` elements; checked in `02a-evidence/assistant-answer-mobile.png`.
  - Found: the fixture card footer said "1 change" while showing 2 rows. This was a test-data error, not UI; corrected.
- **Audit:** axe has no serious or critical findings on the four-width header test page, the assistant pages, and every existing journey. Keyboard paths are unchanged and still covered: keyboard sign-in and sign-out, the row link opened with Enter, the composer's Enter and Shift+Enter, and the sheet focus trap.
- **Detector** (`impeccable detect --json`):

  | Target | Findings |
  |---|---|
  | `next-frontend/src` | `[]` |
  | Signed-in directory HTML (file mode) | `cramped-padding` ×8, `cream-palette` ×1 |
  | Assistant answer HTML (file mode) | `cramped-padding` ×10, `cream-palette` ×1 |

  These are the same two rules as in Task 02. The ground colour is pinned by the brief. The `cramped-padding` findings are the file-mode artifact recorded in Task 01.
- Hooks and live mode were not enabled.

## Tests and checks

From `next-frontend/`:

| Command | Result |
|---|---|
| `npm run api:generate` | Wrote `src/generated/api-openapi.json` and `api.ts` |
| `npm run check` (api:check, lint, typecheck, Vitest) | exit 0; **108 passed** (105 before; new: rate-limit copy, generic withheld notice, Activity reset; changed: scope filter now also covers recent changes, fixture validation with `recordedAt`, card rendering) |
| `npm run build` | exit 0 |
| `E2E_API_BASE_URL=http://127.0.0.1:3901 E2E_DEMO_PASSWORD=<synthetic> npx playwright test` | **48 passed, 4 skipped** |

- **Playwright skips:** each is desktop-only or mobile-only by design; the new header test runs on desktop only.
- **Playwright run setup:**
  - Backend: the compiled `dist/src/server.js`. It already contained the 08a code (`assistantRequestLimiter`, `recordedAt`); I did not rebuild it.
  - Database: my own MySQL 8.4 container on port 3318 with the backend's migrate and seed scripts. It is not `acme_test`, so it does not collide with the backend's destructive DB tests (triage "Environment isolation").
  - No `OPENAI_API_KEY`.
  - The container and servers were removed afterwards.
- **Failures actually observed:**
  - The new fixture rows put Sneha Singh in two cards, which caused strict-mode locator collisions in one component test and one browser test. Fixed with scoped locators.
  - On mobile, the navigation regression first failed on a 30 s click timeout. The cause: after client-side navigation, Activity also keeps the mobile `Menu` `<details>` **open**, so the test's toggle closed it. The test now opens the menu only if it is closed.
- **Log scan:** the backend log has 0 matches for `Bearer`, `eyJ`, the demo password, and `Sneha`.

**Evidence:** `builder_docs/frontend-builder/responses/02a-evidence/`:
- `table-header-*.png` and `table-*.png` at 1024, 1280, 1440, and 1920px;
- `assistant-answer-desktop.png` and `assistant-answer-mobile.png`;
- `employees-mobile.png`.

## Files changed

| File | Change |
|---|---|
| `src/app/employees/directory-results.tsx` | Sort header: inline icon joined to the last word; bottom-aligned header cells |
| `src/app/assistant/assistant-chat.tsx` | Reset on Activity hide, with a generation guard; rate-limit copy; generic withheld notice |
| `src/server/actions/assistant.ts` | Returns `withheld: boolean` instead of a count |
| `src/components/assistant/assistant-cards.tsx` | `recordedAt` and effective date; "recorded" wording |
| `src/lib/format.ts` | `formatDateTime` |
| `src/generated/api-openapi.json`, `src/generated/api.ts` | Regenerated (no content change since Task 02's final state) |
| `tests/support/assistant-fixtures.ts` | Recent changes with `recordedAt`, including one out-of-scope row |
| `tests/unit/assistant.test.ts`, `tests/component/assistant-chat.test.tsx` | Updated and new tests listed above |
| `tests/e2e/assistant.spec.ts`, `tests/e2e/directory.spec.ts` | Navigation regression, generic notice, four-width header alignment |
| `builder_docs/frontend-builder/responses/02a-evidence/` | 11 screenshots |

DESIGN.md and PRODUCT.md were not changed. None of these fixes changes a recorded design rule.

## Known limitations

1. **The mobile `Menu` disclosure stays open after client-side navigation.** The cause is now known: it is the same Activity behaviour as Fix 2, and `preserving-ui-state.md` gives the fix (close it in a `useLayoutEffect` cleanup). It was Task 02 limitation 7 and is not among the approved fixes, so I did not change it.
2. **The four-width header test is not mutation-checked** (Fix 1).
3. **No live model.** Everything except the real 503 path runs through contract-validated fixtures.
4. **The generic notice applies only to the defensive filter.** It hides the count when that filter activates, which a correct backend never triggers. Backend scoping remains the authority.

## Confirmations

- No backend files were modified. `express-backend/` was only read, and its compiled server and seed scripts ran against my own database.
- No Git command ran.
- No `.env` file was read or created.
- Only `next-frontend/` and `builder_docs/frontend-builder/responses/` were changed.
- No new product features were added.
- Impeccable hooks and live mode were not enabled.
