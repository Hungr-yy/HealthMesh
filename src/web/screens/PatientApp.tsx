import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { HealthMessagingClient } from '@shared/client';
import { readbackFields } from '@shared/draft';
import { NATIVE_NAMES, PACK_STATUS, type MessageKey } from '@shared/i18n';
import { newSecret, newUuid } from '@shared/ids';
import { formatAge } from '@shared/time';
import { translateToEnglish } from '@shared/translate';
import {
  ApiError,
  LANGS,
  REQUEST_TYPES,
  type CaseView,
  type DraftField,
  type LangCode,
  type MessageVersionView,
  type NodeStatus,
  type RequestInput,
} from '@shared/types';
import { NetworkNote } from '../components/Chrome';
import { Button, Field, Icon, useAnnounce, type IconName } from '../components/ui';
import { I18nContext, makeI18n, useI18n } from '../lib/i18nContext';
import {
  EMPTY_FORM,
  type DeviceSession,
  type DraftForm,
  type OpenCase,
  type SessionData,
} from '../lib/session';

type Screen =
  | 'lang'
  | 'home'
  | 'help'
  | 'check'
  | 'choose'
  | 'details'
  | 'confirm'
  | 'review'
  | 'receipt'
  | 'reply'
  | 'declined'
  | 'done';

const POLL_MS = 2000;

interface Props {
  client: HealthMessagingClient;
  device: DeviceSession;
  /** Reports the active language so the shell can set page direction and banners. */
  onLanguage: (l: LangCode | null) => void;
}

type SubmitState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'uncertain' }
  | { kind: 'node_unavailable' }
  | { kind: 'storage_full' }
  | { kind: 'error'; message: string };

