import { encodedSize } from '@shared/codec';
import { refFromSeed } from '@shared/ids';
import { tickToIso } from '@shared/time';
import { deriveTracks, reconcileEvents } from '@shared/tracks';
import {
  ApiError,
  type ApiErrorCode,
  type CaseView,
  type ClockQuality,
  type EventStage,
  type EventsPage,
  type MessageVersionView,
  type NodeId,
  type NodeStatus,
  type RequestInput,
  type SubmitResult,
  type TransportEvent,
} from '@shared/types';
import { hashSecret, secretMatches } from './auth';
import { Journal } from './journal';
import { newState, type MessageRec, type State } from './state';

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
export type Command = {
  t: 'accept';
  messageId: string;
  secretHash: string;
  caseId: string | null;
  input: RequestInput;
};

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
    switch (cmd.t) {
      case 'accept':
        return this.applyAccept(cmd);
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
  protected emit(
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

  protected learnAtNode(eventId: string): void {
    if (this.state.knownAtNode.has(eventId)) return;
    this.state.knownAtNode.set(eventId, this.state.tick);
    this.state.nodeFeed.push(eventId);
  }

  protected learnAtClinic(eventId: string): void {
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

  /** Hook: the relay simulator starts moving the message here (Phase 3). */
  protected onAccepted(_msg: MessageRec): void {}

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
  protected nodeReply(_caseId: string): CaseView['reply'] {
    return null;
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
}
