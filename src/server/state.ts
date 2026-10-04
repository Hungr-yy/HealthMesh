import type {
  AdminConfig,
  AuditEvent,
  CaseClosure,
  ConsentRecord,
  ClinicMessageView,
  EventStage,
  NodeId,
  ReplyView,
  RequestInput,
  StaffPriority,
  StaffRef,
  TransportEvent,
  TranslationResult,
  DraftSummary,
} from '@shared/types';

export type FlowKind = 'request' | 'status' | 'reply';

export interface Fault {
  /** Which flows the fault applies to. */
  flowKind: FlowKind | 'any';
  /** Index of the hop within the flow's path (0 = first hop of that flow). */
  hop: number;
  /** 1-based attempt number on that hop. */
  attempt: number;
  fault: 'lose_data' | 'lose_ack';
  /** Optional narrowing. */
  messageId?: string;
  /** Only flows carrying an event of this stage (e.g. the gateway acknowledgement). */
  carriesStage?: EventStage;
}

export interface SimConfig {
  maxRetries: number;
  backoff: number[];
  /** Ticks (simulated minutes) a hop takes, indexed by link 0..3. */
  hopLatency: number[];
  ttlTicks: number;
  translationAvailable: boolean;
  storageLimitBytes: number;
  faults: Fault[];
  /** Deterministic pseudo-random data loss on every attempt, percent 0..100. */
  lossPct: number;
  seed: number;
}

export const DEFAULT_CONFIG: SimConfig = {
  maxRetries: 6,
  backoff: [1, 2, 4, 8, 16, 32],
  hopLatency: [2, 5, 5, 3],
  ttlTicks: 72 * 60,
  translationAvailable: true,
  storageLimitBytes: 5 * 1024 * 1024,
  faults: [],
  lossPct: 0,
  seed: 1,
};

export interface HopState {
  delivered: boolean;
  acked: boolean;
  attempts: number;
  next: number;
  gaveUp: boolean;
  /** Tick when the first attempt was waiting on a down link, for operator view. */
  waitingSince: number | null;
}

export interface Flow {
  id: string;
  kind: FlowKind;
  messageId: string;
  caseId: string;
  /** Node indices into NODE_PATH, e.g. [0,1,2,3,4] up or [4,3,2,1,0] down. */
  path: number[];
  /** Events whose knowledge is transferred to the destination when the flow completes. */
  carries: string[];
  replyId: string | null;
  hops: HopState[];
  createdTick: number;
  done: boolean;
  failed: boolean;
}

export interface MessageRec {
  messageId: string;
  caseId: string;
  version: number;
  input: RequestInput;
  encodedBytes: number;
  acceptedTick: number;
  expiresTick: number;
  supersedes: string | null;
  supersededBy: string | null;
  clinicReceivedTick: number | null;
  translation: TranslationResult | null;
  draft: DraftSummary | null;
  withdrawn: boolean;
  /** Final delivery of the request to the clinic (for duplicate suppression). */
  clinicHasCopy: boolean;
}

export interface CaseRec {
  caseId: string;
  ref: string;
  secretHash: string;
  createdTick: number;
  messageIds: string[];
  assignee: StaffRef | null;
  priority: StaffPriority | null;
  readAtTick: number | null;
  replyDraft: {
    text: string;
    templateId: string | null;
    savedBy: StaffRef;
    atTick: number;
  } | null;
  replyIds: string[];
  replyOpenedAssistedBy: string | null;
  closed: CaseClosure | null;
}

export interface ReplyRec extends ReplyView {
  messageId: string;
  deliveredToNodeTick: number | null;
  deliveredToClinicTick: number | null;
  openedTick: number | null;
}

export interface GatewayInboxRec {
  messageId: string;
  receivedTick: number;
  forwardedTick: number | null;
}
export interface GatewayOutboxRec {
  replyId: string;
  messageId: string;
  enqueuedTick: number;
  sentTick: number | null;
  deliveredTick: number | null;
}
export interface CoverageRec {
  staffed: boolean;
  statedAtTick: number | null;
  statedBy: StaffRef | null;
  note: string;
}
export interface HandoverRec {
  handoverId: string;
  atTick: number;
  from: StaffRef;
  toStaffId: string | null;
  toName: string;
  caseId: string;
  caseRef: string;
  note: string;
}

export const DEFAULT_ADMIN: AdminConfig = {
  consentVersion: 'consent-v1',
  serviceHours: 'Mon-Fri 08:00-16:00 (demo setting, synthetic)',
  reviewWindowTicks: 24 * 60,
  retentionDays: 30,
  facility: 'Ondera Health Post (synthetic)',
};

export interface State {
  tick: number;
  config: SimConfig;
  links: boolean[];
  nodeDownUntil: number;
  battery: Partial<Record<NodeId, { percent: number; reportedAtTick: number }>>;
  lastContact: Partial<Record<NodeId, number>>;
  cases: Map<string, CaseRec>;
  refToCase: Map<string, string>;
  messages: Map<string, MessageRec>;
  events: Map<string, TransportEvent>;
  eventOrder: string[];
  /** eventId -> tick it became known on each side. */
  knownAtNode: Map<string, number>;
  knownAtClinic: Map<string, number>;
  nodeFeed: string[];
  clinicFeed: string[];
  seq: Map<string, number>;
  flows: Flow[];
  replies: Map<string, ReplyRec>;
  counters: {
    event: number;
    flow: number;
    case: number;
    reply: number;
    audit: number;
    consent: number;
    handover: number;
  };
  journalBytes: number;
  /** Gateway module state: its own inbox and outbox, independent of the clinic's records. */
  gateway: { inbox: Map<string, GatewayInboxRec>; outbox: Map<string, GatewayOutboxRec> };
  consents: ConsentRecord[];
  audit: AuditEvent[];
  coverage: CoverageRec;
  handovers: HandoverRec[];
  admin: AdminConfig;
  nodeLog: Array<{
    tick: number;
    kind: 'power_cut' | 'power_restored';
    recoveredQueueItems?: number;
    durationTicks?: number;
  }>;
}

export function newState(): State {
  return {
    tick: 0,
    config: { ...DEFAULT_CONFIG, backoff: [...DEFAULT_CONFIG.backoff], faults: [] },
    links: [true, true, true, true],
    nodeDownUntil: 0,
    battery: {},
    lastContact: {},
    cases: new Map(),
    refToCase: new Map(),
    messages: new Map(),
    events: new Map(),
    eventOrder: [],
    knownAtNode: new Map(),
    knownAtClinic: new Map(),
    nodeFeed: [],
    clinicFeed: [],
    seq: new Map(),
    flows: [],
    replies: new Map(),
    counters: { event: 0, flow: 0, case: 0, reply: 0, audit: 0, consent: 0, handover: 0 },
    journalBytes: 0,
    gateway: { inbox: new Map(), outbox: new Map() },
    consents: [],
    audit: [],
    coverage: { staffed: true, statedAtTick: null, statedBy: null, note: '' },
    handovers: [],
    admin: { ...DEFAULT_ADMIN },
    nodeLog: [],
  };
}

export type { ClinicMessageView };