export function PatientApp({ client, device, onLanguage }: Props) {
  const [session, setSession] = useState<SessionData>(() => device.load());
  const [form, setForm] = useState<DraftForm>(() => device.loadDraft() ?? EMPTY_FORM);
  const [screen, setScreen] = useState<Screen>(() => {
    const s = device.load();
    if (s.language && s.mode) return s.activeCaseId ? 'receipt' : 'home';
    return 'lang';
  });
  const [submit, setSubmit] = useState<SubmitState>({ kind: 'idle' });
  /**
   * Set by "Ask a follow-up" (joins the case) or "Send it again" / edit (joins the case AND
   * supersedes a message, creating a linked new version).
   */
  const [link, setLink] = useState<{ caseId: string; supersedesMessageId?: string } | null>(null);
  const [caseView, setCaseView] = useState<CaseView | null>(null);
  const [nodeStatus, setNodeStatus] = useState<NodeStatus | null>(null);
  const [nodeDown, setNodeDown] = useState(false);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const announce = useAnnounce();

  const lang: LangCode = session.language ?? 'en';
  const i18n = useMemo(() => makeI18n(lang), [lang]);
  const { t } = i18n;

  useEffect(() => onLanguage(session.language), [session.language, onLanguage]);

  // Focus management: move focus to the screen heading whenever the screen changes.
  useEffect(() => {
    headingRef.current?.focus();
  }, [screen]);

  const updateSession = useCallback(
    (patch: Partial<SessionData>) => {
      setSession((prev) => {
        const next = { ...prev, ...patch };
        device.save(next);
        return next;
      });
    },
    [device],
  );

  const updateForm = useCallback(
    (patch: Partial<DraftForm>) => {
      setForm((prev) => {
        const next = { ...prev, ...patch };
        device.saveDraft(next);
        return next;
      });
    },
    [device],
  );

  const activeCase: OpenCase | null =
    session.openCases.find((c) => c.caseId === session.activeCaseId) ?? null;

  const refresh = useCallback(async () => {
    if (!activeCase) return;
    try {
      const v = await client.getCase(activeCase.caseId, { secret: activeCase.secret });
      setCaseView(v);
      client
        .nodeStatus()
        .then(setNodeStatus)
        .catch(() => undefined);
      setNodeDown(false);
    } catch (e) {
      // Keep the last known view: never blank the screen on a transient error.
      if (e instanceof ApiError && e.code === 'node_unavailable') setNodeDown(true);
    }
  }, [client, activeCase]);

  // Poll while a case is open on receipt / reply screens. Bounded: stops when screen changes.
  useEffect(() => {
    if (screen !== 'receipt' && screen !== 'reply') return;
    const first = setTimeout(() => void refresh(), 0);
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [screen, refresh]);

  useEffect(() => {
    let live = true;
    client
      .nodeStatus()
      .then((s) => live && setNodeStatus(s))
      .catch(() => live && setNodeStatus(null));
    return () => {
      live = false;
    };
  }, [client, screen, submit.kind]);

  // Announce visible state changes to screen readers.
  const latest = caseView?.versions[caseView.versions.length - 1];
  const stateKey = latest ? stateLabelKey(latest) : null;
  const lastAnnounced = useRef<string | null>(null);
  useEffect(() => {
    if (stateKey && stateKey !== lastAnnounced.current) {
      if (lastAnnounced.current !== null) announce(t(stateKey));
      lastAnnounced.current = stateKey;
    }
  }, [stateKey, announce, t]);

  // ---------------------------------------------------------------- actions
  const lockDevice = useCallback(() => {
    const cleared = device.lock();
    setSession(cleared);
    setForm(EMPTY_FORM);
    setCaseView(null);
    setSubmit({ kind: 'idle' });
    setLink(null);
    lastAnnounced.current = null;
    setScreen('done');
  }, [device]);

  const switchPatient = useCallback(() => {
    const next = device.switchPatient(session);
    setSession(next);
    setForm(EMPTY_FORM);
    setCaseView(null);
    setSubmit({ kind: 'idle' });
    setLink(null);
    lastAnnounced.current = null;
    setScreen('lang');
  }, [device, session]);

  const buildInput = useCallback(
    (): RequestInput => ({
      requestType: form.requestType ?? 'message_clinic',
      patientName: form.patientName.trim(),
      village: form.village.trim(),
      details: form.details.trim(),
      contact: form.contact.trim(),
      language: lang,
      ...(link && !link.supersedesMessageId ? { relatedCaseId: link.caseId } : {}),
      ...(link?.supersedesMessageId ? { supersedesMessageId: link.supersedesMessageId } : {}),
      entryMode: session.mode === 'worker' ? 'assisted' : 'typed',
      ...(session.mode === 'worker' ? { assistedBy: session.workerLabel || 'health worker' } : {}),
      consent: {
        recipientAcknowledged: form.consent1,
        readersAcknowledged: form.consent2,
        replyMethod: form.replyMethod,
      },
    }),
    [form, lang, session.mode, session.workerLabel, link],
  );

  const send = useCallback(async () => {
    // The message id and secret are created ONCE per submission attempt so retries reuse them.
    const followCase = link ? session.openCases.find((c) => c.caseId === link.caseId) : undefined;
    const pending = session.pending ?? {
      messageId: newUuid(),
      secret: followCase?.secret ?? newSecret(),
    };
    if (!session.pending) updateSession({ pending });
    setSubmit({ kind: 'sending' });
    try {
      const res = await client.submitRequest(buildInput(), pending.messageId, {
        secret: pending.secret,
      });
      const oc: OpenCase = {
        caseId: res.caseId,
        ref: res.ref,
        messageId: res.messageId,
        secret: pending.secret,
      };
      setLink(null);
      device.clearDraft();
      setForm(EMPTY_FORM);
      updateSession({
        pending: null,
        openCases: [...session.openCases.filter((c) => c.caseId !== oc.caseId), oc],
        activeCaseId: oc.caseId,
      });
      setSubmit({ kind: 'idle' });
      setScreen('receipt');
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === 'node_unavailable') return setSubmit({ kind: 'node_unavailable' });
        if (e.code === 'storage_nearly_full') return setSubmit({ kind: 'storage_full' });
        if (e.code === 'network_error') return setSubmit({ kind: 'uncertain' });
        return setSubmit({ kind: 'error', message: e.message });
      }
      setSubmit({ kind: 'uncertain' });
    }
  }, [client, session, updateSession, buildInput, device, link]);

  /** Lost response: ask the node by the stable message id. Never creates a second case. */
  const checkAgain = useCallback(async () => {
    const pending = session.pending;
    if (!pending) return;
    try {
      const v = await client.getCaseByMessageId(pending.messageId, { secret: pending.secret });
      const oc: OpenCase = {
        caseId: v.caseId,
        ref: v.ref,
        messageId: pending.messageId,
        secret: pending.secret,
      };
      device.clearDraft();
      setForm(EMPTY_FORM);
      updateSession({
        pending: null,
        openCases: [...session.openCases, oc],
        activeCaseId: oc.caseId,
      });
      setCaseView(v);
      setSubmit({ kind: 'idle' });
      setScreen('receipt');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'not_found') {
        // Not accepted: safe to retry with the SAME message id.
        setSubmit({ kind: 'idle' });
        announce(t('retrySend'));
      } else if (e instanceof ApiError && e.code === 'node_unavailable') {
        setSubmit({ kind: 'node_unavailable' });
      } else {
        setSubmit({ kind: 'uncertain' });
      }
    }
  }, [client, session, device, updateSession, announce, t]);

  // ---------------------------------------------------------------- render
  const body = (() => {
    switch (screen) {
      case 'lang':
        return (
          <LanguageScreen
            session={session}
            onPick={(l) => updateSession({ language: l })}
            onStart={(mode, worker) => {
              updateSession({ mode, workerLabel: worker });
              setScreen('home');
            }}
            headingRef={headingRef}
          />
        );
      case 'home':
        return (
          <HomeScreen
            headingRef={headingRef}
            onAsk={() => {
              setForm((f) => ({ ...f, requestType: null }));
              setScreen('choose');
            }}
            onCheck={() => setScreen('check')}
            onHelp={() => setScreen('help')}
          />
        );
      case 'help':
        return <HelpScreen headingRef={headingRef} onBack={() => setScreen('home')} />;
      case 'check':
        return (
          <CheckScreen
            headingRef={headingRef}
            session={session}
            client={client}
            onBack={() => setScreen('home')}
            onOpen={(id) => {
              updateSession({ activeCaseId: id });
              setScreen('receipt');
            }}
          />
        );
      case 'choose':
        return (
          <ChooseScreen
            headingRef={headingRef}
            selected={form.requestType}
            onBack={() => setScreen('home')}
            onPick={(rt) => {
              updateForm({ requestType: rt });
              setScreen('details');
            }}
          />
        );
      case 'details':
        return (
          <DetailsScreen
            headingRef={headingRef}
            form={form}
            onChange={updateForm}
            onBack={() => setScreen('choose')}
            onNext={() => setScreen('confirm')}
          />
        );
      case 'confirm':
        return (
          <ConfirmScreen
            headingRef={headingRef}
            input={buildInput()}
            translationAvailable={nodeStatus?.translationAvailable ?? true}
            onBack={() => setScreen('details')}
            onNext={() => setScreen('review')}
          />
        );
      case 'review':
        return (
          <ReviewScreen
            headingRef={headingRef}
            form={form}
            input={buildInput()}
            submit={submit}
            canCheckAgain={!!session.pending}
            onChange={updateForm}
            onBack={() => setScreen('confirm')}
            onSend={() => void send()}
            onCheckAgain={() => void checkAgain()}
            onDecline={() => {
              device.clearDraft();
              setForm(EMPTY_FORM);
              updateSession({ pending: null });
              setSubmit({ kind: 'idle' });
              setScreen('declined');
            }}
          />
        );
      case 'receipt':
        return (
          <ReceiptScreen
            headingRef={headingRef}
            view={caseView}
            oc={activeCase}
            client={client}
            noUpstream={nodeStatus?.upstream === 'link_down'}
            nodeDown={nodeDown}
            onRefresh={() => void refresh()}
            onReply={() => setScreen('reply')}
            onFinish={lockDevice}
            onResend={() => {
              if (!caseView || !activeCase) return;
              const last = caseView.versions[caseView.versions.length - 1];
              if (!last) return;
              setLink({ caseId: activeCase.caseId, supersedesMessageId: last.messageId });
              setSubmit({ kind: 'idle' });
              setForm({
                ...EMPTY_FORM,
                requestType: last.input.requestType,
                patientName: last.input.patientName,
                village: last.input.village,
                details: last.input.details,
                contact: last.input.contact,
              });
              setScreen('details');
            }}
          />
        );
      case 'reply':
        return (
          <ReplyScreen
            headingRef={headingRef}
            view={caseView}
            oc={activeCase}
            client={client}
            workerMode={session.mode === 'worker'}
            workerLabel={session.workerLabel}
            onRefresh={() => void refresh()}
            onBack={() => setScreen('receipt')}
            onFollowUp={() => {
              setLink(activeCase ? { caseId: activeCase.caseId } : null);
              setForm({ ...EMPTY_FORM, requestType: 'message_clinic' });
              setScreen('details');
            }}
            onFinish={lockDevice}
          />
        );
      case 'declined':
        return (
          <section>
            <h1 tabIndex={-1} ref={headingRef}>
              {t('declineSend')}
            </h1>
            <p>{t('declineInfo')}</p>
            <Button onClick={() => setScreen('home')}>{t('finish')}</Button>
          </section>
        );
      case 'done':
        return (
          <section>
            <h1 tabIndex={-1} ref={headingRef}>
              {t('doneTitle')}
            </h1>
            <p>{t('doneBody')}</p>
            <Button
              onClick={() => {
                setScreen('lang');
              }}
            >
              {t('newRequest')}
            </Button>
          </section>
        );
    }
  })();

  const showStepper = ['choose', 'details', 'confirm', 'review'].includes(screen);
  const stepNo = { choose: 1, details: 2, confirm: 3, review: 4 }[screen as 'choose'] ?? 0;
  const inSession = session.mode !== null && screen !== 'lang' && screen !== 'done';

  return (
    <I18nContext.Provider value={i18n}>
      <div lang={lang} dir={i18n.dir} data-testid="patient-root" data-screen={screen}>
        {inSession ? (
          <div className="card" data-testid="session-bar">
            <p className="small muted" style={{ margin: 0 }}>
              <Icon name="user" /> {session.mode === 'worker' ? `${session.workerLabel}` : ''}
            </p>
            {session.mode === 'worker' ? (
              <Button
                variant="secondary"
                icon="user"
                onClick={switchPatient}
                data-testid="switch-patient"
              >
                {t('switchPatient')}
              </Button>
            ) : null}
            <Button variant="secondary" icon="lock" onClick={lockDevice} data-testid="lock-device">
              {t('lockClear')}
            </Button>
          </div>
        ) : null}
        {showStepper ? (
          <div className="step-indicator" data-testid="step-indicator">
            {t('step', { n: stepNo, total: 4 })}
          </div>
        ) : null}
        {body}
        <NetworkNote text={t('messagesSlow')} />
      </div>
    </I18nContext.Provider>
  );
}

