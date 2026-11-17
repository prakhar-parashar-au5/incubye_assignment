# Frontend response 05a: HR access management (shape brief)

**Task:** `builder_docs/frontend-builder/tasks/05a-hr-access-management-shape.md` (the worktree override in `index.md`)
**Worktree:** `/Users/admin/Desktop/Projects/incubyte_take_home_hr_access_ui`, branch `feature/hr-access-frontend` (taken from the handoff; Git not run)
**Status:** shape brief complete. Planning only.
- No production code, tests, generated contract, `PRODUCT.md`, `DESIGN.md`, backend or human specification files were changed.
- One issue was reported: **`builder_docs/frontend-builder/issues/05a-created-hr-users-cannot-sign-in.md`** (`NEEDS_DECISION`). The approved sign-in page only accepts the two demo accounts, so a user created here cannot sign in through the frontend. This brief plans for adding an "Another HR account" email-and-password mode to sign-in. Every journey that depends on it is marked **[S]**.

## 0. Sources and method

**Read:**
- `docs_human/12-hr-access-management.md`
- `builder_docs/responses/11-hr-access-management-api.md`, `11a-temporary-password-recovery.md`, `11b-backend-final-review-fixes.md`
- `express-backend/openapi/openapi.json`: all 17 `hr-users` operations and their schemas, read field by field
- `docs/20-frontend-architecture.md`, `PRODUCT.md`, `DESIGN.md`
- `docs/27-agent-blocker-reporting-protocol.md`
- The existing frontend: sign-in action and form, shell, session layer, salary preview and confirm patterns, and the Task 03b truthful-outcome rule

**API naming.** Every API name below is quoted from the OpenAPI. Anything the contract does not provide is a question in section 13, not an assumed field.

**Impeccable:**
- The skill is not installed in this worktree, so I ran the main checkout's copy read-only: `impeccable context --target next-frontend/src/app/hr-access/page.tsx`. It loaded `PRODUCT.md` and `DESIGN.md`; there is no surface brief.
- **Interview substitution:** this harness has no structured question tool or decision page. Following `shape.md`, assumptions are marked **(assumption)**, the brief is returned, and work stops. The product decision that could not be assumed went into the issue file.
- **No new world.** This is an Operate surface inside the established world (DESIGN.md), so there is no concept workshop.
- **Concrete effects on the plan:**
  - The signature **access record** (`Role | Access`) becomes this feature's main object. It is the list's scope column, the detail header, and the before and after of every preview.
  - The **change record** (Before / After, from Task 03) is reused for previews and audit events.
  - **Modals are rejected** for these flows (`operate.md`, the craft-floor ban on modals for tasks that need neither interruption nor protected focus). Each change gets its own page, as the salary adjust page does. The one exception is the one-time password panel, which is inline but deliberately protected (section 7).

## 1. Job, audience, and outcome

- **Who:** Admin HR (Meera, and any Admin created later), at a desk. Mobile is supported but secondary **(assumption)**. Scoped HR never reaches this feature.
- **Job:** control who can see which employees, replacing spreadsheets and messages. Every change is exact, previewed, version-checked, idempotent and audited.
- **The ten-second test on a user's record:** who this is; their role and status; exactly which country and department combinations they can see; how many employees that is; their current version; and what changed recently, by whom.
- **Success:**
  - No access change happens without an exact preview and a separate confirmation.
  - A temporary password is shown once, to the creating or regenerating Admin, and never again anywhere.
  - Every outcome shown on screen is the backend's persisted state.
- **Anti-goals:**
  - deleting users (the action is "Deactivate access");
  - demotion;
  - any claim that an email was sent;
  - a password in a URL, storage, log, screenshot or later read;
  - a confirmation that applies a stale preview;
  - a custom combobox widget where native checkboxes work.

## 2. Route map and navigation

