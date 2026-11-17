# Railway deployment runbook

How to deploy the ACME Compensation Manager to Railway as three services in one project:

| Service | Source | Reachable from |
|---|---|---|
| `MySQL` | Railway MySQL template | Private network only |
| `express-backend` | this repository, root directory `/express-backend` | Private network only (no public domain) |
| `next-frontend` | this repository, root directory `/next-frontend` | Public HTTPS domain |

```text
Browser ──HTTPS──▶ Railway edge ──▶ next-frontend ──http (private)──▶ express-backend ──▶ MySQL (private)
                                                                         └──HTTPS──▶ OpenAI API
```

Every step below was rehearsed locally on 2026-11-17 against production builds and a fresh MySQL 8.4 container (section 9). The Railway-side steps (dashboard clicks, reference variables, the Railway edge) were not run, because the rehearsal had no Railway account. Section 8 lists what that leaves unproven.

All values in angle brackets are placeholders. Never commit a real value, and never put one in a `.env` file.

---

## 1. Before you start

1. The branch you deploy contains:
   - `express-backend/generated/acme-employees.xlsx`. The seed reads it at runtime. Check it is in the GitHub tree, not only on your machine.
   - `express-backend/.nvmrc` and `next-frontend/.nvmrc` (`22.23.1`).
2. Choose three values on your own machine. Paste them only into the Railway variables editor.
   - **JWT signing key**, at least 32 bytes, random. For example:
     ```sh
     node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
     ```
   - **Synthetic demo password**, at least 12 characters. It is shown publicly on the sign-in page, so it must not be a password you use anywhere else. Both demo accounts use it.
   - **OpenAI API key**, optional. Without it the app works and the assistant records an "assistant is not configured" turn.

---

## 2. Create the project and MySQL

1. Railway dashboard → **New Project** → **Empty project**.
2. On the canvas: **+ Create** → **Database** → **MySQL**. Keep the service name **`MySQL`**. The reference variables below use that name; if you rename it, change `${{MySQL.…}}` everywhere.
3. Wait until the MySQL service is **Active**.
4. Do not create the `acme_demo` database by hand. The backend pre-deploy step creates it (`db:create:dist`), because the template only creates a database named `railway` and the Data tab has no SQL editor for MySQL.

---

## 3. Create `express-backend`

1. **+ Create** → **GitHub Repo** → pick this repository. Rename the service to **`express-backend`** (Settings → service name). The frontend's `API_BASE_URL` refers to this name.
2. **Settings → Source**
   - Root Directory: `/express-backend`
   - Branch: the branch you deploy
   - Watch Paths: `/express-backend/**`
3. **Settings → Build**
   - Builder: **Railpack** (default)
   - Custom Build Command: `npm run build`
4. **Settings → Deploy**
   - Pre-deploy Command: `npm run db:create:dist && npm run db:migrate:dist`
   - Pre-deploy Timeout: `300`
   - Custom Start Command: `node dist/src/server.js`. This starts Node directly, so Railway's SIGTERM reaches the server and it shuts down cleanly (the rehearsal logged `server_stopping`, `server_stopped`, `database_pool_closed`).
   - Healthcheck Path: `/health`
   - Healthcheck Timeout: `300` (default)
   - Restart Policy: **On Failure**
   - Replicas: **1**. The login and assistant rate limits are kept in process memory; with more replicas each keeps its own counts.
5. **Settings → Networking**: do **not** generate a public domain. Only `next-frontend` calls this service.
6. **Variables** → Raw Editor. Paste, then replace the placeholders:

   ```text
   NODE_ENV=production
   PORT=8080
   DATABASE_URL=mysql://${{MySQL.MYSQLUSER}}:${{MySQL.MYSQLPASSWORD}}@${{MySQL.MYSQLHOST}}:${{MySQL.MYSQLPORT}}/acme_demo
   JWT_SIGNING_KEY=<random value from step 1.2>
   CLIENT_IP_SOURCE=socket
   OPENAI_MODEL=gpt-6-luna
   OPENAI_API_KEY=<your OpenAI key, or leave this line out>
   RAILPACK_PRUNE_DEPS=true
   ```

7. Do **not** deploy yet. Go to section 4 first, because the first deploy also seeds.

### `express-backend` variables