// ---------------------------------------------------------------------------- helpers
function stateLabelKey(v: MessageVersionView): MessageKey {
  if (v.tracks.exception === 'expired') return 'expiredMsg';
  if (v.tracks.exception === 'intervention_required') return 'interventionMsg';
  if (v.tracks.exception === 'withdrawn') return 'withdrawn';
  if (v.tracks.returnTransport) return 'returnAvailable';
  switch (v.tracks.care) {
    case 'reply_approved':
      return 'careApproved';
    case 'in_review':
      return 'careInReview';
    case 'awaiting_review':
      return 'careAwaiting';
    default:
  }
  switch (v.tracks.transport) {
    case 'clinic_received':
      return 'stateClinic';
    case 'gateway_received':
      return 'stateGateway';
    case 'relaying':
      return 'stateRelaying';
    default:
      return v.tracks.local === 'accepted' ? 'stateWaiting' : 'stateDraft';
  }
}

function H1({
  children,
  hRef,
}: {
  children: ReactNode;
  hRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  return (
    <h1 tabIndex={-1} ref={hRef}>
      {children}
    </h1>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  const { t } = useI18n();
  return (
    <div className="back-row">
      <Button variant="secondary" icon="back" inline onClick={onClick} data-testid="back">
        {t('back')}
      </Button>
    </div>
  );
}

type HRef = React.RefObject<HTMLHeadingElement | null>;

// ---------------------------------------------------------------------------- A language / access
function LanguageScreen({
  session,
  onPick,
  onStart,
  headingRef,
}: {
  session: SessionData;
  onPick: (l: LangCode) => void;
  onStart: (mode: 'self' | 'worker', worker: string) => void;
  headingRef: HRef;
}) {
  const { t } = useI18n();
  const [workerStep, setWorkerStep] = useState(false);
  const [worker, setWorker] = useState(session.workerLabel || '');
  const chosen = session.language;
  return (
    <section>
      <H1 hRef={headingRef}>{t('langTitle')}</H1>
      <p className="muted">{t('langHelp')}</p>
      <div className="lang-grid" role="group" aria-label={t('langTitle')}>
        {LANGS.map((l) => (
          <Button
            key={l}
            variant="secondary"
            icon="globe"
            aria-pressed={chosen === l}
            lang={l}
            data-testid={`lang-${l}`}
            onClick={() => onPick(l)}
          >
            {NATIVE_NAMES[l]}
            {PACK_STATUS[l] === 'unreviewed-demo' ? ' (UNREVIEWED demo)' : ''}
          </Button>
        ))}
      </div>
      {chosen && !workerStep ? (
        <>
          <Button icon="user" onClick={() => setWorkerStep(true)} data-testid="mode-worker">
            {t('useWithWorker')}
          </Button>
          <p className="small muted">{t('useWithWorkerHelp')}</p>
          <Button
            variant="secondary"
            icon="user"
            onClick={() => onStart('self', '')}
            data-testid="mode-self"
          >
            {t('useAlone')}
          </Button>
        </>
      ) : null}
      {chosen && workerStep ? (
        <>
          <Field id="worker" label={t('workerNameLabel')} hint={t('workerNameDemo')}>
            <input
              id="worker"
              type="text"
              value={worker}
              onChange={(e) => setWorker(e.target.value)}
              aria-describedby="worker-hint"
              autoComplete="off"
            />
          </Field>
          <Button
            onClick={() => onStart('worker', worker.trim() || 'Grace (synthetic)')}
            data-testid="start-worker"
          >
            {t('startAsWorker')}
          </Button>
        </>
      ) : null}
      <div className="notice" data-testid="shared-device-note">
        <Icon name="lock" />
        <span>{t('sharedNote')}</span>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------- B home
function HomeScreen({
  headingRef,
  onAsk,
  onCheck,
  onHelp,
}: {
  headingRef: HRef;
  onAsk: () => void;
  onCheck: () => void;
  onHelp: () => void;
}) {
  const { t } = useI18n();
  return (
    <section>
      <H1 hRef={headingRef}>{t('homeTitle')}</H1>
      <Button icon="send" onClick={onAsk} data-testid="ask-clinic">
        {t('askClinic')}
      </Button>
      <Button variant="secondary" icon="search" onClick={onCheck} data-testid="check-request">
        {t('checkRequest')}
      </Button>
      <Button variant="secondary" icon="help" onClick={onHelp} data-testid="get-help">
        {t('getHelp')}
      </Button>
      <div className="notice" data-testid="delay-notice">
        <Icon name="clock" />
        <span>{t('delayNotice')}</span>
      </div>
    </section>
  );
}

function HelpScreen({ headingRef, onBack }: { headingRef: HRef; onBack: () => void }) {
  const { t } = useI18n();
  return (
    <section>
      <BackButton onClick={onBack} />
      <H1 hRef={headingRef}>{t('helpTitle')}</H1>
      <p>{t('helpBody')}</p>
    </section>
  );
}

function CheckScreen({
  headingRef,
  session,
  client,
  onBack,
  onOpen,
}: {
  headingRef: HRef;
  session: SessionData;
  client: HealthMessagingClient;
  onBack: () => void;
  onOpen: (caseId: string) => void;
}) {
  const { t } = useI18n();
  const [ref, setRef] = useState('');
  const [rejected, setRejected] = useState(false);
  const tryRef = async () => {
    const wanted = ref.trim().toUpperCase();
    const own = session.openCases.find((c) => c.ref === wanted);
    try {
      // With the device's own credential this succeeds; with none it must be rejected.
      await client.lookupByReference(wanted, own ? { secret: own.secret } : undefined);
      if (own) onOpen(own.caseId);
      else setRejected(true);
    } catch {
      setRejected(true);
    }
  };
  return (
    <section>
      <BackButton onClick={onBack} />
      <H1 hRef={headingRef}>{t('checkTitle')}</H1>
      {session.openCases.length ? (
        <>
          <p>{t('checkHelp')}</p>
          {session.openCases.map((c) => (
            <Button key={c.caseId} variant="secondary" icon="mail" onClick={() => onOpen(c.caseId)}>
              {`${t('checkOpen')} ${c.ref}`}
            </Button>
          ))}
        </>
      ) : (
        <div className="notice" data-testid="check-none">
          <Icon name="info" />
          <span>{t('checkNone')}</span>
        </div>
      )}
      <Field id="ref" label={t('checkRefLabel')}>
        <input
          id="ref"
          type="text"
          value={ref}
          autoComplete="off"
          onChange={(e) => {
            setRef(e.target.value);
            setRejected(false);
          }}
        />
      </Field>
      <Button
        variant="secondary"
        icon="search"
        onClick={() => void tryRef()}
        disabled={!ref.trim()}
      >
        {t('checkOpen')}
      </Button>
      {rejected ? (
        <div className="alert" role="alert" data-testid="ref-rejected">
          <Icon name="warning" />
          <span>{t('checkRefRejected')}</span>
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------- C choose
function ChooseScreen({
  headingRef,
  selected,
  onBack,
  onPick,
}: {
  headingRef: HRef;
  selected: RequestInput['requestType'] | null;
  onBack: () => void;
  onPick: (rt: RequestInput['requestType']) => void;
}) {
  const { t } = useI18n();
  const icons: Record<string, IconName> = {
    follow_up: 'clinic',
    existing_referral: 'flag',
    appointment: 'clock',
    message_clinic: 'mail',
    something_else: 'help',
  };
  return (
    <section>
      <BackButton onClick={onBack} />
      <H1 hRef={headingRef}>{t('chooseTitle')}</H1>
      {REQUEST_TYPES.map((rt) => (
        <Button
          key={rt}
          variant={selected === rt ? 'primary' : 'secondary'}
          icon={icons[rt] ?? 'help'}
          data-testid={`type-${rt}`}
          onClick={() => onPick(rt)}
        >
          {t(`type_${rt}` as MessageKey)}
        </Button>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------------------- D details
function DetailsScreen({
  headingRef,
  form,
  onChange,
  onBack,
  onNext,
}: {
  headingRef: HRef;
  form: DraftForm;
  onChange: (p: Partial<DraftForm>) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const { t } = useI18n();
  const [err, setErr] = useState(false);
  return (
    <section>
      <BackButton onClick={onBack} />
      <H1 hRef={headingRef}>{t('detailsTitle')}</H1>
      <Field id="name" label={t('nameLabel')}>
        <input
          id="name"
          type="text"
          value={form.patientName}
          autoComplete="off"
          onChange={(e) => onChange({ patientName: e.target.value })}
        />
      </Field>
      <Field id="village" label={t('villageLabel')}>
        <input
          id="village"
          type="text"
          value={form.village}
          autoComplete="off"
          onChange={(e) => onChange({ village: e.target.value })}
        />
      </Field>
      <Field
        id="details"
        label={t('detailsLabel')}
        hint={t('detailsHint')}
        error={err && !form.details.trim() ? t('detailsRequired') : null}
      >
        <textarea
          id="details"
          value={form.details}
          aria-describedby="details-hint"
          onChange={(e) => {
            setErr(false);
            onChange({ details: e.target.value });
          }}
        />
      </Field>
      <Field id="contact" label={t('contactLabel')}>
        <input
          id="contact"
          type="text"
          value={form.contact}
          autoComplete="off"
          onChange={(e) => onChange({ contact: e.target.value })}
        />
      </Field>
      <div className="notice" data-testid="speak-unavailable">
        <Icon name="info" />
        <span>{t('speakUnavailable')}</span>
      </div>
      <p className="small muted" data-testid="draft-saved">
        <Icon name="check" /> {t('draftSaved')}. {t('draftRetention')}
      </p>
      <Button
        icon="check"
        onClick={() => {
          if (!form.details.trim()) return setErr(true);
          onNext();
        }}
        data-testid="details-next"
      >
        {t('next')}
      </Button>
    </section>
  );
}

// ---------------------------------------------------------------------------- E confirm
function FieldValue({ f }: { f: DraftField }) {
  const { t } = useI18n();
  if (f.status === 'not_provided' || f.value === null)
    return <span className="not-provided">{t('notProvided')}</span>;
  if (f.codes?.length)
    return (
      <span>{f.codes.map((c) => t(`v_${c.replace(/ /g, '_')}` as MessageKey)).join(', ')}</span>
    );
  return <span>{f.value}</span>;
}

function fieldLabel(f: DraftField, t: ReturnType<typeof useI18n>['t']): string {
  const map: Record<string, MessageKey> = {
    timing: 'fieldWhen',
    referral: 'fieldReferral',
    mentions: 'fieldWords',
    contact: 'fieldContact',
    for_whom: 'fieldWho',
  };
  const k = map[f.key];
  return k ? t(k) : f.label;
}

function ConfirmScreen({
  headingRef,
  input,
  translationAvailable,
  onBack,
  onNext,
}: {
  headingRef: HRef;
  input: RequestInput;
  translationAvailable: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  const { t, lang } = useI18n();
  const translation = useMemo(
    () => translateToEnglish(input.details, input.language, { available: translationAvailable }),
    [input.details, input.language, translationAvailable],
  );
  const fields = useMemo(() => readbackFields(input, translation), [input, translation]);
  const needsReview = translation.status !== 'not_needed';
  return (
    <section>
      <BackButton onClick={onBack} />
      <H1 hRef={headingRef}>{t('confirmTitle')}</H1>
      <h2>{t('yourWords')}</h2>
      <blockquote
        className="original"
        lang={input.language}
        dir={lang === 'ar' ? 'rtl' : 'ltr'}
        data-testid="original-text"
      >
        {input.details}
      </blockquote>
      <h2>{t('ourReading')}</h2>
      <div className="card">
        <dl className="facts" data-testid="readback">
          <div className="row">
            <dt>{t('fieldRequest')}</dt>
            <dd>{t(`type_${input.requestType}` as MessageKey)}</dd>
          </div>
          {fields.map((f) => (
            <div
              key={f.key + f.label}
              className={`row${f.status === 'uncertain' ? ' uncertain' : ''}`}
              data-status={f.status}
            >
              <dt>{fieldLabel(f, t)}</dt>
              <dd>
                <FieldValue f={f} />
                {f.status === 'uncertain' ? (
                  <div className="flag">
                    <Icon name="flag" /> {t('pleaseCheck')}
                  </div>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      {needsReview ? (
        <div className="notice" data-testid="translation-review">
          <Icon name="flag" />
          <span>
            <strong>{t('translationReview')}</strong>
            <br />
            {t('translationReviewHelp')}
            {translation.text ? (
              <>
                <br />
                <em lang="en" dir="ltr">
                  {translation.text}
                </em>
              </>
            ) : null}
          </span>
        </div>
      ) : null}
      <Button icon="check" onClick={onNext} data-testid="confirm-right">
        {t('thisIsRight')}
      </Button>
      <Button variant="secondary" onClick={onBack}>
        {t('changeIt')}
      </Button>
    </section>
  );
}

// ---------------------------------------------------------------------------- F review & consent
function ReviewScreen({
  headingRef,
  form,
  input,
  submit,
  canCheckAgain,
  onChange,
  onBack,
  onSend,
  onCheckAgain,
  onDecline,
}: {
  headingRef: HRef;
  form: DraftForm;
  input: RequestInput;
  submit: SubmitState;
  canCheckAgain: boolean;
  onChange: (p: Partial<DraftForm>) => void;
  onBack: () => void;
  onSend: () => void;
  onCheckAgain: () => void;
  onDecline: () => void;
}) {
  const { t, lang } = useI18n();
  const ready = form.consent1 && form.consent2;
  return (
    <section>
      <BackButton onClick={onBack} />
      <H1 hRef={headingRef}>{t('reviewTitle')}</H1>
      <div className="card">
        <dl className="facts">
          <div className="row">
            <dt>{t('reviewTo')}</dt>
            <dd>{t('reviewToValue')}</dd>
          </div>
          <div className="row">
            <dt>{t('reviewMessage')}</dt>
            <dd lang={input.language} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
              {input.details}
            </dd>
          </div>
          <div className="row">
            <dt>{t('reviewWhoReads')}</dt>
            <dd>{t('reviewWhoReadsValue')}</dd>
          </div>
        </dl>
      </div>
      <fieldset style={{ border: 'none', padding: 0, margin: '0 0 1rem' }}>
        <legend className="label" style={{ fontWeight: 600 }}>
          {t('reviewReplyMethod')}
        </legend>
        {(['village_device', 'health_worker_reads'] as const).map((m) => (
          <label className="check" key={m}>
            <input
              type="radio"
              name="replyMethod"
              checked={form.replyMethod === m}
              onChange={() => onChange({ replyMethod: m })}
            />
            <span>{m === 'village_device' ? t('replyVillage') : t('replyWorker')}</span>
          </label>
        ))}
      </fieldset>
      <label className="check">
        <input
          type="checkbox"
          checked={form.consent1}
          onChange={(e) => onChange({ consent1: e.target.checked })}
          data-testid="consent1"
        />
        <span>{t('consent1')}</span>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={form.consent2}
          onChange={(e) => onChange({ consent2: e.target.checked })}
          data-testid="consent2"
        />
        <span>{t('consent2')}</span>
      </label>
      {submit.kind === 'node_unavailable' ? (
        <div className="alert" role="alert" data-testid="err-node-unavailable">
          <Icon name="warning" />
          <span>{t('nodeUnavailable')}</span>
        </div>
      ) : null}
      {submit.kind === 'storage_full' ? (
        <div className="alert" role="alert" data-testid="err-storage-full">
          <Icon name="warning" />
          <span>{t('storageFull')}</span>
        </div>
      ) : null}
      {submit.kind === 'uncertain' ? (
        <div className="alert" role="alert" data-testid="err-uncertain">
          <Icon name="warning" />
          <span>{t('ackUncertain')}</span>
        </div>
      ) : null}
      {submit.kind === 'error' ? (
        <div className="alert" role="alert">
          <Icon name="warning" />
          <span>{submit.message}</span>
        </div>
      ) : null}
      {submit.kind === 'uncertain' && canCheckAgain ? (
        <Button variant="secondary" icon="search" onClick={onCheckAgain} data-testid="check-again">
          {t('checkAgain')}
        </Button>
      ) : null}
      <Button
        icon="send"
        disabled={!ready || submit.kind === 'sending'}
        onClick={onSend}
        data-testid="send-request"
      >
        {submit.kind === 'node_unavailable' || submit.kind === 'uncertain'
          ? t('retrySend')
          : t('sendRequest')}
      </Button>
      <Button variant="secondary" onClick={onDecline} data-testid="decline-send">
        {t('declineSend')}
      </Button>
    </section>
  );
}

// ---------------------------------------------------------------------------- G receipt
export function TrackList({ v }: { v: MessageVersionView }) {
  const { t } = useI18n();
  const tr = v.tracks;
  const net: MessageKey =
    tr.transport === 'clinic_received'
      ? 'stateClinic'
      : tr.transport === 'gateway_received'
        ? 'stateGateway'
        : tr.transport === 'relaying'
          ? 'stateRelaying'
          : tr.local === 'accepted'
            ? 'stateWaiting'
            : 'stateDraft';
  const care: MessageKey =
    tr.care === 'reply_approved'
      ? 'careApproved'
      : tr.care === 'in_review'
        ? 'careInReview'
        : tr.care === 'awaiting_review'
          ? 'careAwaiting'
          : 'careNone';
  const rows: Array<{ name: MessageKey; state: MessageKey; done: boolean; icon: IconName }> = [
    {
      name: 'trackSaved',
      state: tr.local === 'accepted' ? 'stateWaiting' : 'stateDraft',
      done: tr.local === 'accepted',
      icon: 'check',
    },
    {
      name: 'trackNetwork',
      state: net,
      done: !!tr.transport && tr.transport !== 'queued',
      icon: 'radio',
    },
    { name: 'trackClinic', state: care, done: !!tr.care, icon: 'clinic' },
    {
      name: 'trackReply',
      state: tr.returnTransport ? 'returnAvailable' : 'returnNone',
      done: !!tr.returnTransport,
      icon: 'mail',
    },
    {
      name: 'trackYou',
      state: tr.userAction ? 'userOpened' : 'userNone',
      done: !!tr.userAction,
      icon: 'user',
    },
  ];
  return (
    <ul className="tracks" data-testid="tracks">
      {rows.map((r) => (
        <li key={r.name} className={r.done ? 'done' : ''} data-track={r.name}>
          <Icon name={r.done ? 'check' : r.icon} />
          <span>
            <span className="track-name">{t(r.name)}</span>
            <span className="track-state">{t(r.state)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function ReceiptScreen({
  headingRef,
  view,
  oc,
  client,
  noUpstream,
  nodeDown,
  onRefresh,
  onReply,
  onFinish,
  onResend,
}: {
  headingRef: HRef;
  view: CaseView | null;
  oc: OpenCase | null;
  client: HealthMessagingClient;
  noUpstream: boolean;
  nodeDown: boolean;
  onRefresh: () => void;
  onReply: () => void;
  onFinish: () => void;
  onResend: () => void;
}) {
  const { t } = useI18n();
  const [withdrawing, setWithdrawing] = useState(false);
  const v = view?.versions[view.versions.length - 1];
  const lastUpdate = v?.lastUpdateTick ?? null;
  return (
    <section>
      <H1 hRef={headingRef}>{t('receiptTitle')}</H1>
      {oc ? (
        <div className="card">
          <div className="muted small">{t('receiptRef')}</div>
          <div className="ref" data-testid="case-ref">
            {oc.ref}
          </div>
          <p className="small muted">{t('receiptRefNote')}</p>
        </div>
      ) : null}
      {nodeDown ? (
        <div className="notice" data-testid="node-power-off">
          <Icon name="warning" />
          <span>{t('nodePowerOff')}</span>
        </div>
      ) : null}
      {v ? (
        <>
          {v.tracks.exception === 'expired' ? (
            <div className="alert" role="alert" data-testid="exc-expired">
              <Icon name="warning" />
              <span>{t('expiredMsg')}</span>
            </div>
          ) : null}
          {v.tracks.exception === 'intervention_required' ? (
            <div className="alert" role="alert" data-testid="exc-intervention">
              <Icon name="warning" />
              <span>{t('interventionMsg')}</span>
            </div>
          ) : null}
          {v.tracks.exception === 'withdrawn' ? (
            <div className="notice" data-testid="exc-withdrawn">
              <Icon name="info" />
              <span>{t('withdrawn')}</span>
            </div>
          ) : null}
          {noUpstream &&
          (!v.tracks.transport || v.tracks.transport === 'queued') &&
          !v.tracks.exception ? (
            <div className="notice" data-testid="no-upstream">
              <Icon name="radio" />
              <span>{t('noUpstream')}</span>
            </div>
          ) : null}
          <TrackList v={v} />
          <p className="small muted" data-testid="last-update">
            {lastUpdate === null || !view
              ? t('noUpdate')
              : t('lastUpdate', { age: formatAge(view.nowTick - lastUpdate) })}{' '}
            {t('simTimeNote')}
          </p>
          {v.tracks.returnTransport ? (
            <Button icon="mail" onClick={onReply} data-testid="open-reply">
              {t('replyTitle')}
            </Button>
          ) : null}
          {v.tracks.exception === 'expired' ? (
            <Button icon="send" onClick={onResend} data-testid="resubmit">
              {t('resubmit')}
            </Button>
          ) : null}
          <Button variant="secondary" icon="search" onClick={onRefresh}>
            {t('checkAgain')}
          </Button>
          {!withdrawing ? (
            <Button variant="secondary" onClick={() => setWithdrawing(true)} data-testid="withdraw">
              {t('withdraw')}
            </Button>
          ) : (
            <div className="notice">
              <Icon name="info" />
              <span>
                {t('withdrawInfo')}
                <Button
                  variant="secondary"
                  onClick={() => {
                    if (oc) void client.withdraw(oc.caseId, { secret: oc.secret }).then(onRefresh);
                    setWithdrawing(false);
                  }}
                  data-testid="withdraw-confirm"
                >
                  {t('withdraw')}
                </Button>
              </span>
            </div>
          )}
        </>
      ) : (
        <p>{t('noUpdate')}</p>
      )}
      <Button icon="lock" onClick={onFinish} data-testid="finish-lock">
        {t('finishLock')}
      </Button>
    </section>
  );
}

// ---------------------------------------------------------------------------- H reply
function ReplyScreen({
  headingRef,
  view,
  oc,
  client,
  workerMode,
  workerLabel,
  onRefresh,
  onBack,
  onFollowUp,
  onFinish,
}: {
  headingRef: HRef;
  view: CaseView | null;
  oc: OpenCase | null;
  client: HealthMessagingClient;
  workerMode: boolean;
  workerLabel: string;
  onRefresh: () => void;
  onBack: () => void;
  onFollowUp: () => void;
  onFinish: () => void;
}) {
  const { t } = useI18n();
  const [assisted, setAssisted] = useState(false);
  const reply = view?.reply ?? null;
  const v = view?.versions[view.versions.length - 1];
  const opened = !!v?.tracks.userAction;
  return (
    <section>
      <BackButton onClick={onBack} />
      <H1 hRef={headingRef}>{t('replyTitle')}</H1>
      {!reply || !v?.tracks.returnTransport ? (
        <p data-testid="no-reply">{t('replyNone')}</p>
      ) : (
        <>
          <div className="card" data-testid="reply-card">
            <p
              lang={reply.patientLanguage}
              dir={reply.patientLanguage === 'ar' ? 'rtl' : 'ltr'}
              data-testid="reply-text"
              style={{ fontSize: '1.2rem' }}
            >
              {reply.patientText}
            </p>
            {reply.translation !== 'not_needed' ? (
              <p className="small muted" data-testid="reply-translation-note">
                {reply.translation === 'unavailable'
                  ? t('replyNotTranslated')
                  : t('replyTranslated')}{' '}
                <span lang={reply.textLanguage} dir="ltr">
                  {reply.text}
                </span>
              </p>
            ) : null}
            <p className="small">
              {t('replyFrom', { clinic: reply.clinic })}
              <br />
              {t('replyApprovedBy', { name: reply.author.name })}
              <br />
              {t('replyAt', { time: reply.approvedAt.replace('T', ' ').slice(0, 16) + ' UTC' })}
            </p>
          </div>
          <ul className="tracks">
            <li className="done" data-testid="arrived-state">
              <Icon name="check" />
              <span className="track-state">{t('replyArrived')}</span>
            </li>
            <li className={opened ? 'done' : ''} data-testid="opened-state">
              <Icon name={opened ? 'check' : 'clock'} />
              <span className="track-state">{opened ? t('replyOpened') : t('replyNotOpened')}</span>
            </li>
          </ul>
          {!opened ? (
            <>
              {workerMode ? (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={assisted}
                    onChange={(e) => setAssisted(e.target.checked)}
                    data-testid="assisted-reading"
                  />
                  <span>{t('replyAssisted')}</span>
                </label>
              ) : null}
              <Button
                icon="check"
                data-testid="seen"
                onClick={() => {
                  if (!oc) return;
                  void client
                    .markReplyOpened(
                      oc.caseId,
                      { secret: oc.secret },
                      assisted ? workerLabel : undefined,
                    )
                    .then(onRefresh);
                }}
              >
                {t('iHaveSeen')}
              </Button>
            </>
          ) : view?.replyOpenedAssistedBy ? (
            <p className="small muted">{t('replyAssisted')}</p>
          ) : null}
          <Button variant="secondary" icon="mail" onClick={onFollowUp} data-testid="ask-followup">
            {t('askFollowUp')}
          </Button>
          <Button variant="secondary" icon="lock" onClick={onFinish} data-testid="finish">
            {t('finish')}
          </Button>
        </>
      )}
    </section>
  );
}
