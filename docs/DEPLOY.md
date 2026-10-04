# Deploying the hosted demo (SIMULATED)

> **Deployed (Vercel production): <https://rural-health-radio.vercel.app>.** The hosted demo is the same simulated service and synthetic data as the local build, with a conspicuous banner on every screen: _"Hosted demo: state may reset; durable journal is demonstrated in the local build and tests"_.

## Which option?

| Option                                         | Reliability for the Noor journey                                                                                                                                                                              | Use when                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| **A. Vercel + a Postgres database (deployed)** | Reliable: every function instance replays and appends to one shared command log, so concurrent instances agree (verified with 30 parallel requests). Without a database URL, state is per instance and flaky. | You want a Vercel URL (this is what is live). |
| **B. Docker on a container host (Render)**     | Reliable: one long-lived Node process holds all state. Free tiers sleep when idle and reset state. Image not built here (no Docker on the build machine).                                                     | You prefer a single process and no database.  |

Both run the same service code (`src/server`) in **hosted demo mode** (`RHR_HOSTED=1`, set automatically by the Dockerfile, `render.yaml` and the Vercel entry).

## Option B. Render (Docker)

Files: `Dockerfile`, `.dockerignore`, `render.yaml`.

1. The repo is at GitHub `Hungr-yy/HealthMesh` (Render needs a GitHub-connected account).
2. Render dashboard -> **New** -> **Blueprint** -> select the repo. Render reads `render.yaml` (Docker web service, free plan, health check `/api/health`, auto-deploy off).
   - Or **New** -> **Web Service** -> the repo, **Runtime: Docker**, health check path `/api/health`, env `RHR_HOSTED=1`.
3. Wait for the build (`npm ci` + `npm run build:server`). Render injects `PORT`; the service reads it and binds `0.0.0.0` (`RHR_HOST`).
4. The public URL is `https://<service-name>.onrender.com`. Open it; the yellow hosted-demo banner must be visible.

Run the same image anywhere with Docker: `docker build -t rhr-demo . && docker run --rm -p 8787:8787 rhr-demo` (then http://localhost:8787). Without Docker: `npm ci && npm run build:server && npm run start:hosted`.

## Option A. Vercel (what is deployed)

Files: `vercel.json`, `scripts/build-hosted.ts`, `src/server/vercel.ts`, `src/server/shared-journal.ts`, `src/server/pg-store.ts`.

The build produces a **Build Output API v3** directory (`.vercel/output`): the Vite build as static files, plus one Node 22 function `api` (the bundled service) behind `/api/*`.

**Why a database.** Serverless instances do not share memory, and Vercel starts several under concurrent requests (measured: 30 parallel reads returned three different simulator states without a shared store). The hosted demo therefore keeps its command log in Postgres: before serving a request an instance replays commands other instances appended; after, it appends its own atomically (advisory lock plus an optimistic "nothing changed meanwhile" check, with a clean retry). The engine is unchanged; state is still a pure replay of the log. Without `RHR_DATABASE_URL` the function falls back to per-instance memory (not reliable).

Steps used:

1. Create a Postgres database (a free Neon project in `aws-us-east-1`, next to Vercel `iad1`). The table is created on first use.
2. `vercel link --project rural-health-radio` (note: with Vercel CLI 59, a `render.yaml` in the directory makes `vercel link` fail with a "services" error; move it aside for that one command).
3. `vercel env add RHR_DATABASE_URL production --sensitive` (paste the connection string).
4. `vercel build --prod` then `vercel deploy --prebuilt --prod --yes`. (`vercel.json` sets framework Other, `npm ci`, `npm run build:vercel`. The function runtime is `nodejs22.x`; `nodejs20.x` is rejected by Vercel.)
5. New projects have Deployment Protection (SSO) on, which returns 401 to the public. For a public demo disable it: Project -> Settings -> Deployment Protection, or `PATCH /v9/projects/<id>` with `{"ssoProtection": null}`.

Check any deployment: `npx tsx scripts/api-roundtrip.ts https://<your-url>` (submit, relay, clinician approval, reply opened, operator view has no content, reference alone is 401).

Limits: the database is a cold-start-sensitive free tier (the first request after idle can take about a second longer); every visitor shares one demo state; **Simulator -> reset** returns to a clean start.

## Verify locally before deploying

```bash
npm run build:server && RHR_HOSTED=1 node dist-server/server.mjs   # option A, the exact bundle the image runs
npm run build:vercel && npx tsx scripts/vercel-sim.ts               # option B, via a Node stand-in for the platform (port 4174)
```

Browser suites against each (screenshots and axe go to `RHR_E2E_OUT`, never over `docs/`):

```bash
RHR_E2E_TARGET=hosted     RHR_E2E_OUT=/tmp/hosted-out npx playwright test
RHR_E2E_TARGET=vercel-sim RHR_E2E_OUT=/tmp/vsim-out   npx playwright test
```

See [VERIFICATION.md](../VERIFICATION.md) section 7 for what was run and what could not be.

## Limitations (hosted mode)

- **The on-disk journal is not what runs on Vercel**: the hosted demo's "journal" is a database table. The "Restart service from disk" button replays that shared log, which is a fair demonstration of replay, but fsync/torn-write recovery and the real-process SIGKILL test are demonstrated only in the local build and the test suite. On Render the journal is on the container's ephemeral disk and is wiped on redeploy or spin-down.
- **The simulator controls are public and unauthenticated** by design (they are the demo harness). Anyone with the URL can reset or advance the shared demo. Set `RHR_SIM_CONTROLS=off` to remove them (the demo then cannot move time).
- **One shared demo state**: concurrent visitors see and change the same cases.
- Demo tokens are not authentication; all data is synthetic. Not a medical device.
