import { expect, test } from '@playwright/test';
import { HOSTED_BANNER } from '../src/shared/hosted';

/**
 * Deployment banner: shown on every view exactly when the service says it is a hosted demo,
 * and never on the local build. Runs against whichever target the suite was started with.
 */
test('hosted-demo banner matches the deployment mode on every view; SIMULATION banner always', async ({
  page,
  request,
}) => {
  const mode = (await (await request.get('/api/mode')).json()) as { hosted: boolean };
  for (const hash of ['#/', '#/clinic', '#/operator', '#/admin', '#/sim', '#/capabilities']) {
    await page.goto(`/${hash}`);
    await expect(page.getByTestId('sim-banner')).toBeVisible();
    if (mode.hosted) {
      await expect(page.getByTestId('hosted-banner')).toHaveText(HOSTED_BANNER);
    } else {
      await expect(page.getByTestId('hosted-banner')).toHaveCount(0);
    }
  }
  // fixtures mode never claims a deployment mode
  await page.goto('/?fixtures=1');
  await expect(page.getByTestId('hosted-banner')).toHaveCount(0);
});
