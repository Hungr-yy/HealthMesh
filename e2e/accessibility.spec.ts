import { expect, test } from '@playwright/test';
import { composeToConfirm, startPatient } from './flows';
import { expectNoHorizontalScroll, simPost } from './helpers';

test.describe('Accessibility behaviours (beyond axe)', () => {
  test.beforeEach(async ({ request }) => {
    await request.post('/api/sim/reset');
  });

  test('200% text size at 320px: no horizontal scroll, no clipped buttons', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 320, height: 640 } });
    const page = await ctx.newPage();
    await page.goto('/');
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    const screens: Array<() => Promise<void>> = [
      async () => undefined,
      async () => {
        await page.getByTestId('lang-en').click();
        await page.getByTestId('mode-self').click();
      },
      async () => {
        await page.getByTestId('ask-clinic').click();
      },
      async () => {
        await page.getByTestId('type-follow_up').click();
      },
      async () => {
        await page.locator('#details').fill('I need a follow-up appointment next week.');
        await page.getByTestId('details-next').click();
      },
      async () => {
        await page.getByTestId('confirm-right').click();
      },
    ];
    for (const go of screens) {
      await go();
      await expectNoHorizontalScroll(page);
      const clipped = await page
        .locator('button.btn')
        .evaluateAll((els) =>
          els
            .filter((e) => e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1)
            .map((e) => e.textContent),
        );
      expect(clipped, 'buttons whose text is clipped at 200%').toEqual([]);
    }
    await ctx.close();
  });

  test('focus moves to the new screen heading; focus ring visible; no decorative animation', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await startPatient(page, { lang: 'en', mode: 'self' });
    await page.getByTestId('ask-clinic').click();
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('H1');
    await page.keyboard.press('Tab');
    const ring = await page.evaluate(() => {
      const cs = getComputedStyle(document.activeElement as Element);
      return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) };
    });
    expect(ring.style).not.toBe('none');
    expect(ring.width).toBeGreaterThanOrEqual(2);
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  });

  test('state changes are announced to screen readers via a polite live region', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await startPatient(page, { lang: 'en', mode: 'self' });
    await composeToConfirm(page, { details: 'I need a follow-up appointment next week.' });
    await page.getByTestId('confirm-right').click();
    await page.getByTestId('consent1').check();
    await page.getByTestId('consent2').check();
    await page.getByTestId('send-request').click();
    const live = page.getByTestId('announcer');
    await expect(live).toHaveAttribute('aria-live', 'polite');
    await expect(page.getByTestId('tracks')).toContainText('Waiting to send');
    await simPost(page, 'advance', { ticks: 10 });
    await expect(live).toHaveText('Passed to the first relay', { timeout: 15_000 });
  });

  test('page lang/dir follow the chosen language (RTL by layout direction)', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('lang-ar').click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await page.getByTestId('lang-en').click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  });
});