| Route | Purpose | Backend calls |
|---|---|---|
| `/hr-access` | HR user list: search, filters, sort, pagination | `listHrUsers` |
| `/hr-access/new` | Create Admin or Scoped HR user: form, preview, confirm, one-time password | `previewHrUserCreation`, `createHrUser` |
| `/hr-access/[hrUserId]` | Detail: access record, actions, audit history (paginated) | `getHrUser`, `listHrUserAccessAudit` |
| `/hr-access/[hrUserId]/name` | Change display name | `previewHrUserProfile`, `updateHrUserProfile` |
| `/hr-access/[hrUserId]/scope` | Replace country and department scopes (Scoped HR targets only) | `previewHrUserScopes`, `replaceHrUserScopes` |
| `/hr-access/[hrUserId]/promote` | Promote Scoped HR to Admin HR | `previewHrUserPromotion`, `promoteHrUser` |
| `/hr-access/[hrUserId]/deactivate` | Deactivate access, with a required reason | `previewHrUserDeactivation`, `deactivateHrUser` |
| `/hr-access/[hrUserId]/reactivate` | Reactivate access, with a required reason | `previewHrUserReactivation`, `reactivateHrUser` |
| `/hr-access/[hrUserId]/regenerate-password` | Regenerate a temporary password, with a reason | `previewHrUserPasswordRegeneration`, `regenerateHrUserPassword` |

- **Why one page per change:** each operation has its own preview, version and idempotency key, and these routes mirror the backend operations one to one. Separate pages keep focus, back-button behaviour and mobile layout simple. Detail stays a read-only record with an Actions list.
- **Which actions the detail page offers.** It offers only actions that make sense for the record; the backend still decides:
  - Change scope: Scoped HR only.
  - Promote: Scoped HR only.
  - Deactivate: active only.
  - Reactivate: inactive only.
  - Regenerate temporary password: hidden on the signed-in Admin's own record (section 13, Q2).
- **Navigation.** "HR Access" in the rail and mobile menu becomes a real link **for Admin HR only**, using the existing presentation-only `isAdmin`. It sits after Assistant. For Scoped HR it is removed rather than shown as "Coming later" **(assumption)**, because it is not "coming later" for them.
- **Protection.** Add `/hr-access/:path*` to the proxy matcher. Every page uses `requireUser`, the `/session/expired` path and the retryable outage state.
- **Forbidden state.** Scoped HR on any `/hr-access` URL sees a 403 page: "HR Access is available to Admin HR only." It links to Dashboard and makes no HR-access API call. A backend `403 FORBIDDEN` from any call or Server Action renders the same state.
- **Return paths.**
  - The list keeps its URL state.
  - Detail accepts `from=/hr-access?…` through `safeReturnPath` with `/hr-access` added to its allowlist.
  - Change pages return to detail.
  - "Cancel" on a change page returns to detail without writing anything.

## 3. Information hierarchy

### List (`/hr-access`)
1. **Heading** "HR Access", subtitle "Who can see which employees", and an **Add HR user** primary button.
2. **Controls:**
   - search (`q`): "Search by name or exact email";
   - Role (`role`): All, Admin HR, Scoped HR;
   - Status (`status`): **Active** (default), Inactive, Active and inactive (`ALL`);
   - Country scope (`country`) and Department scope (`department`);
   - sort by column headers: Last updated (default, newest first), Name, Email.
   Native selects, as in the directory. Desktop applies on change; mobile uses the existing filter sheet.
3. **"Include inactive users":** when Status is Active, a one-line notice under the controls reads "Inactive users are hidden. Include inactive users", which links to `status=ALL`. This is the spec's affordance without a second control for the same parameter.
4. **Admin matching note:** when a Country or Department filter is set, a note says "Admin HR users are included because they can access all employees." This explains the backend rule instead of surprising the reader.
5. **Results:**
   - **Desktop:** a table with Name (link), Email, Role, Status (dot plus words), Access (the access record: `accessSummary.text`, with its combinations available), Version and Last updated (UTC).
   - **Mobile:** a ruled list: name and email, then role and status, then access text, then version and updated time.
   - Countries and departments appear in the Access column, not as two separate columns. The spec lists them separately, but the access summary already names both dimensions and the cross-product. The detail page shows them separately.
6. **Pagination:** Previous and Next, "Page x of y", page size 25 (100 maximum), all in the URL.
7. **Empty state:** the backend's `emptyMessage` ("No HR users match these filters.") with **Clear filters**.

### Detail (`/hr-access/[hrUserId]`), first viewport
1. Back link, then display name (h1) and email (labelled "Email (cannot be changed)").
2. **Access record.** A ruled record laid out as Role | Status | Access | Employees | Version:
   - Access is `accessSummary.text` and the combination list (`combinations[].countryName + department`);
   - Employees is `accessibleEmployeeCount`;
   - Version is `version`, with Created and Last updated (UTC).
3. **Scope** shown separately: Countries (names) and Departments. Admin rows say "All employees (Admin HR has no scope rows)".
4. **Notices:**
   - `noAccessMessage` with a **Change scope** link, for the legacy empty-scope case and any zero count;
   - an inactive notice ("Inactive: cannot sign in. Reactivate to restore the stored role and scope.").
