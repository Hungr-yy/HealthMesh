import { expect, type Page } from '@playwright/test';
import type { LangCode } from '../src/shared/types';

export async function startPatient(
  page: Page,
  opts: { lang: LangCode; mode: 'self' | 'worker'; worker?: string },
): Promise<void> {
  await page.goto('/');
  await page.getByTestId(`lang-${opts.lang}`).click();
  if (opts.mode === 'self') {
    await page.getByTestId('mode-self').click();
  } else {
    await page.getByTestId('mode-worker').click();
    if (opts.worker) await page.locator('#worker').fill(opts.worker);
    await page.getByTestId('start-worker').click();
  }
  await expect(page.getByTestId('patient-root')).toHaveAttribute('data-screen', 'home');
}

/** From home: ask the clinic, pick a type, fill details, arrive on the confirm screen. */
export async function composeToConfirm(
  page: Page,
  d: { type?: string; name?: string; village?: string; details: string },
): Promise<void> {
  await page.getByTestId('ask-clinic').click();
  await page.getByTestId(`type-${d.type ?? 'follow_up'}`).click();
  if (d.name !== undefined) await page.locator('#name').fill(d.name);
  if (d.village !== undefined) await page.locator('#village').fill(d.village);
  await page.locator('#details').fill(d.details);
  await page.getByTestId('details-next').click();
  await expect(page.getByTestId('patient-root')).toHaveAttribute('data-screen', 'confirm');
}

export async function confirmAndSend(page: Page): Promise<string> {
  await page.getByTestId('confirm-right').click();
  await page.getByTestId('consent1').check();
  await page.getByTestId('consent2').check();
  await page.getByTestId('send-request').click();
  await expect(page.getByTestId('patient-root')).toHaveAttribute('data-screen', 'receipt');
  return (await page.getByTestId('case-ref').textContent()) ?? '';
}

export async function clinicSignIn(
  page: Page,
  token = 'demo-token-clinician-amina',
): Promise<void> {
  await page.goto('/#/clinic');
  await page.reload(); // fresh view state: small screens start on the inbox page
  await page.locator('#staff-select').selectOption(token);
}
