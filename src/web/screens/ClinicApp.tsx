import { useMemo, useState } from 'react';
import { formatAge, tickToIso } from '@shared/time';
import { previewReplyTranslation } from '@shared/translate';
import {
  ApiError,
  type ClinicCaseView,
  type ClinicMessageView,
  type InboxItem,
  type ReplyTemplate,
} from '@shared/types';
import { Button, Icon, useAnnounce } from '../components/ui';
import { StaffSignIn } from '../components/StaffAuth';
import type { HttpClient } from '../lib/httpClient';
import { usePolled } from '../lib/useAsync';

type Pane = 'list' | 'case' | 'reply';

const CARE_LABEL: Record<string, string> = {
  awaiting_review: 'Awaiting review',
  in_review: 'In review',
  reply_approved: 'Reply approved',
};

function ErrorNote({ error }: { error: ApiError | null }) {
  if (!error) return null;
  return (
    <div className="alert" role="alert" data-testid="clinic-error">
      <Icon name="warning" />
      <span>
        {error.code === 'unauthorized'
          ? 'Sign in with a clinic staff identity to see this.'
          : error.code === 'forbidden'
            ? `Not permitted: ${error.message}`
            : error.message}
      </span>
    </div>
  );
}

export function ClinicApp({ client }: { client: HttpClient }) {
  const [sort, setSort] = useState<'oldest' | 'priority'>('oldest');
  const [selected, setSelected] = useState<string | null>(null);
  const [pane, setPane] = useState<Pane>('list');
  const [epoch, setEpoch] = useState(0);

  const inbox = usePolled(() => client.inbox(sort), [client, sort, epoch]);
  const templates = usePolled(() => client.templates(), [client, epoch], 0);

  return (
    <div data-testid="clinic-root">
      <h1>Clinic inbox</h1>
      <p className="muted small">
        Staff view of SIMULATED requests. A human reviews every request and approves every reply.
        Nothing here diagnoses, prescribes or sets priority automatically.
      </p>
      <StaffSignIn client={client} want="clinician" onChange={() => setEpoch((n) => n + 1)} />
      <ErrorNote error={inbox.error} />
      <div className="clinic-layout">
        <section
          aria-label="Inbox"
          className={`pane${pane === 'list' ? ' active' : ''}`}
          data-pane="list"
        >
          <div className="tabs-small" role="group" aria-label="Sort order">
            <Button
              variant={sort === 'oldest' ? 'primary' : 'secondary'}
              inline
              onClick={() => setSort('oldest')}
              aria-pressed={sort === 'oldest'}
            >
              Oldest waiting
            </Button>
            <Button
              variant={sort === 'priority' ? 'primary' : 'secondary'}
              inline
              onClick={() => setSort('priority')}
              aria-pressed={sort === 'priority'}
            >
              Staff priority
            </Button>
          </div>
          {inbox.data && inbox.data.length === 0 ? (
            <p data-testid="inbox-empty">No requests have reached the clinic yet.</p>
          ) : null}
          {inbox.data?.map((i) => (
            <InboxRow
              key={i.caseId}
              item={i}
              nowTick={null}
              selected={selected === i.caseId}
              onSelect={() => {
                setSelected(i.caseId);
                setPane('case');
                void client.markRead(i.caseId).catch(() => undefined);
              }}
            />
          ))}
        </section>
        {selected ? (
          <>
            <section
              aria-label="Case"
              className={`pane${pane === 'case' ? ' active' : ''}`}
              data-pane="case"
            >
              <div className="back-row">
                <Button variant="secondary" icon="back" inline onClick={() => setPane('list')}>
                  Back to inbox
                </Button>
              </div>
              <CasePane
                client={client}
                caseId={selected}
                epoch={epoch}
                onChanged={() => setEpoch((n) => n + 1)}
                onReply={() => setPane('reply')}
              />
            </section>
            <section
              aria-label="Reply"
              className={`pane${pane === 'reply' ? ' active' : ''}`}
              data-pane="reply"
            >
              <div className="back-row">
                <Button variant="secondary" icon="back" inline onClick={() => setPane('case')}>
                  Back to case
                </Button>
              </div>
              <ReplyPane
                client={client}
                caseId={selected}
                templates={templates.data ?? []}
                epoch={epoch}
                onChanged={() => setEpoch((n) => n + 1)}
              />
            </section>
          </>
        ) : (
          <section className="pane desktop-only" aria-label="No case selected">
            <p className="muted">Select a request from the inbox.</p>
          </section>
        )}
      </div>
    </div>
  );
}

