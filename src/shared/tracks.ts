import type {
  CareState,
  EventStage,
  ExceptionState,
  TransportEvent,
  TransportState,
  Tracks,
} from './types';

/** Monotonic ranks: a late or duplicate lower-ranked event never moves a track backwards. */
const TRANSPORT_RANK: Partial<Record<EventStage, number>> = {
  queued: 1,
  relaying: 2,
  gateway_received: 3,
  clinic_received: 4,
};
const TRANSPORT_BY_RANK: TransportState[] = [
  'queued',
  'queued',
  'relaying',
  'gateway_received',
  'clinic_received',
];

const CARE_RANK: Partial<Record<EventStage, number>> = {
  care_awaiting_review: 1,
  care_in_review: 2,
  reply_approved: 3,
};
const CARE_BY_RANK: CareState[] = [
  'awaiting_review',
  'awaiting_review',
  'in_review',
  'reply_approved',
];

/**
 * Merge incoming events into an existing list. De-duplicates by eventId and keeps a stable
 * order by (simulated time, source, sequence, eventId). Pure: returns a new array.
 */
export function reconcileEvents(
  existing: readonly TransportEvent[],
  incoming: readonly TransportEvent[],
): TransportEvent[] {
  const byId = new Map<string, TransportEvent>();
  for (const e of existing) byId.set(e.eventId, e);
  for (const e of incoming) if (!byId.has(e.eventId)) byId.set(e.eventId, e);
  return [...byId.values()].sort(
    (a, b) =>
      a.at.localeCompare(b.at) ||
      a.source.localeCompare(b.source) ||
      a.sequence - b.sequence ||
      a.eventId.localeCompare(b.eventId),
  );
}

/**
 * Derive the separate state tracks from the events a given side has actually received.
 * `accepted` = the local node's durable queue holds the message (Local track).
 * Staff action is the ONLY way to reach "in_review" (a care_in_review event); the transport
 * layer can never produce it.
 */
export function deriveTracks(events: readonly TransportEvent[], accepted: boolean): Tracks {
  let transportRank = 0;
  let careRank = 0;
  let returnTransport: Tracks['returnTransport'] = null;
  let userAction: Tracks['userAction'] = null;
  const exceptions: Array<{ state: ExceptionState; rankAtStall: number }> = [];

  for (const e of events) {
    const tr = TRANSPORT_RANK[e.stage];
    if (tr !== undefined) transportRank = Math.max(transportRank, tr);
    const cr = CARE_RANK[e.stage];
    if (cr !== undefined) careRank = Math.max(careRank, cr);
    if (e.stage === 'reply_available_local') returnTransport = 'reply_available_local';
    if (e.stage === 'reply_opened') userAction = 'reply_opened';
  }
  for (const e of events) {
    if (e.stage === 'expired' || e.stage === 'withdrawn') {
      exceptions.push({ state: e.stage, rankAtStall: 99 });
    } else if (e.stage === 'intervention_required') {
      // Stalled at the hop that gave up; cleared if later progress is known.
      exceptions.push({ state: 'intervention_required', rankAtStall: hopRank(e) });
    }
  }
  let exception: ExceptionState | null = null;
  for (const x of exceptions) {
    if (x.state === 'intervention_required' && transportRank > x.rankAtStall) continue;
    // expired/withdrawn win over intervention
    if (exception === null || x.state !== 'intervention_required') exception = x.state;
  }
  // A reply that has been approved/delivered means the case moved on; an old stall is moot.
  return {
    local: accepted ? 'accepted' : 'draft',
    transport: transportRank > 0 ? TRANSPORT_BY_RANK[transportRank]! : null,
    care: careRank > 0 ? CARE_BY_RANK[careRank]! : null,
    returnTransport,
    userAction,
    exception,
  };
}

function hopRank(e: TransportEvent): number {
  // detail.hop[0] is the node that gave up. village -> after queued(1); ridge -> 2; valley -> 2; gateway -> 3.
  const from = e.detail?.hop?.[0];
  if (from === 'village') return 1;
  if (from === 'relay-ridge' || from === 'relay-valley') return 2;
  if (from === 'gateway') return 3;
  return 1;
}

export function latestEventTick(ticks: readonly number[]): number | null {
  return ticks.length ? Math.max(...ticks) : null;
}
