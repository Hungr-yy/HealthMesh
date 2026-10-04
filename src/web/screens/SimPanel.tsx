import { useEffect, useRef, useState } from 'react';
import { Button, Icon, useAnnounce } from '../components/ui';
import type { HttpClient } from '../lib/httpClient';
import { usePolled } from '../lib/useAsync';

const LINK_NAMES = [
  'village - ridge relay',
  'ridge - valley relay',
  'valley relay - gateway',
  'gateway - clinic (internet/SMS)',
];

export function SimPanel({ client }: { client: HttpClient }) {
  const [epoch, setEpoch] = useState(0);
  const st = usePolled(() => client.simState(), [client, epoch], 1500);
  const s = st.data;
  const announce = useAnnounce();
  const [auto, setAuto] = useState(false);
  const busy = useRef(false);

  const doAct = async (action: string, body: unknown = {}, msg = '') => {
    await client.simPost(action, body);
    if (msg) announce(msg);
    setEpoch((n) => n + 1);
  };

  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => {
      if (busy.current) return;
      busy.current = true;
      client
        .simPost('advance', { ticks: 1 })
        .then(() => setEpoch((n) => n + 1))
        .finally(() => {
          busy.current = false;
        });
    }, 1000);
    return () => clearInterval(id);
  }, [auto, client]);

  return (
    <div data-testid="sim-root">
      <h1>Simulator controls</h1>
      <div className="notice">
        <Icon name="info" />
        <span>
          SIMULATION ONLY. Time is virtual (1 tick = 1 simulated minute) and moves only when you
          advance it. These controls stand in for weather, power and radio conditions.
        </span>
      </div>
      {s ? (
        <>
          <p data-testid="sim-clock">
            Simulated time: {s.nowIso.slice(0, 16).replace('T', ' ')} UTC (tick {s.nowTick}).
            Village node power: {s.nodeUp ? 'on' : `OFF until tick ${s.nodeDownUntil}`}. Restarts
            from disk this process: {s.restarts}.
          </p>
          <h2>Time</h2>
          <div className="tabs-small" style={{ flexWrap: 'wrap' }}>
            {[1, 10, 60, 240].map((n) => (
              <Button
                key={n}
                variant="secondary"
                inline
                onClick={() => void doAct('advance', { ticks: n }, `Advanced ${n} minutes`)}
                data-testid={`advance-${n}`}
              >
                +{n} min
              </Button>
            ))}
            <Button
              variant="secondary"
              inline
              aria-pressed={auto}
              onClick={() => setAuto((a) => !a)}
              data-testid="auto-run"
            >
              {auto ? 'Stop auto-run' : 'Auto-run 1 min / second'}
            </Button>
          </div>
          <h2>Radio links</h2>
          {s.links.map((up, i) => (
            <label className="check" key={i}>
              <input
                type="checkbox"
                checked={up}
                onChange={(e) => void doAct('link', { index: i, up: e.target.checked })}
                data-testid={`link-${i}`}
              />
              <span>
                {LINK_NAMES[i]}: {up ? 'up' : 'DOWN'}
              </span>
            </label>
          ))}
          <h2>Power and recovery</h2>
          <div className="tabs-small" style={{ flexWrap: 'wrap' }}>
            <Button
              variant="secondary"
              inline
              onClick={() =>
                void doAct('power-cut', { durationTicks: 15 }, 'Power cut. Recovered from disk.')
              }
              data-testid="power-cut"
            >
              Cut village power for 15 min and reboot from disk
            </Button>
            <Button
              variant="secondary"
              inline
              onClick={() => void doAct('restart', {}, 'Restarted from disk')}
              data-testid="restart"
            >
              Restart service from disk
            </Button>
          </div>
          <h2>Other conditions</h2>
          <label className="check">
            <input
              type="checkbox"
              checked={s.config.translationAvailable}
              onChange={(e) => void doAct('config', { translationAvailable: e.target.checked })}
              data-testid="translation-toggle"
            />
            <span>
              Translation service available (
              {s.config.translationAvailable ? 'yes' : 'NO: originals only'})
            </span>
          </label>
          <p className="small muted">
            Packet loss: {s.config.lossPct}% / retry limit {s.config.maxRetries} / message lifetime{' '}
            {s.config.ttlTicks} min / journal {s.journalBytes} bytes.
          </p>
          <div className="tabs-small" style={{ flexWrap: 'wrap' }}>
            <Button
              variant="secondary"
              inline
              onClick={() => void doAct('config', { lossPct: s.config.lossPct ? 0 : 40 })}
              data-testid="loss-toggle"
            >
              {s.config.lossPct ? 'Set loss to 0%' : 'Set loss to 40% (stress)'}
            </Button>
            <Button
              variant="secondary"
              inline
              onClick={() => {
                if (window.confirm('Erase the simulated journal and start over?'))
                  void doAct('reset', {}, 'Demo reset');
              }}
              data-testid="reset"
            >
              Reset demo data
            </Button>
          </div>
          <h2>Active transfers (no content)</h2>
          <ul className="timeline">
            {s.flows.length === 0 ? <li>None</li> : null}
            {s.flows.map((f) => (
              <li key={f.id}>
                {f.kind} {f.path.join(' > ')} (message {f.messageId.slice(0, 8)})
              </li>
            ))}
          </ul>
          <h2>Node power log</h2>
          <ul className="timeline" data-testid="node-log">
            {s.nodeLog.length === 0 ? <li>No power events</li> : null}
            {s.nodeLog.map((l, i) => (
              <li key={i}>
                tick {l.tick}: {l.kind.replace('_', ' ')}
                {l.recoveredQueueItems !== undefined
                  ? `, ${l.recoveredQueueItems} queued item(s) recovered from disk`
                  : ''}
                {l.durationTicks ? ` for ${l.durationTicks} min` : ''}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
