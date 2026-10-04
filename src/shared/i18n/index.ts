import type { LangCode } from '../types';
import { en, type MessageKey } from './en';
import { sw } from './sw';
import { ar } from './ar';

export type { MessageKey };

export const PACKS: Record<LangCode, Record<MessageKey, string>> = { en, sw, ar };

/** Native-language names. Shown in every language so a patient can find their own. */
export const NATIVE_NAMES: Record<LangCode, string> = {
  en: 'English',
  sw: 'Kiswahili',
  ar: 'العربية',
};

/** Review status per pack. sw/ar are UNREVIEWED demo strings. */
export const PACK_STATUS: Record<LangCode, 'source' | 'unreviewed-demo'> = {
  en: 'source',
  sw: 'unreviewed-demo',
  ar: 'unreviewed-demo',
};

export const DIRECTION: Record<LangCode, 'ltr' | 'rtl'> = { en: 'ltr', sw: 'ltr', ar: 'rtl' };

export function translate(
  lang: LangCode,
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  let s = PACKS[lang][key] ?? en[key];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}
