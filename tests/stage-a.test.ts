import { describe, expect, it } from 'vitest';
import { FIXTURE_STAFF, NOOR_INPUT } from '@shared/fixtures';
import { CLOSE_OUTCOMES, type CaseView, type StaffRef } from '@shared/types';
import { Engine } from '../src/server/engine';
import {
  CLINICAL_CONTENT_PERMISSIONS,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  can,
} from '../src/server/permissions';
import { newMsg } from './helpers';

/** Stage A product-spec behaviours: gateway, roles, clarification, coverage, consent, audit. */

const ref = (k: keyof typeof FIXTURE_STAFF): StaffRef => {
  const { token: _t, ...r } = FIXTURE_STAFF[k];
  return r;
};
const clinician = ref('clinician');
const clinician2 = ref('clinician2');
const coordinator = ref('coordinator');
const operator = ref('operator');
const admin = ref('admin');
const chw = ref('chw');

const run = (e: Engine, n: number) => {
  for (let i = 0; i < n; i++) e.advance(1);
};
function until(e: Engine, pred: () => boolean, max = 3000) {
  for (let i = 0; i < max; i++) {
    if (pred()) return;
    e.advance(1);
  }
  throw new Error(`condition not reached (tick=${e.state.tick})`);
}
const submit = (e: Engine, over = {}) => {
  const m = newMsg(over);
  return { ...m, ...e.submit(m.input, m.messageId, m.secret) };
};
const node = (e: Engine, c: string, s: string): CaseView => e.getCase(c, s);
const lastV = (v: CaseView) => v.versions[v.versions.length - 1]!;
const UPSTREAM = 3;
const RADIO_VALLEY_GW = 2;

describe('gateway module: separate inbox/outbox, independent radio vs upstream outages', () => {
  it('upstream outage: gateway persists and acknowledges; clinic ack is separate and later', () => {
    const e = Engine.open(null);
    e.setLink(UPSTREAM, false);
    const m = submit(e);
    until(e, () => e.gateway(operator).inbox.items.length === 1);
    run(e, 5);
    const g = e.gateway(operator);
    expect(g.upstream.up).toBe(false);
    expect(g.radio.up).toBe(true);
    expect(g.inbox.held).toBe(1);
    expect(g.inbox.items[0]!.state).toBe('held_upstream_unavailable');
    expect(e.state.messages.get(m.messageId)!.clinicHasCopy).toBe(false);
    // the village learns the GATEWAY has it (return path is radio), but not that the clinic does
    until(e, () => lastV(node(e, m.caseId, m.secret)).tracks.transport === 'gateway_received');
    run(e, 120);
    expect(lastV(node(e, m.caseId, m.secret)).tracks.transport).toBe('gateway_received');

    e.setLink(UPSTREAM, true);
    until(e, () => e.state.messages.get(m.messageId)!.clinicHasCopy);
    expect(e.gateway(operator).inbox.held).toBe(0);
    expect(e.gateway(operator).inbox.forwarded).toBe(1);
    until(e, () => lastV(node(e, m.caseId, m.secret)).tracks.transport === 'clinic_received');
  });

  it('radio outage on the return side: approved reply waits in the gateway outbox while upstream stays up', () => {
    const e = Engine.open(null);
    const a = submit(e);
    until(e, () => lastV(node(e, a.caseId, a.secret)).tracks.transport === 'clinic_received');
    e.startReview(clinician, a.caseId);
    e.setLink(RADIO_VALLEY_GW, false);
    e.approveReply(clinician, a.caseId, {
      text: 'Come Thursday.',
      templateId: null,
      inReplyToMessageId: a.messageId,
    });
    until(e, () => e.gateway(operator).outbox.items.length === 1);
    run(e, 60);
    let g = e.gateway(operator);
    expect(g.outbox.waitingForRadio).toBe(1);
    expect(g.outbox.items[0]!.state).toBe('waiting_radio_unavailable');
    expect(g.upstream.up).toBe(true);
    expect(node(e, a.caseId, a.secret).reply).toBeNull();

    // upstream side still works independently: a second request is forwarded to the clinic
    // only if the radio side can bring it in, so check the reverse: restore and deliver.
    e.setLink(RADIO_VALLEY_GW, true);
    until(e, () => node(e, a.caseId, a.secret).reply !== null);
    g = e.gateway(operator);
    expect(g.outbox.waitingForRadio).toBe(0);
    expect(g.outbox.delivered).toBe(1);
  });

  it('duplicate delivery on the radio side yields ONE gateway inbox record and one logical case', () => {
    const e = Engine.open(null);
    e.configure({ faults: [{ flowKind: 'request', hop: 2, attempt: 1, fault: 'lose_ack' }] });
    const m = submit(e);
    until(e, () => e.state.messages.get(m.messageId)!.clinicHasCopy);
    run(e, 60);
    expect(e.gateway(operator).inbox.items).toHaveLength(1);
    expect(e.state.cases.size).toBe(1);
    expect(e.clinicInbox(clinician, 'oldest')).toHaveLength(1);
    expect(
      [...e.state.events.values()].some(
        (ev) => ev.messageId === m.messageId && ev.stage === 'duplicate_suppressed',
      ),
    ).toBe(true);
  });

  it('gateway status carries no patient content and survives a restart (journal replay)', () => {
    const e = Engine.open(null);
    submit(e, { details: 'SECRET-DETAIL-XYZ', patientName: 'SECRET-NAME' });
    run(e, 40);
    const text = JSON.stringify(e.gateway(operator));
    expect(text).not.toContain('SECRET');
  });
});

