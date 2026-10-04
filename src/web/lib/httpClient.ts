import type {
  CaseCredential,
  ClinicClient,
  HealthMessagingClient,
  OperatorClient,
  AdminClient,
} from '@shared/client';
import {
  ApiError,
  type ApiErrorCode,
  type CaseView,
  type ClinicCaseView,
  type InboxItem,
  type OperatorOverview,
  type ReplyTemplate,
  type EventsPage,
  type NodeStatus,
  type NodeHealth,
  type AdminConfig,
  type AuditEvent,
  type CloseOutcome,
  type CoverageView,
  type GatewayStatus,
  type ReplyKind,
  type ReplyView,
  type RequestInput,
  type SubmitResult,
} from '@shared/types';

/** Typed client over the local service. The UI never speaks any radio protocol. */
export class HttpClient
  implements HealthMessagingClient, ClinicClient, OperatorClient, AdminClient
{
  private staffToken: string | undefined;

  setStaffToken(token: string | undefined): void {
    this.staffToken = token;
  }

  constructor(
    private readonly baseUrl = '',
    private readonly fetchImpl: typeof fetch = (...a) => fetch(...a),
  ) {}

  protected async call<T>(
    method: 'GET' | 'POST',
    path: string,
    opts: { body?: unknown; secret?: string; staff?: boolean } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (opts.secret) headers.authorization = `Case ${opts.secret}`;
    else if (opts.staff && this.staffToken) headers.authorization = `Bearer ${this.staffToken}`;
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      });
    } catch {
      throw new ApiError('network_error', 'Could not reach the local node');
    }
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      throw new ApiError('network_error', 'Unreadable response from the local node', res.status);
    }
    if (!res.ok) {
      const err = (json as { error?: { code?: ApiErrorCode; message?: string } } | undefined)
        ?.error;
      throw new ApiError(
        err?.code ?? 'network_error',
        err?.message ?? `HTTP ${res.status}`,
        res.status,
      );
    }
    return json as T;
  }

  submitRequest(input: RequestInput, messageId: string, c: CaseCredential): Promise<SubmitResult> {
    return this.call('POST', '/api/node/requests', {
      body: { messageId, input },
      secret: c.secret,
    });
  }
  getCase(caseId: string, c: CaseCredential): Promise<CaseView> {
    return this.call('GET', `/api/node/cases/${encodeURIComponent(caseId)}`, { secret: c.secret });
  }
  getCaseByMessageId(messageId: string, c: CaseCredential): Promise<CaseView> {
    return this.call('GET', `/api/node/cases/by-message/${encodeURIComponent(messageId)}`, {
      secret: c.secret,
    });
  }
  lookupByReference(ref: string, c?: CaseCredential): Promise<CaseView> {
    return this.call('GET', `/api/node/cases/lookup?ref=${encodeURIComponent(ref)}`, {
      ...(c ? { secret: c.secret } : {}),
    });
  }
  getEvents(caseId: string, cursor: string | undefined, c: CaseCredential): Promise<EventsPage> {
    const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return this.call('GET', `/api/node/cases/${encodeURIComponent(caseId)}/events${q}`, {
      secret: c.secret,
    });
  }
  approveReply(
    caseId: string,
    input: {
      text: string;
      templateId: string | null;
      inReplyToMessageId: string;
      kind?: ReplyKind;
    },
  ): Promise<ReplyView> {
    return this.call('POST', `/api/clinic/cases/${encodeURIComponent(caseId)}/reply/approve`, {
      body: input,
      staff: true,
    });
  }
  nodeStatus(): Promise<NodeStatus> {
    return this.call('GET', '/api/node/status');
  }
  nodeHealth(): Promise<NodeHealth> {
    return this.call('GET', '/api/node/health');
  }
  async markReplyOpened(
    caseId: string,
    c: CaseCredential,
    assistedReadingBy?: string,
  ): Promise<void> {
    await this.call('POST', `/api/node/cases/${encodeURIComponent(caseId)}/reply/open`, {
      body: { assistedReadingBy: assistedReadingBy ?? null },
      secret: c.secret,
    });
  }
  async withdraw(caseId: string, c: CaseCredential): Promise<void> {
    await this.call('POST', `/api/node/cases/${encodeURIComponent(caseId)}/withdraw`, {
      body: {},
      secret: c.secret,
    });
  }

  // ---------------------------------------------------------------- clinic (staff token)
  inbox(sort: 'oldest' | 'priority'): Promise<InboxItem[]> {
    return this.call('GET', `/api/clinic/inbox?sort=${sort}`, { staff: true });
  }
  getClinicCase(caseId: string): Promise<ClinicCaseView> {
    return this.call('GET', `/api/clinic/cases/${encodeURIComponent(caseId)}`, { staff: true });
  }
  private clinicPost(caseId: string, action: string, body: unknown = {}): Promise<unknown> {
    return this.call('POST', `/api/clinic/cases/${encodeURIComponent(caseId)}/${action}`, {
      body,
      staff: true,
    });
  }
  async markRead(caseId: string): Promise<void> {
    await this.clinicPost(caseId, 'read');
  }
  async claim(caseId: string): Promise<void> {
    await this.clinicPost(caseId, 'claim');
  }
  async startReview(caseId: string): Promise<void> {
    await this.clinicPost(caseId, 'start-review');
  }
  async setPriority(
    caseId: string,
    level: 'routine' | 'soon' | 'urgent',
    reason: string,
  ): Promise<void> {
    await this.clinicPost(caseId, 'priority', { level, reason });
  }
  async saveReplyDraft(caseId: string, text: string, templateId: string | null): Promise<void> {
    await this.clinicPost(caseId, 'reply-draft', { text, templateId });
  }
  templates(): Promise<ReplyTemplate[]> {
    return this.call('GET', '/api/clinic/templates', { staff: true });
  }
  async closeCase(caseId: string, outcome: CloseOutcome, note: string): Promise<void> {
    await this.clinicPost(caseId, 'close', { outcome, note });
  }
  async handover(caseId: string, toStaffId: string, note: string): Promise<void> {
    await this.clinicPost(caseId, 'handover', { toStaffId, note });
  }
  coverage(): Promise<CoverageView> {
    return this.call('GET', '/api/clinic/coverage', { staff: true });
  }
  setCoverage(staffed: boolean, note: string): Promise<CoverageView> {
    return this.call('POST', '/api/clinic/coverage', { body: { staffed, note }, staff: true });
  }

  // ---------------------------------------------------------------- operator
  overview(): Promise<OperatorOverview> {
    return this.call('GET', '/api/operator/overview', { staff: true });
  }
  async requeue(flowId: string): Promise<void> {
    await this.call('POST', '/api/operator/requeue', { body: { flowId }, staff: true });
  }

  gateway(): Promise<GatewayStatus> {
    return this.call('GET', '/api/gateway/status', { staff: true });
  }
  audit(): Promise<AuditEvent[]> {
    return this.call('GET', '/api/audit', { staff: true });
  }

  // ---------------------------------------------------------------- administration
  adminConfig(): Promise<AdminConfig> {
    return this.call('GET', '/api/admin/config', { staff: true });
  }
  updateAdminConfig(patch: Partial<AdminConfig>): Promise<AdminConfig> {
    return this.call('POST', '/api/admin/config', { body: patch, staff: true });
  }
  permissions(): Promise<{ permissions: string[]; roles: Record<string, string[]> }> {
    return this.call('GET', '/api/permissions');
  }

  // ---------------------------------------------------------------- simulator controls (demo)
  simState(): Promise<SimState> {
    return this.call('GET', '/api/sim/state');
  }
  simPost(action: string, body: unknown = {}): Promise<SimState> {
    return this.call('POST', `/api/sim/${action}`, { body });
  }
  demoTokens(): Promise<Array<{ role: string; name: string; token: string }>> {
    return this.call('GET', '/api/sim/demo-tokens');
  }
}

/** Shape of GET /api/sim/state (simulator control panel; no patient content). */
export interface SimState {
  simulated: true;
  nowTick: number;
  nowIso: string;
  links: boolean[];
  nodeUp: boolean;
  nodeDownUntil: number;
  config: {
    maxRetries: number;
    ttlTicks: number;
    translationAvailable: boolean;
    lossPct: number;
    storageLimitBytes: number;
  };
  restarts: number;
  nodeLog: Array<{
    tick: number;
    kind: string;
    recoveredQueueItems?: number;
    durationTicks?: number;
  }>;
  journalBytes: number;
  flows: Array<{ id: string; kind: string; messageId: string; path: string[] }>;
}