5. **Actions:** the action links that apply, ordered by how often they are used **(assumption)**: Change scope, Change display name, Regenerate temporary password, Promote to Admin HR, then Deactivate access (destructive styling) or Reactivate access.
6. **Access history:** the audit timeline, newest first, paginated (section 8).

### Change pages (shared layout)
- **Desktop:** the form (left, about 26rem) beside the preview panel (right), the same layout as salary adjust.
- **Mobile:** stacked, with the preview below.
- **Order:** the current access record first, then the form, then the preview, then Confirm.

## 4. Journeys

Each write follows section 5 (preview and confirm), section 6 (concurrency and outcomes) and section 7 (password handling).

1. **Find an HR user:** search, filter, sort and page on the list, then open detail. All of it is URL state, validated against the `listHrUsers` parameter schemas before any call. An invalid link shows "Some filters in this link are not valid" with Reset, and makes no call.
2. **Create Admin or Scoped HR user (`/hr-access/new`):**
   - Fields: Display name (1–100 characters), Email (format and 254-character limit from the contract), Role as a radio (Scoped HR or Admin HR), and for Scoped HR the Countries and Departments checkbox groups (section 9).
   - Choosing Admin HR hides and clears the scope groups and shows "Admin HR can access all employees. No scope is stored."
   - Preview, then Confirm "Create HR user", then the one-time password panel (section 7), then **Done** goes to the new user's detail.
3. **Combined scope selection:** both lists are chosen together. The backend preview returns the exact cross-product (`proposed.accessSummary.combinations`) and the count (`proposed.accessibleEmployeeCount`). An empty list on either side shows "This scope grants access to no employees." Create blocks it, because the backend requires at least one of each; Change scope only warns.
4. **Display-name edit (`/name`):** one field. The preview shows old and new name, with "No sessions are revoked." Confirm reads "Save display name".
5. **Promote Scoped HR to Admin HR (`/promote`):**
   - The preview shows role Scoped HR → Admin HR, the removed countries and departments struck through, access becoming "All employees", and the count.
   - It warns with the session count: "{sessionsToRevoke} active sessions will end. {Name} must sign in again." The message varies for 0 or 1 sessions.
   - Confirm reads "Promote to Admin HR". The page also says this cannot be undone in this version, because demotion is not supported.
6. **Deactivate access (`/deactivate`):**
   - A reason is required (1–2,000 characters, with a counter near the limit).
   - The preview shows status Active → Inactive, "Access to no employees", and "{n} active sessions will end immediately".
   - For the signed-in Admin's own record, add: "You will be signed out as soon as you confirm."
   - Confirm reads "Deactivate access" (destructive).
7. **Reactivate access (`/reactivate`):**
   - A reason is required (1–500 characters).
   - The preview shows status Inactive → Active and the restored stored role and scope with its count, and "Old sessions are not restored; {name} must sign in."
   - Confirm reads "Reactivate access".
8. **Regenerate temporary password (`/regenerate-password`):**
   - A reason is required (1–2,000 characters).
   - The preview shows the target, the fixed `warning` text, and "{sessionsToRevoke} active sessions will end."
   - Confirm reads "Regenerate temporary password", then the one-time password panel.
   - **Self-regeneration:** the action is hidden on your own record. A direct URL gets `409 SELF_PASSWORD_REGENERATION_FORBIDDEN` at preview, which renders the backend message "Ask another active Admin HR user to regenerate your temporary password." No form submission is possible.
9. **Create replay and credential recovery:** if a create confirmation result has `credentialRecoveryRequired: true` (a replay), the page shows the user as created. It then reads: "The temporary password was shown only in the original response and cannot be shown again." followed by the backend `temporaryPasswordNotice`, and a primary **Regenerate temporary password** link to `/hr-access/{id}/regenerate-password`. A regeneration replay does the same, with a **Preview a new regeneration** link.
10. **Audit history:** see section 8.

## 5. Preview and confirmation (shared behaviour)

- **Preview writes nothing.** The panel heading reads "Preview: nothing has changed yet", and takes focus.
- **What the panel shows,** as a change record of Before and After:
  - only the `changedFields` rows, plus the access summary and the employee count (before and after);
  - `sessionsToRevoke` as a sentence, for promotion, deactivation and regeneration;
  - `reason` as entered;
  - "Based on version {expectedVersion}" and "This preview is valid until {previewExpiresAt} UTC".
