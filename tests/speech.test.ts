import { afterEach, describe, expect, it } from 'vitest';
import { decodeRequest, encodeRequest } from '../src/shared/codec';
import { NOOR_INPUT } from '../src/shared/fixtures';
import { PACKS } from '../src/shared/i18n';
import type { RequestInput } from '../src/shared/types';
import {
  BrowserSpeechAdapter,
  MOCK_PHRASES,
  MockSpeechAdapter,
  createSpeechAdapter,
  mapBrowserError,
  type SpeechErrorCode,
  type SpeechHandlers,
} from '../src/web/lib/speech';

const sync = (fn: () => void) => fn();

function recorder() {
  const log: string[] = [];
  const handlers: SpeechHandlers = {
    onStart: () => log.push('start'),
    onResult: (t, f) => log.push(`${f ? 'final' : 'interim'}:${t}`),
    onError: (c: SpeechErrorCode) => log.push(`error:${c}`),
    onEnd: () => log.push('end'),
  };
  return { log, handlers };
}

describe('MockSpeechAdapter (deterministic)', () => {
  it('ok: interim, then final phrases, ends only when stopped', () => {
    const a = new MockSpeechAdapter('ok', sync);
    const { log, handlers } = recorder();
    const s = a.start('en-US', handlers);
    expect(log).toEqual([
      'start',
      `interim:${MOCK_PHRASES.en[0]!.slice(0, Math.ceil(MOCK_PHRASES.en[0]!.length / 2))}`,
      `final:${MOCK_PHRASES.en[0]}`,
      `final:${MOCK_PHRASES.en[1]}`,
    ]);
    s.stop();
    expect(log.at(-1)).toBe('end');
  });

  it('is repeatable: same scenario gives the same event log', () => {
    const run = () => {
      const { log, handlers } = recorder();
      new MockSpeechAdapter('ok', sync).start('sw-KE', handlers).stop();
      return log;
    };
    expect(run()).toEqual(run());
  });

  it('picks phrases by the language of the locale (sw, ar)', () => {
    const a = new MockSpeechAdapter('ok', sync);
    const sw = recorder();
    a.start('sw-KE', sw.handlers);
    expect(sw.log).toContain(`final:${MOCK_PHRASES.sw[0]}`);
    const ar = recorder();
    a.start('ar-SA', ar.handlers);
    expect(ar.log).toContain(`final:${MOCK_PHRASES.ar[0]}`);
    expect(a.startedWith).toEqual(['sw-KE', 'ar-SA']);
  });

  it('denied, no-speech, error mid-capture, unsupported', () => {
    const d = recorder();
    new MockSpeechAdapter('denied', sync).start('en-US', d.handlers);
    expect(d.log).toEqual(['error:not-allowed', 'end']);

    const n = recorder();
    new MockSpeechAdapter('no-speech', sync).start('en-US', n.handlers);
    expect(n.log).toEqual(['start', 'error:no-speech', 'end']);

    const m = recorder();
    new MockSpeechAdapter('error-mid', sync).start('en-US', m.handlers);
    expect(m.log).toEqual([
      'start',
      `interim:${MOCK_PHRASES.en[0]}`,
      `final:${MOCK_PHRASES.en[0]}`,
      'error:network',
      'end',
    ]);

    expect(new MockSpeechAdapter('unsupported', sync).isSupported()).toBe(false);
  });

  it('abort() silences everything afterwards', () => {
    const queue: Array<() => void> = [];
    const a = new MockSpeechAdapter('ok', (fn) => void queue.push(fn));
    const { log, handlers } = recorder();
    const s = a.start('en-US', handlers);
    s.abort();
    queue.forEach((f) => f());
    expect(log).toEqual([]);
  });
});

describe('createSpeechAdapter', () => {
  it('selects the mock only when asked via ?speech=mock[:scenario]', () => {
    expect(createSpeechAdapter('')).toBeInstanceOf(BrowserSpeechAdapter);
    expect(createSpeechAdapter('?speech=mock')).toBeInstanceOf(MockSpeechAdapter);
    const denied = createSpeechAdapter('?speech=mock:denied');
    expect(denied).toBeInstanceOf(MockSpeechAdapter);
    expect(denied.isSupported()).toBe(true);
    expect(createSpeechAdapter('?speech=mock:unsupported').isSupported()).toBe(false);
    expect(createSpeechAdapter('?speech=other')).toBeInstanceOf(BrowserSpeechAdapter);
  });
});

