import { encodedSize } from '@shared/codec';
import { buildDraftSummary } from '@shared/draft';
import { refFromSeed } from '@shared/ids';
import { tickToIso } from '@shared/time';
import { translateReplyForPatient, translateToEnglish } from '@shared/translate';
import { deriveTracks, reconcileEvents } from '@shared/tracks';
import {
  ApiError,
  type ApiErrorCode,
  type CaseView,
  type CareState,
  type ClinicCaseView,
  type ClinicMessageView,
  type ClockQuality,
  type InboxItem,
  type OperatorOverview,
  type ReplyTemplate,
  type ReplyView,
  type StaffPriority,
  type StaffRef,
  type EventStage,
  type EventsPage,
  type MessageVersionView,
  type NodeId,
  type NodeStatus,
  NODE_PATH,
  type RequestInput,
  type SubmitResult,
  type TransportEvent,
} from '@shared/types';
import { hashSecret, secretMatches } from './auth';
import { Journal } from './journal';
import { newFlow, stepTick, UP, DOWN } from './sim';
import {
  newState,
  type Flow,
  type MessageRec,
  type ReplyRec,
  type SimConfig,
  type State,
} from './state';

export class EngineError extends ApiError {
  constructor(code: ApiErrorCode, message: string, status: number) {
    super(code, message, status);
    this.name = 'EngineError';
  }
}

export const CLOCK_QUALITY: Record<NodeId, ClockQuality> = {
  village: 'unsynced',
  'relay-ridge': 'unsynced',
  'relay-valley': 'unsynced',
  gateway: 'synced',
  clinic: 'synced',
};

/** Journal records. The journal is the durable write-ahead log; state is a pure replay of it. */
export type Command =
  | {
      t: 'accept';
      messageId: string;
      secretHash: string;
      caseId: string | null;
      input: RequestInput;
    }
  | { t: 'advance'; ticks: number }
  | { t: 'link'; index: number; up: boolean }
  | { t: 'power_cut'; durationTicks: number }
  | { t: 'config'; patch: Partial<SimConfig> }
  | { t: 'battery'; node: NodeId; percent: number }
  | { t: 'requeue'; flowId: string }
  | { t: 'read'; caseId: string }
  | { t: 'claim'; caseId: string; staff: StaffRef }
  | { t: 'start_review'; caseId: string; staff: StaffRef }
  | {
      t: 'priority';
      caseId: string;
      staff: StaffRef;
      level: StaffPriority['level'];
      reason: string;
    }
  | { t: 'reply_draft'; caseId: string; staff: StaffRef; text: string; templateId: string | null }
  | {
      t: 'approve';
      caseId: string;
      staff: StaffRef;
      messageId: string;
      text: string;
      templateId: string | null;
    }
  | { t: 'reply_opened'; caseId: string; assistedBy: string | null }
  | { t: 'withdraw'; caseId: string };

export const TEMPLATES: ReplyTemplate[] = [
  {
    id: 'follow-up-thursday',
    title: 'Follow-up: come Thursday morning',
    text: 'Please come to the clinic on Thursday morning for your follow-up. Bring your health card.',
  },
  {
    id: 'received-nurse-contact',
    title: 'Received: nurse will contact you',
    text: 'We received your message. A nurse will contact you through your health worker.',
  },
  {
    id: 'referral-confirmed',
    title: 'Referral confirmed',
    text: 'Your referral is confirmed. Please speak with your health worker about travel.',
  },
];

const NEARLY_FULL_RATIO = 0.9;

export class Engine {
  state: State = newState();
  private replaying = false;

  private constructor(readonly journal: Journal | null) {}

  /** Open an engine. With a directory it is durable; with null it is in-memory (unit tests). */
  static open(dir: string | null): Engine {
    const e = new Engine(dir ? new Journal(dir) : null);
    e.replay();
    return e;
  }

  /** Rebuild all state from the journal (what a restart does). */
  replay(): void {
    this.state = newState();
    if (!this.journal) return;
    this.replaying = true;
    try {
      for (const rec of this.journal.load()) this.apply(rec as Command);
    } finally {
      this.replaying = false;
    }
    this.state.journalBytes = this.journal.size;
  }

  close(): void {
    this.journal?.close();
  }

  // ------------------------------------------------------------------ commit / apply
  protected commit<T>(cmd: Command): T {
    if (!this.replaying) this.journal?.append(cmd);
    const out = this.apply(cmd) as T;
    if (this.journal) this.state.journalBytes = this.journal.size;
    return out;
  }

