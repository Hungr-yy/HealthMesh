import type { CaseCredential, HealthMessagingClient } from '@shared/client';
import { FIXTURE_STAGES, fixtureCase, type FixtureStage } from '@shared/fixtures';
import {
  ApiError,
  type CaseView,
  type EventsPage,
  type NodeStatus,
  type NodeHealth,
  type ReplyView,
  type RequestInput,
  type SubmitResult,
} from '@shared/types';
import { tickToIso } from '@shared/time';

/**
 * In-memory client for static flows (Phase 1) and UI tests. NOT the local service: nothing
 * here is durable. Stage is advanced by hand to show each visible state.
 */
export class FixtureClient implements HealthMessagingClient {
  stage: FixtureStage = 'waiting';
  private submitted = new Map<string, { input: RequestInput; secret: string }>();
  nodeUp = true;
  storageFull = false;
  loseNextResponse = false;

  advance(): FixtureStage {
    const i = FIXTURE_STAGES.indexOf(this.stage);
    this.stage = FIXTURE_STAGES[Math.min(i + 1, FIXTURE_STAGES.length - 1)] ?? this.stage;
    return this.stage;
  }

  async submitRequest(
    input: RequestInput,
    messageId: string,
    credential: CaseCredential,
  ): Promise<SubmitResult> {
    if (!this.nodeUp) throw new ApiError('node_unavailable', 'Local node unavailable', 503);
    if (this.storageFull) throw new ApiError('storage_nearly_full', 'Storage nearly full', 507);
    const dup = this.submitted.has(messageId);
    if (!dup) this.submitted.set(messageId, { input, secret: credential.secret });
    if (this.loseNextResponse) {
      this.loseNextResponse = false;
      throw new ApiError('network_error', 'Response lost');
    }
    return { caseId: 'fx-case-1', ref: 'NR-4K7Q', messageId, version: 1, duplicate: dup };
  }

  private view(secret: string): CaseView {
    const rec = [...this.submitted.values()].find((s) => s.secret === secret);
    if (!rec) throw new ApiError('unauthorized', 'Not authorized', 401);
    return fixtureCase(this.stage, rec.input);
  }

  async getCase(_caseId: string, c: CaseCredential): Promise<CaseView> {
    return this.view(c.secret);
  }
  async getCaseByMessageId(messageId: string, c: CaseCredential): Promise<CaseView> {
    const rec = this.submitted.get(messageId);
    if (!rec) throw new ApiError('not_found', 'Unknown message', 404);
    if (rec.secret !== c.secret) throw new ApiError('unauthorized', 'Not authorized', 401);
    return fixtureCase(this.stage, rec.input);
  }
  async lookupByReference(_ref: string, c?: CaseCredential): Promise<CaseView> {
    if (!c) throw new ApiError('unauthorized', 'A reference alone is not authentication', 401);
    return this.view(c.secret);
  }
  async getEvents(
    _caseId: string,
    _cursor: string | undefined,
    c: CaseCredential,
  ): Promise<EventsPage> {
    const v = this.view(c.secret);
    return {
      events: v.versions[0]?.events ?? [],
      cursor: String(v.versions[0]?.events.length ?? 0),
    };
  }
  async approveReply(): Promise<ReplyView> {
    throw new ApiError('forbidden', 'Fixture client cannot approve replies', 403);
  }
  async nodeStatus(): Promise<NodeStatus> {
    return {
      simulated: true,
      nowTick: 0,
      nowIso: tickToIso(0),
      nodeUp: this.nodeUp,
      storage: { usedBytes: 0, limitBytes: 1, nearlyFull: this.storageFull },
      upstream: 'unknown',
      translationAvailable: true,
    };
  }
  async nodeHealth(): Promise<NodeHealth> {
    return {
      simulated: true,
      nowTick: 0,
      nowIso: tickToIso(0),
      availability: { up: this.nodeUp, downUntilTick: null },
      storage: { usedBytes: 0, limitBytes: 1, nearlyFull: this.storageFull },
      queue: { waitingToSend: 0, oldestAgeTicks: null },
      radioAdapter: { name: 'fixture (no radio)', status: 'simulated_link_up' },
      lastSync: { tick: null, note: 'Static fixtures: no network.' },
      clock: { quality: 'unsynced' },
      storageLayout: { sensitiveCases: 'in memory (fixtures)', assetCache: 'none' },
    };
  }
  async markReplyOpened(): Promise<void> {
    if (this.stage === 'reply') this.stage = 'opened';
  }
  async withdraw(): Promise<void> {
    /* fixture: no-op */
  }
}
