import type { DraftField, DraftSummary, RequestInput, TranslationResult } from './types';

/**
 * Deterministic, rule-based "structured draft". NO AI model is used. It never diagnoses,
 * prescribes or assigns priority: it only extracts patient-stated words and flags uncertainty.
 * Always shown with the label "Draft summary - verify against the original".
 * Keyword lists below are small demo lexicons (sw/ar entries are UNREVIEWED).
 */

const TIMING: Array<{ re: RegExp; value: string }> = [
  { re: /next week|wiki ijayo|الأسبوع القادم/i, value: 'next week' },
  { re: /tomorrow|kesho|غدا|غداً/i, value: 'tomorrow' },
  { re: /today|leo|اليوم/i, value: 'today' },
  { re: /this week|wiki hii|هذا الأسبوع/i, value: 'this week' },
];
const VAGUE_TIMING =
  /soon|asap|some days|few days|hivi karibuni|siku chache|قريبا|قريباً|بضعة أيام/i;
const REFERRAL = /referral|referred|rufaa|إحالة/i;
const MENTIONS: Array<{ re: RegExp; word: string }> = [
  { re: /medicine|medication|tablets?|pills?|dawa|دواء|دوائي/i, word: 'medicine' },
  { re: /fever|homa|حمى/i, word: 'fever' },
  { re: /cough|kikohozi|سعال/i, word: 'cough' },
  { re: /pain|maumivu|ألم/i, word: 'pain' },
];
const ATTENTION = /bleeding|can't breathe|cannot breathe|unconscious|damu nyingi|kutoka damu|نزيف/i;
const OTHER_PERSON =
  /my child|my baby|my mother|my father|my husband|mtoto wangu|mama yangu|طفلي|أمي/i;

function ev(s: RegExp, text: string): string | null {
  const m = s.exec(text);
  return m ? m[0] : null;
}

export function buildDraftSummary(
  input: RequestInput,
  translation: TranslationResult,
): DraftSummary {
  // Rules run over the original, and over the English draft if one exists (both kept separate).
  const texts = [input.details, translation.text ?? ''].filter(Boolean);
  const hay = texts.join(' \n ');
  const fields: DraftField[] = [];

  fields.push({
    key: 'request',
    label: 'Request type (chosen by patient)',
    value: input.requestType.replace(/_/g, ' '),
    status: 'matched',
  });

  const timing = TIMING.map((t) => (t.re.test(hay) ? t.value : null)).filter(Boolean) as string[];
  const vague = ev(VAGUE_TIMING, hay);
  if (timing.length === 1 && !vague) {
    fields.push({
      key: 'timing',
      label: 'When',
      value: timing[0] ?? null,
      codes: timing,
      status: 'matched',
    });
  } else if (timing.length > 1 || vague) {
    fields.push({
      key: 'timing',
      label: 'When',
      value: [...timing, ...(vague ? [`"${vague}"`] : [])].join(' / '),
      status: 'uncertain',
      note: vague
        ? 'Vague or conflicting timing - confirm with the patient.'
        : 'More than one time mentioned.',
    });
  } else {
    fields.push({ key: 'timing', label: 'When', value: null, status: 'not_provided' });
  }

  const ref = ev(REFERRAL, hay);
  fields.push(
    ref || input.requestType === 'existing_referral'
      ? {
          key: 'referral',
          label: 'Referral mentioned',
          value: 'Yes',
          codes: ['yes'],
          status: 'matched',
          note: 'Referral destination/number not captured - check the original and records.',
        }
      : { key: 'referral', label: 'Referral mentioned', value: null, status: 'not_provided' },
  );

  const mentions = MENTIONS.filter((m) => m.re.test(hay)).map((m) => m.word);
  fields.push(
    mentions.length
      ? {
          key: 'mentions',
          label: 'Words the patient used',
          value: mentions.join(', '),
          codes: mentions,
          status: 'matched',
          note: 'Keyword match on patient wording. Not a clinical finding.',
        }
      : { key: 'mentions', label: 'Words the patient used', value: null, status: 'not_provided' },
  );

  fields.push(
    input.contact.trim()
      ? { key: 'contact', label: 'Contact', value: input.contact.trim(), status: 'matched' }
      : { key: 'contact', label: 'Contact', value: null, status: 'not_provided' },
  );

  const other = ev(OTHER_PERSON, hay);
  if (other) {
    fields.push({
      key: 'for_whom',
      label: 'Who is this for?',
      value: `"${other}"`,
      status: 'uncertain',
      note: 'The request may be about someone other than the sender.',
    });
  }

  const attn = ev(ATTENTION, hay);
  if (attn) {
    fields.push({
      key: 'attention',
      label: 'Words flagged for staff attention',
      value: `"${attn}"`,
      status: 'uncertain',
      note: 'Keyword match only. Staff must assess. This does NOT change queue order, and no flag does not mean non-urgent.',
    });
  }

  if (translation.status === 'unavailable' && input.language !== 'en') {
    fields.push({
      key: 'attention',
      label: 'Translation',
      value: 'Unavailable',
      status: 'uncertain',
      note: 'Read the original text. Rules above ran on the original only.',
    });
  }

  return {
    label: 'Draft summary - verify against the original',
    engine: 'deterministic-rules-v1 (no AI model)',
    fields,
  };
}

/** Patient-side readback uses the same rules (screen E), without clinic-only fields. */
export function readbackFields(input: RequestInput, translation: TranslationResult): DraftField[] {
  return buildDraftSummary(input, translation).fields.filter(
    (f) => f.key !== 'attention' && f.key !== 'request',
  );
}
