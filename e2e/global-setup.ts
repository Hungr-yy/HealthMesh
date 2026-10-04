import fs from 'node:fs';
import path from 'node:path';

/** Start each full e2e run with a fresh axe results file (specs append to it). */
export default function globalSetup(): void {
  if (process.env.RHR_E2E_VITE === '1') return;
  const file = path.resolve('docs/axe-results.json');
  if (fs.existsSync(file)) fs.rmSync(file);
}
