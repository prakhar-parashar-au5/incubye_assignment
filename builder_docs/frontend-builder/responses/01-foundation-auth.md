# Frontend response 01: Foundation and authentication shell

**Task:** `builder_docs/frontend-builder/tasks/01-foundation-auth.md`
**Status:** Complete and verified locally. Not committed. Waiting for review.
**Journey delivered:** open sign-in → choose Meera or Rohan → enter the shared synthetic password → server action calls Express login → JWT stored in an HttpOnly cookie → protected `/employees` shell → sign out.

No employee data, directory response shape, or mock rows were added.

## Versions and official docs checked

| Package | Version | Why this version |
|---|---|---|
| Node | 22.23.1 (local) | `engines: >=22.13`, matching jsdom 31 and backend `>=22` |
| next | 16.4.6 | Current stable; scaffolded with `create-next-app@16.4.6` (`--disable-git`) |
| react / react-dom | 19.3.1 | Current stable |
| typescript | 5.9.3 | Not 6.x or 7.x: `openapi-typescript@7.13.0` declares `typescript ^5.x`. typescript-eslint 8.72.2 supports `<6.1.0` |
| tailwindcss / @tailwindcss/turbopack | 4.3.5 | Current stable; Next 16 scaffold uses the Turbopack loader |
| shadcn (CLI, dev only) | 4.23.0, style `base-nova` on `@base-ui/react` 1.9.0 | `shadcn init -d`; components: button, input, label, alert, skeleton (badge added then deleted, unused) |
| openapi-typescript | 7.13.0 | Type generation |
| ajv / ajv-formats | 8.20.0 / 3.0.1 | Runtime response validation from the same generated contract |
| vitest / jsdom / Testing Library | 5.1.0 / 31.0.1 / react 16.3.3, user-event 14.6.10, jest-dom 7.0.1 | Unit and component tests |
| @playwright/test / @axe-core/playwright | 1.65.1 / 4.14.0 | Browser journeys and accessibility scan |
| eslint / eslint-config-next | 9.39.5 / 16.4.6 | ESLint 9, as in the backend; npm prints a deprecation notice for 9.x |

`@vitejs/plugin-react@6.3.0` was tried and removed: it pulled conflicting Babel 7/8 peers (`ERESOLVE`). Vitest 5's built-in oxc JSX transform is enough.

**Installed Next.js docs read** (`next-frontend/node_modules/next/dist/docs/01-app/`), before using the matching API:

| Doc | Effect on the code |
|---|---|
| `03-api-reference/04-functions/cookies.md` | `cookies()` is async; `.set`/`.delete` only in Server Functions or Route Handlers. This is why an expired session goes through `/session/expired` instead of clearing the cookie during render. |
| `02-guides/authentication-with-cache-components.md` | `cacheComponents: true` is the 16.4 scaffold default; session reads must sit inside `<Suspense>`. I did **not** use `use cache: private`, because it would let a revoked session or changed scope render from a 5-minute browser cache, against the "current database authority" decision. |
| `03-api-reference/04-functions/redirect.md` | `redirect()` throws, so it is called outside `try`; inside a streamed boundary it emits a client-side redirect. |
| `03-api-reference/03-file-conventions/proxy.md` | `middleware` is renamed `proxy`; `src/proxy.ts` with a constant matcher. |
| `02-guides/environment-variables.md`, `03-api-reference/04-functions/connection.md` | `await connection()` before reading `DEMO_SHARED_PASSWORD`, so the value is read per request, not baked in at build. The same doc says Next.js loads `.env*` files itself; none exist (limitation below). |
| `02-guides/forms.md` | `useActionState` with `(prevState, formData)` signature and `pending`. |
| `02-guides/data-security.md` | Server Actions are public POST endpoints with Origin/Host checking; each action validates its own input. |
| `02-guides/testing/vitest.md` | Vitest cannot render async Server Components, so those paths are covered by unit tests of their logic plus Playwright. |
| `03-api-reference/04-functions/unstable_rethrow.md` and its source | Used to fix a real defect (see "Problems found"). |