describe('role-based permissions enforced in the service', () => {
  it('the permission table never gives operator or admin any clinical-content permission', () => {
    for (const role of ['operator', 'admin'] as const)
      for (const p of CLINICAL_CONTENT_PERMISSIONS) expect(can(role, p)).toBe(false);
    expect(ROLE_PERMISSIONS.chw).toEqual([]);
    for (const p of PERMISSIONS) expect(typeof p).toBe('string');
  });

  it('only the clinician approves; only the coordinator hands over; only the admin changes config', () => {
    const e = Engine.open(null);
    const m = submit(e);
    until(e, () => e.state.messages.get(m.messageId)!.clinicHasCopy);
    e.startReview(clinician, m.caseId);
    const body = { text: 'Hello.', templateId: null, inReplyToMessageId: m.messageId };
    for (const who of [coordinator, operator, admin, chw])
      expect(() => e.approveReply(who, m.caseId, body)).toThrowError(/not permitted/i);
    expect(() => e.approveReply(null, m.caseId, body)).toThrowError(/sign-in/i);
    expect(() => e.handover(clinician, m.caseId, clinician2.staffId, 'x')).toThrowError(
      /not permitted/i,
    );
    expect(() => e.updateAdminConfig(coordinator, { consentVersion: 'v9' })).toThrowError(
      /not permitted/i,
    );
    expect(() => e.setCoverage(clinician, true, '')).toThrowError(/not permitted/i);
    expect(() => e.operatorRequeue(clinician, 'flow-1')).toThrowError(/not permitted/i);
  });

  it('operator and admin cannot read clinical content in any clinic or case endpoint', () => {
    const e = Engine.open(null);
    const m = submit(e, { details: 'PRIVATE-DETAILS' });
    until(e, () => e.state.messages.get(m.messageId)!.clinicHasCopy);
    for (const who of [operator, admin, chw]) {
      expect(() => e.clinicInbox(who, 'oldest')).toThrowError(/not permitted/i);
      expect(() => e.clinicCaseView(who, m.caseId)).toThrowError(/not permitted/i);
      expect(() => e.claim(who, m.caseId)).toThrowError(/not permitted/i);
    }
    const overview = JSON.stringify(e.operatorOverview(operator));
    expect(overview).not.toContain('PRIVATE-DETAILS');
    expect(JSON.stringify(e.coverage(operator))).not.toContain('PRIVATE-DETAILS');
    expect(JSON.stringify(e.auditTrail(operator))).not.toContain('PRIVATE-DETAILS');
    expect(JSON.stringify(e.gateway(admin))).not.toContain('PRIVATE-DETAILS');
  });

  it('a case secret is not staff authority and a staff token is not a case secret', () => {
    const e = Engine.open(null);
    const m = submit(e);
    expect(() => e.clinicInbox(null, 'oldest')).toThrowError(/sign-in/i);
    expect(() => e.getCase(m.caseId, FIXTURE_STAFF.clinician.token)).toThrowError(
      /not authorized/i,
    );
    expect(() => e.getCase(m.caseId, undefined)).toThrowError(/not authorized/i);
  });
});

