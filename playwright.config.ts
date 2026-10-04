import { defineConfig } from '@playwright/test';

const PORT = 4173;
/** RHR_E2E_VITE=1 runs only the fixture-based UI specs against the Vite dev server (no service). */
const viteOnly = process.env.RHR_E2E_VITE === '1';

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${PORT}`, headless: true },
  webServer: viteOnly
    ? {
        command: `npx vite --port ${PORT} --host 127.0.0.1`,
        url: `http://127.0.0.1:${PORT}`,
        reuseExistingServer: true,
        timeout: 60_000,
      }
    : {
        command: `rm -rf .e2e-data && npx vite build && RHR_DATA_DIR=.e2e-data RHR_PORT=${PORT} npx tsx src/server/index.ts`,
        url: `http://127.0.0.1:${PORT}/api/health`,
        reuseExistingServer: false,
        timeout: 120_000,
      },
});
