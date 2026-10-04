import os from 'node:os';
import path from 'node:path';

/**
 * "Hosted demo mode": the same service logic, deployed to a public URL for people to try.
 * Enabled by RHR_HOSTED=1, or automatically on Vercel (VERCEL is set).
 *
 * What changes: a conspicuous banner in the UI, and the journal lives in the OS temp directory
 * (ephemeral). What does NOT change: the engine, roles, simulator, and synthetic data.
 */
export function isHosted(): boolean {
  return process.env.RHR_HOSTED === '1' || Boolean(process.env.VERCEL);
}

export { HOSTED_BANNER } from '@shared/hosted';

/** Data directory: explicit RHR_DATA_DIR, else temp dir when hosted, else ./data. */
export function dataDir(): string {
  if (process.env.RHR_DATA_DIR) return path.resolve(process.env.RHR_DATA_DIR);
  return isHosted() ? path.join(os.tmpdir(), 'rhr-hosted-demo') : path.resolve('data');
}