## Skill evidence

### Impeccable (project-local, `.kiro/skills/impeccable/`)

- **Context command, run once from the repo root:** `.kiro/skills/impeccable/scripts/impeccable context`. Output: `NO_PRODUCT_MD`, `PRODUCT_INIT_REQUIRED`, `MANUAL_DETECTOR_REQUIRED`, image converters available.
- **References read:** `SKILL.md`, `init.md`, `shape.md`, `new-work.md`, `mode-operate.md`, `operate.md`, `craft-floor.md` (immediately before the first UI edit), `degraded/documenter.md`, and the format part of `document.md`.
- **Init.** No structured question tool exists in this session, so I wrote `PRODUCT.md` from the approved documents only and marked inferred items **(inferred)**. Prakhar should correct anything wrong there.
- **Shape (brief, assumptions marked):**
  - Job: HR manager signs in to a synthetic demo and lands on the employee area. Mode: **Operate**, code-led (no comps).
  - Outcome: signed in with the right account and can see which access is active.
  - Direction: **pinned whole by `docs_human/09-frontend-directory.md`**, so no `concept-seed` roll. Direction-contract `FORM`: `seed: none (pinned)`, quoting "Use a calm HR operations interface: warm off-white background, dark navy or charcoal text, one restrained blue accent … desktop sidebar and a compact mobile header".
  - States: default, wrong password, rate limited, service down, not configured, signed out, session expired, unexpected error.
  - Boundaries: no directory data, no clickable future sections.
- **Direction contract.** Recorded here, not in `.impeccable/surfaces/`. The tool resolves that path to the repo root, which is outside my file ownership.
  - THESIS: the access record is the anchor; the category default it refuses is a centred login card on a blank page.
  - OWN-WORLD: navy rail, warm ground, one blue, hairline-ruled records.
  - STORY: pick the account whose access you need, see the same record once signed in.
  - FIRST VIEWPORT: rail at left, sign-in column at 12vh with accounts, credential, password, action.
  - FORM: pinned, `seed: none (pinned)`.
- **Design decision caused by Impeccable.** `mode-operate.md` requires a concretely named signature move, and says colour must do real jobs rather than "a grey screen with one accent". The result is the **access record**: role and access scope as one ruled two-column line (`ScopeRecord`), used on each sign-in account and in the signed-in identity block. The navy rail is shared by sign-in and the shell, so both read as one product (a task requirement).
- **Second decision (craft floor, operate states).** The directory placeholder uses **static** skeleton bars with the text "Not connected yet". A pulsing skeleton would claim loading that never finishes. During real Suspense loading the same area says "Loading…".
- **Craft floor "browser surfaces" applied:** themed `::selection`, blue `caret-color`, a visible 2px focus outline (light on the rail), `theme-color`, and `color-scheme: light`.
- **Corrections caused by the Impeccable critique and adapt passes on the rendered round 1** (screenshots `round1-*`):
  1. **Adapt (mobile 390px).** The demo password wrapped mid-word ("synthetic-e2e-demo-p / ass") because of `break-all` next to the copy button. Fixed by stacking the value above the button on small screens with `whitespace-nowrap overflow-x-auto` (`round2-mobile-sign-in.png`).
  2. **Critique (consistency).** Sign-in said "India, Tech and Support" while the shell, using the backend order, said "India, Support and Tech". `scopeSummary` now sorts countries and departments, so both read "India, Support and Tech". This changes the literal spec wording (open decision 1).
  3. **Audit (accessibility snapshot).** Each radio's accessible name was the whole row ("Meera Iyer meera.iyer@acme.com Role Admin HR Access All employees"). Now the name is the person, and role and access are its description (`aria-labelledby` / `aria-describedby`).
  4. **Polish.** `AlertDescription` styles every link, so the "Try again" button-link was underlined. Added `no-underline`.
