import type { ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_STAFF } from '@shared/fixtures';
import { HttpClient } from '../src/web/lib/httpClient';
import { freePort, newMsg, startService, tmpDir } from './helpers';

let proc: ChildProcess;
let url: string;

beforeAll(async () => {
  const s = await startService(tmpDir(), freePort());
  proc = s.proc;
  url = s.url;
});
afterAll(() => proc?.kill('SIGKILL'));

const get = (path: string, token?: string) =>
  fetch(`${url}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
const post = (path: string, body: unknown, token?: string) =>
  fetch(`${url}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
const adv = (ticks: number) => post('/api/sim/advance', { ticks });

describe('HTTP API authorization (real service process)', () => {
  it('clinic and operator endpoints require the right staff role', async () => {
    expect((await get('/api/clinic/inbox')).status).toBe(401);
    expect((await get('/api/clinic/inbox', 'not-a-real-token')).status).toBe(401);
    expect((await get('/api/clinic/inbox', FIXTURE_STAFF.chw.token)).status).toBe(403);
    expect((await get('/api/clinic/inbox', FIXTURE_STAFF.clinician.token)).status).toBe(200);
    expect((await get('/api/operator/overview')).status).toBe(401);
    expect((await get('/api/operator/overview', FIXTURE_STAFF.clinician.token)).status).toBe(403);
    expect((await get('/api/operator/overview', FIXTURE_STAFF.operator.token)).status).toBe(200);
  });

  it('a reply is not sent by a coordinator, a CHW, or an anonymous caller (HTTP)', async () => {
    const c = new HttpClient(url);
    const m = newMsg();
    const r = await c.submitRequest(m.input, m.messageId, { secret: m.secret });
    await adv(200);
    const body = { text: 'Hello', templateId: null, inReplyToMessageId: m.messageId };
    const path = `/api/clinic/cases/${r.caseId}/reply/approve`;
    expect((await post(path, body)).status).toBe(401);
    expect((await post(path, body, FIXTURE_STAFF.coordinator.token)).status).toBe(403);
    expect((await post(path, body, FIXTURE_STAFF.chw.token)).status).toBe(403);
    // clinician without starting review: conflict, still nothing sent
    expect((await post(path, body, FIXTURE_STAFF.clinician.token)).status).toBe(409);
    await adv(500);
    const view = await c.getCase(r.caseId, { secret: m.secret });
    expect(view.reply).toBeNull();
    // proper path
    expect(
      (await post(`/api/clinic/cases/${r.caseId}/start-review`, {}, FIXTURE_STAFF.clinician.token))
        .status,
    ).toBe(200);
    expect((await post(path, body, FIXTURE_STAFF.clinician.token)).status).toBe(200);
    await adv(300);
    expect((await c.getCase(r.caseId, { secret: m.secret })).reply?.text).toBe('Hello');
  });

  it('node API: storage-full and node-unavailable surface as typed errors', async () => {
    const c = new HttpClient(url);
    await post('/api/sim/power-cut', { durationTicks: 10 });
    const m = newMsg();
    await expect(c.submitRequest(m.input, m.messageId, { secret: m.secret })).rejects.toMatchObject(
      {
        code: 'node_unavailable',
      },
    );
    await adv(11);
    await post('/api/sim/config', { storageLimitBytes: 100 });
    await expect(c.submitRequest(m.input, m.messageId, { secret: m.secret })).rejects.toMatchObject(
      {
        code: 'storage_nearly_full',
      },
    );
    await post('/api/sim/config', { storageLimitBytes: 5 * 1024 * 1024 });
    await expect(
      c.submitRequest(m.input, m.messageId, { secret: m.secret }),
    ).resolves.toMatchObject({
      duplicate: false,
    });
  });

  it('rejects malformed input and oversize bodies', async () => {
    const r = await fetch(`${url}/api/node/requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Case ${'a'.repeat(32)}` },
      body: '{not json',
    });
    expect(r.status).toBe(400);
    const m = newMsg({ details: 'x'.repeat(2000) });
    const r2 = await post('/api/node/requests', { messageId: m.messageId, input: m.input });
    expect(r2.status).toBe(401); // no credential
  });
});