  protected apply(cmd: Command): unknown {
    const s = this.state;
    switch (cmd.t) {
      case 'accept':
        return this.applyAccept(cmd);
      case 'advance':
        for (let i = 0; i < cmd.ticks; i++) stepTick(this);
        return;
      case 'link':
        s.links[cmd.index] = cmd.up;
        return;
      case 'power_cut':
        s.nodeDownUntil = s.tick + cmd.durationTicks;
        s.nodeLog.push({ tick: s.tick, kind: 'power_cut', durationTicks: cmd.durationTicks });
        return;
      case 'config':
        s.config = { ...s.config, ...cmd.patch };
        return;
      case 'battery':
        s.battery[cmd.node] = { percent: cmd.percent, reportedAtTick: s.tick };
        return;
      case 'requeue':
        return this.applyRequeue(cmd.flowId);
      case 'read':
        return this.applyRead(cmd.caseId);
      case 'claim':
        s.cases.get(cmd.caseId)!.assignee = cmd.staff;
        return;
      case 'start_review':
        return this.applyStartReview(cmd.caseId, cmd.staff);
      case 'priority':
        s.cases.get(cmd.caseId)!.priority = {
          level: cmd.level,
          setBy: cmd.staff,
          reason: cmd.reason,
          atTick: s.tick,
        };
        return;
      case 'reply_draft':
        s.cases.get(cmd.caseId)!.replyDraft = {
          text: cmd.text,
          templateId: cmd.templateId,
          savedBy: cmd.staff,
          atTick: s.tick,
        };
        return;
      case 'approve':
        return this.applyApprove(cmd);
      case 'reply_opened':
        return this.applyReplyOpened(cmd.caseId, cmd.assistedBy);
      case 'withdraw':
        return this.applyWithdraw(cmd.caseId);
    }
  }

  // ------------------------------------------------------------------ node status
  get nodeUp(): boolean {
    return this.state.tick >= this.state.nodeDownUntil;
  }

  private assertNodeUp(): void {
    if (!this.nodeUp)
      throw new EngineError('node_unavailable', 'The local node has no power right now', 503);
  }

  storage() {
    const used = this.state.journalBytes;
    const limit = this.state.config.storageLimitBytes;
    return { usedBytes: used, limitBytes: limit, nearlyFull: used >= limit * NEARLY_FULL_RATIO };
  }

  nodeStatus(): NodeStatus {
    return {
      simulated: true,
      nowTick: this.state.tick,
      nowIso: tickToIso(this.state.tick),
      nodeUp: this.nodeUp,
      storage: this.storage(),
      upstream: this.state.links[0] ? 'link_up' : 'link_down',
      translationAvailable: this.state.config.translationAvailable,
    };
  }

  // ------------------------------------------------------------------ events
  emit(
    messageId: string,
    stage: EventStage,
    source: NodeId,
    opts: {
      detail?: TransportEvent['detail'];
      knownAtNode?: boolean;
      knownAtClinic?: boolean;
    } = {},
  ): TransportEvent {
    const s = this.state;
    const msg = s.messages.get(messageId);
    const key = `${messageId}|${source}`;
    const sequence = (s.seq.get(key) ?? 0) + 1;
    s.seq.set(key, sequence);
    s.counters.event += 1;
    const ev: TransportEvent = {
      eventId: `ev-${s.counters.event}`,
      messageId,
      stage,
      source,
      sequence,
      at: tickToIso(s.tick),
      clockQuality: CLOCK_QUALITY[source],
      version: msg?.version ?? 1,
      ...(opts.detail ? { detail: opts.detail } : {}),
    };
    s.events.set(ev.eventId, ev);
    s.eventOrder.push(ev.eventId);
    s.lastContact[source] = s.tick;
    if (opts.knownAtNode) this.learnAtNode(ev.eventId);
    if (opts.knownAtClinic) this.learnAtClinic(ev.eventId);
    return ev;
  }

  learnAtNode(eventId: string): void {
    if (this.state.knownAtNode.has(eventId)) return;
    this.state.knownAtNode.set(eventId, this.state.tick);
    this.state.nodeFeed.push(eventId);
  }

  learnAtClinic(eventId: string): void {
    if (this.state.knownAtClinic.has(eventId)) return;
    this.state.knownAtClinic.set(eventId, this.state.tick);
    this.state.clinicFeed.push(eventId);
  }

  // ------------------------------------------------------------------ accept (submit)
  /**
   * Idempotent on messageId. Authorization: the secret presented must match the case secret
   * (new case: it becomes the case secret). A case reference alone is never enough.
   */
  submit(input: RequestInput, messageId: string, secret: string | undefined): SubmitResult {
    this.assertNodeUp();
    if (!secret || secret.length < 16)
      throw new EngineError('unauthorized', 'A device credential is required', 401);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(messageId))
      throw new EngineError('bad_request', 'messageId must be a UUID', 400);
    this.validateInput(input);