| Variable | Value | Source | Notes |
|---|---|---|---|
| `NODE_ENV` | `production` | fixed | Also makes `ai:retention:dist --execute` require `--acknowledge-production`. |
| `PORT` | `8080` | set explicitly | Railway would inject one, but the private URL needs a known port, and `${{express-backend.PORT}}` only resolves for a variable defined on the service. The health check uses the same value. |
| `DATABASE_URL` | `mysql://${{MySQL.MYSQLUSER}}:${{MySQL.MYSQLPASSWORD}}@${{MySQL.MYSQLHOST}}:${{MySQL.MYSQLPORT}}/acme_demo` | Railway reference variables | `MYSQLHOST` is the private host. The path must be `/acme_demo`: the demo and fixture guards only accept names ending in `_demo` or `_test`. Validated at startup: protocol must be `mysql:`. |
| `JWT_SIGNING_KEY` | random, ≥ 32 bytes | you | Validated at startup. Changing it signs everyone out. |
| `CLIENT_IP_SOURCE` | `socket` | fixed | See below. |
| `OPENAI_MODEL` | `gpt-6-luna` | fixed | Must match `^[A-Za-z0-9._-]{1,64}$`. The code default is `gpt-6.1-sol`, so set it. |
| `OPENAI_API_KEY` | your key | you | Optional. Unset or empty means the assistant is unavailable and every other route works. |
| `RAILPACK_PRUNE_DEPS` | `true` | fixed | Build-time. Removes dev dependencies after `npm run build`, so the runtime image holds only `dist/` and production dependencies. |
| `APP_ENV`, `DEMO_MEERA_PASSWORD`, `DEMO_ROHAN_PASSWORD` | see section 4 | you | First deploy only. Remove afterwards. |

**`CLIENT_IP_SOURCE`: use `socket`, not `railway-x-real-ip`.** `railway-x-real-ip` is correct only when requests come through Railway's public edge, which sets `X-Real-IP` and overwrites any copy the client sent (`src/http/rate-limit.ts`). In this layout the backend has no public domain. Its only caller is the Next.js server over the private network, which does not pass through the edge and does not send `X-Real-IP` (`next-frontend/src/server/api/client.ts` sends only `Accept`, `Content-Type`, `Authorization`, and the idempotency headers). So with `railway-x-real-ip` every login would fall into the shared `unknown-client` bucket, and any other service on the private network could pick its own bucket by setting the header. With `socket` the key is the frontend's private address. Either way the failed-login key also includes an HMAC of the email, so the effective limit is 5 failures per account per 15 minutes, which is the designed behaviour behind Next.js (review fix 06a). Use `railway-x-real-ip` only if you ever give the backend a public domain and call it from browsers directly.

**Health check.** `GET /health` returns `200 {"status":"ok"}` without touching MySQL. Checked in the rehearsal with the MySQL container paused: still `200` in 1 ms. A healthy check therefore proves the process started and validated its configuration, not that the database is reachable. The pre-deploy step does prove the database is reachable, because the migration must connect. Railway only calls the health check during a deploy, not continuously.

---

## 4. First deploy, with seeding

The seed is destructive (it deletes all employees and compensation records, then loads the workbook) and refuses `APP_ENV=production`. Run it once, from the pre-deploy step, then remove it.

1. In `express-backend` → **Variables**, add:
   ```text
   APP_ENV=demo
   DEMO_MEERA_PASSWORD=<synthetic demo password>
   DEMO_ROHAN_PASSWORD=<same synthetic demo password>
   ```
   Use the same value for both. The sign-in page shows one shared password for both accounts.
2. **Settings → Deploy → Pre-deploy Command**, replace with:
   ```text
   npm run db:create:dist && npm run db:migrate:dist && npm run db:seed:dist -- --replace && npm run db:seed-demo-users:dist
   ```
3. Click **Deploy** (or **Apply changes** → Deploy).
4. Open the deployment → **Pre-deploy logs**. Expect, in order:
   ```text
   Created database acme_demo.
   Applied 8 migration(s); 0 already applied.
   Seeded 10000 employees and 10000 compensation records.
   meera.iyer@acme.com: created
   rohan.mehta@acme.com: created
   ```
   Then **Deploy logs**:
   ```text
   {"event":"server_listening","port":8080,"clientIpSource":"socket","assistant":"unavailable"}
   ```
   `assistant` is `configured` when `OPENAI_API_KEY` is set.
