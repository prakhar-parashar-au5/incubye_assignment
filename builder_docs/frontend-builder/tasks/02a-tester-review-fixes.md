# Frontend review fixes after tester pass 01

**Status:** READY

## Read first

- `tester_docs/responses/01-hr-browser-review.md`
- `docs/code-reviews/01-tester-feedback-triage.md`
- `builder_docs/responses/08-ai-assistant-mcp-fix.md`

## Required fixes

1. Keep every directory sort icon visually attached to its label. Remove header alignment that makes an icon appear to belong to another column. Verify wrapped and right-aligned headers at 1024, 1280, 1440, and 1920 pixel widths.
2. Clear assistant conversation state after client-side navigation away from Assistant and back. Add a browser regression test that uses application navigation, not a full page reload.
3. Change assistant rate-limit copy. Do not say `Wait a minute` for a 15-minute backend window. Use accurate non-promissory text unless reset time is available.
4. When the server-side defensive scope filter removes records, do not reveal the exact hidden count. Show a generic warning.
5. Regenerate the frontend API contract from the updated backend OpenAPI. Support required `recordedAt` on recent-change cards.

## Verification

- Existing frontend checks and build.
- Focused component tests.
- Browser regression for navigation reset.
- Desktop table screenshots at the four widths.
- Mobile directory and assistant.
- Keyboard path.
- Automated accessibility scan.
- Impeccable critique or audit for changed surfaces.

Do not modify backend files or add new product features. Do not run Git commands.

## Response

Write:

```text
builder_docs/frontend-builder/responses/02a-tester-review-fixes.md
```