- **Harden.** Distinct copy for every failure kind (`src/lib/sign-in-state.ts`). After an error, focus moves to the password field or to the form-level alert. Missing demo-password configuration has its own message. An unexpected render error shows a digest reference only, never a stack.
- **Detector** (`impeccable detect --json`, run once at the end):

  | Target | Findings |
  |---|---|
  | `next-frontend/src` | `[]` |
  | `http://localhost:3900/sign-in` at 1280×800 and 390×844 | 1: `cream-palette` (body `#f7f5f1`) |
  | Signed-in `/employees` | `cream-palette`, plus `cramped-padding` on `dl`/`section` |

  - **`cream-palette` is kept.** The brief pins a warm off-white, and the skill says the brief wins over a saturated-pattern warning. Recorded as not canonized in DESIGN.md.
  - **How `/employees` was scanned.** The detector cannot sign in, so I saved the rendered HTML and scanned it as a file with the built CSS copied beside it.
  - **The `cramped-padding` findings are a file-mode artifact.** The same `ScopeRecord` markup on `/sign-in` was flagged in file mode and not in URL mode.
- **Not run:**
  - The shipped `impeccable-finish-reviewer` and documenter subagents. They are not available in this harness; I did the critique rounds and documentation in-thread.
  - Hooks and live mode were not enabled.
  - No `.impeccable/` sidecar was written, because it is outside my file ownership.
- **`DESIGN.md`** was written at the end from the built tokens.

### Anthropic frontend-design skill

- **Source:** `https://github.com/anthropics/skills`, file `skills/frontend-design/SKILL.md`, fetched at repo HEAD `1780c5e5a552fd4d1c9d6a7b0cab26b0c2bef064`. The last commit touching that path is `41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f` (2026-09-03). Read in full.
- **Effects:**
  - Sentence case and no all-caps labels.
  - No eyebrow above any heading. "Synthetic demo credentials" is a real `h2`, not a tracked label.
  - No `→` appended to actions and no middle-dot meta strings.
  - One family (Public Sans) rather than a display/body pair.
  - "Remove one accessory": the unused Badge component was deleted, and "Coming later" is plain text, not a pill.
- **Calibration check.** The skill names "warm cream ground with serif display and terracotta accent" as a generated-design default. The brief pins warm off-white, so I kept the ground but used no serif and no warm accent: navy plus blue.

### Vercel guidance

- **React best practices:** `https://github.com/vercel-labs/agent-skills`, revision `1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62`.
  - Files read: `skills/react-best-practices/SKILL.md` and `rules/server-auth-actions.md`, `server-cache-react.md`, `server-serialization.md`, `server-no-shared-module-state.md`, `bundle-barrel-imports.md`.
  - **`server-auth-actions`:** `signIn` validates its own input and maps an account key to the approved email on the server. A client-sent `email` field is ignored (tested).
  - **`server-serialization`:** `resolveSession` passes only display name, role, and scope lists to rendering. Email and IDs never leave `src/server/session.ts` (tested).
  - **`server-cache-react`:** `getSession` is wrapped in `React.cache` for per-request deduplication only.
- **Web Interface Guidelines:** `https://github.com/vercel-labs/web-interface-guidelines` `command.md` at revision `434b7f91364665f2f733b310ec54809bf8f37937`, fetched as the `web-design-guidelines` skill (same agent-skills revision) instructs. Effects:
  - Removed `transition-all` from the shadcn button and input in favour of explicit properties.
  - "Signing in…" and "Loading…" use the ellipsis character.
  - `autocomplete="current-password"`, `spellCheck={false}`, `touch-action: manipulation`, `theme-color` meta, a skip link, `aria-live` on async errors.
  - The submit button stays enabled until the request starts.
  - Natural-language region names via `Intl.DisplayNames`.
- **Rule not followed.** The guideline's "Title Case for headings/buttons" conflicts with the approved sentence-case copy. The approved spec wins.

## Files changed

All new unless noted. No other directories were touched.