5. **Undo the seed set-up straight away.** If you skip this, every later deploy wipes all salary changes.
   1. Pre-deploy Command back to: `npm run db:create:dist && npm run db:migrate:dist`
   2. Delete `APP_ENV`, `DEMO_MEERA_PASSWORD`, and `DEMO_ROHAN_PASSWORD`.
   3. Deploy. Pre-deploy logs now show `Database acme_demo already exists.` and `Applied 0 migration(s); 8 already applied.`

The demo users are created once. Re-running `db:seed-demo-users:dist` prints `already present` and does **not** change their passwords, so `DEMO_SHARED_PASSWORD` must stay equal to the value you seeded with. This runbook has no rehearsed way to change the demo password later; choose it carefully.

Alternative, if you use the Railway CLI yourself: leave the pre-deploy command alone and run the two seed commands once in a shell on the service (`railway ssh`, service `express-backend`), from the directory that holds `package.json`:

```sh
APP_ENV=demo npm run db:seed:dist -- --replace
APP_ENV=demo DEMO_MEERA_PASSWORD='<…>' DEMO_ROHAN_PASSWORD='<…>' npm run db:seed-demo-users:dist
```

This path was not rehearsed (the rehearsal had no Railway login).

---

## 5. Create `next-frontend`

1. **+ Create** → **GitHub Repo** → the same repository. Rename the service to **`next-frontend`**.
2. **Settings → Source**
   - Root Directory: `/next-frontend`
   - Watch Paths: `/next-frontend/**`
3. **Settings → Build**
   - Builder: **Railpack**
   - Custom Build Command: `npm run build`
   - The build needs dev dependencies (Tailwind, TypeScript). Railpack installs them by default. Do not set `RAILPACK_PRUNE_DEPS` here; pruning the frontend was not rehearsed.
   - The build needs no variables and no backend: the rehearsal built with an empty environment. That matters because the private network is not available during builds.
4. **Settings → Deploy**
   - Custom Start Command: `npm start` (`next start`, which reads `PORT` and binds `0.0.0.0`)
   - Healthcheck Path: `/sign-in` (renders without calling the backend; checked in the rehearsal backend log)
   - Restart Policy: **On Failure**
5. **Variables** → Raw Editor:
   ```text
   NODE_ENV=production
   PORT=3000
   API_BASE_URL=http://${{express-backend.RAILWAY_PRIVATE_DOMAIN}}:${{express-backend.PORT}}
   DEMO_SHARED_PASSWORD=<same synthetic demo password>
   ```
6. **Settings → Networking → Generate Domain**, target port `3000`.
7. Deploy. Deploy logs show `▲ Next.js 16.4.6` and `✓ Ready`.

### `next-frontend` variables

| Variable | Value | Source | Notes |
|---|---|---|---|
| `NODE_ENV` | `production` | fixed | Switches the session cookie to `__Host-acme_session`, `Secure`. |
| `PORT` | `3000` | set explicitly | `next start` reads `PORT` (default 3000). Set it so the domain's target port is fixed. |
| `API_BASE_URL` | `http://${{express-backend.RAILWAY_PRIVATE_DOMAIN}}:${{express-backend.PORT}}` | reference variables | Resolves to `http://express-backend.railway.internal:8080`. Use plain `http`: private-network traffic goes straight to the service port, with no TLS endpoint in front of it. The parser accepts `http:` or `https:` and rejects credentials, a query, or a fragment. Read at request time, server only. |
| `DEMO_SHARED_PASSWORD` | the demo password | you | Shown on the sign-in page. Must equal the password the demo users were seeded with. Read at request time, so changing it needs a restart, not a rebuild. |
| `API_TIMEOUT_MS` | default `5000` | optional | 100–30000. |
| `API_ASSISTANT_TIMEOUT_MS` | default `50000` | optional | 100–120000. The backend allows 45 s per assistant turn. |

No `NEXT_PUBLIC_` variables exist. `src/` and `next.config.ts` contain none, and after the rehearsal build `.next/static` contains none of the names `API_BASE_URL`, `DEMO_SHARED_PASSWORD`, `JWT_SIGNING_KEY`, or `OPENAI`. Never add one for any of these values.

---

## 6. Post-deploy smoke checklist

Run in a private browser window against the public domain.

