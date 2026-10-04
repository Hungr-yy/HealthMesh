import type { LangCode, TranslationResult } from './types';

/**
 * MOCK translator. A tiny phrase dictionary, NOT a real machine-translation system.
 * Swahili and Arabic entries are UNREVIEWED demo strings that need native-speaker review.
 * Output is always flagged "needs review" for non-English text.
 */

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,!?؟،;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// source-language phrase -> English (whole-sentence matches)
const TO_EN: Record<'sw' | 'ar', Record<string, string>> = {
  sw: {
    'nataka miadi ya ufuatiliaji wiki ijayo': 'I want a follow-up appointment next week.',
    'nina rufaa na ninahitaji kujua nifanye nini': 'I have a referral and need to know what to do.',
    'naomba ujumbe kwa kliniki': 'I would like to send a message to the clinic.',
    'dawa yangu imeisha': 'My medicine has run out.',
    'nahitaji kuonana na daktari kesho': 'I need to see the doctor tomorrow.',
  },
  ar: {
    'أحتاج إلى موعد متابعة الأسبوع القادم': 'I need a follow-up appointment next week.',
    'لدي إحالة وأحتاج إلى معرفة ما يجب أن أفعله': 'I have a referral and need to know what to do.',
    'أريد إرسال رسالة إلى العيادة': 'I would like to send a message to the clinic.',
    'انتهى دوائي': 'My medicine has run out.',
    'أحتاج إلى رؤية الطبيب غدا': 'I need to see the doctor tomorrow.',
  },
};

// English reply phrase -> patient language (staff templates have fixed pre-written demo strings)
const FROM_EN: Record<'sw' | 'ar', Record<string, string>> = {
  sw: {
    'please come to the clinic on thursday morning for your follow-up. bring your health card.':
      'Tafadhali njoo kliniki Alhamisi asubuhi kwa ufuatiliaji wako. Lete kadi yako ya afya.',
    'we received your message. a nurse will contact you through your health worker.':
      'Tumepokea ujumbe wako. Muuguzi atawasiliana nawe kupitia mhudumu wako wa afya.',
    'your referral is confirmed. please speak with your health worker about travel.':
      'Rufaa yako imethibitishwa. Tafadhali zungumza na mhudumu wako wa afya kuhusu usafiri.',
  },
  ar: {
    'please come to the clinic on thursday morning for your follow-up. bring your health card.':
      'يرجى القدوم إلى العيادة صباح الخميس لموعد المتابعة. أحضر بطاقتك الصحية.',
    'we received your message. a nurse will contact you through your health worker.':
      'لقد استلمنا رسالتك. ستتواصل معك ممرضة عبر العامل الصحي الخاص بك.',
    'your referral is confirmed. please speak with your health worker about travel.':
      'تم تأكيد إحالتك. يرجى التحدث مع العامل الصحي بشأن السفر.',
  },
};

function lookup(dict: Record<string, string>, text: string): string | undefined {
  const n = norm(text);
  for (const [k, v] of Object.entries(dict)) if (norm(k) === n) return v;
  return undefined;
}

export interface TranslatorOptions {
  available: boolean;
}

/** Translate a patient's original text to English for the clinic. Never alters the original. */
export function translateToEnglish(
  text: string,
  from: LangCode,
  opts: TranslatorOptions,
): TranslationResult {
  const engine = 'mock-dictionary-v1' as const;
  if (from === 'en') return { status: 'not_needed', text: null, engine };
  if (!opts.available) return { status: 'unavailable', text: null, engine };
  const dict = TO_EN[from];
  const hit = lookup(dict, text);
  if (hit) return { status: 'machine_draft_needs_review', text: hit, engine };
  // sentence-by-sentence partial match
  const parts = text
    .split(/[.!?؟\n]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: string[] = [];
  let matched = 0;
  for (const p of parts) {
    const h = lookup(dict, p);
    if (h) {
      matched++;
      out.push(h);
    } else out.push('[untranslated]');
  }
  if (matched === 0) return { status: 'unavailable', text: null, engine };
  return { status: 'partial_needs_review', text: out.join(' '), engine };
}

/** Translate approved English reply text for the patient. Falls back to the original. */
export function translateReplyForPatient(
  text: string,
  textLanguage: LangCode,
  patientLanguage: LangCode,
  opts: TranslatorOptions,
): { status: TranslationResult['status']; text: string } {
  if (textLanguage === patientLanguage) return { status: 'not_needed', text };
  if (!opts.available || textLanguage !== 'en' || patientLanguage === 'en')
    return { status: 'unavailable', text };
  const hit = lookup(FROM_EN[patientLanguage], text);
  if (hit) return { status: 'machine_draft_needs_review', text: hit };
  return { status: 'unavailable', text };
}

/** For clinic UI: would this reply text translate for this language? (pre-approval preview). */
export function previewReplyTranslation(
  text: string,
  patientLanguage: LangCode,
  opts: TranslatorOptions,
) {
  return translateReplyForPatient(text, 'en', patientLanguage, opts);
}
