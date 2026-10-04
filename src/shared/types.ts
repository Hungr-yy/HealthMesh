/**
 * Domain models shared by the web UI, the local service and the tests.
 * Everything here is SIMULATED / synthetic. No real patient data, no real radio protocol.
 */

export type LangCode = 'en' | 'sw' | 'ar';
export const LANGS: readonly LangCode[] = ['en', 'sw', 'ar'];

export type RequestType =
  'follow_up' | 'existing_referral' | 'appointment' | 'message_clinic' | 'something_else';
export const REQUEST_TYPES: readonly RequestType[] = [
  'follow_up',
  'existing_referral',
  'appointment',
  'message_clinic',
  'something_else',
];

export type ReplyMethod = 'village_device' | 'health_worker_reads';

export interface Consent {
  recipientAcknowledged: boolean;
  readersAcknowledged: boolean;
  replyMethod: ReplyMethod;
}

/** What a patient or community health worker (CHW) enters. Minimal fields only. */
export interface RequestInput {
  requestType: RequestType;
  /** Free text name as the patient gives it (synthetic in this prototype). May be empty. */
  patientName: string;
  village: string;
  details: string;
  /** Optional contact hint. Empty string = "Not provided". */
  contact: string;
  /** Language the patient wrote/spoke in. */
  language: LangCode;
  entryMode: 'typed' | 'assisted';
  /**
   * True when the text started as speech-to-text. A flag only: the original transcript stays on
   * the device and no audio is ever stored. Recognition can be wrong, so staff see the flag.
   */
  enteredByVoice?: boolean;
  /** Opaque staff id of the CHW when entryMode === 'assisted'. */
  assistedBy?: string;
  consent: Consent;
  /** Edit after submission: creates a linked new version superseding this message. */
  supersedesMessageId?: string;
  /** Follow-up on an existing case (new message, not an edit). */
  relatedCaseId?: string;
  /** The approved clinic question this message answers (clarification workflow). */
  answersReplyId?: string;
}

// ---------------------------------------------------------------- transport model

export type NodeId = 'village' | 'relay-ridge' | 'relay-valley' | 'gateway' | 'clinic';
export const NODE_PATH: readonly NodeId[] = [
  'village',
  'relay-ridge',
  'relay-valley',
  'gateway',
  'clinic',
];

export type ClockQuality = 'unsynced' | 'synced';

export type EventStage =
  | 'queued'
  | 'relaying'
  | 'gateway_received'
  | 'clinic_received'
  | 'care_awaiting_review'
  | 'care_in_review'
  | 'reply_approved'
  | 'reply_available_local'
  | 'reply_opened'
  | 'expired'
  | 'intervention_required'
  | 'withdrawn'
  | 'duplicate_suppressed'
  | 'power_restored';

/**
 * A custody / status event. Contains NO patient identity or content (only ids, stage, source,
 * sequence and clock quality). `sequence` is per (messageId, source).
 */
export interface TransportEvent {
  eventId: string;
  messageId: string;
  stage: EventStage;
  source: NodeId;
  sequence: number;
  /** Simulated time, ISO-8601. */
  at: string;
  clockQuality: ClockQuality;
  version: number;
  detail?: { hop?: [NodeId, NodeId]; attempts?: number; bytes?: number; note?: string };
}

export type TransportState = 'queued' | 'relaying' | 'gateway_received' | 'clinic_received';
export type CareState = 'awaiting_review' | 'in_review' | 'reply_approved';
export type ExceptionState = 'expired' | 'intervention_required' | 'withdrawn';

export interface Tracks {
  /** Local track: is it only a browser draft, or accepted by the local node's durable queue? */
  local: 'draft' | 'accepted';
  transport: TransportState | null;
  care: CareState | null;
  returnTransport: 'reply_available_local' | null;
  userAction: 'reply_opened' | null;
  exception: ExceptionState | null;
}

// ---------------------------------------------------------------- clinical-adjacent content

export type TranslationStatus =
  'not_needed' | 'machine_draft_needs_review' | 'partial_needs_review' | 'unavailable';

export interface TranslationResult {
  status: TranslationStatus;
  /** Translated text (clearly a mock-dictionary draft) or null when unavailable. */
  text: string | null;
  engine: 'mock-dictionary-v1';
}

export type DraftFieldStatus = 'matched' | 'uncertain' | 'not_provided';

export interface DraftField {
  key: 'request' | 'timing' | 'referral' | 'mentions' | 'contact' | 'for_whom' | 'attention';
  label: string;
  value: string | null;
  /** Canonical codes for matched values so the patient UI can localize them (e.g. 'next week'). */
  codes?: string[];
  status: DraftFieldStatus;
  /** Why the rule fired or why it is uncertain. */
  note?: string;
}

export interface DraftSummary {
  /** Always shown with this exact label. */
  label: 'Draft summary - verify against the original';
  engine: 'deterministic-rules-v1 (no AI model)';
  fields: DraftField[];
}

// ---------------------------------------------------------------- views