| Path | Purpose |
|---|---|
| `PRODUCT.md` | Impeccable product context (inferred from approved docs, labelled) |
| `DESIGN.md` | Design system recorded from the build |
| `next-frontend/package.json`, `package-lock.json` | Pinned deps; scripts `typecheck`, `test`, `test:e2e`, `check`, `api:generate`, `api:check` |
| `next-frontend/next.config.ts` | Scaffold defaults (`cacheComponents`, `partialPrefetching`) plus `poweredByHeader: false` |
| `next-frontend/.gitignore` | Scaffold plus `/test-results`, `/playwright-report` |
| `next-frontend/README.md` | Replaced scaffold README: config, commands, cookie, layout |
| `next-frontend/AGENTS.md`, `eslint.config.mjs`, `tsconfig.json`, `components.json`, `next-env.d.ts`, `src/app/favicon.ico`, `src/lib/utils.ts` | Scaffold / shadcn output, unchanged |
| `next-frontend/scripts/generate-api-contract.mjs` | Auth-only contract and type generator with `--check` drift mode |
| `next-frontend/src/generated/auth-openapi.json`, `auth-api.ts` | Generated; do not edit |
| `next-frontend/src/server/config.ts` | `API_BASE_URL`, `API_TIMEOUT_MS`, `DEMO_SHARED_PASSWORD` validation |
| `next-frontend/src/server/api/client.ts`, `api/contract.ts` | Server-only API client and runtime validators |
| `next-frontend/src/server/cookie-policy.ts`, `session-cookie.ts`, `session.ts` | Cookie policy, cookie I/O, session data access |
| `next-frontend/src/server/actions/auth.ts` | `signIn`, `signOut` Server Actions |
| `next-frontend/src/proxy.ts` | No cookie → `/sign-in` for `/employees/*` |
| `next-frontend/src/app/session/expired/route.ts` | Re-check and clear a rejected session |
| `next-frontend/src/app/layout.tsx`, `page.tsx`, `globals.css`, `not-found.tsx` | Root layout (Public Sans, metadata), `/` → `/employees`, tokens, 404 |
| `next-frontend/src/app/sign-in/page.tsx`, `sign-in-form.tsx`, `copy-password-button.tsx` | Sign-in |
| `next-frontend/src/app/employees/page.tsx`, `error.tsx` | Protected shell, service-error state, error boundary |
| `next-frontend/src/components/shell/app-shell.tsx`, `product-mark.tsx`, `scope-record.tsx` | Rail, mobile header, wordmark, skip link, access record |
| `next-frontend/src/components/ui/button.tsx`, `input.tsx`, `alert.tsx` | shadcn source, adapted (see DESIGN.md) |
| `next-frontend/src/components/ui/label.tsx`, `skeleton.tsx` | shadcn source, unchanged |
| `next-frontend/src/lib/demo-accounts.ts`, `hr-scope.ts`, `sign-in-state.ts` | Approved demo accounts, role and scope text, sign-in state and messages |
| `next-frontend/vitest.config.mts`, `playwright.config.ts` | Test runners |
| `next-frontend/tests/**` | 6 Vitest files, 1 Playwright file, support files |
| `builder_docs/frontend-builder/responses/01-foundation-auth.md` and `01-foundation-auth-evidence/*.png` | This response and 13 screenshots |

Scaffold `public/*.svg` files were deleted (unused).

## API and cookie design

**Contract generation**
- `npm run api:generate` reads `../express-backend/openapi/openapi.json`.
- It keeps only operations `login`, `getCurrentUser`, `logout` and the four schemas they reference, failing if any is missing.
- It writes `src/generated/auth-openapi.json` and `src/generated/auth-api.ts`.
- `npm run api:check` (also run by a unit test) fails on drift.
- The backend file on disk already contains the in-progress Task 07 paths (`/api/v1/employees…`). The filter keeps them out of the frontend entirely.

**Runtime validation**
- Ajv 2020 compiles validators from the generated JSON, so there are no handwritten response types or schemas.
- Extra fields are rejected: `additionalProperties: false` comes from the backend.

