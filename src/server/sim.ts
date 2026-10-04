import { fnv1a } from '@shared/ids';
import { NODE_PATH, type EventStage, type TransportEvent } from '@shared/types';
import type { Engine } from './engine';
import type { Flow, FlowKind, MessageRec } from './state';

/**
 * Deterministic relay simulator. Time is virtual (1 tick = 1 simulated minute) and advances only
 * through journaled `advance` commands, so the whole simulation is a pure function of the
 * journal. Loss is scripted (Fault list) or derived from a hash of (seed, flow, hop, attempt).
 * Nothing here is RF: it models custody transfer, per-hop acknowledgement, bounded retry with
 * backoff, link outages and node power loss.
 */

export function newFlow(
  e: Engine,
  kind: FlowKind,
  msg: Pick<MessageRec, 'messageId' | 'caseId'>,
  path: number[],
  carries: string[],
  replyId: string | null = null,
): Flow {
  const s = e.state;
  s.counters.flow += 1;
  const flow: Flow = {
    id: `flow-${s.counters.flow}`,
    kind,
    messageId: msg.messageId,
    caseId: msg.caseId,
    path,
    carries,
    replyId,
    hops: path.slice(1).map(() => ({
      delivered: false,
      acked: false,
      attempts: 0,
      next: s.tick,
      gaveUp: false,
      waitingSince: null,
    })),
    createdTick: s.tick,
    done: false,
    failed: false,
  };
  s.flows.push(flow);
  return flow;
}

export const UP = [0, 1, 2, 3, 4];
export const DOWN = [4, 3, 2, 1, 0];

function decide(
  e: Engine,
  flow: Flow,
  hop: number,
  attempt: number,
): 'ok' | 'lose_data' | 'lose_ack' {
  const cfg = e.state.config;
  for (const f of cfg.faults) {
    if (f.flowKind !== 'any' && f.flowKind !== flow.kind) continue;
    if (f.hop !== hop || f.attempt !== attempt) continue;
    if (f.messageId && f.messageId !== flow.messageId) continue;
    if (f.carriesStage && !flowCarries(e, flow, f.carriesStage)) continue;
    return f.fault;
  }
  if (cfg.lossPct > 0) {
    const h = fnv1a(`${cfg.seed}|${flow.id}|${hop}|${attempt}`) % 100;
    if (h < cfg.lossPct) return 'lose_data';
  }
  return 'ok';
}

function flowCarries(e: Engine, flow: Flow, stage: EventStage): boolean {
  return flow.carries.some((id) => e.state.events.get(id)?.stage === stage);
}

function backoff(e: Engine, attempts: number): number {
  const b = e.state.config.backoff;
  return b[Math.min(attempts - 1, b.length - 1)] ?? 1;
}

/** Advance simulated time by one tick. */
export function stepTick(e: Engine): void {
  const s = e.state;
  s.tick += 1;

  if (s.nodeDownUntil === s.tick && s.nodeDownUntil > 0) {
    const waiting = s.flows.filter((f) => f.kind === 'request' && !f.done && !f.hops[0]?.delivered);
    s.nodeLog.push({ tick: s.tick, kind: 'power_restored', recoveredQueueItems: waiting.length });
  }

  // Expiry: a request not yet at the clinic past its TTL stops and needs explicit resubmission.
  for (const f of s.flows) {
    if (f.kind !== 'request' || f.done || f.failed) continue;
    const m = s.messages.get(f.messageId);
    if (!m || m.clinicHasCopy || s.tick < m.expiresTick) continue;
    f.failed = true;
    f.done = true;
    e.emit(m.messageId, 'expired', 'village', { knownAtNode: true });
  }

  const n = s.flows.length;
  for (let i = 0; i < n; i++) {
    const f = s.flows[i];
    if (f && !f.done) processFlow(e, f);
  }
}

