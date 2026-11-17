# Test observations (text evidence)

Run window: 2026-11-17 09:21:13–09:39:38 UTC. Source was the visible Chrome UI/accessibility tree on `http://localhost:3228`; no API or database inspection was used. No screenshot files were persisted because the available screenshot operation returned only an inline image. The exact browser observations below support the report without storing salary values or credentials.

- **E1 — Sort:** `/hr-access`; Name link first showed `?sort=name&direction=asc`; second activation showed `?sort=name`, with Name still identified as ascending and rows still in the same order.
- **E2 — Pagination:** `/hr-access` rendered “Page 1 of 1 · 2 users” with active Next link `?page=2`; page 2 rendered “No HR users match these filters.” After creation, list rendered “Page 1 of 1 · 3 users” and continued to expose an active Next link.
- **E3 — Search/filter:** exact-name search `Rohan Mehta` and Admin HR role filter each displayed “The compensation service is not responding. Your session has not been ended. Try again in a moment.” Exact-name retry reproduced it.
- **E4 — Create route:** after one successful create, returning to `/hr-access/new` through Add HR user displayed “Create HR user complete” and the previously created account summary instead of a fresh form.
- **E5 — Scoped employee and request:** newly created account showed “Scoped HR,” access “India and Support,” and 1,755 employees; it opened an in-scope employee page. Request ID `89486b80-e60d-4b00-92c3-1dd59921e284` was pending, then showed Cancelled after Meera’s action and after Reload in the requester’s session. The page stated compensation did not change and retained compensation version 1. Sensitive salary amounts are intentionally omitted.
- **E6 — Last-admin safeguard:** preview on `/hr-access/1/deactivate` displayed “You cannot deactivate the last active Admin HR user. Activate or create another Admin first.” The confirm action was not taken.
- **E7 — AI and assistant:** both persona conversations persisted the unavailable-provider state after Reload. Meera’s monitoring list showed one failed `not_configured` trace; after the raw-view warning, the raw tab was available. The trace was marked reviewed and left undeleted.
- **E8 — Scope denial:** Rohan had no HR Access or AI monitoring navigation. Direct HR Access and AI monitoring URLs showed Admin-only denial states.
- **E9 — Sign-out navigation:** after Scoped HR sign-out, browser Back moved between sign-in routes, Forward returned to the sign-in route with “You have signed out,” and no protected employee/request details appeared.
- **E10 — Dashboard:** Meera saw the all-employee view; Rohan saw India, Support, and Tech only. Compensation was separated by currency in each dashboard.

## Screenshot status

No screenshot file is present in this directory. `app.getScreenshot()` displayed the current page inline but did not return a path or a save action. The native screenshot shortcut had previously switched focus to an unrelated user Chrome window, so I did not risk capturing another user's tab/window. See the issue report.
