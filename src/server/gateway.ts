import type { GatewayStatus } from '@shared/types';
import type { State } from './state';

/**
 * Gateway module. The gateway sits between the radio side (valley relay <-> gateway) and the
 * upstream side (gateway <-> clinic). It keeps its OWN records:
 *
 *  - inbox:  requests received from the radio side and persisted, forwarded to the clinic only
 *            when the upstream link is available;
 *  - outbox: approved replies received from the clinic and persisted, sent over the radio side
 *            only when the radio link is available.
 *
 * Radio and upstream outages are independent: an upstream outage holds requests in the inbox
 * while replies already in the outbox still flow, and a radio outage holds replies in the outbox
 * while the inbox keeps forwarding.
 *
 * SIMULATED: the gateway's records live in the same journal-derived state as the rest of the
 * prototype. A separate gateway process with its own disk is NOT implemented. Records hold ids and
 * ticks only - never names or message text.
 */

export const RADIO_LINK = 2;
export const UPSTREAM_LINK = 3;

export function gatewayInbound(s: State, messageId: string): void {
  if (s.gateway.inbox.has(messageId)) return; // duplicate delivery from the radio side: one record
  s.gateway.inbox.set(messageId, { messageId, receivedTick: s.tick, forwardedTick: null });
}

export function gatewayForwarded(s: State, messageId: string): void {
  const rec = s.gateway.inbox.get(messageId);
  if (rec && rec.forwardedTick === null) rec.forwardedTick = s.tick;
}

export function gatewayOutboundEnqueued(s: State, replyId: string, messageId: string): void {
  if (s.gateway.outbox.has(replyId)) return;
  s.gateway.outbox.set(replyId, {
    replyId,
    messageId,
    enqueuedTick: s.tick,
    sentTick: null,
    deliveredTick: null,
  });
}

export function gatewayOutboundSent(s: State, replyId: string): void {
  const rec = s.gateway.outbox.get(replyId);
  if (rec && rec.sentTick === null) rec.sentTick = s.tick;
}

export function gatewayOutboundDelivered(s: State, replyId: string): void {
  const rec = s.gateway.outbox.get(replyId);
  if (rec && rec.deliveredTick === null) rec.deliveredTick = s.tick;
}

export function gatewayStatus(s: State): GatewayStatus {
  const radioUp = s.links[RADIO_LINK] === true;
  const upstreamUp = s.links[UPSTREAM_LINK] === true;
  const inbox = [...s.gateway.inbox.values()];
  const outbox = [...s.gateway.outbox.values()];
  const held = inbox.filter((r) => r.forwardedTick === null);
  const waiting = outbox.filter((r) => r.sentTick === null);
  return {
    simulated: true,
    nowTick: s.tick,
    radio: { up: radioUp, label: 'Valley relay to gateway (radio side, simulated)' },
    upstream: { up: upstreamUp, label: 'Gateway to clinic (upstream, simulated)' },
    inbox: {
      held: held.length,
      forwarded: inbox.length - held.length,
      oldestHeldAgeTicks: held.length
        ? s.tick - Math.min(...held.map((r) => r.receivedTick))
        : null,
      items: inbox.map((r) => ({
        messageIdShort: r.messageId.slice(0, 8),
        state:
          r.forwardedTick !== null
            ? ('forwarded' as const)
            : upstreamUp
              ? ('forwarding' as const)
              : ('held_upstream_unavailable' as const),
        receivedAtTick: r.receivedTick,
        forwardedAtTick: r.forwardedTick,
      })),
    },
    outbox: {
      waitingForRadio: waiting.length,
      sentToRelay: outbox.filter((r) => r.sentTick !== null && r.deliveredTick === null).length,
      delivered: outbox.filter((r) => r.deliveredTick !== null).length,
      oldestWaitingAgeTicks: waiting.length
        ? s.tick - Math.min(...waiting.map((r) => r.enqueuedTick))
        : null,
      items: outbox.map((r) => ({
        replyIdShort: r.replyId,
        state:
          r.deliveredTick !== null
            ? ('delivered_to_village' as const)
            : r.sentTick !== null
              ? ('sent_to_relay' as const)
              : radioUp
                ? ('sending' as const)
                : ('waiting_radio_unavailable' as const),
        enqueuedAtTick: r.enqueuedTick,
      })),
    },
    persistence:
      'Gateway inbox/outbox are journal-derived state in this prototype. A separate gateway process with its own disk is not implemented.',
  };
}