- **`changed: false`:** "This would change nothing." There is no Confirm button and no audit event; the only option is to edit.
- **Separate confirm action.** The confirm button names the action. The backend decides whether the preview is valid, and the UI never enables a confirm the backend did not preview.
- **Editing any input after a preview** marks it "Out of date: your inputs changed" and replaces Confirm with **Preview again**, as in salary.
- **Expiry** is a timer on `previewExpiresAt`. When it passes, Confirm is replaced by "This preview has expired. Preview again." A backend `PREVIEW_EXPIRED`, `PREVIEW_MISMATCH` or `PREVIEW_INVALID` on confirm shows the same state with that reason's plain copy.
- **Idempotency key.** One key (`crypto.randomUUID()`, which matches `^[A-Za-z0-9_-]{16,128}$`) per confirmation of a preview. It is created by the client component and passed to the Server Action, which sends the `Idempotency-Key` header. **Try again** after an uncertain result reuses the key. A new preview or a stale result gets a new key. The key never enters the URL, storage, logs or the audit view.
- **Cancellation.** "Cancel" on any change page returns to detail with no write. Focus returns to the action link that opened the page **(assumption: via the `from` anchor)**.

## 6. Concurrency, retries, and truthful outcomes

- **`409 STALE_VERSION` (preview or confirm):**
  1. The Server Action immediately reloads `getHrUser`.
  2. The page shows an alert, "This HR user changed while you were working". It takes focus.
  3. Under it, a three-part record: **When you started** (the old preview's `current`), **Now** (the fresh detail), **Your unsaved choice** (the form values, kept).
  4. Confirm is replaced by **Preview again**, which uses the new `version`. Nothing is auto-previewed or auto-confirmed, matching the spec ("must preview and confirm again").
- **`409 DUPLICATE_OPERATION`:** "This action was already submitted with different details. Reload to see the current state." No retry with that key.
- **Uncertain result** (`503 SERVICE_UNAVAILABLE`, timeout, or a network failure on a confirm):
  - Show "We could not confirm whether this was saved. Nothing is shown as changed."
  - **Check again** retries with the **same** key. A replay returns the original outcome (create and regenerate then report `credentialRecoveryRequired`), and a failed first attempt simply runs.
  - **View current record** opens detail. The page never claims success it has not received.
  - If the retry happens after re-sign-in, the backend returns `PREVIEW_INVALID`, because replays are session-bound. The page then says "Your session changed. Check the current record, then preview again."
- **Success** is shown from the response's persisted state. That means `hrUser` (role, status, scope, `accessibleEmployeeCount`, `version`), the `auditEvent` action and time, and `revokedSessionCount` ("2 sessions ended").
  - **Changes without a password** go straight back to detail with `router.replace`, following the 03b rule (no completion flag in the URL). Detail's outcome line reads from the newest audit event, for example "Last change: Scopes replaced by Meera Iyer on … (version 5)". It reads the same for anyone, so a URL cannot fake it. Focus lands on that line.
  - **Create and regenerate** stay on their page to show the password panel (section 7) until Done.
- **`changed: false` confirmation:** "Nothing changed. No audit event was written."
- **Last active Admin** (`409 LAST_ACTIVE_ADMIN` at preview or confirm): show the approved message, "You cannot deactivate the last active Admin HR user. Activate or create another Admin first.", with links to Add HR user and to the inactive Admins list (`role=ADMIN&status=INACTIVE`). There is no confirm and nothing changes.
- **Duplicate email** (`409 EMAIL_TAKEN`, preview or confirm): the field error and the summary read "An HR user with this email already exists." Entered values are kept, and nothing else about the existing account is shown.
- **Validation (`400`, `422 INVALID_SCOPE`):**
  - Client-side checks mirror the contract only for format and length: required fields, email pattern, the 100-character name, the reason lengths, and at least one country and department for a new Scoped user. They feed field errors and a linked error summary that takes focus.
  - Backend `400` and `422` render as a form-level alert, because `ErrorResponse` has no field paths (Q5). All values are kept.
- **Self-deactivation success:** after the 200, the response is shown briefly as "Your access was deactivated. You are now signed out.", then the page moves to `/session/expired`, because the actor's session is revoked (Q3).

## 7. One-time temporary password (security handling)

**Where the password exists:**
- Only in the trusted response of the `createHrUser` or `regenerateHrUserPassword` Server Action, returned to the client component that called it.
- It is held in that component's React state only. It is not in a Server Component prop, an RSC payload, the URL, `localStorage` or `sessionStorage`, a cookie, analytics or a log. The action and `fail()` logging already exclude bodies, and the brief keeps it that way.
- It is never refetched; no later read can return it.

**The panel:**
- An `<output>` labelled "Temporary password, shown once".
- It is **masked by default** **(assumption)**, with a **Show password** toggle (`aria-pressed`) and a **Copy password** button (`navigator.clipboard.writeText`). The copy button confirms "Copied" in a polite status, and a fallback selects the text when the clipboard API is refused.
- The value uses the DESIGN.md `credential` monospace token, with `autocomplete="off"`, `spellcheck=false`, `translate="no"` and `data-sensitive`. **(Assumption:** `data-sensitive` is a hook for screenshot masking in tests.)
- The backend's `temporaryPasswordNotice` is quoted exactly: "Share this temporary password through an approved channel. It is shown only once and no email was sent."
- Above Copy: "Use an approved channel outside this demo. Do not paste it into chat, email or tickets you cannot control." **(assumption on wording; the approved notice is primary)**.
- Nothing says or implies an email was sent.

**Leaving the panel:**
- **Done, I have shared it** clears the state and replaces the route with detail, so Back cannot return to the panel. The panel's component unmounts, and no copy is kept.
- A `beforeunload` prompt guards tab close and reload while the panel shows. In-app navigation away shows the same loss warning in text beside the panel; it cannot be blocked reliably in the App Router.

**Elsewhere:**
- The replay path (`temporaryPassword: null`) never renders an empty panel; it renders the recovery state (journey 9).
- **Audit and views** never show credentials, hashes, session IDs or idempotency keys. The contract's `AccessAuditEvent` has none of these, and the UI adds none. `TEMPORARY_PASSWORD_REGENERATED` events show the action, actor, reason, version and "{n} sessions ended" only.
- **JWT** stays in the HttpOnly cookie. Server Actions read it server-side; the browser never sees it.

## 8. Audit history

- **Endpoint:** `listHrUserAccessAudit`, newest first, 25 per page, paginated with "Page x of y". Focus moves to the "Access history" heading after a page change.
- **Each event:**
  - an action label: Created, Scopes replaced, Display name changed, Promoted to Admin HR, Deactivated, Reactivated, Temporary password regenerated, and the legacy Country or Department scopes changed;
  - time (UTC);
  - actor display name, or "System setup" when `actor` is null;
  - the resulting version, or "not recorded" when null;
  - `revokedSessionCount` when it is not null;
  - the reason when present.
- **Before and after:** a change record of only the fields that differ between `before` and `after` (display name, role, status, countries, departments). This comparison is display logic over backend values, not authority. `before: null` means creation, so only "After" is shown. A legacy `displayName: null` shows "Not recorded".
- **Immutability:** the timeline is read-only, with no edit or delete affordance. A caption says "Access history cannot be changed."
- **Mobile:** each event becomes a ruled block, and the before and after rows stack.

## 9. Scope selection (accessible multi-select)

- **Two native checkbox groups,** each a `<fieldset>` with a `<legend>`: Countries (names, with codes as values) and Departments. They are full-row label targets like the sign-in account rows, with Select all and Clear per group. This avoids a custom listbox or combobox: there are only 2 countries and 5 departments today. If options grew past about 12, the group would gain a filter field, but it would stay a checkbox list.
- **Live, local summary:** "{c} countries × {d} departments = {c×d} combinations" updates as boxes change. This is a count of the selection, not access. The count of employees and the exact combination list come only from the backend preview.
- **In the preview,** the combination list renders as a ruled list, "India + Tech", one combination per line. It wraps at 200% zoom and at 390px with no horizontal scroll. On desktop with 4 or more combinations, it can show as a small matrix (rows are countries, columns are departments, cells ✓). It always has the list underneath, which is the accessible source **(assumption)**.
- **The employee count** is the most prominent number in the preview: "Estimated employees in access: 2,431 (was 1,180)". It comes from `proposed.accessibleEmployeeCount` and `current.accessibleEmployeeCount`.
- **Empty side:** the backend preview text, "This scope grants access to no employees." On create, the client blocks preview with a field error for the empty group.
- **Option source:** an open question (Q1). The plan uses the contract's enums for `listHrUsers` `country` and `department` until the backend confirms or provides an assignable-values source.

## 10. States

| State | Treatment |
|---|---|
| Loading | Skeletons specific to the list, detail and audit, plus "Loading HR users…" status text; nothing editable during the first load |
| Empty list | `emptyMessage` plus Clear filters; with status Active, also "Include inactive users" |
| Invalid list URL | "Some filters in this link are not valid" with Reset filters; no API call |
| Not found | `404` on detail or a change page: the existing not-found page ("HR user not found"); no data |
| Forbidden | Scoped HR (by session role, or any backend `403`): "HR Access is available to Admin HR only." No list, counts or names |
| Expired or revoked session | The existing `/session/expired` flow, also after self-deactivation, promotion of self (not possible) or own sessions being revoked |
| Validation | Field errors plus a focused, linked summary; values kept |
| Duplicate email | "An HR user with this email already exists." on the field and the summary |
| Stale | Alert plus When you started / Now / Your unsaved choice; Preview again |
| Preview expired, mismatch or invalid | Confirm replaced by Preview again, with plain-language reason copy |
| Last active Admin | The approved message; no confirm |
| Self-regeneration | The backend message; no form |
| Uncertain result | "We could not confirm whether this was saved." Check again (same key) and View current record |
| Unavailable (reads) | The existing `ServiceUnavailable` with retry; the session is kept |
| Unexpected response | The existing `UnexpectedResponse` (contract validation failed) |
| Empty-scope legacy user | `noAccessMessage` plus Change scope; access record "Access to no employees"; count 0 |
| Inactive user | Status dot (grey) "Inactive", inactive access text, the reactivation notice; the employee count follows Q4 |
| Success (change) | Persisted result panel, then detail; "Last change" line from the newest audit event |
| Success (create or regenerate) | The one-time password panel (section 7), then detail |
| Replay (create or regenerate) | The recovery state with Regenerate temporary password |
| No change | "Nothing changed. No audit event was written." |

## 11. Responsive, accessibility, keyboard, and focus

- **Desktop:** the list is a table inside a focusable scroll region only at narrow desktop widths. The change pages put the form beside the preview.
- **Mobile (390px):** the list becomes a ruled list, the filter sheet is reused, and change pages stack the preview below the form. The access record wraps into label and value rows.
- **No page-level horizontal overflow at 200% zoom** (720px CSS width). Combination lists wrap, and money-free numbers use tabular figures.
- **Keyboard order:** heading, then Add HR user, controls, results, pagination. On change pages: form fields, then Preview, then the preview panel, then Confirm, then Cancel.
- **Focus:**
  - after preview: the preview heading;
  - after a validation failure: the error summary;
  - after a stale or uncertain result: its alert;
  - after success: the "Last change" line on detail. With a password, the panel's heading, then Copy;
  - after Done: the detail h1;
  - after Cancel: the opening action link;
  - after an audit page change: the "Access history" heading.
- **Announcements:** a polite live region says "Preview ready", "Saved" or "Updating…", as in the existing transition helpers.
- **Labels and colour:** every control has a visible label. Status, role and access colours always come with words. The destructive styling (deactivate) is reserved for that action.
- **Axe:** no serious or critical findings on every major state (section 12).

**Architecture (for Task 05):**
- Server pages read the session and data behind `<Suspense>`. Following the dashboard's documented reading of the Next.js 16 guides, there is no `use cache`: every response is per-Admin and must be current.
- `'use server'` actions do every preview and write: they read the cookie, call the API client and return a typed outcome.
- New contract operations are added to the allowlist and regenerated, with runtime validators. `HrUser` in the session layer gains the contract's `user.id` (Q2), for self-detection only.

## 12. Browser test plan (real backend, isolated synthetic database)

Each journey runs on desktop 1440×900 and mobile 390×844, with overflow and axe checks on each major state. Emails are unique per run and project, for example `qa.{project}.{timestamp}@acme.com`. Passwords are read from the page only into test memory, never written to fixtures, logs or screenshots. **[S]** marks a step that needs the sign-in decision in the issue. With option 2, replace it with `POST /api/v1/auth/login` and a session cookie set from the test, the dashboard tests' pattern.

1. **Create a Scoped user and sign in with the one-time password [S].** Admin creates IN × Tech. The preview shows "India + Tech" and a count. Confirm, read the password from the panel (revealed), Copy, then Done.
   - Assert: the URL has no password; `document.documentElement.outerHTML`, `localStorage`, `sessionStorage` and history URLs do not contain it; Back does not reshow it; screenshots are taken only with the panel masked.
   - Sign in as the new user in a second context. The shell scope reads "India and Tech"; the directory count equals the preview count.
2. **Lost create response, then replay, then regeneration [S].** A test-only proxy, like the dashboard failure proxy, forwards `POST /api/v1/hr-users` to the real backend but answers the browser with 503 after the backend commits.
   - The UI shows the uncertain state. Check again (same key) gives the replay: the recovery state, with no password panel. Regenerate temporary password: preview (with the warning), confirm, then the new password panel.
   - Sign in with it succeeds. One user exists with that email (list search).
3. **Scope replacement, applied on the next request [S].** The user from journey 1 is signed in. Admin replaces IN × Tech with IN, US × Tech, Support. The preview shows 4 combinations and the new count; confirm.
   - The user's next request shows the new scope and the directory count equals the preview count, with no re-sign-in.
4. **Promotion and session revocation [S].** The user is signed in. Admin previews promotion: removed scopes struck through, "1 active session will end". Confirm.
   - The user's next request goes to sign-in. After signing in again, the scope reads "All employees".
5. **Deactivate, reactivate, old-session rejection [S].** The user is signed in.
   - Deactivate requires a reason: an empty reason gives an error, then the preview shows sessions ending. Confirm. The user's next request is rejected, and signing in fails with the generic message.
   - Reactivate requires a reason: confirm. The old session stays rejected; a fresh sign-in works with the stored scope.
6. **Last-active-Admin block.** With Meera as the only active Admin (the test first deactivates any Admin it created earlier, through the UI), Meera opens her own Deactivate page and previews. The approved message appears with no confirm, and the version is unchanged on detail.
7. **Stale concurrent edits.** Two Admin contexts open the same user's Change scope page. A confirms. B previews (or confirms an earlier preview) and gets the stale alert with Then, Now and Your choice. B must preview again, then confirms successfully. Detail shows two audit events.
8. **Duplicate email.** Create with an existing email in different case, such as `MEERA.IYER@ACME.COM`. The field error and summary read "An HR user with this email already exists." No user is created.
9. **Scoped HR forbidden.** Rohan opens `/hr-access`, `/hr-access/new` and `/hr-access/1/scope`. Each shows the forbidden state with no names or counts, and HR Access is absent from his navigation.
   - Through the API, Rohan's token gets `403` on `listHrUsers` and on a write preview.
   - A component test covers a Server Action returning `FORBIDDEN` mid-flow, because a browser cannot produce that state.
10. **Audit history.** After journeys 1 and 3–5, detail shows Created, Scopes replaced, Promoted, Deactivated and Reactivated, newest first. Each has actor Meera, before and after values, reasons, versions and session counts. The page HTML contains no password, `$argon2id$` or idempotency key.
11. **Self-regeneration.** Meera's own record has no Regenerate action. Opening the URL directly shows the backend's `SELF_PASSWORD_REGENERATION_FORBIDDEN` message.
12. **Edit invalidates preview; expiry.** Changing a checkbox after a preview shows "Out of date" and Preview again. Expiry is a component test with a fake clock, rather than waiting 5 minutes in a browser.
13. **List.** Search a partial name and an exact email; Role, Status and Country filters (the Admin-match note shows); Include inactive; the sorts; page 2. Reloading keeps the state, and an invalid link makes no call (the counter proxy).
14. **Desktop, mobile, keyboard and 200% zoom.** A keyboard-only create-and-preview path, filtering, and opening the audit timeline; a 720px viewport with no overflow; axe on the list, detail, each preview, the stale state, the password panel (masked) and forbidden.

**Ordering and isolation:**
- Journeys that create Admins (4) leave them active. Journey 6 therefore deactivates them first, or runs before 4 **(assumption)**.
- The seed has only Meera and Rohan, so every created user is new per run.
- The backend login limiter counts failed sign-ins per caller and email. Journey 5's failed sign-in counts once per run and stays under the limit.

## 13. Exact OpenAPI questions

| # | Question |
|---|---|
| Q1 | **Assignable scope values.** No operation lists the countries and departments that `previewHrUserCreation` and `previewHrUserScopes` accept. The request items are only `pattern: ^[A-Z]{2}$` and free strings up to 100 characters. The `listHrUsers` `country` and `department` enums (`IN`, `US`; `Tech`, `HR`, `Finance`, `Operations`, `Support`) exist, and `getDirectoryOptions` returns only values present among employees. Is the `listHrUsers` enum the supported source for the scope checkboxes? If not, can the backend publish one (for example `GET /api/v1/hr-users/scope-options` → `{ countries: [{ code, name }], departments: [name] }`)? |
| Q2 | **Self-identity.** Does `CurrentUserResponse.user.id` always equal `HrUserView.hrUserId` for the same account? The UI needs it only to hide self-regeneration and add the self-deactivation warning; the backend remains the authority. |
| Q3 | **Self-deactivation response.** When an Admin deactivates themselves (another Admin active), is the `200 HrUserChangeResult` always delivered on the now-revoked session, with only subsequent requests returning `401`? The UI shows the result, then moves to `/session/expired`. |
| Q4 | **Inactive users' count.** For `status: INACTIVE`, `accessSummary.kind` is `INACTIVE` ("access to no employees"). Is `HrUserDetail.accessibleEmployeeCount` 0, or the count the stored scope would grant on reactivation? And is `noAccessMessage` null for an inactive user with a non-empty stored scope? The UI labels the number differently in each case. |
| Q5 | **Field-level errors.** `ErrorResponse.error` has only `code`, `message` and `reason`, and the `reason` enum has no HR-access values. For `400 VALIDATION_ERROR` and `422 INVALID_SCOPE` on create, scope and reason operations, is the message safe to show verbatim? Will there be a field indicator, or should the UI rely on its own contract-derived checks and show backend 400 and 422 as a form-level alert? |
| Q6 | **Preview vs confirm parity for `EMAIL_TAKEN` and `LAST_ACTIVE_ADMIN`.** The OpenAPI lists `EMAIL_TAKEN` on both create operations and `LAST_ACTIVE_ADMIN` on both deactivate operations. Is the same `message` text guaranteed on both, so the UI can show the backend message and not duplicate the approved copy? |
| Q7 | **Replay detection on change operations.** `HrUserChangeResult` has no replay flag. The `Idempotency-Replayed: true` header exists. Should the UI distinguish "already applied earlier" from "applied now" on a Check again retry, for example by reading that header in the Server Action? Or is the persisted result enough? (The plan shows the persisted result either way.) |
| Q8 | **Promoting an inactive Scoped user** (11, open decision 3) is allowed by the backend. Should the UI offer Promote for inactive users, or only for active ones? The plan offers it with a note "This user stays inactive" until decided. |
| Q9 | **List `direction` default.** The response says the default is `desc` for `updatedAt` and `asc` otherwise, but the OpenAPI `direction` parameter has no `default`. Can the OpenAPI publish it, so the frontend can omit defaults from URLs without assuming them? |
| Q10 | **Audit page size.** Is 25 the intended page size for the detail timeline? Is there an order guarantee for events with the same `occurredAt` (newest first by id)? |

## 14. Assumptions

- **Sign-in:** option 1 of the issue (an "Another HR account" mode on `/sign-in`) is approved before Task 05. Otherwise, the **[S]** steps switch to API sign-in.
- **Navigation:** HR Access is shown to Admin HR only, after Assistant, and removed for Scoped HR.
- **One page per change operation** (section 2). Detail is read-only, with action links.
- **The password panel** is masked by default with Show and Copy. Leaving needs "Done, I have shared it"; tab close and reload get a `beforeunload` prompt. An extra caution line sits above Copy.
- **The combination matrix** is optional, from 4 combinations on desktop, always with the list beneath.
- **Action order** on detail is as listed in section 3. The countries and departments columns are merged into Access on the list.
- **Scope checkboxes** use the `listHrUsers` enums until Q1 is answered.
- **Journey 6** runs before Admins are created, or deactivates them first.

## 15. Exclusions

Not planned, per `docs_human/12` "Deliberately excluded" and the task:
- SSO, MFA, password reset email, email delivery, and forced first-login password change;
- self-service password change;
- Admin-to-Scoped demotion, custom roles, per-employee grants and paired scopes;
- an approval workflow and audit deletion or editing;
- showing or recovering an old temporary password;
- HR-access controls inside the assistant or dashboard;
- AI-observability UI.

## Confirm and stop

Following `shape.md`, this brief is returned for one confirmation or correction round, and work stops here.

**Not done:** no production code, tests, generated contract, `PRODUCT.md`, `DESIGN.md`, `.impeccable/` brief, backend or human specification changes.

**Confirmations:**
- Only this response and `builder_docs/frontend-builder/issues/05a-created-hr-users-cannot-sign-in.md` were written, both in this worktree.
- No Git command was run, and nothing was committed or pushed. No `.env` file was read, and no real credential was handled.
- No API field was invented. Every name above comes from `express-backend/openapi/openapi.json` or the backend responses. Anything missing is in section 13.