function processFlow(e: Engine, flow: Flow): void {
  const s = e.state;
  for (let j = 0; j < flow.hops.length; j++) {
    const hop = flow.hops[j]!;
    const holder = j === 0 || flow.hops[j - 1]!.delivered;
    if (!holder || hop.acked || hop.gaveUp || flow.failed) continue;
    if (s.tick < hop.next) continue;
    const a = flow.path[j]!;
    const b = flow.path[j + 1]!;
    const link = Math.min(a, b);
    const nodeDown = (a === 0 || b === 0) && s.tick < s.nodeDownUntil;
    if (!s.links[link] || nodeDown) {
      // Waiting for the link / power: no transmission attempt, so no retry budget is burned.
      if (hop.waitingSince === null) hop.waitingSince = s.tick;
      hop.next = s.tick + 1;
      continue;
    }
    hop.waitingSince = null;
    hop.attempts += 1;
    const outcome = decide(e, flow, j, hop.attempts);
    const exhausted = hop.attempts >= s.config.maxRetries;
    if (outcome === 'lose_data') {
      if (exhausted) giveUp(e, flow, j);
      else hop.next = s.tick + backoff(e, hop.attempts);
      continue;
    }
    if (!hop.delivered) {
      hop.delivered = true;
      const nextHop = flow.hops[j + 1];
      if (nextHop) nextHop.next = Math.max(nextHop.next, s.tick + (s.config.hopLatency[link] ?? 1));
      onDelivered(e, flow, j);
    } else if (flow.kind === 'request') {
      e.emit(flow.messageId, 'duplicate_suppressed', NODE_PATH[b]!, {
        detail: { hop: [NODE_PATH[a]!, NODE_PATH[b]!], attempts: hop.attempts },
      });
    }
    if (outcome === 'lose_ack') {
      if (exhausted) hop.gaveUp = true;
      else hop.next = s.tick + backoff(e, hop.attempts);
    } else {
      hop.acked = true;
      onAcked(e, flow, j);
    }
  }
  const last = flow.hops[flow.hops.length - 1]!;
  if (flow.hops.every((h) => h.acked || h.gaveUp) || (flow.failed && !last.delivered))
    flow.done = true;
}

function giveUp(e: Engine, flow: Flow, j: number): void {
  const hop = flow.hops[j]!;
  hop.gaveUp = true;
  if (hop.delivered) return; // receiver already holds it; only the acknowledgement was lost
  flow.failed = true;
  const a = NODE_PATH[flow.path[j]!]!;
  const b = NODE_PATH[flow.path[j + 1]!]!;
  const msg = e.state.messages.get(flow.messageId);
  if (!msg) return;
  e.emit(flow.messageId, 'intervention_required', a, {
    detail: { hop: [a, b], attempts: hop.attempts, note: `${flow.kind} flow` },
    knownAtNode: flow.kind === 'request' && flow.path[j] === 0,
    knownAtClinic: flow.kind === 'reply',
  });
}

function onDelivered(e: Engine, flow: Flow, j: number): void {
  const s = e.state;
  const bIdx = flow.path[j + 1]!;
  const aIdx = flow.path[j]!;
  const node = NODE_PATH[bIdx]!;
  const last = j === flow.hops.length - 1;
  const msg = s.messages.get(flow.messageId)!;
  const hopDetail = {
    hop: [NODE_PATH[aIdx]!, node] as [(typeof NODE_PATH)[number], (typeof NODE_PATH)[number]],
  };

  if (flow.kind === 'request') {
    if (bIdx === 1 || bIdx === 2) {
      e.emit(msg.messageId, 'relaying', node, { detail: hopDetail });
    } else if (bIdx === 3) {
      const ev = e.emit(msg.messageId, 'gateway_received', 'gateway', { detail: hopDetail });
      newFlow(e, 'status', msg, [3, 2, 1, 0], [ev.eventId]);
    } else if (bIdx === 4) {
      if (msg.clinicHasCopy) return;
      e.deliverToClinic(msg, hopDetail);
    }
    return;
  }

  if (!last) return;
  if (flow.kind === 'status') {
    for (const id of flow.carries) {
      if (bIdx === 0) e.learnAtNode(id);
      else if (bIdx === 4) e.learnAtClinic(id);
    }
    e.onStatusArrived(flow);
    return;
  }
  // reply flow arrived at the village node
  e.onReplyArrived(flow);
}

function onAcked(e: Engine, flow: Flow, j: number): void {
  if (flow.kind !== 'request' || j !== 0) return;
  // The first relay's acknowledgement is the only downstream fact the village node learns itself.
  const ids = e.state.eventOrder;
  for (let i = ids.length - 1; i >= 0; i--) {
    const ev: TransportEvent | undefined = e.state.events.get(ids[i]!);
    if (
      ev &&
      ev.messageId === flow.messageId &&
      ev.stage === 'relaying' &&
      ev.source === 'relay-ridge'
    ) {
      e.learnAtNode(ev.eventId);
      return;
    }
  }
}
