import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { clinicSignIn, confirmAndSend, startPatient } from './flows';
import { VIEWPORTS, axe, expectNoHorizontalScroll, simPost, snap, type Viewport } from './helpers';

/**
 * Voice input (speech-to-text). The REAL browser adapter is exercised against a scripted FAKE of
 * the Web Speech API (injected before page load), so these tests are deterministic and need no
 * microphone. They say nothing about real-browser recognition accuracy (UNKNOWN).
 */

type Scenario = 'ok' | 'denied' | 'error-mid' | 'unsupported';

async function installFakeSpeech(page: Page | BrowserContext, scenario: Scenario) {
  await page.addInitScript((sc: Scenario) => {
    const w = window as unknown as Record<string, unknown>;
    w.__speech = { langs: [] as string[], aborted: 0 };
    if (sc === 'unsupported') {
      Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true });
      Object.defineProperty(window, 'webkitSpeechRecognition', {
        value: undefined,
        configurable: true,
      });
      return;
    }
    const PHRASES: Record<string, string[]> = {
      en: ['I need a follow-up appointment', 'next week. My medicine has run out.'],
      sw: ['Ninahitaji miadi ya ufuatiliaji', 'wiki ijayo. Dawa yangu imeisha.'],
      ar: ['أحتاج إلى موعد متابعة', 'الأسبوع القادم. انتهى دوائي.'],
    };
    class Fake {
      lang = '';
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      onstart: (() => void) | null = null;
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: { error?: string }) => void) | null = null;
      onend: (() => void) | null = null;
      private ended = false;
      private end() {
        if (this.ended) return;
        this.ended = true;
        this.onend?.();
      }
      private emit(text: string, isFinal: boolean) {
        this.onresult?.({ resultIndex: 0, results: [{ isFinal, 0: { transcript: text } }] });
      }
      start() {
        (w.__speech as { langs: string[] }).langs.push(this.lang);
        const p = PHRASES[this.lang.slice(0, 2)] ?? PHRASES.en!;
        if (sc === 'denied') {
          setTimeout(() => {
            this.onerror?.({ error: 'not-allowed' });
            this.end();
          }, 30);
          return;
        }
        setTimeout(() => this.onstart?.(), 30);
        setTimeout(() => this.emit(p[0]!.slice(0, 8), false), 60);
        setTimeout(() => this.emit(p[0]!, true), 90);
        if (sc === 'error-mid') {
          setTimeout(() => {
            this.onerror?.({ error: 'network' });
            this.end();
          }, 120);
        } else {
          setTimeout(() => this.emit(' ' + p[1]!, true), 120);
        }
      }
      stop() {
        setTimeout(() => this.end(), 20);
      }
      abort() {
        (w.__speech as { aborted: number }).aborted++;
      }
    }
    Object.defineProperty(window, 'SpeechRecognition', { value: Fake, configurable: true });
    Object.defineProperty(window, 'webkitSpeechRecognition', { value: Fake, configurable: true });
  }, scenario);
}

async function checked(page: Page, vp: Viewport, name: string) {
  await expectNoHorizontalScroll(page);
  await snap(page, vp, name);
  const rec = await axe(page, vp, name);
  expect(rec.violations, `axe ${name} @ ${vp.name}: ${JSON.stringify(rec.violations)}`).toEqual([]);
}

async function toDetails(page: Page, lang: 'en' | 'sw' | 'ar' = 'en') {
  await startPatient(page, { lang, mode: 'self' });
  await page.getByTestId('ask-clinic').click();
  await page.getByTestId('type-follow_up').click();
  await expect(page.getByTestId('patient-root')).toHaveAttribute('data-screen', 'details');
}

const screenIs = (page: Page, s: string) =>
  expect(page.getByTestId('patient-root')).toHaveAttribute('data-screen', s);

