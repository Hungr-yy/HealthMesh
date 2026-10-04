import { useCallback, useEffect, useRef, useState } from 'react';
import type { MessageKey } from '@shared/i18n';
import { useI18n } from '../lib/i18nContext';
import type { SpeechAdapter, SpeechErrorCode, SpeechSession } from '../lib/speech';
import { Button, Icon } from './ui';

type Phase = 'idle' | 'consent' | 'listening' | 'stopped' | 'error';

const ERROR_KEY: Record<SpeechErrorCode, MessageKey> = {
  'not-allowed': 'voiceErrDenied',
  'no-speech': 'voiceErrNoSpeech',
  'audio-capture': 'voiceErrAudio',
  network: 'voiceErrNetwork',
  'language-not-supported': 'voiceErrLang',
  unknown: 'voiceErrOther',
};

/**
 * Optional speech-to-text for the details box. Typing always keeps working: this component only
 * ever ADDS text (never submits) and every failure ends in a plain message, never a blocked flow.
 */
export function VoiceInput({
  adapter,
  consented,
  onConsent,
  onTranscript,
}: {
  adapter: SpeechAdapter;
  /** Consent line already accepted on this device session. */
  consented: boolean;
  onConsent: () => void;
  /** Called with each FINAL recognized phrase (must be a stable callback). */
  onTranscript: (text: string) => void;
}) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>('idle');
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<SpeechErrorCode | null>(null);
  const [addedAny, setAddedAny] = useState(false);
  const session = useRef<SpeechSession | null>(null);
  const addedRef = useRef(false);
  const erroredRef = useRef(false);
  const continueRef = useRef<HTMLButtonElement>(null);
  const speakRef = useRef<HTMLButtonElement>(null);

  useEffect(() => () => session.current?.abort(), []);
  useEffect(() => {
    if (phase === 'consent') continueRef.current?.focus();
  }, [phase]);

  const begin = useCallback(() => {
    addedRef.current = false;
    erroredRef.current = false;
    setAddedAny(false);
    setError(null);
    setInterim('');
    setPhase('listening');
    session.current = adapter.start(t('speechLocale'), {
      onStart: () => undefined,
      onResult: (text, isFinal) => {
        if (isFinal) {
          if (text.trim()) {
            addedRef.current = true;
            setAddedAny(true);
            onTranscript(text.trim());
          }
          setInterim('');
        } else setInterim(text);
      },
      onError: (code) => {
        erroredRef.current = true;
        setError(code);
        setPhase('error');
      },
      onEnd: () => {
        session.current = null;
        setInterim('');
        if (!erroredRef.current) setPhase('stopped');
      },
    });
  }, [adapter, t, onTranscript]);

  if (!adapter.isSupported()) {
    return (
      <div className="notice" data-testid="speak-unavailable">
        <Icon name="info" />
        <span>{t('speakUnavailable')}</span>
      </div>
    );
  }

  const listening = phase === 'listening';
  const onMainClick = () => {
    if (listening) session.current?.stop();
    else if (!consented) setPhase('consent');
    else begin();
  };

  return (
    <div className="voice" data-testid="voice" data-phase={phase}>
      <Button
        variant="secondary"
        icon={listening ? 'stop' : 'mic'}
        onClick={onMainClick}
        data-testid={listening ? 'voice-stop' : 'voice-start'}
        ref={speakRef}
      >
        {listening ? t('voiceStop') : t('voiceSpeak')}
      </Button>

      {phase === 'consent' ? (
        <div
          className="notice voice-consent"
          role="group"
          aria-labelledby="voice-consent-title"
          data-testid="voice-consent"
        >
          <Icon name="lock" />
          <div>
            <strong id="voice-consent-title">{t('voiceConsentTitle')}</strong>
            <p>{t('voiceConsent')}</p>
            <Button
              icon="mic"
              ref={continueRef}
              onClick={() => {
                onConsent();
                begin();
                // The consent panel is about to disappear: keep keyboard focus on the main button.
                speakRef.current?.focus();
              }}
              data-testid="voice-consent-continue"
            >
              {t('voiceConsentContinue')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setPhase('idle');
                speakRef.current?.focus();
              }}
              data-testid="voice-consent-cancel"
            >
              {t('voiceConsentCancel')}
            </Button>
          </div>
        </div>
      ) : null}

      {/* Live regions exist before their text changes so screen readers announce updates. */}
      <p role="status" className="voice-status" data-testid="voice-status">
        {listening ? (
          <>
            <Icon name="mic" /> {t('voiceListening')}
          </>
        ) : phase === 'stopped' ? (
          <>
            <Icon name="check" /> {addedAny ? t('voiceStoppedAdded') : t('voiceStoppedNothing')}
          </>
        ) : null}
      </p>
      <div role="alert" className="voice-error-slot" data-testid="voice-error-slot">
        {phase === 'error' && error ? (
          <div className="notice" data-testid="voice-error" data-code={error}>
            <Icon name="warning" />
            <span>{t(ERROR_KEY[error])}</span>
          </div>
        ) : null}
      </div>
      {listening && interim ? (
        <p className="small muted" aria-hidden="true" data-testid="voice-interim">
          {t('voiceHearing')} {interim}
        </p>
      ) : null}
      <p className="small muted" data-testid="voice-quality">
        <Icon name="info" /> {t('voiceQuality')}
      </p>
    </div>
  );
}
