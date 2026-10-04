import type {
  CaseView,
  ClinicCaseView,
  EventsPage,
  InboxItem,
  OperatorOverview,
  ReplyTemplate,
  ReplyView,
  RequestInput,
  SubmitResult,
  NodeStatus,
} from './types';

/** Credential presented by the village device for a given case. A case reference alone is NOT one. */
export interface CaseCredential {
  /** Random secret generated on the device when the request is composed. */
  secret: string;
}

/**
 * The typed application client. The UI never speaks any radio protocol: it only talks to this
 * interface, which is implemented over HTTP against the local service (and by an in-memory
 * fixture client for static flows / tests).
 */
export interface HealthMessagingClient {
  /** Idempotent on messageId: a retry with the same messageId never creates a second case. */
  submitRequest(
    input: RequestInput,
    messageId: string,
    credential: CaseCredential,
  ): Promise<SubmitResult>;
  getCase(caseId: string, credential: CaseCredential): Promise<CaseView>;
  /** Recover after a lost submission response: query by the stable message id. */
  getCaseByMessageId(messageId: string, credential: CaseCredential): Promise<CaseView>;
  getEvents(
    caseId: string,
    cursor: string | undefined,
    credential: CaseCredential,
  ): Promise<EventsPage>;
  /** Clinician-only. The reply is not sent until this succeeds with an authorized staff token. */
  approveReply(
    caseId: string,
    input: { text: string; templateId: string | null; inReplyToMessageId: string },
  ): Promise<ReplyView>;
  /**
   * Look a case up by its short reference. A reference alone is NOT authentication: without a
   * matching credential this must be rejected (ApiError 'unauthorized').
   */
  lookupByReference(ref: string, credential?: CaseCredential): Promise<CaseView>;
  nodeStatus(): Promise<NodeStatus>;
  markReplyOpened(
    caseId: string,
    credential: CaseCredential,
    assistedReadingBy?: string,
  ): Promise<void>;
  withdraw(caseId: string, credential: CaseCredential): Promise<void>;
}

export interface ClinicClient {
  inbox(sort: 'oldest' | 'priority'): Promise<InboxItem[]>;
  getCase(caseId: string): Promise<ClinicCaseView>;
  claim(caseId: string): Promise<void>;
  startReview(caseId: string): Promise<void>;
  setPriority(caseId: string, level: 'routine' | 'soon' | 'urgent', reason: string): Promise<void>;
  saveReplyDraft(caseId: string, text: string, templateId: string | null): Promise<void>;
  templates(): Promise<ReplyTemplate[]>;
}

export interface OperatorClient {
  overview(): Promise<OperatorOverview>;
}
