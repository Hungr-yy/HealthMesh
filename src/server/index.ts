import path from 'node:path';
import { buildRouter } from './api';
import { Engine } from './engine';
import { dataDir, isHosted } from './hosted';

// RHR_PORT wins; PORT is what container hosts (Render, Fly, Railway...) inject.
const port = Number(process.env.RHR_PORT ?? process.env.PORT ?? 8787);
// Loopback by default (local dev). Containers set RHR_HOST=0.0.0.0.
const host = process.env.RHR_HOST ?? '127.0.0.1';
const staticDir = path.resolve(process.env.RHR_STATIC_DIR ?? 'dist');

const engine = Engine.open(dataDir());
const server = buildRouter(engine).createServer(staticDir);

server.listen(port, host, () => {
  console.log(
    `[SIMULATION] Rural Health Radio ${isHosted() ? '(HOSTED DEMO MODE) ' : ''}service on http://${host}:${port}`,
  );
  console.log(
    `[SIMULATION] durable journal: ${engine.journal?.file} (${engine.journal?.size} bytes)`,
  );
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.close();
    engine.close();
    process.exit(0);
  });
}
