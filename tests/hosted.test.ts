import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HOSTED_BANNER } from '@shared/hosted';
import vercelHandler from '../src/server/vercel';
import { tmpDir } from './helpers';

/**
 * The Vercel serverless entry, called the way a platform calls it: a raw Node (req, res) pair,
 * once with an untouched stream and once with a body the platform already parsed.
 */
let server: http.Server;
let url: string;
let preParse = false;

beforeAll(async () => {
  process.env.RHR_DATA_DIR = tmpDir();
  server = http.createServer((rq, rs) => {
    if (!preParse || rq.method === 'GET') return vercelHandler(rq, rs);
    const chunks: Buffer[] = [];
    rq.on('data', (c: Buffer) => chunks.push(c));
    rq.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      (rq as unknown as { body: unknown }).body = raw ? JSON.parse(raw) : undefined;
      vercelHandler(rq, rs);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
  delete process.env.RHR_DATA_DIR;
  delete process.env.RHR_HOSTED;
});

const post = (path: string, body: unknown) =>
  fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('hosted demo mode (Vercel serverless entry)', () => {
  it('reports hosted mode with the exact banner wording', async () => {
    const m = (await (await fetch(`${url}/api/mode`)).json()) as {
      hosted: boolean;
      banner: string;
    };
    expect(m.hosted).toBe(true);
    expect(m.banner).toBe(HOSTED_BANNER);
    expect(HOSTED_BANNER).toBe(
      'Hosted demo: state may reset; durable journal is demonstrated in the local build and tests',
    );
  });

  it.each([false, true])(
    'simulator state persists across requests on a warm instance (platform pre-parsed body: %s)',
    async (pre) => {
      preParse = pre;
      expect((await post('/api/sim/reset', {})).status).toBe(200);
      const before = (await (await fetch(`${url}/api/sim/state`)).json()) as { nowTick: number };
      expect((await post('/api/sim/advance', { ticks: 7 })).status).toBe(200);
      const after = (await (await fetch(`${url}/api/sim/state`)).json()) as { nowTick: number };
      expect(after.nowTick).toBe(before.nowTick + 7);
    },
  );

  it('rejects malformed JSON and unknown routes with typed errors', async () => {
    preParse = false;
    const bad = await fetch(`${url}/api/sim/advance`, { method: 'POST', body: '{nope' });
    expect(bad.status).toBe(400);
    expect((await fetch(`${url}/api/nothing-here`)).status).toBe(404);
  });
});
