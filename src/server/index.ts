import path from 'node:path';
import { buildRouter } from './api';
import { Engine } from './engine';

const port = Number(process.env.RHR_PORT ?? 8787);
const dataDir = path.resolve(process.env.RHR_DATA_DIR ?? 'data');
const staticDir = path.resolve('dist');

const engine = Engine.open(dataDir);
const server = buildRouter(engine).createServer(staticDir);

server.listen(port, '127.0.0.1', () => {
  console.log(`[SIMULATION] Rural Health Radio local service on http://127.0.0.1:${port}`);
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
