import { expect, test, type Page } from '@playwright/test';
import { VIEWPORTS, axe, expectNoHorizontalScroll, simPost, snap } from './helpers';

/**
 * The P0 "Noor" vertical flow against the REAL local service + relay simulator, in a real
 * (headless Chromium) browser, at 320px and desktop. Also captures screenshots and axe results.
 */
for (const vp of VIEWPORTS) {
  test(`Noor journey end to end @ ${vp.name}`, async ({ browser, request }) => {
    test.setTimeout(180_000);
    await request.post('/api/sim/reset');
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const patient = await ctx.newPage();
    const clinic = await ctx.newPage();
    const operator = await ctx.newPage();
    const adv = (n: number) => simPost(patient, 'advance', { ticks: n });
    const check = async (page: Page, name: string) => {
      await snap(page, vp, name);
      const rec = await axe(page, vp, name);
      expect(
        rec.violations,
        `axe violations on ${name} @ ${vp.name}: ${JSON.stringify(rec.violations)}`,
      ).toEqual([]);
    };

    // ---------------------------------------------------------------- A language / access
    await patient.goto('/');
    await expect(patient.getByTestId('sim-banner')).toBeVisible();
    await expect(patient.getByTestId('shared-device-note')).toBeVisible();
    await check(patient, '01-A-language-access');
    await patient.getByTestId('lang-en').click();
    await patient.getByTestId('mode-self').click();

    // ---------------------------------------------------------------- B home
    await expect(patient.getByTestId('delay-notice')).toBeVisible();
    await check(patient, '02-B-home');
    await patient.getByTestId('ask-clinic').click();

    // ---------------------------------------------------------------- C choose
    await expect(patient.getByTestId('step-indicator')).toHaveText('Step 1 of 4');
    await check(patient, '03-C-choose-request');
    await patient.getByTestId('type-follow_up').click();

    // ---------------------------------------------------------------- D details
    await patient.locator('#name').fill('Noor (synthetic)');
    await patient.locator('#village').fill('Ondera highlands (synthetic)');
    await patient
      .locator('#details')
      .fill('I need a follow-up appointment next week. My medicine has run out.');
    await check(patient, '04-D-details');
    await patient.getByTestId('details-next').click();

    // ---------------------------------------------------------------- E confirm understanding
    await expect(patient.getByTestId('readback')).toContainText('Not provided'); // contact
    await expect(patient.getByTestId('original-text')).toContainText('follow-up appointment');
    await check(patient, '05-E-confirm-understanding');
    await patient.getByTestId('confirm-right').click();

    // ---------------------------------------------------------------- F review & consent
    await expect(patient.getByTestId('send-request')).toBeDisabled();
    await patient.getByTestId('consent1').check();
    await patient.getByTestId('consent2').check();
    await check(patient, '06-F-review-consent');
    await patient.getByTestId('send-request').click();

    // ---------------------------------------------------------------- G receipt: honest first state
    const ref = await patient.getByTestId('case-ref').textContent();
    expect(ref).toMatch(/^NR-[A-Z0-9]{4}$/);
    await expect(patient.getByTestId('tracks')).toContainText('Waiting to send');
    await expect(patient.getByTestId('tracks')).not.toContainText('The clinic received it');
    await expectNoHorizontalScroll(patient);
    await check(patient, '07-G-receipt-waiting-to-send');

    // simulated power interruption: node reboots from disk, queued item recovered
    await simPost(patient, 'power-cut', { durationTicks: 15 });
    await adv(5);
    const st = await (await patient.request.get('/api/sim/state')).json();
    expect(st.nodeUp).toBe(false);
    await adv(12);
    const st2 = await (await patient.request.get('/api/sim/state')).json();
    expect(st2.nodeUp).toBe(true);
    expect(
      st2.nodeLog.some(
        (l: { kind: string; recoveredQueueItems?: number }) =>
          l.kind === 'power_restored' && l.recoveredQueueItems === 1,
      ),
    ).toBe(true);
    await expect(patient.getByTestId('tracks')).toContainText('Waiting to send', {
      timeout: 15_000,
    });

    // relays: first relay hands back an acknowledgement
    await adv(10);
    await expect(patient.getByTestId('tracks')).toContainText('Passed to the first relay', {
      timeout: 15_000,
    });
    await check(patient, '08-G-receipt-relaying');

    // clinic receives (clinic view) before the village device learns of it
    await adv(30);
    await clinic.goto('/#/clinic');
    await clinic.locator('#staff-select').selectOption('demo-token-clinician-amina');
    await expect(clinic.getByTestId(`inbox-${ref}`)).toBeVisible({ timeout: 15_000 });
    await check(clinic, '10-clinic-inbox');
    await clinic.getByTestId(`inbox-${ref}`).click();
    await expect(clinic.getByTestId('clinic-original')).toContainText('follow-up appointment');
    await expect(clinic.getByTestId('case-pane')).toContainText(
      'Draft summary - verify against the original',
    );
    await check(clinic, '11-clinic-case');

    // patient eventually learns gateway + clinic receipt via return acknowledgements
    await adv(60);
    await expect(patient.getByTestId('tracks')).toContainText('The clinic received it', {
      timeout: 15_000,
    });
    await expect(patient.getByTestId('tracks')).toContainText('Waiting for clinic review');
    await check(patient, '09-G-receipt-clinic-received');

    // ---------------------------------------------------------------- clinic: review, approve
    await clinic.getByTestId('claim').click();
    await clinic.getByTestId('start-review').click();
    await clinic.getByTestId('go-reply').click();
    await clinic.locator('#tpl').selectOption('follow-up-thursday');
    await clinic.getByTestId('save-draft').click();
    await expect(clinic.getByTestId('approve-reply')).toBeDisabled();
    await clinic.getByTestId('approve-confirm').check();
    await check(clinic, '12-clinic-reply-editor');
    await clinic.getByTestId('approve-reply').click();
    await expect(clinic.getByTestId('approved-record')).toBeVisible({ timeout: 15_000 });
    await check(clinic, '13-clinic-reply-approved');

    // approved but not yet arrived: patient has no reply
    await expect(patient.getByTestId('open-reply')).toHaveCount(0);

    // ---------------------------------------------------------------- operator (no patient content)
    await operator.goto('/#/operator');
    await operator.locator('#staff-select').selectOption('demo-token-operator-ops');
    await expect(operator.getByTestId('nodes-table')).toBeVisible({ timeout: 15_000 });
    const opText = await operator.getByTestId('operator-root').innerText();
    expect(opText).not.toContain('Noor');
    expect(opText).not.toContain('medicine');
    await check(operator, '14-operator-dashboard');

    // ---------------------------------------------------------------- H reply arrives
    await adv(60);
    await expect(patient.getByTestId('open-reply')).toBeVisible({ timeout: 15_000 });
    await check(patient, '15-G-receipt-reply-arrived');
    await patient.getByTestId('open-reply').click();
    await expect(patient.getByTestId('reply-text')).toContainText('Thursday morning');
    await expect(patient.getByTestId('arrived-state')).toContainText(
      'Reply arrived on this village device',
    );
    await expect(patient.getByTestId('opened-state')).toContainText('Not opened yet');
    await check(patient, '16-H-reply-arrived-not-opened');
    await patient.getByTestId('seen').click();
    await expect(patient.getByTestId('opened-state')).toContainText('Opened by the patient', {
      timeout: 15_000,
    });
    await check(patient, '17-H-reply-opened');

    // return delivery + patient action are tracked independently at the clinic
    await adv(60);
    await clinic.reload();
    await clinic.locator('#staff-select').selectOption('demo-token-clinician-amina');
    await clinic.getByTestId(`inbox-${ref}`).click();
    await expect(clinic.getByTestId('return-tracking')).toContainText(
      'confirmed by return acknowledgement',
      { timeout: 15_000 },
    );
    await expect(clinic.getByTestId('return-tracking')).toContainText(
      'Patient opened reply: confirmed',
    );

    // finish and lock hides content and clears the device
    await patient.getByTestId('finish').click();
    await expect(patient.getByTestId('patient-root')).toHaveAttribute('data-screen', 'done');
    await expect(patient.locator('body')).not.toContainText('Thursday morning');
    await check(patient, '18-done-device-cleared');
    await ctx.close();
  });
}
