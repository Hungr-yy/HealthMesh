import { expect, type Page } from '@playwright/test';

/** Press Tab until the element matching `selector` has focus (keyboard-only navigation). */
export async function tabTo(page: Page, selector: string, max = 80): Promise<void> {
  for (let i = 0; i < max; i++) {
    const hit = await page.evaluate(
      (sel) => document.activeElement?.matches(sel) ?? false,
      selector,
    );
    if (hit) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Could not reach ${selector} by keyboard within ${max} Tab presses`);
}

export async function kbActivate(page: Page, selector: string): Promise<void> {
  await tabTo(page, selector);
  await page.keyboard.press('Enter');
}

export async function kbToggle(page: Page, selector: string): Promise<void> {
  await tabTo(page, selector);
  await page.keyboard.press('Space');
}

export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const r = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  expect(
    r.sw,
    `horizontal overflow: scrollWidth ${r.sw} > clientWidth ${r.cw}`,
  ).toBeLessThanOrEqual(r.cw);
}

export async function screen(page: Page): Promise<string | null> {
  return page.getByTestId('patient-root').getAttribute('data-screen');
}
