import type { LangCode } from '../../shared/types';

/**
 * Speech-to-text adapter. The UI only talks to these interfaces, so the browser implementation
 * (Web Speech API) can be swapped for another engine or replaced by the deterministic mock.
 *
 * PRIVACY: browser speech recognition may stream audio to a third-party service chosen by the
 * browser vendor. This code never records, stores or uploads audio itself (no MediaRecorder).
 * QUALITY: recognition accuracy for sw and ar is UNKNOWN (never verified in this project).
 */

export type SpeechErrorCode =
  | 'not-allowed' // microphone or service permission denied
  | 'no-speech'
  | 'audio-capture' // no microphone
  | 'network'
  | 'language-not-supported'
  | 'unknown';

export interface SpeechHandlers {
  onStart(): void;
  /** `isFinal` false = interim guess that may still change. */
  onResult(transcript: string, isFinal: boolean): void;
  onError(code: SpeechErrorCode): void;
  /** Always called once when capture has finished, after an error or a normal stop. */
  onEnd(): void;
}

export interface SpeechSession {
  /** Ask the engine to finish and deliver what it has. */
  stop(): void;
  /** Drop everything immediately (e.g. when leaving the screen). */
  abort(): void;
}

export interface SpeechAdapter {
  readonly kind: 'browser' | 'mock';
  isSupported(): boolean;
  /** BCP-47 locale, e.g. "en-US". Throws nothing; failures arrive through handlers.onError. */
  start(locale: string, handlers: SpeechHandlers): SpeechSession;
}

// ---------------------------------------------------------------- browser (Web Speech API)

interface BrowserRecognitionResult {
  readonly isFinal: boolean;
  readonly 0: { transcript: string };
}
interface BrowserRecognitionEvent {
  readonly resultIndex: number;
  readonly results: ArrayLike<BrowserRecognitionResult>;
}
interface BrowserRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((e: BrowserRecognitionEvent) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type BrowserRecognitionCtor = new () => BrowserRecognition;

function browserCtor(): BrowserRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: BrowserRecognitionCtor;
    webkitSpeechRecognition?: BrowserRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function mapBrowserError(code: string | undefined): SpeechErrorCode {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'not-allowed';
    case 'no-speech':
      return 'no-speech';
    case 'audio-capture':
      return 'audio-capture';
    case 'network':
      return 'network';
    case 'language-not-supported':
      return 'language-not-supported';
    default:
      return 'unknown';
  }
}

export class BrowserSpeechAdapter implements SpeechAdapter {
  readonly kind = 'browser' as const;
  isSupported(): boolean {
    return browserCtor() !== null;
  }
  start(locale: string, h: SpeechHandlers): SpeechSession {
    const Ctor = browserCtor();
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      h.onEnd();
    };
    if (!Ctor) {
      queueMicrotask(() => {
        h.onError('unknown');
        end();
      });
      return { stop: () => undefined, abort: () => undefined };
    }
    let rec: BrowserRecognition;
    try {
      rec = new Ctor();
      rec.lang = locale;
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.onstart = () => h.onStart();
      rec.onresult = (e) => {
        let finalText = '';
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i]!;
          if (r.isFinal) finalText += r[0].transcript;
          else interim += r[0].transcript;
        }
        if (finalText) h.onResult(finalText.trim(), true);
        if (interim) h.onResult(interim.trim(), false);
      };
      rec.onerror = (e) => h.onError(mapBrowserError(e.error));
      rec.onend = end;
      rec.start();
    } catch {
      queueMicrotask(() => {
        h.onError('unknown');
        end();
      });
      return { stop: () => undefined, abort: () => undefined };
    }
    return {
      stop: () => {
        try {
          rec.stop();
        } catch {
          end();
        }
      },
      abort: () => {
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        try {
          rec.abort();
        } catch {
          /* already stopped */
        }
        ended = true;
      },
    };
  }
}

// ---------------------------------------------------------------- deterministic mock

export type MockScenario =
  | 'ok' // two interim guesses, then final text, ends on stop()
  | 'denied' // permission refused
  | 'error-mid' // first final phrase arrives, then the engine errors
  | 'no-speech'
  | 'unsupported';

/** Fixed demo phrases per language. sw and ar are UNREVIEWED demo strings. */
export const MOCK_PHRASES: Record<LangCode, readonly string[]> = {
  en: ['I need a follow-up appointment', 'next week. My medicine has run out.'],
  sw: ['Ninahitaji miadi ya ufuatiliaji', 'wiki ijayo. Dawa yangu imeisha.'],
  ar: ['أحتاج إلى موعد متابعة', 'الأسبوع القادم. انتهى دوائي.'],
};

type Scheduler = (fn: () => void) => void;

/**
 * Deterministic recognizer for tests and offline demos: no microphone, no network, no timing
 * dependence beyond the injected scheduler (default: next macrotask).
 */
export class MockSpeechAdapter implements SpeechAdapter {
  readonly kind = 'mock' as const;
  readonly startedWith: string[] = [];
  constructor(
    private readonly scenario: MockScenario = 'ok',
    private readonly schedule: Scheduler = (fn) => void setTimeout(fn, 0),
    private readonly phrases: Record<LangCode, readonly string[]> = MOCK_PHRASES,
  ) {}
  isSupported(): boolean {
    return this.scenario !== 'unsupported';
  }
  start(locale: string, h: SpeechHandlers): SpeechSession {
    this.startedWith.push(locale);
    const lang = (locale.slice(0, 2) in this.phrases ? locale.slice(0, 2) : 'en') as LangCode;
    const [p1, p2] = this.phrases[lang] as [string, string];
    let live = true;
    let ended = false;
    const end = () => {
      if (!live || ended) return;
      ended = true;
      h.onEnd();
    };
    const step = (fn: () => void) =>
      this.schedule(() => {
        if (live && !ended) fn();
      });
    switch (this.scenario) {
      case 'denied':
        step(() => {
          h.onError('not-allowed');
          end();
        });
        break;
      case 'no-speech':
        step(() => {
          h.onStart();
          h.onError('no-speech');
          end();
        });
        break;
      case 'error-mid':
        step(() => {
          h.onStart();
          h.onResult(p1, false);
          h.onResult(p1, true);
          h.onError('network');
          end();
        });
        break;
      case 'ok':
        step(() => {
          h.onStart();
          h.onResult(p1.slice(0, Math.ceil(p1.length / 2)), false);
          h.onResult(p1, true);
          h.onResult(p2, true);
        });
        break;
      default:
        step(() => {
          h.onError('unknown');
          end();
        });
    }
    return {
      stop: () => step(end),
      abort: () => {
        live = false;
      },
    };
  }
}

/**
 * Picks the adapter. `?speech=mock` (or `mock:denied`, `mock:error-mid`, `mock:no-speech`,
 * `mock:unsupported`) selects the deterministic mock so the flow can be demonstrated without a
 * microphone. Otherwise the real browser Web Speech API is used when present.
 */
export function createSpeechAdapter(
  search: string = globalThis.location?.search ?? '',
): SpeechAdapter {
  const v = new URLSearchParams(search).get('speech');
  if (v && (v === 'mock' || v.startsWith('mock:'))) {
    const scenario = (v.split(':')[1] ?? 'ok') as MockScenario;
    return new MockSpeechAdapter(scenario);
  }
  return new BrowserSpeechAdapter();
}
