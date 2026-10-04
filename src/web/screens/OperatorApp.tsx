import { formatAge } from '@shared/time';
import type { GatewayStatus } from '@shared/types';
import { Button, Icon } from '../components/ui';
import { StaffSignIn } from '../components/StaffAuth';
import type { HttpClient } from '../lib/httpClient';
import { usePolled } from '../lib/useAsync';
import { useState } from 'react';

export function OperatorApp({ client }: { client: HttpClient }) {
  const [epoch, setEpoch] = useState(0);
  const ov = usePolled(() => client.overview(), [client, epoch]);
  const o = ov.data;
  const age = (t: number | null) =>
    t === null || !o ? 'No contact yet' : `${formatAge(o.nowTick - t)} ago`;
  return (
    <div data-testid="operator-root">
      <h1>Network operator</h1>
      <p className="muted small">
        SIMULATED network. This view shows custody events and counts only: no patient names or
        message text.
      </p>
      <StaffSignIn client={client} want="operator" onChange={() => setEpoch((n) => n + 1)} />
      {ov.error ? (
        <div className="alert" role="alert">
          <Icon name="warning" />
          <span>
            {ov.error.code === 'unauthorized'
              ? 'Sign in as the network operator to see this.'
              : ov.error.message}
          </span>
        </div>
      ) : null}
      {o ? (
        <>
          <h2>Nodes</h2>
          <div className="table-scroll">
            <table className="data" data-testid="nodes-table">
              <thead>
                <tr>
                  <th scope="col">Node</th>
                  <th scope="col">Reachable</th>
                  <th scope="col">Last contact</th>
                  <th scope="col">Battery</th>
                </tr>
              </thead>
              <tbody>
                {o.nodes.map((n) => (
                  <tr key={n.id}>
                    <th scope="row">{n.label}</th>
                    <td>{n.reachable ? 'Reachable' : 'Not reachable'}</td>
                    <td>{age(n.lastContactTick)}</td>
                    <td>
                      {n.battery
                        ? `${n.battery.percent}% (reported ${age(n.battery.reportedAtTick)})`
                        : 'Not reported'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <GatewayPanel client={client} epoch={epoch} />
          <h2>Links</h2>
          <ul className="timeline" data-testid="links-list">
            {o.links.map((l) => (
              <li key={l.index}>
                {l.from} to {l.to}: {l.up ? 'up' : 'down'}
              </li>
            ))}
          </ul>
          <h2>Queue (counts only)</h2>
          <dl className="facts" data-testid="queue-counts">
            <div className="row">
              <dt>Waiting at village node</dt>
              <dd>{o.queue.queuedAtVillage}</dd>
            </div>
            <div className="row">
              <dt>In relay custody</dt>
              <dd>{o.queue.inFlight}</dd>
            </div>
            <div className="row">
              <dt>Delivered to clinic</dt>
              <dd>{o.queue.deliveredToClinic}</dd>
            </div>
            <div className="row">
              <dt>Expired</dt>
              <dd>{o.queue.expired}</dd>
            </div>
            <div className="row">
              <dt>Needs intervention</dt>
              <dd>{o.queue.interventionRequired}</dd>
            </div>
            <div className="row">
              <dt>Oldest queued</dt>
              <dd>
                {o.queue.oldestQueuedAgeTicks === null
                  ? 'None queued'
                  : formatAge(o.queue.oldestQueuedAgeTicks)}
              </dd>
            </div>
            <div className="row">
              <dt>Gateway</dt>
              <dd>
                {o.gateway.status} (last contact {age(o.gateway.lastContactTick)})
              </dd>
            </div>
            <div className="row">
              <dt>Retry bound</dt>
              <dd>
                {o.retry.maxRetries} attempts per hop, backoff {o.retry.backoffTicks.join(', ')} min
              </dd>
            </div>
            <div className="row">
              <dt>Node storage</dt>
              <dd>
                {o.storage.usedBytes} of {o.storage.limitBytes} bytes
                {o.storage.nearlyFull ? ' (nearly full: new submissions blocked)' : ''}
              </dd>
            </div>
            <div className="row">
              <dt>Measured so far (simulation)</dt>
              <dd>
                {o.measured.hopsCompleted} hop deliveries, {o.measured.custodyEvents} custody events
              </dd>
            </div>
          </dl>
          <h2>Custody events</h2>
          <div className="table-scroll">
            <table className="data" data-testid="events-table">
              <thead>
                <tr>
                  <th scope="col">Time (sim UTC)</th>
                  <th scope="col">Stage</th>
                  <th scope="col">Source</th>
                  <th scope="col">Clock</th>
                  <th scope="col">Message</th>
                </tr>
              </thead>
              <tbody>
                {[...o.events]
                  .reverse()
                  .slice(0, 40)
                  .map((e) => (
                    <tr key={e.eventId}>
                      <td>{e.at.slice(5, 16).replace('T', ' ')}</td>
                      <td>{e.stage.replace(/_/g, ' ')}</td>
                      <td>{e.source}</td>
                      <td>{e.clockQuality}</td>
                      <td>{e.messageId.slice(0, 8)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {o.queue.interventionRequired > 0 ? (
            <Button variant="secondary" onClick={() => setEpoch((n) => n + 1)}>
              Refresh
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function GatewayPanel({ client, epoch }: { client: HttpClient; epoch: number }) {
  const gw = usePolled(() => client.gateway(), [client, epoch]);
  const g: GatewayStatus | null = gw.data;
  if (!g) return null;
  const upDown = (b: boolean) => (b ? 'available' : 'UNAVAILABLE');
  return (
    <section aria-label="Gateway" data-testid="gateway-panel">
      <h2>Gateway (inbox and outbox)</h2>
      <p className="small muted">
        Two independent sides. Radio side: {upDown(g.radio.up)}. Upstream side to the clinic:{' '}
        {upDown(g.upstream.up)}. Ids and counts only: no patient content.
      </p>
      <dl className="facts" data-testid="gateway-counts">
        <div className="row">
          <dt>Inbox: held, waiting for upstream</dt>
          <dd data-testid="gw-held">
            {g.inbox.held}
            {g.inbox.oldestHeldAgeTicks !== null
              ? ` (oldest ${formatAge(g.inbox.oldestHeldAgeTicks)})`
              : ''}
          </dd>
        </div>
        <div className="row">
          <dt>Inbox: forwarded to clinic</dt>
          <dd data-testid="gw-forwarded">{g.inbox.forwarded}</dd>
        </div>
        <div className="row">
          <dt>Outbox: replies waiting for the radio side</dt>
          <dd data-testid="gw-waiting">
            {g.outbox.waitingForRadio}
            {g.outbox.oldestWaitingAgeTicks !== null
              ? ` (oldest ${formatAge(g.outbox.oldestWaitingAgeTicks)})`
              : ''}
          </dd>
        </div>
        <div className="row">
          <dt>Outbox: sent to relay / delivered to village</dt>
          <dd data-testid="gw-sent">
            {g.outbox.sentToRelay} / {g.outbox.delivered}
          </dd>
        </div>
      </dl>
      <p className="small muted">{g.persistence}</p>
    </section>
  );
}
