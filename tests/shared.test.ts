import { describe, expect, it } from 'vitest';
import { decodeRequest, encodeRequest } from '@shared/codec';
import { buildDraftSummary } from '@shared/draft';
import { fixtureCase, NOOR_INPUT, NOOR_INPUT_AR, NOOR_INPUT_SW } from '@shared/fixtures';
import { PACKS, translate } from '@shared/i18n';
import { en } from '@shared/i18n/en';
import { newUuid } from '@shared/ids';
import { deriveTracks, reconcileEvents } from '@shared/tracks';
import { translateReplyForPatient, translateToEnglish } from '@shared/translate';
import type { TransportEvent } from '@shared/types';

const ev = (n: number, stage: TransportEvent['stage'], at = n): TransportEvent => ({
  eventId: `e${n}`,
  messageId: 'm',
  stage,
  source: 'gateway',
  sequence: n,
  at: new Date(Date.UTC(2026, 9, 4, 8, at)).toISOString(),
  clockQuality: 'synced',
  version: 1,
});

describe('codec', () => {
  it('round-trips English, Swahili and Arabic requests losslessly', () => {
    for (const input of [NOOR_INPUT, NOOR_INPUT_SW, NOOR_INPUT_AR]) {
      const id = newUuid();
      const out = decodeRequest(encodeRequest(input, id));
      expect(out.messageId).toBe(id);
      expect(out.input).toEqual(input);
    }
  });
});

describe('tracks', () => {
  it('reconcile drops duplicate events by eventId and is order independent', () => {
    const a = ev(1, 'queued');
    const b = ev(2, 'clinic_received');
    const x = reconcileEvents([], [b, a, a, b]);
    const y = reconcileEvents([a], [b, a]);
    expect(x.map((e) => e.eventId)).toEqual(['e1', 'e2']);
    expect(y).toEqual(x);
  });

  it('a late lower-stage event never moves the transport track backwards', () => {
    const t = deriveTracks([ev(2, 'clinic_received'), ev(1, 'gateway_received')], true);
    expect(t.transport).toBe('clinic_received');
  });

  it('in_review is only reachable through a staff care_in_review event', () => {
    const transportOnly = deriveTracks(
      [ev(1, 'queued'), ev(2, 'relaying'), ev(3, 'gateway_received'), ev(4, 'clinic_received')],
      true,
    );
    expect(transportOnly.care).toBeNull();
    expect(deriveTracks([ev(1, 'care_awaiting_review'), ev(2, 'care_in_review')], true).care).toBe(
      'in_review',
    );
  });

  it('draft-only vs accepted is honest', () => {
    expect(deriveTracks([], false).local).toBe('draft');
    expect(deriveTracks([ev(1, 'queued')], true).local).toBe('accepted');
  });

  it('fixture stages never claim clinic receipt before a clinic event', () => {
    expect(fixtureCase('gateway').versions[0]?.tracks.transport).toBe('gateway_received');
    expect(fixtureCase('waiting').versions[0]?.tracks.transport).toBe('queued');
  });
});

describe('language packs', () => {
  it('Swahili and Arabic have every English key (full parity)', () => {
    for (const k of Object.keys(en)) {
      expect(PACKS.sw[k as keyof typeof en], `sw missing ${k}`).toBeTruthy();
      expect(PACKS.ar[k as keyof typeof en], `ar missing ${k}`).toBeTruthy();
    }
  });
  it('interpolates placeholders', () => {
    expect(translate('en', 'step', { n: 2, total: 4 })).toBe('Step 2 of 4');
  });
});

describe('translation mock + draft summary', () => {
  it('translation failure preserves the original and marks review required', () => {
    const r = translateToEnglish(NOOR_INPUT_SW.details, 'sw', { available: false });
    expect(r.status).toBe('unavailable');
    expect(r.text).toBeNull();
    const d = buildDraftSummary(NOOR_INPUT_SW, r);
    expect(d.fields.some((f) => f.label === 'Translation' && f.status === 'uncertain')).toBe(true);
    expect(NOOR_INPUT_SW.details).toBe('Nataka miadi ya ufuatiliaji wiki ijayo.');
  });

  it('known Swahili/Arabic demo phrases get a mock draft that still needs review', () => {
    expect(translateToEnglish(NOOR_INPUT_SW.details, 'sw', { available: true }).status).toBe(
      'machine_draft_needs_review',
    );
    expect(translateToEnglish(NOOR_INPUT_AR.details, 'ar', { available: true }).status).toBe(
      'machine_draft_needs_review',
    );
  });

  it('unknown text is unavailable, not guessed', () => {
    expect(translateToEnglish('maneno mengine kabisa', 'sw', { available: true }).status).toBe(
      'unavailable',
    );
  });

  it('draft summary marks vague timing uncertain and missing fields Not provided', () => {
    const t = translateToEnglish('x', 'en', { available: true });
    const d = buildDraftSummary({ ...NOOR_INPUT, details: 'Please see me soon' }, t);
    expect(d.label).toBe('Draft summary - verify against the original');
    expect(d.fields.find((f) => f.key === 'timing')?.status).toBe('uncertain');
    expect(d.fields.find((f) => f.key === 'contact')?.status).toBe('not_provided');
  });

  it('reply translation falls back to the clinic text when unavailable', () => {
    const r = translateReplyForPatient('Come tomorrow at nine.', 'en', 'sw', { available: true });
    expect(r.status).toBe('unavailable');
    expect(r.text).toBe('Come tomorrow at nine.');
  });
});
