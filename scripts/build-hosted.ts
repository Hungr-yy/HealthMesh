/**
 * Builds the hosted-demo artifacts (SIMULATED service, synthetic data).
 *
 *   tsx scripts/build-hosted.ts server   -> dist-server/server.mjs   (single Node server; Docker/Render)
 *   tsx scripts/build-hosted.ts vercel   -> .vercel/output           (Vercel Build Output API v3)
 *
 * Both bundle the SAME service code (src/server) with esbuild, so no TypeScript path-alias or
 * dev dependency is needed at runtime. Run `vite build` first (the npm scripts do).
 */
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const target = process.argv[2];
const common = {
  bundle: true,
  platform: 'node' as const,
  target: 'node20',
  format: 'esm' as const,
  logLevel: 'warning' as const,
  tsconfig: 'tsconfig.json',
};

async function server(): Promise<void> {
  fs.rmSync('dist-server', { recursive: true, force: true });
  await build({
    ...common,
    entryPoints: ['src/server/index.ts'],
    outfile: 'dist-server/server.mjs',
  });
  console.log('dist-server/server.mjs written');
}

async function vercel(): Promise<void> {
  if (!fs.existsSync('dist/index.html')) throw new Error('dist/ missing: run `vite build` first');
  const out = path.resolve('.vercel/output');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'static'), { recursive: true });
  fs.cpSync('dist', path.join(out, 'static'), { recursive: true });
  const fn = path.join(out, 'functions/api.func');
  fs.mkdirSync(fn, { recursive: true });
  await build({
    ...common,
    entryPoints: ['src/server/vercel.ts'],
    outfile: path.join(fn, 'index.mjs'),
  });
  fs.writeFileSync(
    path.join(fn, '.vc-config.json'),
    JSON.stringify(
      {
        runtime: 'nodejs20.x',
        handler: 'index.mjs',
        launcherType: 'Nodejs',
        // raw Node req/res: the service reads the request stream itself
        shouldAddHelpers: false,
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(out, 'config.json'),
    JSON.stringify(
      { version: 3, routes: [{ handle: 'filesystem' }, { src: '/api/(.*)', dest: '/api' }] },
      null,
      2,
    ),
  );
  console.log('.vercel/output written (static + functions/api.func)');
}

async function main(): Promise<void> {
  if (target === 'server') await server();
  else if (target === 'vercel') await vercel();
  else {
    console.error('usage: build-hosted.ts server|vercel');
    process.exit(2);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
