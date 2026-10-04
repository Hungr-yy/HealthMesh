import { tickToIso } from './time';
import { deriveTracks } from './tracks';
import type {
  CaseView,
  ClockQuality,
  EventStage,
  NodeId,
  ReplyView,
  RequestInput,
  TransportEvent,
} from './types';

/** Synthetic fixtures. "Noor" is fictional. No real person, place or clinic. */
export const NOOR_INPUT: RequestInput = {
  requestType: 'follow_up',
  patientName: 'Noor (synthetic)',
  village: 'Ondera highlands (synthetic)',
  details: 'I need a follow-up appointment next week. My medicine has run out.',
  contact: '',
  language: 'en',
  entryMode: 'typed',
  consent: {
    recipientAcknowledged: true,
    readersAcknowledged: true,
    replyMethod: 'village_device',
  },
};

export const NOOR_INPUT_SW: RequestInput = {
  ...NOOR_INPUT,
  details: 'Nataka miadi ya ufuatiliaji wiki ijayo.',
  language: 'sw',
};

export const NOOR_INPUT_AR: RequestInput = {
  ...NOOR_INPUT,
  details: 'أحتاج إلى موعد متابعة الأسبوع القادم',
  language: 'ar',
};

export const FIXTURE_STAFF = {
  clinician: {
    token: 'demo-token-clinician-amina',
    staffId: 'staff-amina',
    name: 'Dr. Amina (synthetic)',
    role: 'clinician' as const,
    clinic: 'Ondera Health Post (synthetic)',
  },
  coordinator: {
    token: 'demo-token-coordinator-juma',
    staffId: 'staff-juma',
    name: 'Juma, clinic coordinator (synthetic)',
    role: 'coordinator' as const,
    clinic: 'Ondera Health Post (synthetic)',
  },
  chw: {
    token: 'demo-token-chw-grace',
    staffId: 'chw-grace',
    name: 'Grace, community health worker (synthetic)',
    role: 'chw' as const,
    clinic: 'Ondera Health Post (synthetic)',
  },
  operator: {
    token: 'demo-token-operator-ops',
    staffId: 'op-ops',
    name: 'Network operator (synthetic)',
    role: 'operator' as const,
    clinic: 'Ondera Health Post (synthetic)',
  },
};

export type FixtureStage =
  | 'waiting'
  | 'relaying'
  | 'gateway'
  | 'clinic'
  | 'in_review'
  | 'reply'
  | 'opened'
  | 'expired'
  | 'intervention';

export const FIXTURE_STAGES: FixtureStage[] = [
  'waiting',
  'relaying',
  'gateway',
  'clinic',
  'in_review',
  'reply',
  'opened',
];

let seq = 0;
function ev(
  messageId: string,
  stage: EventStage,
  source: NodeId,
  tick: number,
  clock: ClockQuality = 'unsynced',
): TransportEvent {
  seq++;
  return {
    eventId: `fx-${seq}`,
    messageId,
    stage,
    source,
    sequence: seq,
    at: tickToIso(tick),
    clockQuality: clock,
    version: 1,
  };
}

export const FIXTURE_REPLY: Omit<ReplyView, 'caseId' | 'inReplyToMessageId'> = {
  replyId: 'fx-reply-1',
  version: 1,
  text: 'Please come to the clinic on Thursday morning for your follow-up. Bring your health card.',
  textLanguage: 'en',
  patientText:
    'Please come to the clinic on Thursday morning for your follow-up. Bring your health card.',
  patientLanguage: 'en',
  translation: 'not_needed',
  author: { name: 'Dr. Amina (synthetic)', role: 'clinician' },
  clinic: 'Ondera Health Post (synthetic)',
  approvedAt: tickToIso(190),
  approvedAtTick: 190,
  templateId: 'follow-up-thursday',
};

/** Build a CaseView for a fixture stage. Pure and deterministic. */
export function fixtureCase(stage: FixtureStage, input: RequestInput = NOOR_INPUT): CaseView {
  seq = 0;
  const messageId = '11111111-2222-4333-8444-555555555555';
  const events: TransportEvent[] = [ev(messageId, 'queued', 'village', 0)];
  const upto = (s: FixtureStage[]) => s.includes(stage);
  if (upto(['relaying', 'gateway', 'clinic', 'in_review', 'reply', 'opened']))
    events.push(ev(messageId, 'relaying', 'relay-ridge', 12));
  if (upto(['gateway', 'clinic', 'in_review', 'reply', 'opened']))
    events.push(ev(messageId, 'gateway_received', 'gateway', 55, 'synced'));
  if (upto(['clinic', 'in_review', 'reply', 'opened'])) {
    events.push(ev(messageId, 'clinic_received', 'clinic', 70, 'synced'));
    events.push(ev(messageId, 'care_awaiting_review', 'clinic', 70, 'synced'));
  }
  if (upto(['in_review', 'reply', 'opened']))
    events.push(ev(messageId, 'care_in_review', 'clinic', 130, 'synced'));
  if (upto(['reply', 'opened'])) {
    events.push(ev(messageId, 'reply_approved', 'clinic', 190, 'synced'));
    events.push(ev(messageId, 'reply_available_local', 'village', 240));
  }
  if (stage === 'opened') events.push(ev(messageId, 'reply_opened', 'village', 260));
  if (stage === 'expired') events.push(ev(messageId, 'expired', 'village', 4320));
  if (stage === 'intervention')
    events.push({
      ...ev(messageId, 'intervention_required', 'village', 400),
      detail: { hop: ['village', 'relay-ridge'], attempts: 6 },
    });
  const tracks = deriveTracks(events, true);
  const nowTick = stage === 'expired' ? 4330 : stage === 'opened' ? 270 : 300;
  const hasReply = stage === 'reply' || stage === 'opened';
  return {
    caseId: 'fx-case-1',
    ref: 'NR-4K7Q',
    versions: [
      {
        messageId,
        version: 1,
        supersedesMessageId: null,
        supersededBy: null,
        input,
        acceptedAt: tickToIso(0),
        expiresAt: tickToIso(4320),
        encodedBytes: 0,
        tracks,
        events,
        lastUpdateTick: Math.max(
          ...events.map((e) => Math.round((Date.parse(e.at) - Date.parse(tickToIso(0))) / 60000)),
        ),
      },
    ],
    reply: hasReply
      ? { ...FIXTURE_REPLY, caseId: 'fx-case-1', inReplyToMessageId: messageId }
      : null,
    replyOpenedAssistedBy: null,
    nowTick,
    nowIso: tickToIso(nowTick),
  };
}