function InboxRow({
  item,
  selected,
  onSelect,
}: {
  item: InboxItem;
  nowTick: number | null;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className="inbox-item"
      aria-current={selected}
      onClick={onSelect}
      data-testid={`inbox-${item.ref}`}
    >
      <strong>{item.ref}</strong>{' '}
      <span className="muted">{item.requestType.replace(/_/g, ' ')}</span>
      <div>
        {item.unread ? <span className="badge strong">Unread</span> : null}
        {item.priority ? (
          <span className="badge">
            <Icon name="flag" /> Staff priority: {item.priority.level}
          </span>
        ) : null}
        {item.assignee ? (
          <span className="badge">{item.assignee.name}</span>
        ) : (
          <span className="badge">Unassigned</span>
        )}
        <span className="badge">{CARE_LABEL[item.care ?? 'awaiting_review']}</span>
        {item.exception ? <span className="badge">{item.exception.replace(/_/g, ' ')}</span> : null}
      </div>
      <div className="small muted">
        {item.villageLabel} / language {item.language} / {item.versionCount} version(s)
      </div>
    </button>
  );
}

function Ages({ view, m }: { view: ClinicCaseView; m: ClinicMessageView }) {
  return (
    <p className="small muted" data-testid="ages">
      Age of request: {formatAge(view.nowTick - m.receivedAtTick)} (since the clinic received it;
      simulated time).
      <br />
      Last network update: {formatAge(view.nowTick - m.lastNetworkUpdateTick)} ago.
      <br />
      Original timestamps come from the village node&apos;s clock, which is{' '}
      {m.events[0]?.clockQuality ?? 'unsynced'}: treat as approximate.
    </p>
  );
}

function CasePane({
  client,
  caseId,
  epoch,
  onChanged,
  onReply,
}: {
  client: HttpClient;
  caseId: string;
  epoch: number;
  onChanged: () => void;
  onReply: () => void;
}) {
  const view = usePolled(() => client.getClinicCase(caseId), [client, caseId, epoch]);
  const [reason, setReason] = useState('');
  const [level, setLevel] = useState<'routine' | 'soon' | 'urgent'>('soon');
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const announce = useAnnounce();
  const v = view.data;
  const act = async (fn: () => Promise<void>, msg: string) => {
    try {
      await fn();
      setActionError(null);
      announce(msg);
      onChanged();
    } catch (e) {
      setActionError(e instanceof ApiError ? e : null);
    }
  };
  if (!v) return <ErrorNote error={view.error} />;
  const latest = v.messages[v.messages.length - 1];
  return (
    <div data-testid="case-pane">
      <h2>
        {v.ref}
        <span className="muted small"> (SIMULATED synthetic request)</span>
      </h2>
      <div>
        {v.assignee ? (
          <span className="badge">Assigned: {v.assignee.name}</span>
        ) : (
          <span className="badge">Unassigned</span>
        )}
        {v.priority ? (
          <span className="badge" data-testid="priority-provenance">
            Staff priority: {v.priority.level} - set by {v.priority.setBy.name} (
            {v.priority.setBy.role}) at {tickToIso(v.priority.atTick).slice(11, 16)} UTC: &quot;
            {v.priority.reason}&quot;
          </span>
        ) : (
          <span className="badge">No staff priority set</span>
        )}
      </div>
      {latest ? <Ages view={v} m={latest} /> : null}
      <ErrorNote error={actionError} />
      <div className="tabs-small">
        <Button
          variant="secondary"
          inline
          onClick={() => void act(() => client.claim(caseId), 'Claimed')}
          data-testid="claim"
        >
          Claim / assign to me
        </Button>
        <Button
          variant="secondary"
          inline
          onClick={() => void act(() => client.startReview(caseId), 'Review started')}
          data-testid="start-review"
        >
          Start review
        </Button>
      </div>
      <fieldset
        style={{ border: '1px solid var(--border-soft)', borderRadius: 8, marginBottom: '1rem' }}
      >
        <legend>Set staff priority (human decision, recorded with your name)</legend>
        <div className="field">
          <label htmlFor="prio-level">Level</label>
          <select
            id="prio-level"
            value={level}
            onChange={(e) => setLevel(e.target.value as typeof level)}
          >
            <option value="routine">routine</option>
            <option value="soon">soon</option>
            <option value="urgent">urgent</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="prio-reason">Reason (required unless routine)</label>
          <input
            id="prio-reason"
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <Button
          variant="secondary"
          inline
          onClick={() =>
            void act(() => client.setPriority(caseId, level, reason), 'Priority recorded')
          }
          data-testid="set-priority"
        >
          Record priority
        </Button>
      </fieldset>
      {v.messages.map((m) => (
        <MessageBlock key={m.messageId} m={m} />
      ))}
      <Button variant="secondary" icon="mail" onClick={onReply} data-testid="go-reply">
        Write reply
      </Button>
    </div>
  );
}

