import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildRouter } from './api';
import { Engine } from './engine';
import { dataDir, sharedDatabaseUrl } from './hosted';
import { PgLogStore } from './pg-store';
import { SharedJournal, SharedRunner } from './shared-journal';

/**
 * Vercel serverless entry (bundled by scripts/build-hosted.ts into the Build Output API).
 *
 * HOSTED DEMO MODE. When a database URL is configured, every instance replays the same shared
 * command log before serving a request and appends after it, so concurrent function instances
 * agree (see shared-journal.ts). Without one, state is per warm instance (temp-dir journal) and
 * separate instances do not share state.
 */
let handler: ((rq: IncomingMessage, rs: ServerResponse) => void) | null = null;

/** Cheap, stateless endpoints skip the database round trips. */
const STATELESS = new Set(['/api/health', '/api/mode']);

function build(): (rq: IncomingMessage, rs: ServerResponse) => void {
  process.env.RHR_HOSTED = '1';
  const url = sharedDatabaseUrl();
  if (!url) return buildRouter(Engine.open(dataDir())).handler(null);
  const journal = new SharedJournal(new PgLogStore(url));
  const engine = Engine.openWith(journal);
  const runner = new SharedRunner(engine, journal);
  const router = buildRouter(engine);
  router.around = (call, path) => (STATELESS.has(path) ? call() : runner.run(call));
  return router.handler(null);
}

export default function vercelHandler(rq: IncomingMessage, rs: ServerResponse): void {
  handler ??= build();
  handler(rq, rs);
}
