import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HttpClient } from '../src/web/lib/httpClient';
import { Engine, EngineError } from '../src/server/engine';
import { freePort, newMsg, openEngine, startService, tmpDir } from './helpers';
import type { ChildProcess } from 'node:child_process';

const procs: ChildProcess[] = [];
afterEach(() => {
  for (const p of procs.splice(0)) p.kill('SIGKILL');
});

describe('Phase 2: local durability', () => {
  it('accepted request survives engine restart (replay from journal)', () => {
    const dir = tmpDir();
    const a = Engine.open(dir);
    const m = newMsg();
    const res = a.submit(m.input, m.messageId, m.secret);
    a.close();

    const b = Engine.open(dir);
    const view = b.getCaseByMessageId(m.messageId, m.secret);
    expect(view.caseId).toBe(res.caseId);
    expect(view.ref).toBe(res.ref);
    expect(view.versions).toHaveLength(1);
    expect(view.versions[0]?.input.details).toBe(m.input.details);
    expect(view.versions[0]?.tracks.local).toBe('accepted');
    expect(view.versions[0]?.tracks.transport).toBe('queued');
    b.close();
  });

  it('duplicate submission with the same messageId yields exactly one case', () => {
    const { engine } = openEngine();
    const m = newMsg();
    const first = engine.submit(m.input, m.messageId, m.secret);
    const second = engine.submit(m.input, m.messageId, m.secret);
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.caseId).toBe(first.caseId);
    expect(engine.state.cases.size).toBe(1);
    expect(engine.state.messages.size).toBe(1);
    // and still exactly one after a restart
    engine.replay();
    expect(engine.state.cases.size).toBe(1);
    engine.close();
  });

  it('same messageId with different content is a conflict, not a second case', () => {
    const { engine } = openEngine();
    const m = newMsg();
    engine.submit(m.input, m.messageId, m.secret);
    expect(() =>
      engine.submit({ ...m.input, details: 'something different' }, m.messageId, m.secret),
    ).toThrow(EngineError);
    expect(engine.state.cases.size).toBe(1);
  });

  it('a torn trailing journal record (crash mid-write) is dropped without losing earlier records', () => {
    const dir = tmpDir();
    const a = Engine.open(dir);
    const m = newMsg();
    a.submit(m.input, m.messageId, m.secret);
    a.close();
    fs.appendFileSync(path.join(dir, 'journal.jsonl'), '{"t":"accept","messageId":"torn'); // no newline
    const b = Engine.open(dir);
    expect(b.journal?.recoveredTornWrite).toBe(true);
    expect(b.state.messages.size).toBe(1);
    // journal still appendable and consistent after recovery
    const m2 = newMsg();
    b.submit(m2.input, m2.messageId, m2.secret);
    b.close();
    expect(Engine.open(dir).state.messages.size).toBe(2);
  });

  it('SIGKILL of the real service after an acknowledged accept loses nothing', async () => {
    const dir = tmpDir();
    const port = freePort();
    const s1 = await startService(dir, port);
    procs.push(s1.proc);
    const client = new HttpClient(s1.url);
    const m = newMsg();
    const res = await client.submitRequest(m.input, m.messageId, { secret: m.secret });
    expect(res.duplicate).toBe(false);
    s1.proc.kill('SIGKILL'); // no graceful shutdown
    await new Promise((r) => setTimeout(r, 300));

    const s2 = await startService(dir, port);
    procs.push(s2.proc);
    const view = await new HttpClient(s2.url).getCaseByMessageId(m.messageId, { secret: m.secret });
    expect(view.ref).toBe(res.ref);
    expect(view.versions[0]?.input.details).toBe(m.input.details);
  });

  it('storage nearly full blocks new submissions but keeps existing ones readable', () => {
    const { engine } = openEngine();
    const m1 = newMsg();
    engine.submit(m1.input, m1.messageId, m1.secret);
    engine.state.config.storageLimitBytes = engine.journal!.size + 10; // >= 90% used
    const m2 = newMsg();
    expect(() => engine.submit(m2.input, m2.messageId, m2.secret)).toThrowError(/nearly full/i);
    expect(engine.getCase(engine.state.messages.get(m1.messageId)!.caseId, m1.secret)).toBeTruthy();
    expect(engine.state.cases.size).toBe(1);
  });

  it('unauthorized case-reference lookup is rejected (a reference alone is not authentication)', () => {
    const { engine } = openEngine();
    const m = newMsg();
    const res = engine.submit(m.input, m.messageId, m.secret);
    // no credential
    expect(() => engine.lookupByReference(res.ref, undefined)).toThrowError(/not authorized/i);
    // wrong credential
    expect(() => engine.lookupByReference(res.ref, 'f'.repeat(32))).toThrowError(/not authorized/i);
    // unknown reference gives the same error (no enumeration)
    expect(() => engine.lookupByReference('NR-ZZZZ', m.secret)).toThrowError(/not authorized/i);
    // correct credential works
    expect(engine.lookupByReference(res.ref, m.secret).caseId).toBe(res.caseId);
  });

  it('HTTP: lookup by reference without credential returns 401', async () => {
    const dir = tmpDir();
    const s = await startService(dir, freePort());
    procs.push(s.proc);
    const c = new HttpClient(s.url);
    const m = newMsg();
    const res = await c.submitRequest(m.input, m.messageId, { secret: m.secret });
    const r = await fetch(`${s.url}/api/node/cases/lookup?ref=${res.ref}`);
    expect(r.status).toBe(401);
    const r2 = await fetch(`${s.url}/api/node/cases/${res.caseId}`);
    expect(r2.status).toBe(401);
  });
});