- [ ] `https://<frontend-domain>/sign-in` loads and shows the synthetic demo password.
- [ ] Sign in as **Meera Iyer** with that password. You land on **Employees**, which shows **10,000 employees**.
- [ ] Browser dev tools → Application → Cookies: `__Host-acme_session`, `HttpOnly`, `Secure`, `SameSite=Lax`.
- [ ] **Dashboard**: scope "All employees", people counts, compensation by currency, and the breakdown tabs (Department, Country, …) load.
- [ ] **Assistant**: send "Summarize annual base salary by department."
  - Without `OPENAI_API_KEY`: "The assistant is not configured … Your message was saved."
  - With a key: an answer with cards.
- [ ] **AI monitoring** (Admin): the turn you just sent is counted. Without a key it is **Failed**, stage "Model · Model call failed", category `not_configured`. **AI traces** lists it.
- [ ] Sign out, sign in as **Rohan Mehta**. Dashboard scope reads "India, Support and Tech (permission filtered)". **AI monitoring** says "Your HR role cannot view AI monitoring."
- [ ] `express-backend` → Deploy logs show one `request` line per call, with no request bodies, tokens, or passwords.
- [ ] `express-backend` has no public domain (Settings → Networking).

---

## 7. Routine deploys and rollback

**Routine deploy.** Push to the branch. Each service rebuilds only when its watch path changed. For the backend, the pre-deploy step runs `db:create:dist` (no-op) and `db:migrate:dist`, which applies only new migrations under a MySQL named lock (`GET_LOCK`), so two deploys cannot migrate at once. If the pre-deploy step fails, Railway does not deploy the new version and the old one keeps serving.

**Rollback.** Service → **Deployments** → the last good deployment → **⋯** → **Rollback**.

- Code rollback is safe across existing migrations: the migration runner ignores recorded migrations that the older code does not have, so the older pre-deploy step succeeds.
- Migrations are forward-only. Rolling back code does not undo a schema change. A future migration that drops or renames something an older version reads would break a code rollback; keep migrations additive, or plan the rollback before shipping one.
- Data: if your Railway plan offers volume backups, take one on the MySQL service before a deploy that adds a migration. The rehearsal could not check backups.
- Roll back `next-frontend` together with `express-backend` if the API contract changed between the two versions.

**AI retention (30 days).** Nothing deletes old traces automatically. Monthly, from a shell on `express-backend` (CLI), run a dry run, read the counts, then execute:

```sh
npm run ai:retention:dist -- --retention-days 30
npm run ai:retention:dist -- --retention-days 30 --execute --acknowledge-production
```

Both were rehearsed with `NODE_ENV=production`: the dry run printed the cutoff and counts; `--execute` without `--acknowledge-production` was refused. A Railway cron service running the same command is a sensible next step.

---

## 8. What can break, and what was checked