export interface StaffRef {
  staffId: string;
  name: string;
  role: StaffRole;
  clinic: string;
}
/**
 * Service roles. 'clinician' = clinic reviewer. The patient is not a staff role: a patient (or CHW
 * on a village device) proves access to a case with its case secret. Integration accounts are
 * plan-only (no integration service is built).
 */
export type StaffRole = 'clinician' | 'coordinator' | 'chw' | 'operator' | 'admin';

/** 'clarification' = an APPROVED question from the clinic; the patient's answer is a linked follow-up. */
export type ReplyKind = 'reply' | 'clarification';

/** Administrative closure outcomes. Closing asserts NO health outcome. */
export const CLOSE_OUTCOMES = [
  'appointment_arranged',
  'referral_question_answered',
  'follow_up_needed',
  'withdrawn_by_requester',
  'no_clinic_action_possible',
] as const;
export type CloseOutcome = (typeof CLOSE_OUTCOMES)[number];

export interface ReplyView {
  replyId: string;
  caseId: string;
  inReplyToMessageId: string;
  kind: ReplyKind;
  version: number;
  /** Text exactly as approved by staff. */
  text: string;
  textLanguage: LangCode;
  /** Text to show the patient in their selected language, and how it was produced. */
  patientText: string;
  patientLanguage: LangCode;
  translation: TranslationStatus;
  author: { name: string; role: StaffRole };
  clinic: string;
  approvedAt: string;
  approvedAtTick: number;
  templateId: string | null;
}

export interface MessageVersionView {
  messageId: string;
  version: number;
  supersedesMessageId: string | null;
  supersededBy: string | null;
  input: RequestInput;
  acceptedAt: string;
  expiresAt: string;
  encodedBytes: number;
  tracks: Tracks;
  events: TransportEvent[];
  /** Simulated tick of the most recent update received on this side, or null. */
  lastUpdateTick: number | null;
}

/** What the village device (patient / CHW) can see. Derived only from node-known events. */
export interface CaseView {
  caseId: string;
  ref: string;
  versions: MessageVersionView[];
  reply: ReplyView | null;
  replyOpenedAssistedBy: string | null;
  nowTick: number;
  nowIso: string;
}

export interface InboxItem {
  caseId: string;
  ref: string;
  latestMessageId: string;
  requestType: RequestType;
  language: LangCode;
  villageLabel: string;
  receivedAtTick: number;
  lastNetworkUpdateTick: number;
  unread: boolean;
  assignee: StaffRef | null;
  priority: StaffPriority | null;
  care: CareState | null;
  returnTransport: 'reply_available_local' | null;
  userAction: 'reply_opened' | null;
  exception: ExceptionState | null;
  versionCount: number;
  /** Administrative closure, if any. */
  closed?: CaseClosure | null;
  /** Waiting longer than the review window with no approved reply (not applicable when closed). */
  overdue?: boolean;
}

export interface CaseClosure {
  outcome: CloseOutcome;
  note: string;
  by: StaffRef;
  atTick: number;
  /** Fixed statement: closure is administrative and asserts no health outcome. */
  statement: string;
}

/** Consent as recorded when the request was accepted (no clinical content). */
export interface ConsentRecord {
  consentId: string;
  caseId: string;
  messageId: string;
  /** Version of the consent wording in force at acceptance (admin-managed). */
  version: string;
  atTick: number;
  recipientAcknowledged: boolean;
  readersAcknowledged: boolean;
  replyMethod: ReplyMethod;
  recordedBy: 'patient' | 'health_worker';
}

/** Audit events carry actors, actions and identifiers - never message text or names. */
export interface AuditEvent {
  auditId: string;
  atTick: number;
  at: string;
  actor: { kind: 'staff' | 'village_device' | 'system'; role?: StaffRole; staffId?: string };
  action: string;
  caseRef?: string;
  detail?: Record<string, string | number | boolean | null>;
}

export interface ConversationItem {
  kind: 'patient_message' | 'clinic_reply' | 'clinic_question';
  id: string;
  atTick: number;
  text: string;
  language: LangCode;
  /** Link: which clinic question a patient message answers, or which message a reply answers. */
  linkedTo: string | null;
}

export interface StaffPriority {
  level: 'routine' | 'soon' | 'urgent';
  setBy: StaffRef;
  reason: string;
  atTick: number;
}

export interface ClinicMessageView {
  messageId: string;
  version: number;
  supersedesMessageId: string | null;
  original: RequestInput;
  /** Original is never overwritten; translation is shown separately. */
  translation: TranslationResult;
  draftSummary: DraftSummary;
  tracks: Tracks;
  events: TransportEvent[];
  receivedAtTick: number;
  lastNetworkUpdateTick: number;
}

