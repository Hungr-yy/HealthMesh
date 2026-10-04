/**
 * HTTP-only round trip against a running deployment (local, Docker or Vercel), SIMULATED data:
 * Noor submits, the relay carries it, a clinician approves, Noor's device receives and opens the
 * reply, and the operator view carries no patient content.
 *
 *   npx tsx scripts/api-roundtrip.ts https://your-demo.example
 */
import { randomUUID, randomBytes } from 'node:crypto';
import { NOOR_INPUT } from '../src/shared/fixtures';

const base = (process.argv[2] ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const CLINICIAN = 'demo-token-clinician-amina';
const OPERATOR = 'demo-token-operator-ops';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function call<T = Json>(
  method: string,
  path: string,
  opts: { body?: unknown; bearer?: string; secret?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  if (opts.secret) headers.authorization = `Case ${opts.secret}`;
  const r = await fetch(base + path, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : {}) as T;
}
const step = (s: string) => console.log(`ok  ${s}`);
function check(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`);
}

async function main(): Promise<void> {
  const mode = await call('GET', '/api/mode');
  console.log(`target ${base}: hosted=${mode.hosted} state=${mode.state}`);
  await call('POST', '/api/sim/reset', { body: {} });
  step('reset');

  const messageId = randomUUID();
  const secret = randomBytes(24).toString('hex');
  const sub = await call('POST', '/api/node/requests', {
    body: { messageId, input: NOOR_INPUT },
    secret,
  });
  const caseId: string = sub.caseId ?? sub.id ?? sub.case?.id;
  check(Boolean(caseId), `submit returned a case id (${JSON.stringify(Object.keys(sub))})`);
  step(`Noor submitted (accepted durably, case ref ${sub.ref ?? sub.case?.ref})`);

  await call('POST', '/api/sim/advance', { body: { ticks: 80 } });
  const inbox = await call<Json[]>('GET', '/api/clinic/inbox', { bearer: CLINICIAN });
  check(inbox.length === 1, `exactly one case in the clinic inbox (got ${inbox.length})`);
  step('relayed to the clinic: one inbox entry');

  await call('POST', `/api/clinic/cases/${caseId}/claim`, { bearer: CLINICIAN, body: {} });
  await call('POST', `/api/clinic/cases/${caseId}/start-review`, { bearer: CLINICIAN, body: {} });
  const cc = await call('GET', `/api/clinic/cases/${caseId}`, { bearer: CLINICIAN });
  check(JSON.stringify(cc).includes('follow-up appointment'), 'clinic sees the original text');
  await call('POST', `/api/clinic/cases/${caseId}/reply/approve`, {
    bearer: CLINICIAN,
    body: {
      text: 'Please come on Thursday morning for your follow-up. (synthetic)',
      templateId: null,
      inReplyToMessageId: messageId,
    },
  });
  step('clinician approved a reply');

  // before the radio carries it back, Noor must not have a reply
  let view = await call('GET', `/api/node/cases/${caseId}`, { secret });
  check(!view.reply, 'no reply on the village device before the return path delivers');
  await call('POST', '/api/sim/advance', { body: { ticks: 200 } });
  view = await call('GET', `/api/node/cases/${caseId}`, { secret });
  check(Boolean(view.reply), 'reply arrived on the village device');
  step('reply arrived at the village');

  await call('POST', `/api/node/cases/${caseId}/reply/open`, { secret, body: {} });
  step('Noor opened the reply');

  const op = JSON.stringify(await call('GET', '/api/operator/overview', { bearer: OPERATOR }));
  for (const word of ['Noor', 'follow-up appointment', 'Thursday', 'medicine'])
    check(!op.includes(word), `operator view must not contain "${word}"`);
  step('operator view carries no patient content');

  // a bare reference never opens a case
  const lookup = await fetch(`${base}/api/node/cases/lookup?ref=${sub.ref ?? ''}`);
  check(lookup.status === 401, `reference alone is rejected (got ${lookup.status})`);
  step('case reference alone returns 401');
  console.log('ROUND TRIP PASSED');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