    const existing = this.state.messages.get(messageId);
    if (existing) {
      const c = this.state.cases.get(existing.caseId)!;
      if (!secretMatches(secret, c.secretHash))
        throw new EngineError('unauthorized', 'Credential does not match this case', 401);
      if (JSON.stringify(existing.input) !== JSON.stringify(input))
        throw new EngineError('conflict', 'messageId was already used for different content', 409);
      return {
        caseId: c.caseId,
        ref: c.ref,
        messageId,
        version: existing.version,
        duplicate: true,
      };
    }

    let caseId: string | null = null;
    const related = input.supersedesMessageId
      ? this.state.messages.get(input.supersedesMessageId)?.caseId
      : input.relatedCaseId;
    if (input.supersedesMessageId && !related)
      throw new EngineError('not_found', 'Message to supersede not found', 404);
    if (related) {
      const c = this.state.cases.get(related);
      if (!c) throw new EngineError('not_found', 'Case not found', 404);
      if (!secretMatches(secret, c.secretHash))
        throw new EngineError('unauthorized', 'Credential does not match this case', 401);
      caseId = c.caseId;
    }

    if (this.storage().nearlyFull)
      throw new EngineError(
        'storage_nearly_full',
        'Local storage is nearly full: new submissions are blocked',
        507,
      );

