import type { CaseCredential, HealthMessagingClient } from '@shared/client';
import {
  ApiError,
  type ApiErrorCode,
  type CaseView,
  type EventsPage,
  type NodeStatus,
  type ReplyView,
  type RequestInput,
  type SubmitResult,
} from '@shared/types';

/** Typed client over the local service. The UI never speaks any radio protocol. */
export class HttpClient implements HealthMessagingClient {
  staffToken: string | undefined;

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
    let json: unknown = undefined;
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
    input: { text: string; templateId: string | null; inReplyToMessageId: string },
  ): Promise<ReplyView> {
    return this.call('POST', `/api/clinic/cases/${encodeURIComponent(caseId)}/reply/approve`, {
      body: input,
      staff: true,
    });
  }
  nodeStatus(): Promise<NodeStatus> {
    return this.call('GET', '/api/node/status');
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
}
