import { defineConfig } from '@playwright/test';

const PORT = 4173;
/** RHR_E2E_VITE=1 runs only the fixture-based UI specs against the Vite dev server (no service). */
const viteOnly = process.env.RHR_E2E_VITE === '1';

/**
 * RHR_E2E_TARGET selects what the suite runs against:
 *   (unset)     local service from source (default; the committed evidence comes from this)
 *   hosted      the bundled single Node server in hosted demo mode (what Docker/Render runs)
 *   vercel-sim  the Vercel Build Output through a Node stand-in for the platform router
 * Hosted targets write screenshots/axe to RHR_E2E_OUT (set it!) so docs/ is never overwritten.
 */
const target = process.env.RHR_E2E_TARGET ?? 'local';
const FRESH_TMP = 'rm -rf /tmp/rhr-hosted-demo';
const serverCommand =
  target === 'hosted'
    ? `${FRESH_TMP} && npm run build:server && RHR_HOSTED=1 RHR_PORT=${PORT} node dist-server/server.mjs`
    : target === 'vercel-sim'
      ? `${FRESH_TMP} && npm run build:vercel && RHR_PORT=${PORT} npx tsx scripts/vercel-sim.ts`
      : `rm -rf .e2e-data && npx vite build && RHR_DATA_DIR=.e2e-data RHR_PORT=${PORT} npx tsx src/server/index.ts`;

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: process.env.RHR_E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`, headless: true },
  // RHR_E2E_BASE_URL: test an already running server (e.g. the image's files started by hand).
  webServer: process.env.RHR_E2E_BASE_URL
    ? undefined
    : viteOnly
      ? {
          command: `npx vite --port ${PORT} --host 127.0.0.1`,
          url: `http://127.0.0.1:${PORT}`,
          reuseExistingServer: true,
          timeout: 60_000,
        }
      : {
          command: serverCommand,
          url: `http://127.0.0.1:${PORT}/api/health`,
          reuseExistingServer: false,
          timeout: 120_000,
        },
});
