import { describe, expect, it } from 'vitest';
import { DeviceSession, DRAFT_TTL_MS, EMPTY_FORM, MemoryKV } from '../src/web/lib/session';

function make(now = { t: 1_000 }) {
  const session = new MemoryKV();
  const local = new MemoryKV();
  return { session, local, now, dev: new DeviceSession(session, local, () => now.t) };
}

describe('device session (shared-device protection)', () => {
  it('switching patient clears drafts, secrets and cases but keeps the worker identity', () => {
    const { dev, session, local } = make();
    dev.save({
      language: 'sw',
      mode: 'worker',
      workerLabel: 'Grace (synthetic)',
      openCases: [{ caseId: 'c1', ref: 'NR-AAAA', messageId: 'm', secret: 's3cret' }],
      activeCaseId: 'c1',
      pending: { messageId: 'm2', secret: 'p3nding' },
    });
    dev.saveDraft({ ...EMPTY_FORM, details: 'Patient A private text', patientName: 'A' });
    const next = dev.switchPatient(dev.load());
    expect(next.openCases).toEqual([]);
    expect(next.pending).toBeNull();
    expect(next.activeCaseId).toBeNull();
    expect(next.language).toBeNull();
    expect(next.workerLabel).toBe('Grace (synthetic)');
    expect(dev.loadDraft()).toBeNull();
    const dump =
      JSON.stringify([session, local, dev.load()]) + (session.getItem('rhr.session.v1') ?? '');
    expect(dump).not.toContain('Patient A private text');
    expect(dump).not.toContain('s3cret');
    expect(dump).not.toContain('p3nding');
  });

  it('lock wipes everything', () => {
    const { dev, session, local } = make();
    dev.save({
      language: 'en',
      mode: 'self',
      workerLabel: '',
      openCases: [],
      activeCaseId: null,
      pending: null,
    });
    dev.saveDraft({ ...EMPTY_FORM, details: 'x' });
    dev.lock();
    expect(session.getItem('rhr.session.v1')).toBeNull();
    expect(local.getItem('rhr.draft.v1')).toBeNull();
  });

  it('drafts expire after the 24 h retention window', () => {
    const { dev, now } = make();
    dev.saveDraft({ ...EMPTY_FORM, details: 'keep me' });
    expect(dev.loadDraft()?.details).toBe('keep me');
    now.t += DRAFT_TTL_MS + 1;
    expect(dev.loadDraft()).toBeNull();
  });
});
