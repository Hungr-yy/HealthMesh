import { expect, test, type Page } from '@playwright/test';
import { clinicSignIn, composeToConfirm, confirmAndSend, startPatient } from './flows';
import { VIEWPORTS, axe, expectNoHorizontalScroll, simPost, snap, type Viewport } from './helpers';

/** Stage A product-spec UI: clarification, coverage/overdue, handover, closure, admin, matrices. */

const T = {
  clinician: 'demo-token-clinician-amina',
  coordinator: 'demo-token-coordinator-juma',
  admin: 'demo-token-admin-zawadi',
};

async function checked(page: Page, vp: Viewport, name: string) {
  await expectNoHorizontalScroll(page);
  await snap(page, vp, name);
  const rec = await axe(page, vp, name);
  expect(rec.violations, `axe ${name} @ ${vp.name}: ${JSON.stringify(rec.violations)}`).toEqual([]);
}

for (const vp of VIEWPORTS) {
  test.describe(`Stage A: clarification, coverage, administration @ ${vp.name}`, () => {
    test.beforeEach(async ({ request }) => {
      await request.post('/api/sim/reset');
    });

    test('clarification question, linked answer, conversation; coverage, overdue, handover and closure', async ({
      browser,
    }) => {
      test.setTimeout(180_000);
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const patient = await ctx.newPage();
      const clinic = await ctx.newPage();
      const adv = (n: number) => simPost(patient, 'advance', { ticks: n });

      await startPatient(patient, { lang: 'en', mode: 'self' });
      await composeToConfirm(patient, {
        name: 'Noor (synthetic)',
        details: 'My medicine has run out.',
      });
      const ref = await confirmAndSend(patient);
      await adv(80);

      // Clinic asks an approved clarification question.
      await clinicSignIn(clinic, T.clinician);
      await clinic.getByTestId(`inbox-${ref}`).click();
      await clinic.getByTestId('start-review').click();
      await clinic.getByTestId('go-reply').click();
      await clinic.getByTestId('kind-clarification').check();
      await clinic.locator('#reply-text').fill('Which medicine has run out?');
      await clinic.getByTestId('approve-confirm').check();
      await clinic.getByTestId('approve-reply').click();
      await expect(clinic.getByTestId('approved-record')).toContainText('question');
      await checked(clinic, vp, '90-clinic-clarification-question-approved');

      // Patient sees the question and answers with a linked follow-up in the SAME case.
      await adv(200);
      await patient.reload();
      await patient.getByTestId('open-reply').click({ timeout: 20_000 });
      await expect(patient.getByTestId('clarification-banner')).toContainText(
        'The clinic has a question for you',
      );
      await checked(patient, vp, '91-patient-clinic-question');
      await patient.getByTestId('answer-question').click();
      await patient.locator('#details').fill('The blue tablets for my blood pressure.');
      await patient.getByTestId('details-next').click();
      await patient.getByTestId('confirm-right').click();
      await patient.getByTestId('consent1').check();
      await patient.getByTestId('consent2').check();
      await patient.getByTestId('send-request').click();
      await expect(patient.getByTestId('case-ref')).toHaveText(ref); // same case
      await adv(120);

      await clinic.reload();
      await clinic.locator('#staff-select').selectOption(T.clinician);
      await clinic.getByTestId(`inbox-${ref}`).click();
      const conv = clinic.getByTestId('conversation');
      await expect(conv).toContainText('Patient message');
      await expect(conv).toContainText('Clinic question (approved)');
      await expect(conv).toContainText('answers the clinic question above');
      await expect(conv).toContainText('blue tablets');
      await expect(clinic.getByTestId('consent-record')).toContainText('consent-v1');
      await checked(clinic, vp, '92-clinic-conversation-linked-answer');

      // Coordinator: staffing statement, overdue after the review window, handover, closure.
      await clinicSignIn(clinic, T.coordinator);
      await clinic.getByTestId('coverage-panel').locator('summary').click();
      await expect(clinic.getByTestId('coverage-label')).toContainText('No staffing statement');
      await clinic.getByTestId('coverage-staffed').uncheck();
      await clinic.locator('#cov-note').fill('Power cut at the clinic; handing over');
      await clinic.getByTestId('coverage-save').click();
      await expect(clinic.getByTestId('coverage-label')).toContainText('NOT staffed');
      await adv(25 * 60);
      await clinic.reload();
      await clinic.locator('#staff-select').selectOption(T.coordinator);
      await expect(clinic.getByTestId(`overdue-${ref}`)).toBeVisible({ timeout: 15_000 });
      await clinic.getByTestId('coverage-panel').locator('summary').click();
      await expect(clinic.getByTestId('overdue-list')).toContainText(ref);
      await expect(clinic.getByTestId('coverage-label')).toContainText('stale statement');
      await checked(clinic, vp, '93-clinic-coverage-overdue-stale-statement');

      await clinic.getByTestId(`inbox-${ref}`).click();
      await clinic.getByTestId('handover-panel').locator('summary').click();
      await clinic.locator('#ho-note').fill('Shift change');
      await clinic.getByTestId('handover').click();
      await clinic.getByTestId('coverage-panel').locator('summary').click();
      await expect(clinic.getByTestId('handover-list')).toContainText('handed over to Dr. Baraka');

      await clinic.getByTestId('close-panel').locator('summary').click();
      await expect(clinic.getByTestId('close-case')).toBeDisabled(); // outcome is required
      await clinic.locator('#close-outcome').selectOption('follow_up_needed');
      await clinic.getByTestId('close-case').click();
      await expect(clinic.getByTestId('closed-record')).toContainText(
        'does not state any health outcome',
      );
      await checked(clinic, vp, '94-clinic-handover-and-closed-with-outcome');
      await ctx.close();
    });

    test('administration: settings change is attributed in the audit trail; permission matrix; no content', async ({
      browser,
    }) => {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const admin = await ctx.newPage();
      await admin.goto('/#/admin');
      await admin.reload();
      await expect(admin.getByTestId('admin-error')).toContainText('Sign in');
      await admin.locator('#staff-select').selectOption(T.admin);
      await expect(admin.getByTestId('admin-config')).toContainText('consent-v1');
      await admin.locator('#cfg-consent').fill('consent-v2');
      await admin.getByTestId('admin-save').click();
      await expect(admin.getByTestId('admin-config')).toContainText('consent-v2');
      await expect(admin.getByTestId('audit-table')).toContainText('config changed');
      await expect(admin.getByTestId('permissions-table')).toContainText('case.approve_reply');
      await checked(admin, vp, '95-admin-config-audit-permissions');
      // a clinician cannot use admin settings
      await admin.locator('#staff-select').selectOption(T.clinician);
      await expect(admin.getByTestId('admin-error')).toContainText(/not permitted/i);
      await ctx.close();
    });

    test('capability matrix and language capability matrix are visible and honest', async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/#/capabilities');
      await expect(page.getByTestId('capabilities-table')).toContainText('Voice input');
      await expect(page.getByTestId('capabilities-table')).toContainText('Not built');
      await expect(page.getByTestId('language-matrix')).toContainText('UNREVIEWED');
      await expect(page.getByTestId('capabilities-root')).toContainText(
        'nothing has been evaluated with real users',
      );
      await checked(page, vp, '96-capability-matrix');
    });
  });
}
