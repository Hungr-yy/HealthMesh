import { createContext, useContext } from 'react';
import type { LangCode } from '@shared/types';
import { DIRECTION, translate, type MessageKey } from '@shared/i18n';

export interface I18n {
  lang: LangCode;
  dir: 'ltr' | 'rtl';
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
}

export function makeI18n(lang: LangCode): I18n {
  return { lang, dir: DIRECTION[lang], t: (k, v) => translate(lang, k, v) };
}

export const I18nContext = createContext<I18n>(makeI18n('en'));
export const useI18n = () => useContext(I18nContext);
