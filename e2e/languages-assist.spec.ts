import { expect, test, type Page } from '@playwright/test';
import { clinicSignIn, composeToConfirm, confirmAndSend, startPatient } from './flows';
import { VIEWPORTS, axe, expectNoHorizontalScroll, simPost, snap, type Viewport } from './helpers';

/** Phase 4: language packs (sw, ar RTL), uncertain output, translation failure, assisted mode. */

async function checked(page: Page, vp: Viewport, name: string) {
  await expectNoHorizontalScroll(page);
  await snap(page, vp, name);
  const rec = await axe(page, vp, name);
  expect(rec.violations, `axe ${name} @ ${vp.name}: ${JSON.stringify(rec.violations)}`).toEqual([]);
}

async function clinicApprove(clinic: Page, ref: string) {
  await clinicSignIn(clinic);
  await clinic.getByTestId(`inbox-${ref}`).click();
  await clinic.getByTestId('start-review').click();
  await clinic.getByTestId('go-reply').click();
  await clinic.locator('#tpl').selectOption('follow-up-thursday');
  await clinic.getByTestId('approve-confirm').check();
  await clinic.getByTestId('approve-reply').click();
  await expect(clinic.getByTestId('approved-record')).toBeVisible({ timeout: 15_000 });
}

for (const vp of VIEWPORTS) {
  test.describe(`Languages and assistance @ ${vp.name}`, () => {
    test.beforeEach(async ({ request }) => {
      await request.post('/api/sim/reset');
    });

    test('Swahili journey: UNREVIEWED banner, translation flagged for review, reply in Swahili', async ({
      browser,
    }) => {
      test.setTimeout(120_000);
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const patient = await ctx.newPage();
      const clinic = await ctx.newPage();
      await startPatient(patient, { lang: 'sw', mode: 'self' });
      await expect(patient.getByTestId('unreviewed-banner')).toContainText('UNREVIEWED');
      await expect(patient.locator('html')).toHaveAttribute('lang', 'sw');
      await checked(patient, vp, '20-sw-B-home');
      await composeToConfirm(patient, {
        name: 'Noor (synthetic)',
        village: 'Ondera (synthetic)',
        details: 'Nataka miadi ya ufuatiliaji wiki ijayo.',
      });
      await expect(patient.getByTestId('translation-review')).toContainText(
        'I want a follow-up appointment next week.',
      );
      await expect(patient.getByTestId('original-text')).toHaveText(
        'Nataka miadi ya ufuatiliaji wiki ijayo.',
      );
      await checked(patient, vp, '21-sw-E-confirm-translation-needs-review');
      const ref = await confirmAndSend(patient);
      await checked(patient, vp, '22-sw-G-receipt');

      await simPost(patient, 'advance', { ticks: 60 });
      await clinicSignIn(clinic);
      await clinic.getByTestId(`inbox-${ref}`).click();
      await expect(clinic.getByTestId('clinic-original')).toHaveText(
        'Nataka miadi ya ufuatiliaji wiki ijayo.',
      );
      await expect(clinic.getByTestId('clinic-translation')).toContainText('needs review');
      await checked(clinic, vp, '23-sw-clinic-case-original-and-mock-translation');
      await clinicApprove(clinic, ref);

      await simPost(patient, 'advance', { ticks: 200 });
      await patient.getByTestId('open-reply').click({ timeout: 20_000 });
      await expect(patient.getByTestId('reply-text')).toContainText('Alhamisi');
      await expect(patient.getByTestId('reply-translation-note')).toContainText(
        'Please come to the clinic on Thursday',
      );
      await checked(patient, vp, '24-sw-H-reply-in-swahili-needs-review');
      await ctx.close();
    });

    test('Arabic journey: RTL by layout direction, not string reversal', async ({ browser }) => {
      test.setTimeout(120_000);
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const patient = await ctx.newPage();
      await patient.goto('/');
      await patient.getByTestId('lang-ar').click();
      await expect(patient.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(patient.getByTestId('patient-root')).toHaveAttribute('dir', 'rtl');
      await checked(patient, vp, '25-ar-A-language-rtl');
      await patient.getByTestId('mode-self').click();
      await composeToConfirm(patient, {
        name: 'نور (وهمي)',
        details: 'أحتاج إلى موعد متابعة الأسبوع القادم',
      });
      // stored/displayed text is the logical string; direction comes from the dir attribute
      await expect(patient.getByTestId('original-text')).toHaveText(
        'أحتاج إلى موعد متابعة الأسبوع القادم',
      );
      await expect(patient.getByTestId('original-text')).toHaveAttribute('dir', 'rtl');
      await checked(patient, vp, '26-ar-E-confirm-rtl');
      await confirmAndSend(patient);
      await checked(patient, vp, '27-ar-G-receipt-rtl');
      await ctx.close();
    });

    test('uncertain output is surfaced but never blocks plain text', async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const patient = await ctx.newPage();
      const clinic = await ctx.newPage();
      await startPatient(patient, { lang: 'en', mode: 'self' });
      await composeToConfirm(patient, {
        name: 'Noor (synthetic)',
        details: 'Please see my child soon about the fever',
      });
      const uncertain = patient.locator('[data-testid="readback"] [data-status="uncertain"]');
      expect(await uncertain.count()).toBeGreaterThanOrEqual(2); // vague timing + other person
      await expect(patient.getByTestId('readback')).toContainText('Please check');
      await checked(patient, vp, '28-E-uncertain-highlighted');
      await expect(patient.getByTestId('confirm-right')).toBeEnabled(); // not blocked
      const ref = await confirmAndSend(patient);
      await simPost(patient, 'advance', { ticks: 60 });
      await clinicSignIn(clinic);
      await clinic.getByTestId(`inbox-${ref}`).click();
      await expect(clinic.getByTestId('clinic-original')).toHaveText(
        'Please see my child soon about the fever',
      );
      expect(
        await clinic.locator('[data-testid="draft-summary"] [data-status="uncertain"]').count(),
      ).toBeGreaterThanOrEqual(2);
      await ctx.close();
    });

    test('translation unavailable: original preserved, review flag shown, reply shows clinic wording', async ({
      browser,
    }) => {
      test.setTimeout(120_000);
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const patient = await ctx.newPage();
      const clinic = await ctx.newPage();
      await patient.goto('/');
      await simPost(patient, 'config', { translationAvailable: false });
      await startPatient(patient, { lang: 'sw', mode: 'self' });
      await composeToConfirm(patient, {
        name: 'Noor (synthetic)',
        details: 'Nataka miadi ya ufuatiliaji wiki ijayo.',
      });
      await expect(patient.getByTestId('translation-review')).toBeVisible();
      await checked(patient, vp, '29-sw-E-translation-unavailable');
      const ref = await confirmAndSend(patient);
      await simPost(patient, 'advance', { ticks: 60 });
      await clinicSignIn(clinic);
      await clinic.getByTestId(`inbox-${ref}`).click();
      await expect(clinic.getByTestId('clinic-original')).toHaveText(
        'Nataka miadi ya ufuatiliaji wiki ijayo.',
      );
      await expect(clinic.getByTestId('clinic-translation')).toContainText(
        'Translation unavailable',
      );
      await checked(clinic, vp, '30-clinic-translation-unavailable');
      await clinicApprove(clinic, ref);
      await simPost(patient, 'advance', { ticks: 200 });
      await patient.getByTestId('open-reply').click({ timeout: 20_000 });
      await expect(patient.getByTestId('reply-text')).toContainText('Please come to the clinic');
      await expect(patient.getByTestId('reply-translation-note')).toContainText('Hakuna tafsiri');
      await checked(patient, vp, '31-sw-H-reply-untranslated-fallback');
      await simPost(patient, 'config', { translationAvailable: true });
      await ctx.close();
    });

    test('assisted mode: patient switching never carries previous text, secrets or session', async ({
      browser,
    }) => {
      test.setTimeout(120_000);
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const page = await ctx.newPage();
      await startPatient(page, { lang: 'en', mode: 'worker', worker: 'Grace (synthetic)' });
      await expect(page.getByTestId('session-bar')).toContainText('Grace (synthetic)');
      // Patient A: submit
      await composeToConfirm(page, {
        name: 'Patient A (synthetic)',
        details: 'A-PRIVATE-TEXT-111 follow-up next week',
      });
      const refA = await confirmAndSend(page);
      await checked(page, vp, '32-assisted-G-receipt-patient-A');
      // Patient A: second draft typed but never sent
      await page.getByTestId('finish-lock').isVisible();
      // switch patient (clears form, drafts, cases, secrets)
      await page.getByTestId('switch-patient').click();
      await expect(page.getByTestId('patient-root')).toHaveAttribute('data-screen', 'lang');
      const dump = await page.evaluate(() =>
        JSON.stringify({
          local: { ...window.localStorage },
          session: { ...window.sessionStorage },
          body: document.body.innerText,
        }),
      );
      expect(dump).not.toContain('A-PRIVATE-TEXT-111');
      expect(dump).not.toContain('Patient A');
      expect(dump).not.toContain(refA);
      expect(dump).toContain('Grace (synthetic)'); // worker identity kept, patient data not
      // Patient B starts fresh: empty form, no cases
      await page.getByTestId('lang-en').click();
      await page.getByTestId('mode-self').isVisible();
      await page.getByTestId('mode-worker').click();
      await page.locator('#worker').fill('Grace (synthetic)');
      await page.getByTestId('start-worker').click();
      await page.getByTestId('check-request').click();
      await expect(page.getByTestId('check-none')).toBeVisible();
      await expect(page.locator('body')).not.toContainText(refA);
      // Patient A's reference alone is rejected
      await page.locator('#ref').fill(refA);
      await page.getByRole('button', { name: 'Open', exact: true }).click();
      await expect(page.getByTestId('ref-rejected')).toBeVisible();
      await checked(page, vp, '33-assisted-check-reference-rejected');
      await page.getByTestId('back').click();
      await page.getByTestId('ask-clinic').click();
      await page.getByTestId('type-follow_up').click();
      await expect(page.locator('#details')).toHaveValue('');
      await expect(page.locator('#name')).toHaveValue('');
      // unsent draft is also wiped by switching
      await page.locator('#details').fill('B-DRAFT-TEXT-222');
      await page.getByTestId('switch-patient').click();
      const dump2 = await page.evaluate(() =>
        JSON.stringify({
          local: { ...window.localStorage },
          session: { ...window.sessionStorage },
        }),
      );
      expect(dump2).not.toContain('B-DRAFT-TEXT-222');
      await ctx.close();
    });

    test('assisted reading is recorded explicitly and shown separately from arrival', async ({
      browser,
    }) => {
      test.setTimeout(120_000);
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const patient = await ctx.newPage();
      const clinic = await ctx.newPage();
      await startPatient(patient, { lang: 'en', mode: 'worker', worker: 'Grace (synthetic)' });
      await composeToConfirm(patient, {
        name: 'Noor (synthetic)',
        details: 'I need a follow-up appointment next week.',
      });
      const ref = await confirmAndSend(patient);
      await simPost(patient, 'advance', { ticks: 60 });
      await clinicApprove(clinic, ref);
      await simPost(patient, 'advance', { ticks: 200 });
      await patient.getByTestId('open-reply').click({ timeout: 20_000 });
      await expect(patient.getByTestId('opened-state')).toContainText('Not opened yet');
      await patient.getByTestId('assisted-reading').check();
      await checked(patient, vp, '34-assisted-H-record-assisted-reading');
      await patient.getByTestId('seen').click();
      await expect(patient.getByTestId('opened-state')).toContainText('Opened by the patient', {
        timeout: 15_000,
      });
      await expect(patient.getByTestId('patient-root')).toContainText(
        'A health worker read this reply to the patient',
      );
      await ctx.close();
    });
  });
}