**Server-only client** (`src/server/api/client.ts`)
- `import 'server-only'` makes any Client Component import a build error.
- It reads `API_BASE_URL` per call. Missing or invalid configuration returns `CONFIGURATION`, and the log names only the variable.
- Each request has `AbortSignal.timeout(API_TIMEOUT_MS)` (default 5000), `cache: 'no-store'`, and `redirect: 'error'`, so a redirect cannot carry the Bearer header elsewhere.
- The Bearer header is added only when a token is passed: `getCurrentUser` and `logout`.
- Result mapping:
  - Contract error body → its public code.
  - Network failure or timeout, or a non-contract 5xx → `UNAVAILABLE`.
  - Unparseable or contract-mismatched body → `INVALID_RESPONSE`.
- Logs contain `{event, operation, kind, status}` only, never bodies, tokens, emails, or undici messages (tested).

**Sign-in action**
- The form posts `account` (`meera` | `rohan`) and `password`. The server maps the key to the approved email.
- Empty or over-1024-character passwords are rejected before the backend is called.
- The returned state carries the account and an error code only, never the password or token.
- The cookie is set only when `expiresAt` parses and lies in the future. Then `redirect('/employees')`.

**Cookie**
- `acme_session` in development; `__Host-acme_session` in production. The `__Host-` prefix makes the browser require Secure, `Path=/`, and no Domain.
- Attributes: `HttpOnly`, `SameSite=Lax`, `Secure` when `NODE_ENV=production`, `Path=/`, `Expires` = backend `expiresAt`.

**Protected rendering**
- `src/proxy.ts` redirects requests without a cookie (307).
- `/employees` renders a static shell skeleton, then inside `<Suspense>` calls `/api/v1/auth/me`. Outcomes:
  - `UNAUTHENTICATED` or a non-active user → `/session/expired`. That handler asks the backend again and clears the cookie only if the backend confirms the session is invalid, so a cross-site link cannot sign out a valid session. Then `/sign-in?reason=session-expired`.
  - Unavailable or invalid response → a retryable service error. The cookie is kept.

**Sign-out**
- Calls `POST /api/v1/auth/logout` with the cookie token if one exists.
- Clears the cookie whatever the result, then redirects to `/sign-in?reason=signed-out`.
- Safe to repeat.

**Demo password**
- `DEMO_SHARED_PASSWORD` is read on the server after `connection()`.
- It is rendered under "Synthetic demo credentials" and passed as a prop to the form. It is public by design and is not a `NEXT_PUBLIC_` variable.

## Tests and failures actually observed

**Vitest: 52 tests, 6 files, all pass.**

| File | Covers |
|---|---|
| `api-contract.test.ts` (4) | Drift check via the generator; exactly 3 auth operations and 4 schemas; `expectTypeOf` on generated types (enforced by `tsc`); validators accept the contract and reject extra field, bad date, unknown role, missing scope list, unknown error code |
| `config.test.ts` (13) | Valid URLs and timeout; 6 invalid `API_BASE_URL` forms with no value in the message; 5 invalid timeouts; demo password ignores `NEXT_PUBLIC_*` |
| `api-client.test.ts` (12) | Login path and no auth header; Bearer on `/me` and logout; 6 public codes mapped; refused connection and a real 200 ms timeout → `UNAVAILABLE`; HTML 502, invalid JSON 200, wrong shape, unknown error body; `CONFIGURATION` without fetch; exact log entries and absence of password, token, `Bearer`, email, backend message, IP, body |
| `auth-actions.test.ts` (11) | Successful login sends the approved email, sets the cookie with exact flags and `Expires`, redirects; production `__Host-` + Secure; client email and unknown account ignored; empty password; invalid credentials (account kept, no cookie, no password echo); 429 → `RATE_LIMITED`; outage; past `expiresAt`; sign-out revocation call + cookie cleared; cleared when backend down; repeat without cookie |
| `session.test.ts` (8) | Proxy 307 without cookie and pass-through with cookie; signed-out, signed-in (no email leaves), expired (401 and INACTIVE), unavailable (network, 500, 503); role/scope text; demo account descriptions |
| `sign-in-form.test.tsx` (4) | Accounts with accessible descriptions and the labelled password; keyboard-only Tab/ArrowDown/Enter sign-in with submitted fields checked; error keeps Rohan, focuses and empties the field; rate-limit message; unconfigured password message |