| Risk | What happens | What I checked | Not checked |
|---|---|---|---|
| Build needs dev dependencies | `npm ci --omit=dev && npm run build` fails with `tsc: command not found`. | Reproduced locally. Railpack installs dev dependencies for the build; `RAILPACK_PRUNE_DEPS=true` removes them after. After `npm prune --omit=dev` (no `typescript`, no `tsx`), the server, `create-database`, `migrate`, `seed-database`, `seed-demo-users`, and `ai-retention` all ran from `dist/`. | Railpack's exact prune step on Railway. |
| Runtime assets missing | Migrate, seed, or the dashboard USD comparison fails. | `src/paths.ts` resolves the package root by walking up to `package.json`, so `dist/` reads `db/migrations/` (8 files), `data/exchange-rates/usd-inr.json`, `generated/acme-employees.xlsx`, and `openapi/openapi.json` from the service root. The rehearsal migrated and seeded from `dist/`. | Whether `generated/acme-employees.xlsx` is in the GitHub tree (I ran no Git command). |
| `acme_demo` missing | Every connection fails with `ER_BAD_DB_ERROR`. | `db:create:dist` created it on a server that had only `railway`, then reported `already exists` on the second run. | Railway's `root` grants (the template user is `root`, so it should have `CREATE`). |
| `DATABASE_URL` reference typo or a service renamed | Pre-deploy fails before deploying; the old version keeps serving. | Startup validation rejects a non-`mysql:` URL. | Railway reference resolution. |
| MySQL password with URL-special characters (`@ : / ?`) | URL parsing breaks. | Railway-generated passwords are normally alphanumeric. | The actual generated value. |
| Seed left in the pre-deploy step | Every deploy deletes salary changes and reloads the workbook. | Section 4 step 5. The rehearsal ran the full chain twice; the second run reseeded 10,000 rows and left the demo users `already present`. | |
| Wrong `API_BASE_URL` or backend `PORT` | Pages render, every data call fails (`api_request_failed` in frontend logs). `/sign-in` still passes its health check. | Config parser accepts `http://express-backend.railway.internal:8080`. Rehearsal used `http://localhost:4230`. | Railway private DNS. The backend binds `::` (dual-stack), which works for both legacy IPv6-only and newer dual-stack private networks. |
| Session cookie not set | Sign-in appears to succeed, then returns to sign-in. | `__Host-` cookies need HTTPS and `Path=/`, no `Domain`. The Railway domain is HTTPS. Locally, Chromium accepted the `Secure` cookie on `http://localhost` (verified in the rehearsal). It would fail on plain `http://<LAN IP>`. | The Railway edge. |
| Health check passes while MySQL is down | Deploy succeeds; pages show errors. | `/health` does not use MySQL (paused-DB test). The pre-deploy migration is the database check. | |
| `CLIENT_IP_SOURCE=railway-x-real-ip` set anyway | All logins share the `unknown-client` IP bucket, still per account. No outage. | `rate-limit.ts` and the frontend client headers. | |
| More than one backend replica | Rate limits are per replica. | Comments in `rate-limit.ts`. | |
| Node version drift | Different runtime than the tested lanes. | `engines.node` is `22.23.1` in both services (Railpack reads `engines` before `.nvmrc`), plus `.nvmrc`. Local rehearsal on `v22.23.1`. | Railpack resolving exactly `22.23.1`. |
| OpenAI key missing or invalid | Assistant records a failed turn; everything else works. | Rehearsed with no key: `not_configured` turn shown in the UI and in AI monitoring. | A live key on Railway. |
| Next.js server actions behind the edge | Sign-in or salary forms fail with an origin error. | Locally, sign-in worked in production mode. | The Railway edge's `Host` / `X-Forwarded-Host` headers. The smoke checklist's sign-in step covers it. |

---

## 9. Local production rehearsal (how this runbook was verified)

Run on 2026-11-17, Node `v22.23.1`, Docker `mysql:8.4` (8.4.13). Ports: MySQL `127.0.0.1:3330`, backend `4230`, frontend `3230`. All values are synthetic placeholders. The container was removed afterwards.

```sh
# MySQL shaped like the Railway template: root user, default database "railway", no server flags
docker run -d --name acme-deploy-rehearsal-mysql -p 127.0.0.1:3330:3306 --tmpfs /var/lib/mysql \
  -e MYSQL_ROOT_PASSWORD=<placeholder> -e MYSQL_DATABASE=railway mysql:8.4

# Backend: build with dev dependencies, then prune, as Railpack does
cd express-backend
npm ci && npm run build && npm prune --omit=dev
export DATABASE_URL='mysql://root:<placeholder>@127.0.0.1:3330/acme_demo'
npm run db:create:dist                      # Created database acme_demo.
npm run db:migrate:dist                     # Applied 8 migration(s)
APP_ENV=demo npm run db:seed:dist -- --replace          # Seeded 10000 employees and 10000 compensation records.
APP_ENV=demo DEMO_MEERA_PASSWORD=<pw> DEMO_ROHAN_PASSWORD=<pw> npm run db:seed-demo-users:dist   # created, created
NODE_ENV=production PORT=4230 CLIENT_IP_SOURCE=socket OPENAI_MODEL=gpt-6-luna \
  JWT_SIGNING_KEY=<placeholder ≥ 32 bytes> node dist/src/server.js

# Frontend: build with an empty environment, start with Railway-style PORT
cd ../next-frontend
npm ci && npm run build
NODE_ENV=production PORT=3230 API_BASE_URL=http://localhost:4230 DEMO_SHARED_PASSWORD=<pw> npm start
```

Then, in a browser (Playwright, Chromium): sign in as Meera → Employees (10,000) → Dashboard (Country tab) → Assistant ("The assistant is not configured", message saved) → AI monitoring (1 trace, Failed, `not_configured`) → AI traces (1 row) → sign out → Rohan → Dashboard (India, Support and Tech) → AI monitoring refused. `SIGTERM` to the backend logged a clean shutdown.

```sh
docker rm -f acme-deploy-rehearsal-mysql
```