function MessageBlock({ m }: { m: ClinicMessageView }) {
  const dir = m.original.language === 'ar' ? 'rtl' : 'ltr';
  return (
    <article className="card" data-testid={`message-v${m.version}`}>
      <h3>
        Version {m.version}
        {m.supersedesMessageId ? ' (supersedes an earlier version; earlier version kept)' : ''}
      </h3>
      <h4>Original (never overwritten)</h4>
      <blockquote
        className="original"
        lang={m.original.language}
        dir={dir}
        data-testid="clinic-original"
      >
        {m.original.details}
      </blockquote>
      <p className="small muted">
        Written in {m.original.language}, entered{' '}
        {m.original.entryMode === 'assisted' ? 'with a health worker' : 'by typing'}
        {m.original.enteredByVoice
          ? ' (started as speech-to-text; may contain recognition errors)'
          : ''}
        . Name: {m.original.patientName || 'Not provided'}. Village:{' '}
        {m.original.village || 'Not provided'}.
      </p>
      {m.translation.status === 'not_needed' ? null : (
        <div className="notice" data-testid="clinic-translation">
          <Icon name="flag" />
          <span>
            {m.translation.status === 'unavailable' ? (
              <>
                <strong>Translation unavailable.</strong> Read the original above; it has not been
                altered.
              </>
            ) : (
              <>
                <strong>Mock-dictionary translation, needs review:</strong> {m.translation.text}
              </>
            )}
          </span>
        </div>
      )}
      <h4>{m.draftSummary.label}</h4>
      <p className="small muted">{m.draftSummary.engine}</p>
      <dl className="facts" data-testid="draft-summary">
        {m.draftSummary.fields.map((f, i) => (
          <div
            key={i}
            className={`row${f.status === 'uncertain' ? ' uncertain' : ''}`}
            data-status={f.status}
          >
            <dt>{f.label}</dt>
            <dd>
              {f.value === null ? <span className="not-provided">Not provided</span> : f.value}
              {f.status === 'uncertain' ? (
                <div className="flag">
                  <Icon name="flag" /> Verify against the original
                  {f.note ? <span className="small muted">: {f.note}</span> : null}
                </div>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
      <h4>Network and care status (as known to the clinic)</h4>
      <ul className="timeline" data-testid="clinic-events">
        {m.events.map((e) => (
          <li key={e.eventId}>
            {e.stage.replace(/_/g, ' ')} - {e.source} - {e.at.slice(11, 16)} UTC ({e.clockQuality}{' '}
            clock)
          </li>
        ))}
      </ul>
      <p className="small" data-testid="return-tracking">
        Reply approved: {m.tracks.care === 'reply_approved' ? 'yes' : 'no'}. Reply arrived on
        village device:{' '}
        {m.tracks.returnTransport ? 'confirmed by return acknowledgement' : 'not confirmed'}.
        Patient opened reply: {m.tracks.userAction ? 'confirmed' : 'not confirmed'}.
      </p>
    </article>
  );
}

function ReplyPane({
  client,
  caseId,
  templates,
  epoch,
  onChanged,
}: {
  client: HttpClient;
  caseId: string;
  templates: ReplyTemplate[];
  epoch: number;
  onChanged: () => void;
}) {
  const view = usePolled(() => client.getClinicCase(caseId), [client, caseId, epoch]);
  if (!view.data) return <ErrorNote error={view.error} />;
  // Keyed so the editor state is initialised from the saved draft once per case.
  return (
    <ReplyEditor
      key={caseId}
      client={client}
      caseId={caseId}
      templates={templates}
      v={view.data}
      onChanged={onChanged}
    />
  );
}

function ReplyEditor({
  client,
  caseId,
  templates,
  v,
  onChanged,
}: {
  client: HttpClient;
  caseId: string;
  templates: ReplyTemplate[];
  v: ClinicCaseView;
  onChanged: () => void;
}) {
  const status = usePolled(() => client.nodeStatus(), [client], 0);
  const [text, setText] = useState(v.replyDraft?.text ?? '');
  const [templateId, setTemplateId] = useState<string | null>(v.replyDraft?.templateId ?? null);
  const [confirmed, setConfirmed] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);

  const latest = v?.messages[v.messages.length - 1];
  const lang = latest?.original.language ?? 'en';
  const preview = useMemo(
    () =>
      previewReplyTranslation(text, lang, { available: status.data?.translationAvailable ?? true }),
    [text, lang, status.data],
  );
  if (!latest) return null;
  const inReview = latest.tracks.care === 'in_review' || latest.tracks.care === 'reply_approved';
  const approved = v.replies[v.replies.length - 1];

  return (
    <div data-testid="reply-pane">
      <h2>Reply</h2>
      <p className="small muted">
        A reply is only sent after a clinician explicitly approves it below. Saving a draft sends
        nothing.
      </p>
      <ErrorNote error={err} />
      <div className="field">
        <label htmlFor="tpl">Template (optional)</label>
        <select
          id="tpl"
          value={templateId ?? ''}
          onChange={(e) => {
            const t = templates.find((x) => x.id === e.target.value);
            setTemplateId(t?.id ?? null);
            if (t) setText(t.text);
          }}
        >
          <option value="">Free text</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="reply-text">Reply text (English)</label>
        <textarea id="reply-text" value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      {lang !== 'en' ? (
        <div className="notice" data-testid="reply-preview">
          <Icon name="flag" />
          <span>
            Patient reads {lang}.{' '}
            {preview.status === 'machine_draft_needs_review' ? (
              <>
                Mock-dictionary draft shown to the patient (needs review):{' '}
                <span lang={lang} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
                  {preview.text}
                </span>
              </>
            ) : (
              <>
                No translation available: the patient will see your English wording with a notice.
              </>
            )}
          </span>
        </div>
      ) : null}
      <Button
        variant="secondary"
        onClick={() => {
          client
            .saveReplyDraft(caseId, text, templateId)
            .then(() => {
              setErr(null);
              onChanged();
            })
            .catch((e: unknown) => setErr(e instanceof ApiError ? e : null));
        }}
        data-testid="save-draft"
      >
        Save draft (sends nothing)
      </Button>
      {!inReview ? (
        <p className="small muted" data-testid="needs-review-note">
          Start the review before approving a reply.
        </p>
      ) : null}
      <label className="check">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          data-testid="approve-confirm"
        />
        <span>I have read the original request and I approve this reply under my name.</span>
      </label>
      <Button
        icon="send"
        disabled={!confirmed || !text.trim() || !inReview}
        onClick={() => {
          client
            .approveReply(caseId, { text, templateId, inReplyToMessageId: latest.messageId })
            .then(() => {
              setErr(null);
              setConfirmed(false);
              onChanged();
            })
            .catch((e: unknown) => setErr(e instanceof ApiError ? e : null));
        }}
        data-testid="approve-reply"
      >
        Approve and send reply
      </Button>
      {approved ? (
        <div className="card" data-testid="approved-record">
          <strong>Approved reply v{approved.version}</strong> by {approved.author.name} (
          {approved.author.role}) at {approved.approvedAt.slice(11, 16)} UTC (simulated).
          <br />
          <span className="small muted">
            Return delivery is tracked separately: see the status lines in the case pane.
          </span>
        </div>
      ) : null}
    </div>
  );
}
