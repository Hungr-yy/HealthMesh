import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildRouter } from './api';
import { Engine } from './engine';
import { dataDir } from './hosted';

/**
 * Vercel serverless entry (bundled by scripts/build-hosted.ts into the Build Output API).
 *
 * HOSTED DEMO MODE. State is held by the warm function instance (journal in the temp dir) and is
 * lost on a cold start; separate instances do not share state. The static UI is served by Vercel.
 */
let handler: ((rq: IncomingMessage, rs: ServerResponse) => void) | null = null;

export default function vercelHandler(rq: IncomingMessage, rs: ServerResponse): void {
  if (!handler) {
    process.env.RHR_HOSTED = '1';
    handler = buildRouter(Engine.open(dataDir())).handler(null);
  }
  handler(rq, rs);
}