describe('BrowserSpeechAdapter (feature detection and Web Speech API mapping)', () => {
  const g = globalThis as unknown as { window?: unknown };
  const original = g.window;
  afterEach(() => {
    if (original === undefined) delete g.window;
    else g.window = original;
  });

  class FakeRecognition {
    static last: FakeRecognition | null = null;
    lang = '';
    continuous = false;
    interimResults = false;
    maxAlternatives = 0;
    onstart: (() => void) | null = null;
    onresult: ((e: unknown) => void) | null = null;
    onerror: ((e: { error?: string }) => void) | null = null;
    onend: (() => void) | null = null;
    started = false;
    constructor() {
      FakeRecognition.last = this;
    }
    start() {
      this.started = true;
      this.onstart?.();
    }
    stop() {
      this.onend?.();
    }
    abort() {
      this.started = false;
    }
  }

  it('is unsupported without SpeechRecognition/webkitSpeechRecognition', () => {
    g.window = {};
    expect(new BrowserSpeechAdapter().isSupported()).toBe(false);
  });

  it('is supported with either constructor name', () => {
    g.window = { webkitSpeechRecognition: FakeRecognition };
    expect(new BrowserSpeechAdapter().isSupported()).toBe(true);
    g.window = { SpeechRecognition: FakeRecognition };
    expect(new BrowserSpeechAdapter().isSupported()).toBe(true);
  });

  it('sets the locale, separates interim from final results, and reports end', () => {
    g.window = { SpeechRecognition: FakeRecognition };
    const { log, handlers } = recorder();
    const s = new BrowserSpeechAdapter().start('ar-SA', handlers);
    const rec = FakeRecognition.last!;
    expect(rec.lang).toBe('ar-SA');
    expect(rec.continuous).toBe(true);
    expect(rec.interimResults).toBe(true);
    rec.onresult?.({
      resultIndex: 0,
      results: [
        { isFinal: true, 0: { transcript: ' مرحبا ' } },
        { isFinal: false, 0: { transcript: 'كيف' } },
      ],
    });
    s.stop();
    expect(log).toEqual(['start', 'final:مرحبا', 'interim:كيف', 'end']);
  });

  it('maps engine error names to plain categories', () => {
    expect(mapBrowserError('not-allowed')).toBe('not-allowed');
    expect(mapBrowserError('service-not-allowed')).toBe('not-allowed');
    expect(mapBrowserError('no-speech')).toBe('no-speech');
    expect(mapBrowserError('audio-capture')).toBe('audio-capture');
    expect(mapBrowserError('network')).toBe('network');
    expect(mapBrowserError('language-not-supported')).toBe('language-not-supported');
    expect(mapBrowserError('aborted')).toBe('unknown');
    expect(mapBrowserError(undefined)).toBe('unknown');
  });

  it('a constructor that throws becomes an error + end, never an exception', async () => {
    g.window = {
      SpeechRecognition: class {
        constructor() {
          throw new Error('boom');
        }
      },
    };
    const { log, handlers } = recorder();
    new BrowserSpeechAdapter().start('en-US', handlers);
    await Promise.resolve();
    expect(log).toEqual(['error:unknown', 'end']);
  });
});

describe('voice flag and language packs', () => {
  it('enteredByVoice survives the compact codec; absent stays absent', () => {
    const id = '123e4567-e89b-42d3-a456-426614174000';
    const voice: RequestInput = { ...NOOR_INPUT, enteredByVoice: true };
    expect(decodeRequest(encodeRequest(voice, id)).input.enteredByVoice).toBe(true);
    expect(decodeRequest(encodeRequest(NOOR_INPUT, id)).input.enteredByVoice).toBeUndefined();
  });

  it('each language pack declares its recognition locale', () => {
    expect(PACKS.en.speechLocale).toBe('en-US');
    expect(PACKS.sw.speechLocale).toBe('sw-KE');
    expect(PACKS.ar.speechLocale).toBe('ar-SA');
  });

  it('the voice flag wording is present in every pack', () => {
    for (const lang of ['en', 'sw', 'ar'] as const) {
      expect(PACKS[lang].voiceFlag.length).toBeGreaterThan(5);
      expect(PACKS[lang].voiceConsent.length).toBeGreaterThan(20);
    }
    expect(PACKS.en.voiceFlag).toBe('Entered by voice - check it is correct');
  });
});
