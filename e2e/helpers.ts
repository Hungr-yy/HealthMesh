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

import fs from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';

export const SHOT_DIR = path.resolve('docs/screenshots');
export const AXE_FILE = path.resolve('docs/axe-results.json');

export interface Viewport {
  name: 'mobile-320' | 'desktop-1280';
  width: number;
  height: number;
}
export const VIEWPORTS: Viewport[] = [
  { name: 'mobile-320', width: 320, height: 640 },
  { name: 'desktop-1280', width: 1280, height: 800 },
];

export async function snap(page: Page, vp: Viewport, name: string): Promise<void> {
  const dir = path.join(SHOT_DIR, vp.name);
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

export interface AxeRecord {
  viewport: string;
  screen: string;
  violations: Array<{ id: string; impact: string | null | undefined; help: string; nodes: number }>;
  passes: number;
}

/** Run axe (WCAG 2.0/2.1 A + AA tags) on the current page and append the result to the evidence file. */
export async function axe(page: Page, vp: Viewport, screenName: string): Promise<AxeRecord> {
  const r = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const rec: AxeRecord = {
    viewport: vp.name,
    screen: screenName,
    violations: r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.length,
    })),
    passes: r.passes.length,
  };
  const all: AxeRecord[] = fs.existsSync(AXE_FILE)
    ? (JSON.parse(fs.readFileSync(AXE_FILE, 'utf8')) as AxeRecord[])
    : [];
  all.push(rec);
  fs.mkdirSync(path.dirname(AXE_FILE), { recursive: true });
  fs.writeFileSync(AXE_FILE, JSON.stringify(all, null, 2));
  return rec;
}

export async function simPost(page: Page, action: string, body: unknown = {}): Promise<void> {
  const r = await page.request.post(`/api/sim/${action}`, { data: body });
  expect(r.ok(), `sim ${action} failed: ${r.status()}`).toBe(true);
}
