import { expect, test, type Browser, type Page } from '@playwright/test';
import { composeToConfirm, startPatient } from './flows';
import { VIEWPORTS, axe, expectNoHorizontalScroll, simPost, snap, type Viewport } from './helpers';

/** Phase 5: failure and recovery states, in a real browser against the real service. */

async function checked(page: Page, vp: Viewport, name: string) {
  await expectNoHorizontalScroll(page);
  await snap(page, vp, name);
  const rec = await axe(page, vp, name);
  expect(rec.violations, `axe ${name} @ ${vp.name}: ${JSON.stringify(rec.violations)}`).toEqual([]);
}

async function toReview(page: Page, details = 'I need a follow-up appointment next week.') {
  await startPatient(page, { lang: 'en', mode: 'self' });
  await composeToConfirm(page, { name: 'Noor (synthetic)', details });
  await page.getByTestId('confirm-right').click();
  await page.getByTestId('consent1').check();
  await page.getByTestId('consent2').check();
}

const CLINICIAN = { authorization: 'Bearer demo-token-clinician-amina' };

for (const vp of VIEWPORTS) {
  test.describe(`Failure and recovery states @ ${vp.name}`, () => {
    test.beforeEach(async ({ request }) => {
      await request.post('/api/sim/reset');
    });
    const open = async (browser: Browser) => {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      return { ctx, page: await ctx.newPage() };
    };

    test('local node unavailable: draft kept, NOT accepted; retry after power returns', async ({
      browser,
    }) => {
      const { ctx, page } = await open(browser);
      await toReview(page);
      await simPost(page, 'power-cut', { durationTicks: 30 });
      await page.getByTestId('send-request').click();
      await expect(page.getByTestId('err-node-unavailable')).toContainText('NOT been accepted');
      await checked(page, vp, '40-fail-node-unavailable-draft-not-accepted');
      await simPost(page, 'advance', { ticks: 31 });
      await page.getByTestId('send-request').click();
      await expect(page.getByTestId('patient-root')).toHaveAttribute('data-screen', 'receipt');
      await ctx.close();
    });

    test('storage nearly full blocks new submissions with a plain explanation', async ({
      browser,
    }) => {
      const { ctx, page } = await open(browser);
      await toReview(page);
      await simPost(page, 'config', { storageLimitBytes: 20 });
      await page.getByTestId('send-request').click();
      await expect(page.getByTestId('err-storage-full')).toBeVisible();
      await checked(page, vp, '41-fail-storage-nearly-full');
      await simPost(page, 'config', { storageLimitBytes: 5 * 1024 * 1024 });
      await ctx.close();
    });

    test('lost submission response: query by stable message id, never a second case', async ({
      browser,
      request,
    }) => {
      const { ctx, page } = await open(browser);
      await toReview(page);
      const postedIds: string[] = [];
      page.on('request', (r) => {
        if (r.method() === 'POST' && r.url().endsWith('/api/node/requests'))
          postedIds.push((r.postDataJSON() as { messageId: string }).messageId);
      });
      let dropped = false;
      await page.route('**/api/node/requests', async (route) => {
        if (!dropped) {
          dropped = true;
          await route.fetch(); // the node ACCEPTS the request ...
          await route.abort('failed'); // ... but the response never reaches the device
        } else await route.continue();
      });
      await page.getByTestId('send-request').click();
      await expect(page.getByTestId('err-uncertain')).toBeVisible();
      await checked(page, vp, '42-fail-lost-ack-uncertain');
      await page.getByTestId('check-again').click();
      await expect(page.getByTestId('patient-root')).toHaveAttribute('data-screen', 'receipt');
      expect(postedIds).toHaveLength(1); // checking did not re-send
      await simPost(page, 'advance', { ticks: 120 });
      const inbox = await (await request.get('/api/clinic/inbox', { headers: CLINICIAN })).json();
      expect(inbox).toHaveLength(1); // exactly one case
      await ctx.close();
    });

    test('request never reached the node: retry reuses the SAME message id, one case', async ({
      browser,
      request,
    }) => {
      const { ctx, page } = await open(browser);
      await toReview(page);
      const postedIds: string[] = [];
      page.on('request', (r) => {
        if (r.method() === 'POST' && r.url().endsWith('/api/node/requests'))
          postedIds.push((r.postDataJSON() as { messageId: string }).messageId);
      });
      let dropped = false;
      await page.route('**/api/node/requests', async (route) => {
        if (!dropped) {
          dropped = true;
          await route.abort('failed'); // lost on the way TO the node
        } else await route.continue();
      });
      await page.getByTestId('send-request').click();
      await expect(page.getByTestId('err-uncertain')).toBeVisible();
      await page.getByTestId('check-again').click(); // node says: never heard of it
      await page.getByTestId('send-request').click();
      await expect(page.getByTestId('patient-root')).toHaveAttribute('data-screen', 'receipt');
      expect(postedIds).toHaveLength(2);
      expect(postedIds[0]).toBe(postedIds[1]);
      await simPost(page, 'advance', { ticks: 120 });
      const inbox = await (await request.get('/api/clinic/inbox', { headers: CLINICIAN })).json();
      expect(inbox).toHaveLength(1);
      await ctx.close();
    });

    test('no upstream signal: message waits safely, explained honestly', async ({ browser }) => {
      const { ctx, page } = await open(browser);
      await toReview(page);
      await simPost(page, 'link', { index: 0, up: false });
      await page.getByTestId('send-request').click();
      await expect(page.getByTestId('no-upstream')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('tracks')).toContainText('Waiting to send');
      await checked(page, vp, '43-fail-no-upstream-signal');
      await simPost(page, 'link', { index: 0, up: true });
      await ctx.close();
    });

    test('power interruption on the receipt screen is explained and recovers', async ({
      browser,
    }) => {
      const { ctx, page } = await open(browser);
      await toReview(page);
      await page.getByTestId('send-request').click();
      await expect(page.getByTestId('case-ref')).toBeVisible();
      await simPost(page, 'power-cut', { durationTicks: 20 });
      await expect(page.getByTestId('node-power-off')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('case-ref')).toBeVisible(); // last known view kept
      await checked(page, vp, '44-fail-power-off-receipt');
      await simPost(page, 'advance', { ticks: 25 });
      await expect(page.getByTestId('node-power-off')).toHaveCount(0, { timeout: 15_000 });
      await ctx.close();
    });

    test('expiry: explicit resubmission creates a linked new version', async ({ browser }) => {
      const { ctx, page } = await open(browser);
      await simPost(page, 'config', { ttlTicks: 30 });
      await simPost(page, 'link', { index: 0, up: false });
      await toReview(page);
      await page.getByTestId('send-request').click();
      // wait until the node has accepted it: on a remote target the click's request can
      // otherwise arrive after the simulator advance below
      await expect(page.getByTestId('patient-root')).toHaveAttribute('data-screen', 'receipt');
      await simPost(page, 'advance', { ticks: 31 });
      await expect(page.getByTestId('exc-expired')).toBeVisible({ timeout: 15_000 });
      await checked(page, vp, '45-fail-expired');
      await simPost(page, 'link', { index: 0, up: true });
      await simPost(page, 'config', { ttlTicks: 4320 });
      await page.getByTestId('resubmit').click();
      await expect(page.locator('#details')).toHaveValue(/follow-up appointment/);
      await page.getByTestId('details-next').click();
      await page.getByTestId('confirm-right').click();
      await page.getByTestId('consent1').check();
      await page.getByTestId('consent2').check();
      await page.getByTestId('send-request').click();
      await expect(page.getByTestId('patient-root')).toHaveAttribute('data-screen', 'receipt');
      await expect(page.getByTestId('exc-expired')).toHaveCount(0, { timeout: 15_000 });
      await simPost(page, 'advance', { ticks: 200 });
      await expect(page.getByTestId('tracks')).toContainText('The clinic received it', {
        timeout: 15_000,
      });
      await ctx.close();
    });

    test('bounded retry: sending stops and asks for help (no endless spinner)', async ({
      browser,
    }) => {
      const { ctx, page } = await open(browser);
      await simPost(page, 'config', { lossPct: 100, maxRetries: 3 });
      await toReview(page);
      await page.getByTestId('send-request').click();
      await expect(page.getByTestId('patient-root')).toHaveAttribute('data-screen', 'receipt');
      await simPost(page, 'advance', { ticks: 120 });
      await expect(page.getByTestId('exc-intervention')).toBeVisible({ timeout: 15_000 });
      await checked(page, vp, '46-fail-intervention-required');
      expect(await page.locator('[role="progressbar"], [aria-busy="true"]').count()).toBe(0);
      await simPost(page, 'config', { lossPct: 0, maxRetries: 6 });
      await ctx.close();
    });

    test('delayed clinic response: only ages are shown, never an arrival estimate', async ({
      browser,
    }) => {
      const { ctx, page } = await open(browser);
      await toReview(page);
      await page.getByTestId('send-request').click();
      await expect(page.getByTestId('patient-root')).toHaveAttribute('data-screen', 'receipt');
      await simPost(page, 'advance', { ticks: 100 });
      await expect(page.getByTestId('tracks')).toContainText('Waiting for clinic review', {
        timeout: 15_000,
      });
      await simPost(page, 'advance', { ticks: 3000 });
      await expect(page.getByTestId('last-update')).toContainText(/Last update received \d+ d/, {
        timeout: 15_000,
      });
      const text = (await page.locator('body').innerText()).toLowerCase();
      for (const bad of ['estimated', 'eta', 'will arrive in', 'arrives in', 'expected in']) {
        expect(text, `found arrival-estimate wording "${bad}"`).not.toContain(bad);
      }
      await checked(page, vp, '47-delayed-clinic-response-ages-only');
      await ctx.close();
    });

    test('withdrawal is explained: forwarded copies cannot be erased', async ({ browser }) => {
      const { ctx, page } = await open(browser);
      await toReview(page);
      await page.getByTestId('send-request').click();
      await page.getByTestId('withdraw').click();
      await expect(page.locator('body')).toContainText('cannot be erased');
      await checked(page, vp, '48-withdraw-explained');
      await page.getByTestId('withdraw-confirm').click();
      await expect(page.getByTestId('exc-withdrawn')).toBeVisible({ timeout: 15_000 });
      await ctx.close();
    });
  });
}