export interface ClinicCaseView {
  caseId: string;
  ref: string;
  messages: ClinicMessageView[];
  assignee: StaffRef | null;
  priority: StaffPriority | null;
  replies: ReplyView[];
  /** Chronological conversation under this case (patient messages and approved clinic replies). */
  conversation?: ConversationItem[];
  consent?: ConsentRecord[];
  closed?: CaseClosure | null;
  replyDraft: { text: string; templateId: string | null; savedBy: StaffRef; atTick: number } | null;
  nowTick: number;
  nowIso: string;
}

export interface ReplyTemplate {
  id: string;
  title: string;
  text: string;
}

export interface OperatorOverview {
  simulated: true;
  nowTick: number;
  nowIso: string;
  nodes: Array<{
    id: NodeId;
    label: string;
    reachable: boolean;
    lastContactTick: number | null;
    battery: { percent: number; reportedAtTick: number } | null;
  }>;
  links: Array<{ index: number; from: NodeId; to: NodeId; up: boolean }>;
  queue: {
    queuedAtVillage: number;
    inFlight: number;
    deliveredToClinic: number;
    expired: number;
    interventionRequired: number;
    oldestQueuedAgeTicks: number | null;
  };
  gateway: { status: 'up' | 'down'; lastContactTick: number | null };
  retry: { maxRetries: number; backoffTicks: number[] };
  storage: { usedBytes: number; limitBytes: number; nearlyFull: boolean };
  /** Custody events only: no names, no message text. */
  events: TransportEvent[];
  measured: { hopsCompleted: number; custodyEvents: number };
}

export interface NodeStatus {
  simulated: true;
  nowTick: number;
  nowIso: string;
  nodeUp: boolean;
  storage: { usedBytes: number; limitBytes: number; nearlyFull: boolean };
  upstream: 'unknown' | 'link_up' | 'link_down';
  translationAvailable: boolean;
}

export interface SubmitResult {
  caseId: string;
  ref: string;
  messageId: string;
  version: number;
  /** true when this messageId was already accepted (idempotent retry). */
  duplicate: boolean;
}

export interface EventsPage {
  events: TransportEvent[];
  cursor: string;
}

export type ApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'bad_request'
  | 'node_unavailable'
  | 'storage_nearly_full'
  | 'network_error';

export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly status = 0,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ---------------------------------------------------------------- gateway, coverage, node health

/** Gateway module view. Custody metadata only: never names or message text. */
export interface GatewayStatus {
  simulated: true;
  nowTick: number;
  /** Radio side: valley relay <-> gateway link. Independent of the upstream side. */
  radio: { up: boolean; label: string };
  /** Upstream side: gateway <-> clinic (internet in a real deployment; simulated here). */
  upstream: { up: boolean; label: string };
  inbox: {
    /** Received by the gateway and persisted, not yet forwarded to the clinic. */
    held: number;
    forwarded: number;
    oldestHeldAgeTicks: number | null;
    items: Array<{
      messageIdShort: string;
      state: 'held_upstream_unavailable' | 'forwarding' | 'forwarded';
      receivedAtTick: number;
      forwardedAtTick: number | null;
    }>;
  };
  outbox: {
    /** Approved replies persisted at the gateway, waiting for the radio side. */
    waitingForRadio: number;
    sentToRelay: number;
    delivered: number;
    oldestWaitingAgeTicks: number | null;
    items: Array<{
      replyIdShort: string;
      state: 'waiting_radio_unavailable' | 'sending' | 'sent_to_relay' | 'delivered_to_village';
      enqueuedAtTick: number;
    }>;
  };
  persistence: string;
}

export interface CoverageView {
  simulated: true;
  nowTick: number;
  staffed: boolean;
  /** When someone last STATED staffing. A stale statement is not live staffing evidence. */
  statedAtTick: number | null;
  statedBy: StaffRef | null;
  note: string;
  statementAgeTicks: number | null;
  stale: boolean;
  staleAfterTicks: number;
  displayLabel: string;
  serviceHours: string;
  reviewWindowTicks: number;
  open: number;
  closed: number;
  overdueCount: number;
  /** Case list is empty for roles without clinical access (operator). */
  overdue: Array<{
    caseId: string;
    ref: string;
    waitingTicks: number;
    overdueByTicks: number;
    assignee: StaffRef | null;
  }>;
  handovers: Array<{
    handoverId: string;
    atTick: number;
    from: StaffRef;
    toStaffId: string | null;
    toName: string;
    caseRef: string;
    note: string;
  }>;
}

export interface NodeHealth {
  simulated: true;
  nowTick: number;
  nowIso: string;
  availability: { up: boolean; downUntilTick: number | null };
  storage: { usedBytes: number; limitBytes: number; nearlyFull: boolean };
  queue: { waitingToSend: number; oldestAgeTicks: number | null };
  radioAdapter: { name: string; status: 'simulated_link_up' | 'simulated_link_down' };
  lastSync: { tick: number | null; note: string };
  clock: { quality: ClockQuality };
  storageLayout: { sensitiveCases: string; assetCache: string };
}

export interface AdminConfig {
  consentVersion: string;
  serviceHours: string;
  reviewWindowTicks: number;
  retentionDays: number;
  facility: string;
}
