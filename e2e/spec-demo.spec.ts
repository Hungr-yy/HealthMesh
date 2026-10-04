import { expect, test, type Page } from '@playwright/test';
import { clinicSignIn, composeToConfirm, startPatient } from './flows';
import { VIEWPORTS, axe, expectNoHorizontalScroll, simPost, snap, type Viewport } from './helpers';

/**
 * The scripted full demo from the product spec (section 15), end to end in a real browser against
 * the real service and the deterministic relay simulator. Everything is SIMULATED.
 *
 *  1. Noor confirms a follow-up request while the upstream is disconnected
 *  2. durable acceptance
 *  3. restart the local service (state replays from disk)
 *  4. restore the relay
 *  5. gateway and clinic acknowledgements are shown separately
 *  6. clinic compares original with the optional draft and approves
 *  7. interrupt the return path, restore it, retrieve the reply at the village
 *  8. inject a duplicate delivery -> one logical case
 *  9. operator view without patient content
 * 10. lock the shared device
 */

const TOKENS = {
  clinician: 'demo-token-clinician-amina',
  operator: 'demo-token-operator-ops',
};

async function checked(page: Page, vp: Viewport, name: string) {
  await expectNoHorizontalScroll(page);
  await snap(page, vp, name);
  const rec = await axe(page, vp, name);
  expect(rec.violations, `axe ${name} @ ${vp.name}: ${JSON.stringify(rec.violations)}`).toEqual([]);
}

async function staffPage(page: Page, hash: string, token: string) {
  await page.goto(`/${hash}`);
  await page.reload();
  await page.locator('#staff-select').selectOption(token);
}

