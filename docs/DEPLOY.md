# Deploying the hosted demo (SIMULATED)

> **Nothing here has been deployed or pushed.** The hosted demo is the same simulated service and synthetic data as the local build, with a conspicuous banner on every screen: _"Hosted demo: state may reset; durable journal is demonstrated in the local build and tests"_.

## Which option?

| Option                                           | Reliability for the Noor journey                                                                                                                                                                | Use when                                    |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **A. Docker on a container host (Render)**       | **Recommended.** One long-lived Node process holds all state, so multi-step flows (patient, clinic, operator, simulator) behave exactly as locally. Free tiers sleep when idle and reset state. | You want the link in the form to just work. |
| **B. Vercel (static + one serverless function)** | **Best effort.** Same code and API, but each warm function instance has its own in-memory state. A cold start or a second instance loses/forks state mid-demo.                                  | You specifically want a Vercel URL.         |

Both run the same service code (`src/server`) in **hosted demo mode** (`RHR_HOSTED=1`, set automatically by the Dockerfile, `render.yaml` and the Vercel entry).

## A. Render (Docker) - recommended

Files: `Dockerfile`, `.dockerignore`, `render.yaml`.

1. Push the repo to GitHub (done by you; this repo has not been pushed by the build agent).
2. Render dashboard -> **New** -> **Blueprint** -> select the repo. Render reads `render.yaml` (Docker web service, free plan, health check `/api/health`, auto-deploy off).
   - Or **New** -> **Web Service** -> the repo, **Runtime: Docker**, health check path `/api/health`, env `RHR_HOSTED=1`.
3. Wait for the build (`npm ci` + `npm run build:server`). Render injects `PORT`; the service reads it and binds `0.0.0.0` (`RHR_HOST`).
4. The public URL is `https://<service-name>.onrender.com`. Open it; the yellow hosted-demo banner must be visible.

Run the same image anywhere with Docker: `docker build -t rhr-demo . && docker run --rm -p 8787:8787 rhr-demo` (then http://localhost:8787). Without Docker: `npm ci && npm run build:server && npm run start:hosted`.

## B. Vercel

Files: `vercel.json`, `scripts/build-hosted.ts`, `src/server/vercel.ts`.

The build produces a **Build Output API v3** directory (`.vercel/output`): the Vite build as static files, plus one Node 20 function `api` (the bundled service) behind `/api/*`.

- Git import: Vercel -> **Add New Project** -> the repo. `vercel.json` sets Framework **Other**, install `npm ci`, build `npm run build:vercel`. No env vars needed (`VERCEL` is detected as hosted mode).
- CLI: `npx vercel build && npx vercel deploy --prebuilt --prod` (log in and link the project when asked).

Limits: the journal is in the function's temp directory, so state survives only while that instance stays warm; it is not shared between instances. If a demo looks reset, use **Simulator -> reset** and start again.

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

- **Restart durability is not demonstrable on free hosting**: the container/function temp disk is ephemeral. The "Restart service from disk" button works within a running instance, but a redeploy, idle spin-down or cold start wipes everything. Journal durability (including real-process SIGKILL) is demonstrated in the local build and the test suite.
- **The simulator controls are public and unauthenticated** by design (they are the demo harness). Anyone with the URL can reset or advance the shared demo. Set `RHR_SIM_CONTROLS=off` to remove them (the demo then cannot move time).
- **One shared demo state**: concurrent visitors see and change the same cases.
- Demo tokens are not authentication; all data is synthetic. Not a medical device.