for (const vp of VIEWPORTS) {
  test.describe(`Voice input @ ${vp.name}`, () => {
    test.beforeEach(async ({ request }) => {
      await request.post('/api/sim/reset');
    });
    const open = async (browser: Browser, scenario: Scenario) => {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      await installFakeSpeech(ctx, scenario);
      return { ctx, page: await ctx.newPage() };
    };

    test('supported: consent first, transcript goes into the editable box, flagged on confirm, reaches the clinic as a flag', async ({
      browser,
    }) => {
      test.setTimeout(120_000);
      const { ctx, page } = await open(browser, 'ok');
      await toDetails(page);
      await checked(page, vp, '50-voice-D-ready');
      await expect(page.getByTestId('voice-quality')).toContainText('can make mistakes');

      // First use: consent line BEFORE the microphone is touched.
      await page.getByTestId('voice-start').click();
      await expect(page.getByTestId('voice-consent')).toContainText('another company');
      await expect(page.getByTestId('voice-consent')).toContainText(
        'do not record or keep any audio',
      );
      expect(
        await page.evaluate(
          () => (window as never as { __speech: { langs: string[] } }).__speech.langs,
        ),
      ).toEqual([]);
      await checked(page, vp, '51-voice-D-consent');
      await page.getByTestId('voice-consent-continue').click();

      await expect(page.getByTestId('voice-status')).toContainText('Listening');
      await expect(page.getByTestId('voice-stop')).toBeFocused();
      await expect(page.locator('#details')).toHaveValue(/follow-up appointment/);
      await checked(page, vp, '52-voice-D-listening');
      await page.getByTestId('voice-stop').click();
      await expect(page.getByTestId('voice-status')).toContainText('Stopped');
      await expect(page.getByTestId('voice-status')).toContainText('Please check it');
      await expect(page.locator('#details')).toHaveValue(
        'I need a follow-up appointment next week. My medicine has run out.',
      );
      // Never auto-submitted.
      await screenIs(page, 'details');
      const langs = await page.evaluate(
        () => (window as never as { __speech: { langs: string[] } }).__speech.langs,
      );
      expect(langs).toEqual(['en-US']);

      // Editable: the patient corrects it by typing.
      await page
        .locator('#details')
        .fill('I need a follow-up appointment next week. My medicine has run out. Thank you.');
      await checked(page, vp, '53-voice-D-transcript-added-and-edited');

      // Consent is not asked again in this session.
      await page.getByTestId('voice-start').click();
      await expect(page.getByTestId('voice-consent')).toHaveCount(0);
      await page.getByTestId('voice-stop').click();
      await expect(page.getByTestId('voice-status')).toContainText('Stopped');
      await page
        .locator('#details')
        .fill('I need a follow-up appointment next week. My medicine has run out. Thank you.');

      await page.getByTestId('details-next').click();
      await screenIs(page, 'confirm');
      await expect(page.getByTestId('voice-flag')).toContainText(
        'Entered by voice - check it is correct',
      );
      await expect(page.getByTestId('voice-flag')).toContainText(
        'You changed the text after speaking',
      );
      // The original transcript is kept (recognized phrases, before the edit).
      await expect(page.getByTestId('voice-original')).toContainText(
        'I need a follow-up appointment next week.',
      );
      await expect(page.getByTestId('voice-original')).not.toContainText('Thank you');
      await expect(page.getByTestId('original-text')).toContainText('Thank you');
      await checked(page, vp, '54-voice-E-confirm-flags-voice-text');

      const ref = await confirmAndSend(page);
      await simPost(page, 'advance', { ticks: 60 });
      const clinic = await ctx.newPage();
      await clinicSignIn(clinic);
      await clinic.getByTestId(`inbox-${ref}`).click();
      await expect(clinic.getByText('started as speech-to-text')).toBeVisible();
      await ctx.close();
    });

    test('keyboard operable, 48px targets, announcements in live regions', async ({ browser }) => {
      const { ctx, page } = await open(browser, 'ok');
      await toDetails(page);
      const box = await page.getByTestId('voice-start').boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(48);
      expect(box!.width).toBeGreaterThanOrEqual(48);
      await expect(page.getByTestId('voice-status')).toHaveAttribute('role', 'status');
      await expect(page.getByTestId('voice-error-slot')).toHaveAttribute('role', 'alert');
      await page.getByTestId('voice-start').focus();
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('voice-consent-continue')).toBeFocused();
      const c = await page.getByTestId('voice-consent-continue').boundingBox();
      expect(c!.height).toBeGreaterThanOrEqual(48);
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('voice-status')).toContainText('Listening');
      await page.keyboard.press('Enter'); // focus stays on the same button, now "Stop"
      await expect(page.getByTestId('voice-status')).toContainText('Stopped');
      await ctx.close();
    });

    test('declining consent leaves typing fully working (no microphone use)', async ({
      browser,
    }) => {
      const { ctx, page } = await open(browser, 'ok');
      await toDetails(page);
      await page.getByTestId('voice-start').click();
      await page.getByTestId('voice-consent-cancel').click();
      await expect(page.getByTestId('voice-consent')).toHaveCount(0);
      await expect(page.getByTestId('voice-start')).toBeFocused();
      expect(
        await page.evaluate(
          () => (window as never as { __speech: { langs: string[] } }).__speech.langs,
        ),
      ).toEqual([]);
      await page.locator('#details').fill('I need a follow-up appointment.');
      await page.getByTestId('details-next').click();
      await screenIs(page, 'confirm');
      await expect(page.getByTestId('voice-flag')).toHaveCount(0);
      await ctx.close();
    });

    test('unsupported browser: plain message, typing works, no voice flag', async ({ browser }) => {
      const { ctx, page } = await open(browser, 'unsupported');
      await toDetails(page);
      await expect(page.getByTestId('speak-unavailable')).toContainText('not available');
      await expect(page.getByTestId('voice-start')).toHaveCount(0);
      await checked(page, vp, '55-voice-D-unsupported-fallback');
      await page.locator('#details').fill('I need a follow-up appointment next week.');
      await page.getByTestId('details-next').click();
      await screenIs(page, 'confirm');
      await expect(page.getByTestId('voice-flag')).toHaveCount(0);
      await ctx.close();
    });

    test('permission denied: clear message, nothing added, typing continues', async ({
      browser,
    }) => {
      const { ctx, page } = await open(browser, 'denied');
      await toDetails(page);
      await page.getByTestId('voice-start').click();
      await page.getByTestId('voice-consent-continue').click();
      await expect(page.getByTestId('voice-error')).toContainText('microphone is not allowed');
      await expect(page.getByTestId('voice-error')).toHaveAttribute('data-code', 'not-allowed');
      await expect(page.locator('#details')).toHaveValue('');
      await checked(page, vp, '56-voice-D-permission-denied');
      await page.locator('#details').fill('I need a follow-up appointment next week.');
      await page.getByTestId('details-next').click();
      await screenIs(page, 'confirm');
      await expect(page.getByTestId('voice-flag')).toHaveCount(0);
      await ctx.close();
    });

    test('error mid-capture: what was already heard is kept and flagged, user can continue', async ({
      browser,
    }) => {
      const { ctx, page } = await open(browser, 'error-mid');
      await toDetails(page);
      await page.getByTestId('voice-start').click();
      await page.getByTestId('voice-consent-continue').click();
      await expect(page.getByTestId('voice-error')).toContainText('lost its connection');
      await expect(page.locator('#details')).toHaveValue('I need a follow-up appointment');
      await expect(page.getByTestId('voice-start')).toBeEnabled();
      await checked(page, vp, '57-voice-D-error-mid-capture');
      await page.locator('#details').fill('I need a follow-up appointment next week.');
      await page.getByTestId('details-next').click();
      await screenIs(page, 'confirm');
      await expect(page.getByTestId('voice-flag')).toBeVisible();
      await expect(page.getByTestId('voice-original')).toHaveText('I need a follow-up appointment');
      await ctx.close();
    });

    test('clearing the box removes the voice flag (typed text is not labelled as voice)', async ({
      browser,
    }) => {
      const { ctx, page } = await open(browser, 'ok');
      await toDetails(page);
      await page.getByTestId('voice-start').click();
      await page.getByTestId('voice-consent-continue').click();
      await expect(page.locator('#details')).toHaveValue(/medicine has run out/);
      await page.getByTestId('voice-stop').click();
      await page.locator('#details').fill('');
      await page.locator('#details').fill('Typed instead: I need an appointment.');
      await page.getByTestId('details-next').click();
      await screenIs(page, 'confirm');
      await expect(page.getByTestId('voice-flag')).toHaveCount(0);
      await ctx.close();
    });

    test('Arabic: recognition locale ar-SA, RTL layout, flag and original shown in Arabic', async ({
      browser,
    }) => {
      const { ctx, page } = await open(browser, 'ok');
      await toDetails(page, 'ar');
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByTestId('voice-quality')).toContainText('غير مُتحقَّق');
      await page.getByTestId('voice-start').click();
      await expect(page.getByTestId('voice-consent')).toContainText('لا نسجّل الصوت');
      await checked(page, vp, '58-ar-voice-D-consent-rtl');
      await page.getByTestId('voice-consent-continue').click();
      await expect(page.getByTestId('voice-status')).toContainText('نحن نستمع');
      await page.getByTestId('voice-stop').click();
      await expect(page.locator('#details')).toHaveValue(
        'أحتاج إلى موعد متابعة الأسبوع القادم. انتهى دوائي.',
      );
      expect(
        await page.evaluate(
          () => (window as never as { __speech: { langs: string[] } }).__speech.langs,
        ),
      ).toEqual(['ar-SA']);
      await checked(page, vp, '59-ar-voice-D-transcript-rtl');
      await page.getByTestId('details-next').click();
      await screenIs(page, 'confirm');
      await expect(page.getByTestId('voice-flag')).toContainText('أُدخل بالصوت - تأكد من صحته');
      await expect(page.getByTestId('voice-original')).toHaveAttribute('dir', 'rtl');
      await checked(page, vp, '60-ar-voice-E-confirm-flag-rtl');
      await ctx.close();
    });

    test('Swahili: recognition locale sw-KE (quality UNVERIFIED, stated in the UI)', async ({
      browser,
    }) => {
      const { ctx, page } = await open(browser, 'ok');
      await toDetails(page, 'sw');
      await page.getByTestId('voice-start').click();
      await page.getByTestId('voice-consent-continue').click();
      await expect(page.locator('#details')).toHaveValue(/Dawa yangu imeisha/);
      await page.getByTestId('voice-stop').click();
      expect(
        await page.evaluate(
          () => (window as never as { __speech: { langs: string[] } }).__speech.langs,
        ),
      ).toEqual(['sw-KE']);
      await expect(page.getByTestId('voice-quality')).toContainText('haijathibitishwa');
      await ctx.close();
    });

    // 200% text is only meaningful at the narrow viewport.
    if (vp.name === 'mobile-320')
      test('200% text at 320px keeps the voice controls usable', async ({ browser }) => {
        const { ctx, page } = await open(browser, 'ok');
        await toDetails(page);
        await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
        await page.getByTestId('voice-start').click();
        await expectNoHorizontalScroll(page);
        await expect(page.getByTestId('voice-consent-continue')).toBeVisible();
        await ctx.close();
      });
  });
}