for (const vp of VIEWPORTS) {
  test.describe(`Spec section 15 demo @ ${vp.name}`, () => {
    test.beforeEach(async ({ request }) => {
      await request.post('/api/sim/reset');
    });

    test('outage, restart, restore, separate gateway/clinic acks, approval, return-path interruption, duplicate -> one case, operator view, lock', async ({
      browser,
    }) => {
      test.setTimeout(240_000);
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const patient = await ctx.newPage();
      const clinic = await ctx.newPage();
      const operator = await ctx.newPage();
      const adv = (n: number) => simPost(patient, 'advance', { ticks: n });

      // 1-2. Upstream disconnected at the village: Noor still gets durable acceptance.
      await simPost(patient, 'link', { index: 0, up: false });
      await startPatient(patient, { lang: 'en', mode: 'self' });
      await composeToConfirm(patient, {
        name: 'Noor (synthetic)',
        village: 'Ondera (synthetic)',
        details: 'I need a follow-up appointment next week. My medicine has run out.',
      });
      await patient.getByTestId('confirm-right').click();
      await patient.getByTestId('consent1').check();
      await patient.getByTestId('consent2').check();
      await patient.getByTestId('send-request').click();
      await expect(patient.getByTestId('patient-root')).toHaveAttribute('data-screen', 'receipt');
      const ref = ((await patient.getByTestId('case-ref').textContent()) ?? '').trim();
      expect(ref).toMatch(/^NR-[A-Z0-9]{4}$/);
      await expect(patient.getByTestId('no-upstream')).toBeVisible({ timeout: 15_000 });
      await expect(patient.getByTestId('tracks')).toContainText('Waiting to send');
      await expect(patient.getByTestId('tracks')).not.toContainText('The clinic received it');
      await checked(patient, vp, '70-spec-1-accepted-while-upstream-down');

      // 3. Restart the local service: everything is replayed from the journal on disk.
      await simPost(patient, 'restart');
      await patient.reload();
      await expect(patient.getByTestId('case-ref')).toHaveText(ref, { timeout: 15_000 });
      await expect(patient.getByTestId('tracks')).toContainText('Waiting to send');
      await checked(patient, vp, '71-spec-2-after-service-restart-still-queued');

      // 4-5. Gateway upstream stays down; the relay chain comes back. The village learns the
      // GATEWAY has it, but not that the clinic does.
      await simPost(patient, 'link', { index: 3, up: false });
      await simPost(patient, 'link', { index: 0, up: true });
      await adv(90);
      await expect(patient.getByTestId('tracks')).toContainText('Reached the gateway', {
        timeout: 20_000,
      });
      await expect(patient.getByTestId('tracks')).not.toContainText('The clinic received it');
      await checked(patient, vp, '72-spec-3-gateway-ack-clinic-not-yet');

      await staffPage(operator, '#/operator', TOKENS.operator);
      await expect(operator.getByTestId('gateway-panel')).toBeVisible({ timeout: 15_000 });
      await expect(operator.getByTestId('gw-held')).toContainText('1');
      await expect(operator.getByTestId('gateway-panel')).toContainText(
        'Upstream side to the clinic: UNAVAILABLE',
      );
      await expect(operator.getByTestId('gateway-panel')).toContainText('Radio side: available');
      await checked(operator, vp, '73-spec-4-operator-gateway-holds-request');

      // 8. Inject a duplicate delivery (lost ack at the gateway->clinic hop), then restore upstream.
      await simPost(patient, 'config', {
        faults: [{ flowKind: 'request', hop: 3, attempt: 1, fault: 'lose_ack' }],
      });
      await simPost(patient, 'link', { index: 3, up: true });
      await adv(120);
      await clinicSignIn(clinic, TOKENS.clinician);
      await expect(clinic.getByTestId(`inbox-${ref}`)).toBeVisible({ timeout: 15_000 });
      await expect(clinic.locator('[data-testid^="inbox-NR-"]')).toHaveCount(1); // ONE logical case
      await expect(patient.getByTestId('tracks')).toContainText('The clinic received it', {
        timeout: 20_000,
      });
      await operator.reload();
      await operator.locator('#staff-select').selectOption(TOKENS.operator);
      await expect(operator.getByTestId('events-table')).toContainText('duplicate suppressed', {
        timeout: 15_000,
      });
      await expect(operator.getByTestId('gw-forwarded')).toContainText('1');
      await checked(operator, vp, '74-spec-5-duplicate-injected-one-case');

      // 6. Clinic compares the original with the optional draft summary and approves.
      await clinic.getByTestId(`inbox-${ref}`).click();
      await expect(clinic.getByTestId('clinic-original')).toContainText('follow-up appointment');
      await expect(clinic.getByTestId('case-pane')).toContainText(
        'Draft summary - verify against the original',
      );
      await checked(clinic, vp, '75-spec-6-clinic-original-and-draft');
      await clinic.getByTestId('claim').click();
      await clinic.getByTestId('start-review').click();
      // 7. Return path interrupted (ridge <-> valley) BEFORE the reply is approved.
      await simPost(patient, 'link', { index: 1, up: false });
      await clinic.getByTestId('go-reply').click();
      await clinic.locator('#tpl').selectOption('follow-up-thursday');
      await clinic.getByTestId('approve-confirm').check();
      await clinic.getByTestId('approve-reply').click();
      await expect(clinic.getByTestId('approved-record')).toBeVisible({ timeout: 15_000 });
      await checked(clinic, vp, '76-spec-7-reply-approved-by-clinician');

      await adv(150);
      await patient.reload();
      await expect(patient.getByTestId('open-reply')).toHaveCount(0);
      await operator.reload();
      await operator.locator('#staff-select').selectOption(TOKENS.operator);
      await expect(operator.getByTestId('gateway-panel')).toBeVisible({ timeout: 15_000 });
      await expect(operator.getByTestId('gw-sent')).toContainText('1 / 0'); // sent to relay, not delivered
      await checked(operator, vp, '77-spec-8-return-path-interrupted');

      await simPost(patient, 'link', { index: 1, up: true });
      await adv(200);
      await patient.reload();
      await patient.getByTestId('open-reply').click({ timeout: 20_000 });
      await expect(patient.getByTestId('reply-text')).toContainText('Thursday morning');
      await expect(patient.getByTestId('arrived-state')).toBeVisible();
      await checked(patient, vp, '78-spec-9-reply-retrieved-at-village');
      await patient.getByTestId('seen').click();
      await expect(patient.getByTestId('opened-state')).toContainText('Opened by the patient');

      // 9. Operator view carries no patient content.
      await operator.reload();
      await operator.locator('#staff-select').selectOption(TOKENS.operator);
      await expect(operator.getByTestId('gateway-panel')).toBeVisible({ timeout: 15_000 });
      await expect(operator.getByTestId('gw-sent')).toContainText('0 / 1');
      const opText = await operator.getByTestId('operator-root').innerText();
      for (const forbidden of [
        'follow-up appointment',
        'medicine',
        'Noor (synthetic)',
        'Ondera (synthetic)',
        'Thursday',
      ])
        expect(opText).not.toContain(forbidden);
      await checked(operator, vp, '79-spec-10-operator-view-no-patient-content');

      // 10. Lock the shared device: content is hidden, a bare reference no longer opens the case.
      await patient.getByTestId('lock-device').click();
      await expect(patient.locator('body')).not.toContainText('Thursday morning');
      await expect(patient.locator('body')).not.toContainText('follow-up appointment');
      await checked(patient, vp, '80-spec-11-device-locked');
      await patient.reload();
      await expect(patient.getByTestId('case-ref')).toHaveCount(0);
      const lookup = await patient.request.get(`/api/node/cases/lookup?ref=${ref}`);
      expect(lookup.status()).toBe(401);
      await ctx.close();
    });
  });
}