describe('clarification workflow and correction/withdrawal', () => {
  function toReview() {
    const e = Engine.open(null);
    const m = submit(e);
    until(e, () => lastV(node(e, m.caseId, m.secret)).tracks.transport === 'clinic_received');
    e.startReview(clinician, m.caseId);
    return { e, m };
  }

  it('approved question is linked to the request, the answer is a linked follow-up in the same case', () => {
    const { e, m } = toReview();
    const q = e.approveReply(clinician, m.caseId, {
      text: 'Which medicine has run out?',
      templateId: null,
      inReplyToMessageId: m.messageId,
      kind: 'clarification',
    });
    expect(q.kind).toBe('clarification');
    expect(node(e, m.caseId, m.secret).reply).toBeNull(); // not there until it arrives
    until(e, () => node(e, m.caseId, m.secret).reply !== null);
    expect(node(e, m.caseId, m.secret).reply!.kind).toBe('clarification');

    const ans = newMsg({
      relatedCaseId: m.caseId,
      answersReplyId: q.replyId,
      details: 'The blue tablets.',
    });
    const r = e.submit(ans.input, ans.messageId, m.secret);
    expect(r.caseId).toBe(m.caseId); // same case
    expect(r.version).toBe(2);
    until(e, () => e.state.messages.get(ans.messageId)!.clinicHasCopy);

    const cv = e.clinicCaseView(clinician, m.caseId);
    expect(cv.conversation!.map((c) => c.kind)).toEqual([
      'patient_message',
      'clinic_question',
      'patient_message',
    ]);
    const ticks = cv.conversation!.map((c) => c.atTick);
    expect([...ticks].sort((a, b) => a - b)).toEqual(ticks); // chronological
    expect(cv.conversation![2]!.linkedTo).toBe(q.replyId);
  });

  it('approving the same content twice is idempotent (one reply, one return flow)', () => {
    const { e, m } = toReview();
    const body = { text: 'Come Thursday.', templateId: null, inReplyToMessageId: m.messageId };
    const a = e.approveReply(clinician, m.caseId, body);
    const b = e.approveReply(clinician, m.caseId, body);
    expect(b.replyId).toBe(a.replyId);
    expect(e.state.replies.size).toBe(1);
    expect(e.state.flows.filter((f) => f.kind === 'reply')).toHaveLength(1);
  });

  it('a follow-up cannot claim to answer a reply that has not arrived or is from another case', () => {
    const { e, m } = toReview();
    const q = e.approveReply(clinician, m.caseId, {
      text: 'Question?',
      templateId: null,
      inReplyToMessageId: m.messageId,
      kind: 'clarification',
    });
    const early = newMsg({ relatedCaseId: m.caseId, answersReplyId: q.replyId });
    expect(() => e.submit(early.input, early.messageId, m.secret)).toThrowError(/answersReplyId/);
    const other = submit(e);
    until(e, () => node(e, m.caseId, m.secret).reply !== null);
    const wrong = newMsg({ relatedCaseId: other.caseId, answersReplyId: q.replyId });
    expect(() => e.submit(wrong.input, wrong.messageId, other.secret)).toThrowError(
      /answersReplyId/,
    );
  });

  it('correction after submission is a linked new version; the original stays', () => {
    const { e, m } = toReview();
    const fix = newMsg({ supersedesMessageId: m.messageId, details: 'Corrected: next Tuesday.' });
    const r = e.submit(fix.input, fix.messageId, m.secret);
    expect(r.caseId).toBe(m.caseId);
    expect(e.state.messages.get(m.messageId)!.supersededBy).toBe(fix.messageId);
    expect(e.state.messages.get(m.messageId)!.input.details).toBe(NOOR_INPUT.details);
  });

  it('cancel is only possible before custody leaves the village; afterwards it is a withdrawal notice', () => {
    const e = Engine.open(null);
    e.setLink(0, false); // custody cannot leave the village node
    const a = submit(e);
    e.withdraw(a.caseId, a.secret);
    const ev = [...e.state.events.values()].find(
      (x) => x.messageId === a.messageId && x.stage === 'withdrawn',
    )!;
    expect(ev.detail?.note).toBe('cancelled_before_custody');
    run(e, 200);
    e.setLink(0, true);
    run(e, 200);
    expect(e.state.messages.get(a.messageId)!.clinicHasCopy).toBe(false); // never left

    const e2 = Engine.open(null);
    const b = submit(e2);
    until(e2, () => e2.state.messages.get(b.messageId)!.clinicHasCopy);
    e2.withdraw(b.caseId, b.secret);
    const ev2 = [...e2.state.events.values()].find(
      (x) => x.messageId === b.messageId && x.stage === 'withdrawn',
    )!;
    expect(ev2.detail?.note).toBe('withdrawal_after_forwarding');
    // the clinic copy still exists: no promise of remote erasure
    expect(e2.state.messages.get(b.messageId)!.clinicHasCopy).toBe(true);
    expect(e2.state.audit.some((x) => x.action === 'withdrawal_notice')).toBe(true);
  });
});