**Red runs actually observed**

- Every Vitest file passed on its first run. That is weak evidence, so I ran four temporary mutations, each restored afterwards (a search for the mutation markers found 0):

  | Mutation | Tests that failed |
  |---|---|
  | `httpOnly: false` | 3 in `auth-actions` |
  | Bearer header dropped | `api-client` "adds the Bearer token…" and `auth-actions` revocation |
  | Sign-out keeps cookie when logout fails | `auth-actions` "clears the cookie even when the backend is unavailable" |
  | Unavailable treated as expired | `session` "treats backend failure as unavailable, not as sign-out" |

- The `unstable_rethrow` addition broke 2 action tests until the `next/navigation` mock exported it.
- **Playwright, first run:** 4 failures, `Storage.setCookies: Invalid cookie fields`, because the tests injected a `__Host-`/Secure cookie with an `http://` URL. Fixed the tests to use `url: "https://localhost"`.
- **Playwright, a later run:** "Rohan sees his scope" failed on mobile with a real backend `429 RATE_LIMITED`. My one manual wrong attempt plus four test runs reached five failures in 15 minutes, and the backend's limiter blocked Rohan, as designed. I restarted the backend to reset its in-memory limiter, and the final run passed. The wrong-password test now runs on the desktop project only, and the README states the limit.

**Playwright final run: 17 passed, 1 skipped** (the wrong-password test on mobile, by design). It ran against the real Express auth API (compiled `dist/src/server.js`) and an isolated MySQL 8.4 container on port 3318, seeded with the backend's own migrate, seed, and demo-user scripts and a synthetic password. Journeys:

- Signed-out redirect.
- Sign-in content plus axe scan.
- Meera keyboard sign-in:
  - Cookie `httpOnly`, `sameSite: Lax`, `secure`, `path /`, expiry about 2 hours.
  - Shell shows name, role, and "All employees".
  - Token absent from page HTML, from a raw `/employees` response, and from `document.cookie`.
  - Axe scan, no horizontal overflow.
  - Keyboard sign-out (through the Menu on mobile); cookie gone.
  - The old token now gets **401 from the real `/api/v1/auth/me`**, so the session was revoked, not just forgotten.
  - The protected page redirects again.
- Rohan's scope and the permission-filtered notice.
- Wrong password: inline error, focus on the field, Rohan still selected, no cookie.
- Invalid cookie → `/sign-in?reason=session-expired` and the cookie cleared.
- Backend down (second server pointed at port 9): service error with "Try again", cookie kept, no redirect; sign-in shows the outage message.
- Rail on desktop and compact header on mobile; future sections are neither links nor buttons.

Axe found no serious or critical violations on `/sign-in` and `/employees` at both widths.

**Rate limit in the browser.** It is not a dedicated journey, because each failure locks a shared demo account for 15 minutes. It is covered by the action and form tests, and the real backend 429 was seen once (above), shown by the form as "Too many failed attempts for this account…".

## Browser routes and viewports checked

Captured in the Playwright MCP browser and a Chromium script, saved in `01-foundation-auth-evidence/`:

| Round | Captures |
|---|---|
| 1 | `desktop-sign-in`, `desktop-sign-in-error`, `desktop-employees-rohan`, `mobile-employees-rohan`, `mobile-menu-open`, `mobile-sign-in-signed-out` |
| 2 | `desktop-sign-in`, `desktop-employees-meera`, `desktop-sign-in-session-expired`, `desktop-service-unavailable`, `mobile-sign-in`, `mobile-employees-rohan`, `mobile-service-unavailable` |

Viewports: 1440×900 and 390×844. The detector also rendered 1280×800.

## Commands and results

From `next-frontend/` unless noted:

| Command | Result |
|---|---|
| `npm run api:generate` / `npm run api:check` | Wrote both files / "Generated API contract is current." |
| `npm run lint` | exit 0 |
| `npm run typecheck` (`next typegen && tsc --noEmit`) | exit 0 |
| `npm test` | 52 passed |
| `npm run check` | exit 0 |
| `npm run build` | exit 0; `/employees` and `/sign-in` partial prerender, `/session/expired` dynamic, proxy present |
| `E2E_API_BASE_URL=http://127.0.0.1:3901 E2E_DEMO_PASSWORD=<synthetic> npx playwright test` | 17 passed, 1 skipped |
| `npm audit --omit=dev` | 0 vulnerabilities (dev-only advisories: `deepmerge` via the shadcn CLI, `minimatch` via typescript-eslint) |
| `.kiro/skills/impeccable/scripts/impeccable detect --json …` | As listed above |
| `express-backend/`: `node --import tsx --test test/http-openapi.test.ts` (read-only) | 11 passed |

**Backend test setup.** No backend files were changed.
- Container: `docker run … --name acme-frontend-e2e-mysql -p 127.0.0.1:3318:3306 --tmpfs /var/lib/mysql mysql:8.4`, separate from the backend builder's `acme-take-home-mysql`.
- Seeding: `npm run db:migrate`, `APP_ENV=test npm run db:seed -- --replace`, and `db:seed-demo-users` with synthetic passwords.
- Server: `node dist/src/server.js` on port 3901 with a synthetic signing key.
- The container, both servers, `.playwright-mcp/`, and `test-results/` were removed afterwards.

## Problems found and fixed during the work

- **Swallowed prerender interrupts.** Server logs showed `getCurrentUser UNAVAILABLE` during successful sign-ins. A temporary diagnostic showed the cause: Next.js rejects `fetch()` when a prerender pass completes ("During prerendering, fetch() rejects…"), and my `catch` turned that into `UNAVAILABLE` instead of letting Next handle it. Fixed with `unstable_rethrow(error)` in both client `catch` blocks; the spurious log lines are gone.
- **Accessible names, mobile password wrap, scope order, underlined retry link.** See the Impeccable corrections.

## Known limitations

1. **OpenAPI "committed" state not verified.** I may not run Git, so I could not confirm the on-disk `openapi.json` equals the committed one. Its auth operations and schemas match `06-authentication-api.md` and `06-authentication-api-fix.md`, and the generator excludes all non-auth paths. To confirm, run `git diff --stat -- express-backend/openapi/openapi.json` and check that any difference is limited to directory paths.
2. **Next.js loads `.env*` files itself if they exist.** None exist and no project code reads them. Deployments must use injected variables.
3. **An expired session mid-render redirects through a streamed client-side redirect** (HTTP 200 with a redirect instruction), because session reads stream behind Suspense. A missing cookie gets a real 307 from the proxy.
4. **The mobile menu is a native `<details>` disclosure.** Keyboard and screen-reader operable, no focus trap, and it does not close on outside click. A focus-managed sheet arrives with mobile filters in Task 02.
5. **No browser-IP failed-login limit at the Next.js boundary.** This remains the documented future work from `docs/18`.
6. **Single-instance assumptions.** `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` is not set, which is fine for one instance. Multiple instances need it.
7. **Fonts.** Public Sans is downloaded from Google Fonts at build time by `next/font` and then self-hosted; the build needs network access.
8. **Skip link.** It exists and passes axe. My one attempt to screenshot it focused did not show it (focus did not start at the document), so I do not claim a visual check.

## Open decisions for review

1. **Scope wording order.** The spec text says "India, Tech and Support"; the UI shows "India, Support and Tech" (sorted, identical on sign-in and in the shell). Keep sorting, or fix a specific order?
2. **`PRODUCT.md` inferences** (marked) need Prakhar's confirmation.

## Confirmations

- No backend files were modified. `express-backend/` was only read, and its scripts were run against my own isolated database.
- No Git command was run. Nothing was committed or pushed.
- No `.env` file was read or created.
- No directory API integration, employee data, mock rows, dashboard, salary, HR management, upload, AI, or MCP work. Frontend Task 02 was not started.
- `index.md`, `docs/`, `docs_human/`, `builder_docs/parent_instructions/`, and `builder_docs/responses/` were not edited.
- Impeccable hooks and live mode were not enabled.