    return this.commit<SubmitResult>({
      t: 'accept',
      messageId,
      secretHash: hashSecret(secret),
      caseId,
      input,
    });
  }

  private validateInput(input: RequestInput): void {
    if (!input || typeof input !== 'object')
      throw new EngineError('bad_request', 'Invalid request', 400);
    if (typeof input.details !== 'string' || input.details.trim() === '')
      throw new EngineError('bad_request', 'details are required', 400);
    if (input.details.length > 1000)
      throw new EngineError('bad_request', 'details too long (max 1000 characters)', 400);
    if (!input.consent?.recipientAcknowledged || !input.consent?.readersAcknowledged)
      throw new EngineError('bad_request', 'Consent is required before sending', 400);
  }

  protected applyAccept(cmd: Extract<Command, { t: 'accept' }>): SubmitResult {
    const s = this.state;
    let c = cmd.caseId ? s.cases.get(cmd.caseId)! : undefined;
    if (!c) {
      s.counters.case += 1;
      const caseId = `case-${s.counters.case}`;
      let attempt = 0;
      let ref = refFromSeed(s.counters.case * 104729 + s.config.seed, attempt);
      while (s.refToCase.has(ref))
        ref = refFromSeed(s.counters.case * 104729 + s.config.seed, ++attempt);
      c = {
        caseId,
        ref,
        secretHash: cmd.secretHash,
        createdTick: s.tick,
        messageIds: [],
        assignee: null,
        priority: null,
        readAtTick: null,
        replyDraft: null,
        replyIds: [],
        replyOpenedAssistedBy: null,
      };
      s.cases.set(caseId, c);
      s.refToCase.set(ref, caseId);
    }
    const version = c.messageIds.length + 1;
    const msg: MessageRec = {
      messageId: cmd.messageId,
      caseId: c.caseId,
      version,
      input: cmd.input,
      encodedBytes: encodedSize(cmd.input, cmd.messageId),
      acceptedTick: s.tick,
      expiresTick: s.tick + s.config.ttlTicks,
      supersedes: cmd.input.supersedesMessageId ?? null,
      supersededBy: null,
      clinicReceivedTick: null,
      translation: null,
      draft: null,
      withdrawn: false,
      clinicHasCopy: false,
    };
    s.messages.set(msg.messageId, msg);
    c.messageIds.push(msg.messageId);
    if (msg.supersedes) {
      const old = s.messages.get(msg.supersedes);
      if (old) old.supersededBy = msg.messageId;
    }
    this.emit(msg.messageId, 'queued', 'village', {
      detail: { bytes: msg.encodedBytes },
      knownAtNode: true,
    });
    this.onAccepted(msg);
    return { caseId: c.caseId, ref: c.ref, messageId: msg.messageId, version, duplicate: false };
  }

  /** The relay simulator starts moving the accepted message hop by hop. */
  protected onAccepted(msg: MessageRec): void {
    newFlow(this, 'request', msg, UP, []);
  }

  // ------------------------------------------------------------------ node reads
  private caseForSecret(caseId: string, secret: string | undefined) {
    const c = this.state.cases.get(caseId);
    // Same error for unknown case and bad credential: do not reveal which references exist.
    if (!c || !secretMatches(secret, c.secretHash))
      throw new EngineError('unauthorized', 'Not authorized for this case', 401);
    return c;
  }

  lookupByReference(ref: string, secret: string | undefined): CaseView {
    this.assertNodeUp();
    const id = this.state.refToCase.get(ref.trim().toUpperCase());
    if (!id) throw new EngineError('unauthorized', 'Not authorized for this case', 401);
    return this.getCase(id, secret);
  }

  getCaseByMessageId(messageId: string, secret: string | undefined): CaseView {
    this.assertNodeUp();
    const m = this.state.messages.get(messageId);
    if (!m) {
      if (!secret) throw new EngineError('unauthorized', 'Not authorized', 401);
      throw new EngineError('not_found', 'No such message on this node', 404);
    }
    return this.getCase(m.caseId, secret);
  }

  getCase(caseId: string, secret: string | undefined): CaseView {
    this.assertNodeUp();
    const c = this.caseForSecret(caseId, secret);
    const versions = c.messageIds.map((id) => this.nodeVersionView(this.state.messages.get(id)!));
    return {
      caseId: c.caseId,
      ref: c.ref,
      versions,
      reply: this.nodeReply(c.caseId),
      replyOpenedAssistedBy: c.replyOpenedAssistedBy,
      nowTick: this.state.tick,
      nowIso: tickToIso(this.state.tick),
    };
  }

  /** Reply as visible on the village device: only once it has actually arrived there. */
  protected nodeReply(caseId: string): CaseView['reply'] {
    const c = this.state.cases.get(caseId)!;
    for (let i = c.replyIds.length - 1; i >= 0; i--) {
      const r = this.state.replies.get(c.replyIds[i]!)!;
      if (r.deliveredToNodeTick !== null) return this.publicReply(r);
    }
    return null;
  }

  private publicReply(r: ReplyRec): ReplyView {
    const {
      messageId: _m,
      deliveredToNodeTick: _a,
      deliveredToClinicTick: _b,
      openedTick: _c,
      ...view
    } = r;
    return view;
  }

  protected nodeEventsFor(messageId: string): TransportEvent[] {
    const s = this.state;
    const evs = s.nodeFeed.map((id) => s.events.get(id)!).filter((e) => e.messageId === messageId);
    return reconcileEvents([], evs);
  }

  protected nodeVersionView(m: MessageRec): MessageVersionView {
    const s = this.state;
    const events = this.nodeEventsFor(m.messageId);
    const ticks = events.map((e) => s.knownAtNode.get(e.eventId) ?? 0);
    return {
      messageId: m.messageId,
      version: m.version,
      supersedesMessageId: m.supersedes,
      supersededBy: m.supersededBy,
      input: m.input,
      acceptedAt: tickToIso(m.acceptedTick),
      expiresAt: tickToIso(m.expiresTick),
      encodedBytes: m.encodedBytes,
      tracks: deriveTracks(events, true),
      events,
      lastUpdateTick: ticks.length ? Math.max(...ticks) : null,
    };
  }

  /** Feed of node-known events for a case. cursor = index into the node feed (opaque string). */
  getEvents(caseId: string, cursor: string | undefined, secret: string | undefined): EventsPage {
    this.assertNodeUp();
    const c = this.caseForSecret(caseId, secret);
    const s = this.state;
    const from = Number.parseInt(cursor ?? '0', 10);
    const start = Number.isFinite(from) && from >= 0 ? from : 0;
    const mine = new Set(c.messageIds);
    const events = s.nodeFeed
      .slice(start)
      .map((id) => s.events.get(id)!)
      .filter((e) => mine.has(e.messageId));
    return { events, cursor: String(s.nodeFeed.length) };
  }

  // ================================================================== simulator controls
  advance(ticks: number): void {
    if (!Number.isInteger(ticks) || ticks < 1 || ticks > 20000)
      throw new EngineError('bad_request', 'ticks must be an integer between 1 and 20000', 400);
    this.commit({ t: 'advance', ticks });
  }

  setLink(index: number, up: boolean): void {
    if (!Number.isInteger(index) || index < 0 || index > 3)
      throw new EngineError('bad_request', 'link index must be 0..3', 400);
    this.commit({ t: 'link', index, up });
  }

  /** Simulated power loss at the village node. Callers then replay() to prove recovery from disk. */
  powerCut(durationTicks: number): void {
    if (!Number.isInteger(durationTicks) || durationTicks < 1 || durationTicks > 20000)
      throw new EngineError('bad_request', 'durationTicks must be 1..20000', 400);
    this.commit({ t: 'power_cut', durationTicks });
  }

  configure(patch: Partial<SimConfig>): void {
    this.commit({ t: 'config', patch });
  }

  reportBattery(node: NodeId, percent: number): void {
    this.commit({ t: 'battery', node, percent: Math.max(0, Math.min(100, Math.round(percent))) });
  }

  requeue(flowId: string): void {
    if (!this.state.flows.some((f) => f.id === flowId))
      throw new EngineError('not_found', 'Unknown flow', 404);
    this.commit({ t: 'requeue', flowId });
  }

  private applyRequeue(flowId: string): void {
    const s = this.state;
    const f = s.flows.find((x) => x.id === flowId);
    if (!f) return;
    f.failed = false;
    f.done = false;
    for (const h of f.hops)
      if (h.gaveUp) {
        h.gaveUp = false;
        h.attempts = 0;
        h.next = s.tick;
      }
  }

  simState() {
    const s = this.state;
    return {
      simulated: true as const,
      nowTick: s.tick,
      nowIso: tickToIso(s.tick),
      links: s.links,
      nodeUp: this.nodeUp,
      nodeDownUntil: s.nodeDownUntil,
      config: s.config,
      restarts: this.restarts,
      nodeLog: s.nodeLog,
      journalBytes: s.journalBytes,
      flows: s.flows
        .filter((f) => !f.done)
        .map((f) => ({
          id: f.id,
          kind: f.kind,
          messageId: f.messageId,
          path: f.path.map((i) => NODE_PATH[i]),
          hops: f.hops.map((h) => ({ ...h })),
        })),
    };
  }

  /** Number of times state was rebuilt from disk (simulated restarts) in this process. */
  restarts = 0;

  /** Demo reset (simulator control): wipe the journal and start from an empty node. */
  reset(): void {
    this.journal?.reset();
    this.replay();
    this.restarts = 0;
  }

  restart(): void {
    this.replay();
    this.restarts += 1;
  }

  // ================================================================== clinic side
  /** Called by the simulator when the request copy first reaches the clinic. */
  deliverToClinic(msg: MessageRec, hopDetail: TransportEvent['detail']): void {
    const s = this.state;
    msg.clinicHasCopy = true;
    msg.clinicReceivedTick = s.tick;
    msg.translation = translateToEnglish(msg.input.details, msg.input.language, {
      available: s.config.translationAvailable,
    });
    msg.draft = buildDraftSummary(msg.input, msg.translation);
    const e1 = this.emit(msg.messageId, 'clinic_received', 'clinic', {
      ...(hopDetail ? { detail: hopDetail } : {}),
      knownAtClinic: true,
    });
    const e2 = this.emit(msg.messageId, 'care_awaiting_review', 'clinic', { knownAtClinic: true });
    newFlow(this, 'status', msg, DOWN, [e1.eventId, e2.eventId]);
  }

  /** Called when a status flow completes (nothing extra to do on the node side yet). */
  onStatusArrived(flow: Flow): void {
    if (flow.path[flow.path.length - 1] !== 4) return;
    for (const id of flow.carries) {
      const ev = this.state.events.get(id);
      if (!ev || (ev.stage !== 'reply_available_local' && ev.stage !== 'reply_opened')) continue;
      for (const r of this.state.replies.values()) {
        if (r.messageId !== flow.messageId) continue;
        if (ev.stage === 'reply_available_local' && r.deliveredToClinicTick === null)
          r.deliveredToClinicTick = this.state.tick;
      }
    }
  }

  /** Called when an approved reply reaches the village node. */
  onReplyArrived(flow: Flow): void {
    const s = this.state;
    const reply = s.replies.get(flow.replyId!)!;
    const msg = s.messages.get(flow.messageId)!;
    reply.deliveredToNodeTick = s.tick;
    for (const id of flow.carries) this.learnAtNode(id);
    const ev = this.emit(msg.messageId, 'reply_available_local', 'village', { knownAtNode: true });
    newFlow(this, 'status', msg, UP, [ev.eventId]);
  }

  private clinicEventsFor(messageId: string): TransportEvent[] {
    const s = this.state;
    return reconcileEvents(
      [],
      s.clinicFeed.map((id) => s.events.get(id)!).filter((e) => e.messageId === messageId),
    );
  }

  private requireStaff(staff: { role: string } | null, roles: string[]): asserts staff is StaffRef {
    if (!staff) throw new EngineError('unauthorized', 'Staff sign-in required', 401);
    if (!roles.includes(staff.role))
      throw new EngineError('forbidden', `Role '${staff.role}' is not permitted to do this`, 403);
  }

  private clinicCase(caseId: string) {
    const c = this.state.cases.get(caseId);
    const has = c?.messageIds.some((id) => this.state.messages.get(id)?.clinicHasCopy);
    if (!c || !has) throw new EngineError('not_found', 'No such case at this clinic', 404);
    return c;
  }

  private latestClinicMessage(caseId: string): MessageRec {
    const c = this.state.cases.get(caseId)!;
    for (let i = c.messageIds.length - 1; i >= 0; i--) {
      const m = this.state.messages.get(c.messageIds[i]!)!;
      if (m.clinicHasCopy) return m;
    }
    throw new EngineError('not_found', 'No such case at this clinic', 404);
  }

  clinicInbox(staff: StaffRef | null, sort: 'oldest' | 'priority'): InboxItem[] {
    this.requireStaff(staff, ['clinician', 'coordinator']);
    const s = this.state;
    const items: InboxItem[] = [];
    for (const c of s.cases.values()) {
      if (!c.messageIds.some((id) => s.messages.get(id)?.clinicHasCopy)) continue;
      const m = this.latestClinicMessage(c.caseId);
      const evs = this.clinicEventsFor(m.messageId);
      const tracks = deriveTracks(evs, true);
      let last = 0;
      for (const id of c.messageIds)
        for (const e of this.clinicEventsFor(id))
          last = Math.max(last, s.knownAtClinic.get(e.eventId) ?? 0);
      items.push({
        caseId: c.caseId,
        ref: c.ref,
        latestMessageId: m.messageId,
        requestType: m.input.requestType,
        language: m.input.language,
        villageLabel: m.input.village,
        receivedAtTick: m.clinicReceivedTick ?? 0,
        lastNetworkUpdateTick: last,
        unread: c.readAtTick === null || c.readAtTick < (m.clinicReceivedTick ?? 0),
        assignee: c.assignee,
        priority: c.priority,
        care: tracks.care as CareState | null,
        returnTransport: tracks.returnTransport,
        userAction: tracks.userAction,
        exception: tracks.exception,
        versionCount: c.messageIds.length,
      });
    }
    const rank = { urgent: 0, soon: 1, routine: 2 } as const;
    const done = (i: InboxItem) => (i.care === 'reply_approved' ? 1 : 0);
    items.sort((a, b) => {
      if (done(a) !== done(b)) return done(a) - done(b);
      if (sort === 'priority') {
        const pa = a.priority ? rank[a.priority.level] : 3;
        const pb = b.priority ? rank[b.priority.level] : 3;
        if (pa !== pb) return pa - pb;
      }
      return a.receivedAtTick - b.receivedAtTick || a.caseId.localeCompare(b.caseId);
    });
    return items;
  }

  clinicCaseView(staff: StaffRef | null, caseId: string): ClinicCaseView {
    this.requireStaff(staff, ['clinician', 'coordinator']);
    const s = this.state;
    const c = this.clinicCase(caseId);
    const messages: ClinicMessageView[] = [];
    for (const id of c.messageIds) {
      const m = s.messages.get(id)!;
      if (!m.clinicHasCopy) continue;
      const evs = this.clinicEventsFor(id);
      const ticks = evs.map((e) => s.knownAtClinic.get(e.eventId) ?? 0);
      messages.push({
        messageId: id,
        version: m.version,
        supersedesMessageId: m.supersedes,
        original: m.input,
        translation: m.translation!,
        draftSummary: m.draft!,
        tracks: deriveTracks(evs, true),
        events: evs,
        receivedAtTick: m.clinicReceivedTick ?? 0,
        lastNetworkUpdateTick: ticks.length ? Math.max(...ticks) : 0,
      });
    }
    return {
      caseId: c.caseId,
      ref: c.ref,
      messages,
      assignee: c.assignee,
      priority: c.priority,
      replies: c.replyIds.map((rid) => this.publicReply(s.replies.get(rid)!)),
      replyDraft: c.replyDraft,
      nowTick: s.tick,
      nowIso: tickToIso(s.tick),
    };
  }

  templates(): ReplyTemplate[] {
    return TEMPLATES;
  }

  markRead(staff: StaffRef | null, caseId: string): void {
    this.requireStaff(staff, ['clinician', 'coordinator']);
    this.clinicCase(caseId);
    this.commit({ t: 'read', caseId });
  }

  private applyRead(caseId: string): void {
    this.state.cases.get(caseId)!.readAtTick = this.state.tick;
  }

  claim(staff: StaffRef | null, caseId: string): void {
    this.requireStaff(staff, ['clinician', 'coordinator']);
    const c = this.clinicCase(caseId);
    if (c.assignee && c.assignee.staffId !== staff.staffId)
      throw new EngineError('conflict', `Already assigned to ${c.assignee.name}`, 409);
    this.commit({ t: 'claim', caseId, staff });
  }

  startReview(staff: StaffRef | null, caseId: string): void {
    this.requireStaff(staff, ['clinician', 'coordinator']);
    const c = this.clinicCase(caseId);
    if (c.assignee && c.assignee.staffId !== staff.staffId)
      throw new EngineError('conflict', `Assigned to ${c.assignee.name}`, 409);
    this.commit({ t: 'start_review', caseId, staff });
  }

  private applyStartReview(caseId: string, staff: StaffRef): void {
    const s = this.state;
    const c = s.cases.get(caseId)!;
    if (!c.assignee) c.assignee = staff;
    const m = this.latestClinicMessage(caseId);
    const already = this.clinicEventsFor(m.messageId).some((e) => e.stage === 'care_in_review');
    if (already) return;
    const ev = this.emit(m.messageId, 'care_in_review', 'clinic', { knownAtClinic: true });
    newFlow(this, 'status', m, DOWN, [ev.eventId]);
  }

  setPriority(
    staff: StaffRef | null,
    caseId: string,
    level: StaffPriority['level'],
    reason: string,
  ): void {
    this.requireStaff(staff, ['clinician', 'coordinator']);
    this.clinicCase(caseId);
    if (!['routine', 'soon', 'urgent'].includes(level))
      throw new EngineError('bad_request', 'Invalid priority level', 400);
    if (level !== 'routine' && !reason.trim())
      throw new EngineError('bad_request', 'A reason is required to set staff priority', 400);
    this.commit({ t: 'priority', caseId, staff, level, reason: reason.trim().slice(0, 300) });
  }

  saveReplyDraft(
    staff: StaffRef | null,
    caseId: string,
    text: string,
    templateId: string | null,
  ): void {
    this.requireStaff(staff, ['clinician', 'coordinator']);
    this.clinicCase(caseId);
    // A draft is NOT a reply: nothing is queued for return transport.
    this.commit({ t: 'reply_draft', caseId, staff, text: text.slice(0, 1000), templateId });
  }

  /**
   * Explicit, authorized approval. Only a clinician may approve. Until this succeeds there is no
   * reply object and no return flow: the patient cannot receive anything.
   */
  approveReply(
    staff: StaffRef | null,
    caseId: string,
    input: { text: string; templateId: string | null; inReplyToMessageId: string },
  ): ReplyView {
    this.requireStaff(staff, ['clinician']);
    const c = this.clinicCase(caseId);
    const text = (input.text ?? '').trim();
    if (!text) throw new EngineError('bad_request', 'Reply text is required', 400);
    if (text.length > 1000) throw new EngineError('bad_request', 'Reply too long', 400);
    const m = this.state.messages.get(input.inReplyToMessageId);
    if (!m || m.caseId !== c.caseId || !m.clinicHasCopy)
      throw new EngineError('bad_request', 'inReplyToMessageId is not a message of this case', 400);
    const inReview = this.clinicEventsFor(m.messageId).some((e) => e.stage === 'care_in_review');
    if (!inReview)
      throw new EngineError('conflict', 'Start the review before approving a reply', 409);
    return this.commit<ReplyView>({
      t: 'approve',
      caseId,
      staff,
      messageId: m.messageId,
      text,
      templateId: input.templateId ?? null,
    });
  }

  private applyApprove(cmd: Extract<Command, { t: 'approve' }>): ReplyView {
    const s = this.state;
    const c = s.cases.get(cmd.caseId)!;
    const m = s.messages.get(cmd.messageId)!;
    s.counters.reply += 1;
    const tr = translateReplyForPatient(cmd.text, 'en', m.input.language, {
      available: s.config.translationAvailable,
    });
    const rec: ReplyRec = {
      replyId: `reply-${s.counters.reply}`,
      caseId: c.caseId,
      inReplyToMessageId: m.messageId,
      version: c.replyIds.length + 1,
      text: cmd.text,
      textLanguage: 'en',
      patientText: tr.text,
      patientLanguage: tr.status === 'machine_draft_needs_review' ? m.input.language : 'en',
      translation:
        tr.status === 'not_needed'
          ? 'not_needed'
          : tr.status === 'machine_draft_needs_review'
            ? 'machine_draft_needs_review'
            : 'unavailable',
      author: { name: cmd.staff.name, role: cmd.staff.role },
      clinic: cmd.staff.clinic,
      approvedAt: tickToIso(s.tick),
      approvedAtTick: s.tick,
      templateId: cmd.templateId,
      messageId: m.messageId,
      deliveredToNodeTick: null,
      deliveredToClinicTick: null,
      openedTick: null,
    };
    s.replies.set(rec.replyId, rec);
    c.replyIds.push(rec.replyId);
    c.replyDraft = null;
    const ev = this.emit(m.messageId, 'reply_approved', 'clinic', { knownAtClinic: true });
    newFlow(this, 'reply', m, DOWN, [ev.eventId], rec.replyId);
    return this.publicReply(rec);
  }

  // ================================================================== village-device actions
  markReplyOpened(caseId: string, secret: string | undefined, assistedBy: string | null): void {
    this.assertNodeUp();
    const c = this.caseForSecret(caseId, secret);
    if (!this.nodeReply(c.caseId))
      throw new EngineError('conflict', 'No reply has arrived on this device', 409);
    this.commit({ t: 'reply_opened', caseId, assistedBy });
  }

  private applyReplyOpened(caseId: string, assistedBy: string | null): void {
    const s = this.state;
    const c = s.cases.get(caseId)!;
    let reply: ReplyRec | undefined;
    for (let i = c.replyIds.length - 1; i >= 0; i--) {
      const r = s.replies.get(c.replyIds[i]!)!;
      if (r.deliveredToNodeTick !== null) {
        reply = r;
        break;
      }
    }
    if (!reply || reply.openedTick !== null) return;
    reply.openedTick = s.tick;
    c.replyOpenedAssistedBy = assistedBy;
    const m = s.messages.get(reply.messageId)!;
    const ev = this.emit(m.messageId, 'reply_opened', 'village', {
      knownAtNode: true,
      ...(assistedBy ? { detail: { note: 'assisted_reading' } } : {}),
    });
    newFlow(this, 'status', m, UP, [ev.eventId]);
  }

  withdraw(caseId: string, secret: string | undefined): void {
    this.assertNodeUp();
    this.caseForSecret(caseId, secret);
    this.commit({ t: 'withdraw', caseId });
  }

  private applyWithdraw(caseId: string): void {
    const s = this.state;
    const c = s.cases.get(caseId)!;
    const mid = c.messageIds[c.messageIds.length - 1]!;
    const m = s.messages.get(mid)!;
    if (m.withdrawn) return;
    m.withdrawn = true;
    const ev = this.emit(mid, 'withdrawn', 'village', { knownAtNode: true });
    // Stop sending from this device if the first hop has not yet delivered. Copies already
    // forwarded cannot be erased; tell the clinic so it does not act on a withdrawn request.
    for (const f of s.flows) {
      if (f.kind === 'request' && f.messageId === mid && !f.hops[0]!.delivered) {
        f.failed = true;
        f.done = true;
      }
    }
    newFlow(this, 'status', m, UP, [ev.eventId]);
  }

  // ================================================================== operator
  operatorOverview(staff: StaffRef | null): OperatorOverview {
    this.requireStaff(staff, ['operator']);
    const s = this.state;
    const labels: Record<NodeId, string> = {
      village: 'Ondera village node (simulated)',
      'relay-ridge': 'Ridge relay (simulated)',
      'relay-valley': 'Valley relay (simulated)',
      gateway: 'District gateway (simulated)',
      clinic: 'Clinic station (simulated)',
    };
    const reach = (i: number): boolean => {
      if (i === 3) return true;
      if (i === 4) return s.links[3] === true;
      for (let l = i; l < 3; l++) if (!s.links[l]) return false;
      return i === 0 ? this.nodeUp : true;
    };
    const reqFlows = s.flows.filter((f) => f.kind === 'request');
    const queued = reqFlows.filter((f) => !f.done && !f.hops[0]!.delivered);
    const inFlight = reqFlows.filter(
      (f) => f.hops[0]!.delivered && !f.failed && !s.messages.get(f.messageId)!.clinicHasCopy,
    );
    const oldest = queued.length
      ? s.tick - Math.min(...queued.map((f) => s.messages.get(f.messageId)!.acceptedTick))
      : null;
    return {
      simulated: true,
      nowTick: s.tick,
      nowIso: tickToIso(s.tick),
      nodes: NODE_PATH.map((id, i) => ({
        id,
        label: labels[id],
        reachable: reach(i),
        lastContactTick: s.lastContact[id] ?? null,
        battery: s.battery[id] ?? null,
      })),
      links: [0, 1, 2, 3].map((index) => ({
        index,
        from: NODE_PATH[index]!,
        to: NODE_PATH[index + 1]!,
        up: s.links[index]!,
      })),
      queue: {
        queuedAtVillage: queued.length,
        inFlight: inFlight.length,
        deliveredToClinic: [...s.messages.values()].filter((m) => m.clinicHasCopy).length,
        expired: [...s.events.values()].filter((e) => e.stage === 'expired').length,
        interventionRequired: reqFlows.filter(
          (f) =>
            f.failed &&
            !s.messages.get(f.messageId)!.clinicHasCopy &&
            f.hops.some((h) => h.gaveUp && !h.delivered),
        ).length,
        oldestQueuedAgeTicks: oldest,
      },
      gateway: {
        status: s.links[3] ? 'up' : 'down',
        lastContactTick: s.lastContact.gateway ?? null,
      },
      retry: { maxRetries: s.config.maxRetries, backoffTicks: s.config.backoff },
      storage: this.storage(),
      // Custody events only: ids, stage, source, clock quality. No names, no message text.
      events: s.eventOrder.slice(-300).map((id) => s.events.get(id)!),
      measured: {
        hopsCompleted: s.flows.reduce((n, f) => n + f.hops.filter((h) => h.delivered).length, 0),
        custodyEvents: s.eventOrder.length,
      },
    };
  }
}