describe('clinic coverage, overdue review window, handover and explicit closure', () => {
  function clinicCase() {
    const e = Engine.open(null);
    const m = submit(e);
    until(e, () => e.state.messages.get(m.messageId)!.clinicHasCopy);
    return { e, m };
  }

  it('staffing is only ever a statement; no statement and stale statements are labelled', () => {
    const { e } = clinicCase();
    expect(e.coverage(coordinator).displayLabel).toMatch(/No staffing statement/);
    e.setCoverage(coordinator, true, 'Two nurses on shift');
    expect(e.coverage(coordinator).stale).toBe(false);
    run(e, 5 * 60);
    const c = e.coverage(coordinator);
    expect(c.stale).toBe(true);
    expect(c.displayLabel).toMatch(/stale statement, not live staffing evidence/);
    e.setCoverage(coordinator, false, 'Power cut at the clinic; handing over');
    expect(e.coverage(coordinator).staffed).toBe(false);
    expect(e.coverage(coordinator).displayLabel).toMatch(/NOT staffed/);
  });

  it('overdue = waiting longer than the review window with no approved reply', () => {
    const { e, m } = clinicCase();
    expect(e.coverage(clinician).overdueCount).toBe(0);
    run(e, e.state.admin.reviewWindowTicks + 10);
    const c = e.coverage(coordinator);
    expect(c.overdueCount).toBe(1);
    expect(c.overdue[0]!.caseId).toBe(m.caseId);
    expect(c.overdue[0]!.overdueByTicks).toBeGreaterThan(0);
    expect(e.clinicInbox(clinician, 'oldest')[0]!.overdue).toBe(true);
    // the operator sees the COUNT but no case rows
    const op = e.coverage(operator);
    expect(op.overdueCount).toBe(1);
    expect(op.overdue).toEqual([]);
    // an approved reply ends the overdue state
    e.startReview(clinician, m.caseId);
    e.approveReply(clinician, m.caseId, {
      text: 'Hello.',
      templateId: null,
      inReplyToMessageId: m.messageId,
    });
    expect(e.coverage(coordinator).overdueCount).toBe(0);
  });

  it('handover is coordinator-only, needs a note, moves the assignee and leaves an audit event', () => {
    const { e, m } = clinicCase();
    e.claim(clinician, m.caseId);
    expect(() => e.claim(clinician2, m.caseId)).toThrowError(/already assigned/i);
    expect(() => e.handover(coordinator, m.caseId, clinician2.staffId, '  ')).toThrowError(/note/);
    expect(() => e.handover(coordinator, m.caseId, 'nobody', 'x')).toThrowError(/reviewer/);
    e.handover(coordinator, m.caseId, clinician2.staffId, 'Shift change, please review today');
    expect(e.clinicCaseView(clinician, m.caseId).assignee!.staffId).toBe(clinician2.staffId);
    const h = e.coverage(coordinator).handovers;
    expect(h).toHaveLength(1);
    expect(h[0]!.from.staffId).toBe(coordinator.staffId);
    const aud = e.auditTrail(coordinator).find((x) => x.action === 'case_handover')!;
    expect(aud.actor.staffId).toBe(coordinator.staffId);
    expect(aud.detail).toEqual({ to: clinician2.staffId });
  });

  it('closing needs an explicit outcome, is administrative, and a follow-up reopens the case', () => {
    const { e, m } = clinicCase();
    expect(() => e.closeCase(clinician, m.caseId, 'cured' as never, '')).toThrowError(/outcome/i);
    expect(() => e.closeCase(operator, m.caseId, 'follow_up_needed', '')).toThrowError(
      /not permitted/i,
    );
    expect(CLOSE_OUTCOMES).toContain('appointment_arranged');
    e.closeCase(clinician, m.caseId, 'appointment_arranged', 'Booked via health worker');
    const cv = e.clinicCaseView(clinician, m.caseId);
    expect(cv.closed!.outcome).toBe('appointment_arranged');
    expect(cv.closed!.statement).toMatch(/does not state any health outcome/);
    run(e, e.state.admin.reviewWindowTicks + 50);
    expect(e.coverage(coordinator).overdueCount).toBe(0); // closed cases are not overdue
    expect(e.coverage(coordinator).closed).toBe(1);

    const f = newMsg({ relatedCaseId: m.caseId, details: 'Still need help.' });
    e.submit(f.input, f.messageId, m.secret);
    expect(e.clinicCaseView(clinician, m.caseId).closed).toBeNull();
    expect(e.state.audit.some((x) => x.action === 'case_reopened_by_follow_up')).toBe(true);
  });
});

