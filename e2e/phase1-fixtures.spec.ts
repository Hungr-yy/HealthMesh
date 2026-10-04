import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, kbActivate, kbToggle, screen, tabTo } from './helpers';

/** Phase 1 gate: static flows against synthetic fixtures, keyboard-only, at 320px. */
test.describe('Phase 1: static flows (fixture client)', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test('Noor journey A-H is fully keyboard operable at 320px with no horizontal scroll', async ({
    page,
  }) => {
    await page.goto('/?fixtures=1');
    await expect(page.getByTestId('sim-banner')).toBeVisible();

    // A language / access
    await expect(page.getByTestId('shared-device-note')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await kbActivate(page, '[data-testid="lang-en"]');
    await kbActivate(page, '[data-testid="mode-self"]');

    // B home
    expect(await screen(page)).toBe('home');
    await expect(page.getByTestId('delay-notice')).toBeVisible();
    await expect(page.getByTestId('check-request')).toBeVisible();
    await expect(page.getByTestId('get-help')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await kbActivate(page, '[data-testid="ask-clinic"]');

    // C choose
    expect(await screen(page)).toBe('choose');
    await expect(page.getByTestId('step-indicator')).toHaveText('Step 1 of 4');
    await expectNoHorizontalScroll(page);
    await kbActivate(page, '[data-testid="type-follow_up"]');

    // D details (typing; voice is optional and either offered or explained as unavailable)
    expect(await screen(page)).toBe('details');
    await expect(
      page.getByTestId('voice-start').or(page.getByTestId('speak-unavailable')),
    ).toBeVisible();
    await tabTo(page, '#details');
    await page.keyboard.type('I need a follow-up appointment next week. My medicine has run out.');
    await expectNoHorizontalScroll(page);
    await kbActivate(page, '[data-testid="details-next"]');

    // E confirm
    expect(await screen(page)).toBe('confirm');
    await expect(page.getByTestId('original-text')).toContainText('follow-up appointment');
    await expect(page.getByTestId('readback')).toContainText('Not provided');
    await expectNoHorizontalScroll(page);
    await kbActivate(page, '[data-testid="confirm-right"]');

    // F review & consent
    expect(await screen(page)).toBe('review');
    await expect(page.getByTestId('send-request')).toBeDisabled();
    await kbToggle(page, '[data-testid="consent1"]');
    await kbToggle(page, '[data-testid="consent2"]');
    await expectNoHorizontalScroll(page);
    await kbActivate(page, '[data-testid="send-request"]');

    // G receipt: honest first state
    await expect(page.getByTestId('case-ref')).toHaveText('NR-4K7Q');
    await expect(page.getByTestId('tracks')).toContainText('Waiting to send');
    await expect(page.getByTestId('tracks')).not.toContainText('The clinic received it');
    await expectNoHorizontalScroll(page);

    for (let i = 0; i < 5; i++) await page.getByTestId('fixture-advance').click();
    await expect(page.getByTestId('open-reply')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('tracks')).toContainText('The clinic received it');

    // H reply
    await kbActivate(page, '[data-testid="open-reply"]');
    expect(await screen(page)).toBe('reply');
    await expect(page.getByTestId('arrived-state')).toContainText(
      'Reply arrived on this village device',
    );
    await expect(page.getByTestId('opened-state')).toContainText('Not opened yet');
    await expectNoHorizontalScroll(page);
    await kbActivate(page, '[data-testid="seen"]');
    await expect(page.getByTestId('opened-state')).toContainText('Opened by the patient', {
      timeout: 10_000,
    });
  });

  test('primary actions are at least 48x48 CSS px', async ({ page }) => {
    await page.goto('/?fixtures=1');
    const boxes = await page.locator('button.btn').evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return { w: r.width, h: r.height, t: e.textContent };
      }),
    );
    expect(boxes.length).toBeGreaterThan(0);
    for (const b of boxes) {
      expect(b.w, b.t ?? '').toBeGreaterThanOrEqual(48);
      expect(b.h, b.t ?? '').toBeGreaterThanOrEqual(48);
    }
  });
});
