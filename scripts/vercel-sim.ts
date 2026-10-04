/**
 * Local simulation of how Vercel serves `.vercel/output`: static files first (filesystem), then
 * /api/* to the bundled serverless function, called with a raw Node (req, res) like the real
 * runtime does with shouldAddHelpers=false. Used to run the Noor e2e against the Vercel build.
 * It is NOT Vercel itself: routing, cold starts and multi-instance behaviour are not reproduced.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve('.vercel/output');
const staticDir = path.join(root, 'static');
type Fn = (rq: http.IncomingMessage, rs: http.ServerResponse) => void;
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
const port = Number(process.env.RHR_PORT ?? 4174);

async function main(): Promise<void> {
  const mod = (await import(
    pathToFileURL(path.join(root, 'functions/api.func/index.mjs')).href
  )) as { default: Fn };
  http
    .createServer((rq, rs) => {
      const url = new URL(rq.url ?? '/', 'http://localhost');
      const file = path.join(staticDir, url.pathname === '/' ? 'index.html' : url.pathname);
      if (file.startsWith(staticDir) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        rs.writeHead(200, {
          'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
        });
        fs.createReadStream(file).pipe(rs);
      } else if (url.pathname.startsWith('/api/')) {
        mod.default(rq, rs);
      } else {
        rs.writeHead(404).end('not found');
      }
    })
    .listen(port, '127.0.0.1', () => console.log(`vercel-sim on http://127.0.0.1:${port}`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