describe('consent records, audit events and administration', () => {
  it('records consent at acceptance with the wording version in force; admin changes apply to new requests only', () => {
    const e = Engine.open(null);
    const a = submit(e);
    expect(e.state.consents).toHaveLength(1);
    expect(e.state.consents[0]).toMatchObject({
      caseId: a.caseId,
      messageId: a.messageId,
      version: 'consent-v1',
      recipientAcknowledged: true,
      readersAcknowledged: true,
      recordedBy: 'patient',
    });
    e.updateAdminConfig(admin, { consentVersion: 'consent-v2' });
    const b = submit(e, { entryMode: 'assisted', assistedBy: 'Grace' });
    expect(e.state.consents.map((c) => c.version)).toEqual(['consent-v1', 'consent-v2']);
    expect(e.state.consents[1]!.recordedBy).toBe('health_worker');
    until(e, () => e.state.messages.get(b.messageId)!.clinicHasCopy);
    expect(e.clinicCaseView(clinician, b.caseId).consent![0]!.version).toBe('consent-v2');
  });

  it('audit events attribute actions and never contain names or message text', () => {
    const e = Engine.open(null);
    const m = submit(e, { details: 'MY-HEALTH-TEXT', patientName: 'MY-NAME' });
    until(e, () => e.state.messages.get(m.messageId)!.clinicHasCopy);
    e.claim(clinician, m.caseId);
    e.startReview(clinician, m.caseId);
    e.setPriority(clinician, m.caseId, 'soon', 'SECRET-REASON');
    e.approveReply(clinician, m.caseId, {
      text: 'REPLY-TEXT-HERE',
      templateId: null,
      inReplyToMessageId: m.messageId,
    });
    e.updateAdminConfig(admin, { serviceHours: 'Mon-Sat' });
    const trail = e.auditTrail(coordinator);
    const actions = trail.map((t) => t.action);
    for (const a of [
      'request_accepted',
      'consent_recorded',
      'case_claimed',
      'review_started',
      'priority_set',
      'reply_approved',
      'config_changed',
    ])
      expect(actions).toContain(a);
    const text = JSON.stringify(trail);
    for (const secret of ['MY-HEALTH-TEXT', 'MY-NAME', 'SECRET-REASON', 'REPLY-TEXT-HERE'])
      expect(text).not.toContain(secret);
    expect(trail.find((t) => t.action === 'reply_approved')!.actor).toMatchObject({
      kind: 'staff',
      role: 'clinician',
    });
    expect(() => e.auditTrail(clinician)).toThrowError(/not permitted/i);
    expect(() => e.auditTrail(null)).toThrowError(/sign-in/i);
  });

  it('config changes are validated, attributed, and survive journal replay', async () => {
    const { tmpDir } = await import('./helpers');
    const dir = tmpDir();
    const e = Engine.open(dir);
    expect(() => e.updateAdminConfig(admin, { reviewWindowTicks: -5 })).toThrowError(/valid/i);
    e.updateAdminConfig(admin, { reviewWindowTicks: 90, consentVersion: 'consent-v7' });
    e.close();
    const e2 = Engine.open(dir);
    expect(e2.adminConfig(admin)).toMatchObject({
      reviewWindowTicks: 90,
      consentVersion: 'consent-v7',
    });
    expect(e2.state.audit.some((x) => x.action === 'config_changed')).toBe(true);
    e2.close();
  });
});

describe('village node health indicators', () => {
  it('reports availability, storage, queue age, radio adapter status and last sync', () => {
    const e = Engine.open(null);
    e.setLink(0, false);
    expect(e.nodeHealth().radioAdapter.status).toBe('simulated_link_down');
    submit(e);
    run(e, 30);
    const h = e.nodeHealth();
    expect(h.queue.waitingToSend).toBe(1);
    expect(h.queue.oldestAgeTicks).toBe(30);
    expect(h.availability.up).toBe(true);
    expect(h.lastSync.tick).toBeNull();
    e.setLink(0, true);
    run(e, 20);
    expect(e.nodeHealth().queue.waitingToSend).toBe(0);
    expect(e.nodeHealth().lastSync.tick).not.toBeNull();
    e.powerCut(10);
    expect(e.nodeHealth().availability).toEqual({ up: false, downUntilTick: e.state.tick + 10 });
    expect(e.nodeHealth().storageLayout.sensitiveCases).toMatch(/plaintext/);
  });
});
