import { describe, expect, it } from 'vitest';
import { FIXTURE_STAFF, NOOR_INPUT, NOOR_INPUT_AR, NOOR_INPUT_SW } from '@shared/fixtures';
import type { CaseView, StaffRef } from '@shared/types';
import { Engine, EngineError } from '../src/server/engine';
import { newMsg, tmpDir } from './helpers';

const ref = (k: keyof typeof FIXTURE_STAFF): StaffRef => {
  const { token: _t, ...r } = FIXTURE_STAFF[k];
  return r;
};
const clinician = ref('clinician');
const coordinator = ref('coordinator');

function run(e: Engine, n: number) {
  for (let i = 0; i < n; i++) e.advance(1);
}
function until(e: Engine, pred: () => boolean, max = 2000) {
  for (let i = 0; i < max; i++) {
    if (pred()) return;
    e.advance(1);
  }
  throw new Error(`condition not reached within ${max} ticks (tick=${e.state.tick})`);
}
function node(e: Engine, caseId: string, secret: string): CaseView {
  return e.getCase(caseId, secret);
}
const last = (v: CaseView) => v.versions[v.versions.length - 1]!;

function submit(e: Engine, over = {}) {
  const m = newMsg(over);
  const r = e.submit(m.input, m.messageId, m.secret);
  return { ...m, ...r };
}

