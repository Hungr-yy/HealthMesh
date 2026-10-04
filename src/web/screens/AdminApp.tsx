import { useState } from 'react';
import { ApiError } from '@shared/types';
import { Button, Icon, useAnnounce } from '../components/ui';
import { StaffSignIn } from '../components/StaffAuth';
import type { HttpClient } from '../lib/httpClient';
import { usePolled } from '../lib/useAsync';

/** Deployment administration (synthetic). No patient content is shown here. */
export function AdminApp({ client }: { client: HttpClient }) {
  const [epoch, setEpoch] = useState(0);
  const cfg = usePolled(() => client.adminConfig(), [client, epoch], 0);
  const audit = usePolled(() => client.audit(), [client, epoch]);
  const perms = usePolled(() => client.permissions(), [client], 0);
  const [err, setErr] = useState<ApiError | null>(null);
  const [consent, setConsent] = useState('');
  const [window_, setWindow] = useState('');
  const announce = useAnnounce();

  const save = async () => {
    const patch: Record<string, unknown> = {};
    if (consent.trim()) patch.consentVersion = consent.trim();
    if (window_.trim()) patch.reviewWindowTicks = Number(window_);
    try {
      await client.updateAdminConfig(patch);
      setErr(null);
      setConsent('');
      setWindow('');
      announce('Configuration saved and recorded in the audit trail');
      setEpoch((n) => n + 1);
    } catch (e) {
      setErr(e instanceof ApiError ? e : null);
    }
  };

  return (
    <div data-testid="admin-root">
      <h1>Deployment administration</h1>
      <p className="muted small">
        SIMULATED, synthetic settings. Every change is attributed in the audit trail. Audit events
        hold identifiers only: no names and no message text.
      </p>
      <StaffSignIn client={client} want="admin" onChange={() => setEpoch((n) => n + 1)} />
      {cfg.error || err ? (
        <div className="alert" role="alert" data-testid="admin-error">
          <Icon name="warning" />
          <span>
            {(err ?? cfg.error)!.code === 'unauthorized'
              ? 'Sign in as the deployment administrator to see this.'
              : (err ?? cfg.error)!.message}
          </span>
        </div>
      ) : null}
      {cfg.data ? (
        <>
          <h2>Settings</h2>
          <dl className="facts" data-testid="admin-config">
            <div className="row">
              <dt>Consent wording version</dt>
              <dd>{cfg.data.consentVersion}</dd>
            </div>
            <div className="row">
              <dt>Service hours (stated)</dt>
              <dd>{cfg.data.serviceHours}</dd>
            </div>
            <div className="row">
              <dt>Review window</dt>
              <dd>{cfg.data.reviewWindowTicks} simulated minutes</dd>
            </div>
            <div className="row">
              <dt>Retention setting</dt>
              <dd>{cfg.data.retentionDays} days (recorded only; NOT enforced in this prototype)</dd>
            </div>
          </dl>
          <div className="field">
            <label htmlFor="cfg-consent">New consent wording version</label>
            <input
              id="cfg-consent"
              type="text"
              value={consent}
              onChange={(e) => setConsent(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="cfg-window">Review window (simulated minutes)</label>
            <input
              id="cfg-window"
              type="number"
              value={window_}
              onChange={(e) => setWindow(e.target.value)}
            />
          </div>
          <Button icon="check" onClick={() => void save()} data-testid="admin-save">
            Save settings
          </Button>
        </>
      ) : null}
      {perms.data ? (
        <>
          <h2>Role permissions (enforced in the service)</h2>
          <div className="table-scroll">
            <table className="data" data-testid="permissions-table">
              <caption className="sr-only">Permissions by role</caption>
              <thead>
                <tr>
                  <th scope="col">Permission</th>
                  {Object.keys(perms.data.roles).map((r) => (
                    <th scope="col" key={r}>
                      {r}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {perms.data.permissions.map((p) => (
                  <tr key={p}>
                    <th scope="row">{p}</th>
                    {Object.entries(perms.data!.roles).map(([r, list]) => (
                      <td key={r}>{list.includes(p) ? 'Yes' : '-'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">
            Patients and community health workers on a village device act through a case secret, not
            through these staff roles. Integration accounts are not built.
          </p>
        </>
      ) : null}
      {audit.data ? (
        <>
          <h2>Audit trail (latest first)</h2>
          <div className="table-scroll">
            <table className="data" data-testid="audit-table">
              <caption className="sr-only">Audit events</caption>
              <thead>
                <tr>
                  <th scope="col">Time (sim UTC)</th>
                  <th scope="col">Actor</th>
                  <th scope="col">Action</th>
                  <th scope="col">Case</th>
                </tr>
              </thead>
              <tbody>
                {[...audit.data]
                  .reverse()
                  .slice(0, 25)
                  .map((a) => (
                    <tr key={a.auditId}>
                      <td>{a.at.slice(5, 16).replace('T', ' ')}</td>
                      <td>{a.actor.kind === 'staff' ? a.actor.role : a.actor.kind}</td>
                      <td>{a.action.replace(/_/g, ' ')}</td>
                      <td>{a.caseRef ?? '-'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
