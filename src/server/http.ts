import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { ApiError, type ApiErrorCode } from '@shared/types';

export interface Req {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: http.IncomingHttpHeaders;
  body: unknown;
  params: Record<string, string>;
}

export type Handler = (req: Req) => unknown | Promise<unknown>;

/** Wraps each API call (used by hosted mode to sync a shared journal around it). */
export type Around = (call: () => Promise<unknown>, path: string) => Promise<unknown>;

interface Route {
  method: string;
  parts: string[];
  handler: Handler;
}

const STATUS: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  bad_request: 400,
  node_unavailable: 503,
  storage_nearly_full: 507,
  network_error: 502,
};

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

export class Router {
  private routes: Route[] = [];
  /** Optional wrapper around every API handler call. */
  around: Around | null = null;

  add(method: string, pattern: string, handler: Handler): void {
    this.routes.push({ method, parts: pattern.split('/').filter(Boolean), handler });
  }

  private match(method: string, pathname: string) {
    const segs = pathname.split('/').filter(Boolean);
    for (const r of this.routes) {
      if (r.method !== method || r.parts.length !== segs.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      r.parts.forEach((p, i) => {
        const s = segs[i] ?? '';
        if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(s);
        else if (p !== s) ok = false;
      });
      if (ok) return { route: r, params };
    }
    return null;
  }

  /** A plain (req, res) handler: used by the standalone server and by the Vercel function. */
  handler(staticDir: string | null): (rq: http.IncomingMessage, rs: http.ServerResponse) => void {
    return (rq, rs) => {
      void this.handle(rq, rs, staticDir);
    };
  }

  createServer(staticDir: string | null): http.Server {
    return http.createServer(this.handler(staticDir));
  }

  private async handle(
    rq: http.IncomingMessage,
    rs: http.ServerResponse,
    staticDir: string | null,
  ): Promise<void> {
    const url = new URL(rq.url ?? '/', 'http://localhost');
    const method = rq.method ?? 'GET';
    if (!url.pathname.startsWith('/api/')) return this.serveStatic(url.pathname, rs, staticDir);
    try {
      const body = await readBody(rq);
      const m = this.match(method, url.pathname);
      if (!m) throw new ApiError('not_found', `No route ${method} ${url.pathname}`, 404);
      const call = async () =>
        m.route.handler({
          method,
          path: url.pathname,
          query: url.searchParams,
          headers: rq.headers,
          body,
          params: m.params,
        });
      const out = this.around ? await this.around(call, url.pathname) : await call();
      send(rs, 200, out ?? { ok: true });
    } catch (e) {
      if (e instanceof ApiError) {
        send(rs, e.status || STATUS[e.code], { error: { code: e.code, message: e.message } });
      } else {
        console.error(e);
        send(rs, 500, { error: { code: 'internal', message: 'Internal error' } });
      }
    }
  }

  private serveStatic(pathname: string, rs: http.ServerResponse, dir: string | null): void {
    if (!dir || !fs.existsSync(dir)) {
      rs.writeHead(404, { 'content-type': 'text/plain' });
      rs.end('Frontend not built. Run `npm run build:web` or use `npm run dev`.');
      return;
    }
    const safe = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
    let file = path.join(dir, safe);
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory())
      file = path.join(dir, 'index.html');
    const ext = path.extname(file);
    rs.writeHead(200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    fs.createReadStream(file).pipe(rs);
  }
}

function send(rs: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  rs.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  rs.end(data);
}

function readBody(rq: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (rq.method === 'GET' || rq.method === 'HEAD') return resolve(undefined);
    // Some serverless hosts pre-parse the body and consume the stream; use theirs if present.
    const pre = (rq as { body?: unknown }).body;
    if (pre !== undefined) {
      if (typeof pre === 'string') {
        try {
          return resolve(pre === '' ? undefined : JSON.parse(pre));
        } catch {
          return reject(new ApiError('bad_request', 'Body is not valid JSON', 400));
        }
      }
      return resolve(pre);
    }
    const chunks: Buffer[] = [];
    let size = 0;
    rq.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 64 * 1024) {
        reject(new ApiError('bad_request', 'Body too large', 400));
        rq.destroy();
      } else chunks.push(c);
    });
    rq.on('end', () => {
      if (!chunks.length) return resolve(undefined);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new ApiError('bad_request', 'Invalid JSON', 400));
      }
    });
    rq.on('error', reject);
  });
}