describe('Phase 3: relay simulator', () => {
  it('FULL JOURNEY: accept -> relays -> gateway -> clinic -> review -> approved reply -> arrives -> opened', () => {
    const e = Engine.open(tmpDir());
    const m = submit(e);
    // honest first state: queued locally, nothing downstream known
    expect(last(node(e, m.caseId, m.secret)).tracks.transport).toBe('queued');
    expect(last(node(e, m.caseId, m.secret)).tracks.local).toBe('accepted');

    until(e, () => last(node(e, m.caseId, m.secret)).tracks.transport === 'relaying');
    // clinic has it before the village node KNOWS the clinic has it
    until(e, () => e.state.messages.get(m.messageId)!.clinicHasCopy);
    expect(last(node(e, m.caseId, m.secret)).tracks.transport).not.toBe('clinic_received');
    until(e, () => last(node(e, m.caseId, m.secret)).tracks.transport === 'clinic_received');
    expect(last(node(e, m.caseId, m.secret)).tracks.care).toBe('awaiting_review');

    // staff action is the only way into "in review"
    run(e, 200);
    expect(last(node(e, m.caseId, m.secret)).tracks.care).toBe('awaiting_review');
    e.claim(clinician, m.caseId);
    e.startReview(clinician, m.caseId);
    until(e, () => last(node(e, m.caseId, m.secret)).tracks.care === 'in_review');

    const reply = e.approveReply(clinician, m.caseId, {
      text: 'Please come to the clinic on Thursday morning for your follow-up. Bring your health card.',
      templateId: 'follow-up-thursday',
      inReplyToMessageId: m.messageId,
    });
    expect(reply.author.name).toContain('Amina');
    expect(reply.version).toBe(1);
    expect(node(e, m.caseId, m.secret).reply).toBeNull(); // approved but NOT yet on the village device
    until(e, () => node(e, m.caseId, m.secret).reply !== null);
    const v = node(e, m.caseId, m.secret);
    expect(last(v).tracks.returnTransport).toBe('reply_available_local');
    expect(last(v).tracks.userAction).toBeNull(); // arrived != opened
    expect(last(v).tracks.care).toBe('reply_approved');

    // clinic learns return delivery independently (via the return-path acknowledgement)
    expect(e.clinicCaseView(clinician, m.caseId).messages[0]!.tracks.returnTransport).toBeNull();
    until(
      e,
      () => e.clinicCaseView(clinician, m.caseId).messages[0]!.tracks.returnTransport !== null,
    );

    e.markReplyOpened(m.caseId, m.secret, 'Grace (synthetic)');
    const opened = node(e, m.caseId, m.secret);
    expect(last(opened).tracks.userAction).toBe('reply_opened');
    expect(opened.replyOpenedAssistedBy).toBe('Grace (synthetic)');
    until(
      e,
      () => e.clinicCaseView(clinician, m.caseId).messages[0]!.tracks.userAction === 'reply_opened',
    );
    e.close();
  });

  it('replay from the journal reproduces identical views (deterministic simulation)', () => {
    const dir = tmpDir();
    const e = Engine.open(dir);
    const m = submit(e);
    e.setLink(1, false);
    run(e, 15);
    e.setLink(1, true);
    until(e, () => e.state.messages.get(m.messageId)!.clinicHasCopy);
    const before = JSON.stringify([
      node(e, m.caseId, m.secret),
      e.clinicCaseView(clinician, m.caseId),
    ]);
    e.restart();
    const after = JSON.stringify([
      node(e, m.caseId, m.secret),
      e.clinicCaseView(clinician, m.caseId),
    ]);
    expect(after).toBe(before);
    e.close();
  });

  it('outage then restored link: waits without burning retries, then delivers', () => {
    const e = Engine.open(null);
    e.setLink(1, false); // ridge -> valley down
    const m = submit(e);
    run(e, 120);
    const v = last(node(e, m.caseId, m.secret));
    expect(v.tracks.transport).toBe('relaying'); // first relay acked, nothing beyond
    expect(e.state.messages.get(m.messageId)!.clinicHasCopy).toBe(false);
    expect(v.tracks.exception).toBeNull(); // waiting for a link is not a failure
    expect(e.operatorOverview(ref('operator')).links[1]!.up).toBe(false);
    e.setLink(1, true);
    until(e, () => last(node(e, m.caseId, m.secret)).tracks.transport === 'clinic_received');
  });

  it('restart before transmission: queued item survives restarts and is sent when the link returns', () => {
    const dir = tmpDir();
    let e = Engine.open(dir);
    e.setLink(0, false); // no upstream signal from the village
    const m = submit(e);
    run(e, 30);
    expect(last(node(e, m.caseId, m.secret)).tracks.transport).toBe('queued');
    e.close();
    e = Engine.open(dir); // process restart #1
    e.restart(); // restart #2 (state rebuilt again)
    expect(last(node(e, m.caseId, m.secret)).input.details).toBe(NOOR_INPUT.details);
    expect(e.operatorOverview(ref('operator')).queue.queuedAtVillage).toBe(1);
    e.setLink(0, true);
    until(e, () => last(node(e, m.caseId, m.secret)).tracks.transport === 'clinic_received');
    e.close();
  });

  it('power interruption: node refuses API while down, queue recovered from disk, delivery resumes', () => {
    const dir = tmpDir();
    const e = Engine.open(dir);
    const m = submit(e);
    e.powerCut(20);
    e.restart(); // RAM lost; everything rebuilt from the journal
    expect(e.nodeUp).toBe(false);
    expect(() => e.getCase(m.caseId, m.secret)).toThrowError(/no power/i);
    const m2 = newMsg();
    expect(() => e.submit(m2.input, m2.messageId, m2.secret)).toThrowError(EngineError);
    run(e, 21);
    expect(e.nodeUp).toBe(true);
    expect(e.state.nodeLog.some((l) => l.kind === 'power_restored')).toBe(true);
    expect(node(e, m.caseId, m.secret).versions[0]!.input.details).toBe(NOOR_INPUT.details);
    until(e, () => last(node(e, m.caseId, m.secret)).tracks.transport === 'clinic_received');
    e.close();
  });

  it('LOST ACK (hop level): sender retries, receiver suppresses the duplicate, clinic gets one copy', () => {
    const e = Engine.open(null);
    e.configure({ faults: [{ flowKind: 'request', hop: 0, attempt: 1, fault: 'lose_ack' }] });
    const m = submit(e);
    until(e, () => last(node(e, m.caseId, m.secret)).tracks.transport === 'clinic_received');
    const stages = [...e.state.events.values()]
      .filter((x) => x.messageId === m.messageId)
      .map((x) => x.stage);
    expect(stages.filter((s) => s === 'duplicate_suppressed')).toHaveLength(1);
    expect(stages.filter((s) => s === 'clinic_received')).toHaveLength(1);
    expect(e.clinicInbox(clinician, 'oldest')).toHaveLength(1);
  });

  it('LOST ACK (submission response): resubmitting the same messageId never creates a second case', () => {
    const e = Engine.open(null);
    const m = newMsg();
    const first = e.submit(m.input, m.messageId, m.secret); // response "lost" on the way back
    const found = e.getCaseByMessageId(m.messageId, m.secret); // client queries by stable id
    const retry = e.submit(m.input, m.messageId, m.secret);
    expect(found.caseId).toBe(first.caseId);
    expect(retry.duplicate).toBe(true);
    expect(e.state.cases.size).toBe(1);
    expect(() =>
      e.getCaseByMessageId('00000000-0000-4000-8000-000000000000', m.secret),
    ).toThrowError(/no such message/i);
  });

  it('DUPLICATE DELIVERY at the clinic hop yields one inbox entry and one clinic_received', () => {
    const e = Engine.open(null);
    e.configure({ faults: [{ flowKind: 'request', hop: 3, attempt: 1, fault: 'lose_ack' }] });
    const m = submit(e);
    until(e, () => last(node(e, m.caseId, m.secret)).tracks.transport === 'clinic_received');
    run(e, 60);
    expect(e.clinicInbox(clinician, 'oldest')).toHaveLength(1);
    const evs = [...e.state.events.values()].filter((x) => x.messageId === m.messageId);
    expect(evs.filter((x) => x.stage === 'clinic_received')).toHaveLength(1);
    expect(evs.some((x) => x.stage === 'duplicate_suppressed' && x.source === 'clinic')).toBe(true);
    expect(e.clinicCaseView(clinician, m.caseId).messages).toHaveLength(1);
  });

  it('REORDERED EVENTS: clinic ack overtakes the gateway ack; track never regresses; both kept', () => {
    const e = Engine.open(null);
    // lose the first 5 attempts of the gateway_received status flow's first hop
    e.configure({
      faults: [1, 2, 3, 4, 5].map((attempt) => ({
        flowKind: 'status' as const,
        hop: 0,
        attempt,
        fault: 'lose_data' as const,
        carriesStage: 'gateway_received' as const,
      })),
    });
    const m = submit(e);
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 400; i++) {
      e.advance(1);
      const page = e.getEvents(m.caseId, cursor, m.secret);
      cursor = page.cursor;
      for (const ev of page.events) seen.push(ev.stage);
      const t = last(node(e, m.caseId, m.secret)).tracks.transport;
      if (seen.includes('clinic_received') && !seen.includes('gateway_received')) {
        expect(t).toBe('clinic_received'); // never regresses while the older ack is still missing
      }
      if (seen.includes('gateway_received')) break;
    }
    expect(seen.indexOf('clinic_received')).toBeGreaterThan(-1);
    expect(seen.indexOf('gateway_received')).toBeGreaterThan(seen.indexOf('clinic_received'));
    const final = last(node(e, m.caseId, m.secret));
    expect(final.tracks.transport).toBe('clinic_received');
    expect(final.events.map((x) => x.stage)).toContain('gateway_received');
  });

  it('EXPIRED: stops sending, shows exception, explicit resubmission is a linked new version', () => {
    const e = Engine.open(null);
    e.configure({ ttlTicks: 30 });
    e.setLink(0, false);
    const m = submit(e);
    run(e, 31);
    const v = last(node(e, m.caseId, m.secret));
    expect(v.tracks.exception).toBe('expired');
    e.setLink(0, true);
    run(e, 100);
    expect(e.state.messages.get(m.messageId)!.clinicHasCopy).toBe(false); // expired items are not sent
    // explicit resubmission: new message id, supersedes the expired one, same case
    e.configure({ ttlTicks: 4320 });
    const m2 = newMsg({ supersedesMessageId: m.messageId });
    const r2 = e.submit(m2.input, m2.messageId, m.secret);
    expect(r2.caseId).toBe(m.caseId);
    expect(r2.version).toBe(2);
    until(e, () => last(node(e, m.caseId, m.secret)).tracks.transport === 'clinic_received');
    const view = node(e, m.caseId, m.secret);
    expect(view.versions[0]!.supersededBy).toBe(m2.messageId);
    expect(view.versions[0]!.input.details).toBe(NOOR_INPUT.details); // history kept
  });

  it('BOUNDED RETRY: persistent loss stops at the retry limit and needs intervention; requeue resumes', () => {
    const e = Engine.open(null);
    e.configure({ lossPct: 100, maxRetries: 3, backoff: [1, 2] });
    const m = submit(e);
    run(e, 200);
    const v = last(node(e, m.caseId, m.secret));
    expect(v.tracks.exception).toBe('intervention_required');
    const attempts = e.state.flows[0]!.hops[0]!.attempts;
    expect(attempts).toBe(3); // exactly the limit, not endless
    run(e, 200);
    expect(e.state.flows[0]!.hops[0]!.attempts).toBe(3);
    const op = e.operatorOverview(ref('operator'));
    expect(op.queue.interventionRequired).toBe(1);
    e.configure({ lossPct: 0 });
    e.requeue(e.state.flows[0]!.id);
    until(e, () => last(node(e, m.caseId, m.secret)).tracks.transport === 'clinic_received');
    expect(last(node(e, m.caseId, m.secret)).tracks.exception).toBeNull();
  });

  it('PATIENT SWITCHING WITHOUT LEAKAGE (service): one patient credential cannot read another case', () => {
    const e = Engine.open(null);
    const a = submit(e, { patientName: 'Patient A (synthetic)', details: 'A private details' });
    const b = submit(e, { patientName: 'Patient B (synthetic)', details: 'B private details' });
    expect(() => e.getCase(a.caseId, b.secret)).toThrowError(/not authorized/i);
    expect(() => e.getCase(b.caseId, a.secret)).toThrowError(/not authorized/i);
    expect(() => e.getEvents(a.caseId, undefined, b.secret)).toThrowError(/not authorized/i);
    expect(() => e.lookupByReference(a.ref, b.secret)).toThrowError(/not authorized/i);
    expect(() => e.getCaseByMessageId(a.messageId, b.secret)).toThrowError(/not authorized/i);
    run(e, 40);
    const evsB = e.getEvents(b.caseId, undefined, b.secret).events;
    expect(evsB.every((x) => x.messageId === b.messageId)).toBe(true);
    expect(JSON.stringify(node(e, b.caseId, b.secret))).not.toContain('A private details');
  });

  it('REPLY UNSENT UNTIL AUTHORIZED APPROVAL: drafts, unauthorized roles and unreviewed cases send nothing', () => {
    const e = Engine.open(null);
    const m = submit(e);
    until(e, () => last(node(e, m.caseId, m.secret)).tracks.transport === 'clinic_received');
    const body = { text: 'Come on Thursday.', templateId: null, inReplyToMessageId: m.messageId };

    e.saveReplyDraft(coordinator, m.caseId, body.text, null); // draft is not a reply
    expect(() => e.approveReply(null, m.caseId, body)).toThrowError(/sign-in required/i);
    expect(() => e.approveReply(coordinator, m.caseId, body)).toThrowError(/not permitted/i);
    expect(() => e.approveReply(ref('chw'), m.caseId, body)).toThrowError();
    expect(() => e.approveReply(ref('operator'), m.caseId, body)).toThrowError();
    expect(() => e.approveReply(clinician, m.caseId, body)).toThrowError(/start the review/i);
    e.startReview(coordinator, m.caseId);
    expect(() => e.approveReply(coordinator, m.caseId, body)).toThrowError(/not permitted/i);

    run(e, 500);
    expect(e.state.replies.size).toBe(0);
    expect(e.state.flows.some((f) => f.kind === 'reply')).toBe(false);
    expect(node(e, m.caseId, m.secret).reply).toBeNull();

    e.approveReply(clinician, m.caseId, body);
    expect(e.state.flows.some((f) => f.kind === 'reply')).toBe(true);
    until(e, () => node(e, m.caseId, m.secret).reply !== null);
    expect(node(e, m.caseId, m.secret).reply!.text).toBe('Come on Thursday.');
  });

  it('TRANSLATION FAILURE PRESERVES THE ORIGINAL and requires review; reply falls back to clinic wording', () => {
    const e = Engine.open(null);
    e.configure({ translationAvailable: false });
    const m = submit(e, NOOR_INPUT_SW);
    until(e, () => e.state.messages.get(m.messageId)!.clinicHasCopy);
    const cv = e.clinicCaseView(clinician, m.caseId);
    const msg = cv.messages[0]!;
    expect(msg.original.details).toBe(NOOR_INPUT_SW.details); // unchanged
    expect(msg.translation.status).toBe('unavailable');
    expect(msg.translation.text).toBeNull();
    expect(msg.draftSummary.label).toBe('Draft summary - verify against the original');
    expect(
      msg.draftSummary.fields.some((f) => f.label === 'Translation' && f.status === 'uncertain'),
    ).toBe(true);
    // plain text is never blocked: the request is fully readable and the clinician can proceed
    e.startReview(clinician, m.caseId);
    const r = e.approveReply(clinician, m.caseId, {
      text: 'Please come to the clinic on Thursday morning for your follow-up. Bring your health card.',
      templateId: 'follow-up-thursday',
      inReplyToMessageId: m.messageId,
    });
    expect(r.translation).toBe('unavailable');
    expect(r.patientText).toBe(r.text);
    // translation back online: mock dictionary produces a Swahili draft flagged for review
    const e2 = Engine.open(null);
    const m2 = submit(e2, NOOR_INPUT_SW);
    until(e2, () => e2.state.messages.get(m2.messageId)!.clinicHasCopy);
    const c2 = e2.clinicCaseView(clinician, m2.caseId).messages[0]!;
    expect(c2.translation.status).toBe('machine_draft_needs_review');
    expect(c2.original.details).toBe(NOOR_INPUT_SW.details);
    const m3 = submit(e2, NOOR_INPUT_AR);
    until(e2, () => e2.state.messages.get(m3.messageId)!.clinicHasCopy);
    expect(e2.clinicCaseView(clinician, m3.caseId).messages[0]!.translation.status).toBe(
      'machine_draft_needs_review',
    );
  });

  it('operator view carries custody events only: no names, text, or other patient content', () => {
    const e = Engine.open(null);
    const m = submit(e, {
      patientName: 'Zuberi Unique Name',
      details: 'unique-secret-phrase-xyz',
      village: 'Hidden Village',
    });
    until(e, () => last(node(e, m.caseId, m.secret)).tracks.transport === 'clinic_received');
    e.reportBattery('village', 71);
    const blob = JSON.stringify(e.operatorOverview(ref('operator')));
    for (const secret of ['Zuberi', 'unique-secret-phrase', 'Hidden Village', m.secret, m.ref]) {
      expect(blob).not.toContain(secret);
    }
    const evBlob = JSON.stringify([...e.state.events.values()]);
    expect(evBlob).not.toContain('Zuberi');
    expect(evBlob).not.toContain('unique-secret-phrase');
    expect(() => e.operatorOverview(clinician)).toThrowError(/not permitted/i);
    expect(() => e.operatorOverview(null)).toThrowError(/sign-in/i);
    const op = e.operatorOverview(ref('operator'));
    expect(op.nodes.find((n) => n.id === 'village')!.battery).toEqual({
      percent: 71,
      reportedAtTick: e.state.tick,
    });
    expect(op.nodes.find((n) => n.id === 'gateway')!.battery).toBeNull(); // only when supplied
    expect(op.measured.hopsCompleted).toBeGreaterThan(0);
  });

  it('priority is staff-set with provenance; sorting never invents priority', () => {
    const e = Engine.open(null);
    const a = submit(e);
    run(e, 5);
    const b = submit(e);
    until(e, () => e.state.messages.get(b.messageId)!.clinicHasCopy);
    expect(e.clinicInbox(coordinator, 'priority').map((i) => i.priority)).toEqual([null, null]);
    expect(() => e.setPriority(coordinator, b.caseId, 'urgent', '  ')).toThrowError(/reason/i);
    e.setPriority(coordinator, b.caseId, 'urgent', 'Called by CHW about bleeding');
    const inbox = e.clinicInbox(coordinator, 'priority');
    expect(inbox[0]!.caseId).toBe(b.caseId);
    expect(inbox[0]!.priority).toMatchObject({ level: 'urgent', setBy: { staffId: 'staff-juma' } });
    expect(e.clinicInbox(coordinator, 'oldest')[0]!.caseId).toBe(a.caseId);
  });

  it('withdrawal stops unsent copies, informs the clinic, and cannot erase forwarded copies', () => {
    const e = Engine.open(null);
    e.setLink(0, false);
    const m = submit(e);
    run(e, 3);
    e.withdraw(m.caseId, m.secret);
    e.setLink(0, true);
    run(e, 100);
    expect(e.state.messages.get(m.messageId)!.clinicHasCopy).toBe(false);
    expect(last(node(e, m.caseId, m.secret)).tracks.exception).toBe('withdrawn');
  });

  it('edit after submission creates a linked new version and keeps the original', () => {
    const e = Engine.open(null);
    const m = submit(e);
    const m2 = newMsg({
      details: 'Corrected: please make it Friday.',
      supersedesMessageId: m.messageId,
    });
    const r = e.submit(m2.input, m2.messageId, m.secret);
    expect(r.version).toBe(2);
    expect(r.caseId).toBe(m.caseId);
    const v = node(e, m.caseId, m.secret);
    expect(v.versions[0]!.supersededBy).toBe(m2.messageId);
    expect(v.versions[0]!.input.details).toBe(NOOR_INPUT.details);
    expect(v.versions[1]!.supersedesMessageId).toBe(m.messageId);
    expect(() => e.submit(m2.input, newMsg().messageId, 'f'.repeat(32))).toThrowError(
      /does not match/i,
    );
  });
});
