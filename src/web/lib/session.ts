import type { LangCode, RequestType, ReplyMethod } from '@shared/types';

/** Minimal storage surface so the session can be tested without a browser. */
export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export class MemoryKV implements KV {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

export interface DraftForm {
  requestType: RequestType | null;
  patientName: string;
  village: string;
  details: string;
  /** Original speech-to-text transcript (empty when the text was only typed). Same 24 h retention as the draft. */
  voiceTranscript: string;
  contact: string;
  replyMethod: ReplyMethod;
  consent1: boolean;
  consent2: boolean;
}

export const EMPTY_FORM: DraftForm = {
  requestType: null,
  patientName: '',
  village: '',
  details: '',
  voiceTranscript: '',
  contact: '',
  replyMethod: 'village_device',
  consent1: false,
  consent2: false,
};

export interface OpenCase {
  caseId: string;
  ref: string;
  messageId: string;
  secret: string;
}

/** A submission in flight: ids are created once so a retry reuses the same message id. */
export interface PendingSubmit {
  messageId: string;
  secret: string;
}

export interface SessionData {
  language: LangCode | null;
  mode: 'self' | 'worker' | null;
  workerLabel: string;
  openCases: OpenCase[];
  activeCaseId: string | null;
  pending: PendingSubmit | null;
}

const EMPTY_SESSION: SessionData = {
  language: null,
  mode: null,
  workerLabel: '',
  openCases: [],
  activeCaseId: null,
  pending: null,
};

/** Explicit retention policy for browser-held drafts. */
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const DRAFT_KEY = 'rhr.draft.v1';
const SESSION_KEY = 'rhr.session.v1';

/**
 * Device session: case secrets and the current form. Held in sessionStorage (cleared with the
 * tab) and, for drafts only, in localStorage under a 24 h retention limit. Everything is wiped
 * on lock / switch patient. This is NEVER shown as the node queue; the local service is.
 */
export class DeviceSession {
  constructor(
    private readonly session: KV,
    private readonly local: KV,
    private readonly now: () => number = () => Date.now(),
  ) {}

  load(): SessionData {
    const raw = this.session.getItem(SESSION_KEY);
    if (!raw) return { ...EMPTY_SESSION, openCases: [] };
    try {
      return { ...EMPTY_SESSION, ...(JSON.parse(raw) as Partial<SessionData>) };
    } catch {
      return { ...EMPTY_SESSION, openCases: [] };
    }
  }

  save(data: SessionData): void {
    this.session.setItem(SESSION_KEY, JSON.stringify(data));
  }

  loadDraft(): DraftForm | null {
    const raw = this.local.getItem(DRAFT_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { savedAt: number; form: DraftForm };
      if (this.now() - parsed.savedAt > DRAFT_TTL_MS) {
        this.local.removeItem(DRAFT_KEY);
        return null;
      }
      return { ...EMPTY_FORM, ...parsed.form };
    } catch {
      this.local.removeItem(DRAFT_KEY);
      return null;
    }
  }

  saveDraft(form: DraftForm): void {
    const empty = !form.details && !form.patientName && !form.village && !form.contact;
    if (empty) {
      this.local.removeItem(DRAFT_KEY);
      return;
    }
    this.local.setItem(DRAFT_KEY, JSON.stringify({ savedAt: this.now(), form }));
  }

  clearDraft(): void {
    this.local.removeItem(DRAFT_KEY);
  }

  /** Lock: wipe form, draft, open cases and secrets. Language/mode also reset. */
  lock(): SessionData {
    this.session.removeItem(SESSION_KEY);
    this.local.removeItem(DRAFT_KEY);
    return { ...EMPTY_SESSION, openCases: [] };
  }

  /**
   * Switch patient (assisted mode): clears everything about the previous patient but keeps the
   * health worker's own label/mode so the worker need not sign in again.
   */
  switchPatient(prev: SessionData): SessionData {
    this.local.removeItem(DRAFT_KEY);
    const next: SessionData = {
      ...EMPTY_SESSION,
      openCases: [],
      mode: prev.mode,
      workerLabel: prev.workerLabel,
    };
    this.save(next);
    return next;
  }
}
