import type { ReactNode } from 'react';
import { PACK_STATUS, translate } from '@shared/i18n';
import type { LangCode } from '@shared/types';
import { en } from '@shared/i18n/en';
import { HOSTED_BANNER } from '@shared/hosted';
import { Icon } from './ui';

/** Banners that must be visible on every screen. */
export function SimulationBanner({ lang = 'en' }: { lang?: LangCode }) {
  return (
    <div className="sim-banner" role="note" data-testid="sim-banner">
      <strong>SIMULATION</strong> - {en.simBanner.replace(/^SIMULATION - /, '')}
      {lang !== 'en' ? (
        <div lang={lang} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
          {translate(lang, 'simBanner')}
        </div>
      ) : null}
    </div>
  );
}

/** Conspicuous notice when the service runs as the public hosted demo. */
export function HostedBanner() {
  return (
    <div className="hosted-banner" role="note" data-testid="hosted-banner">
      <strong>{HOSTED_BANNER}</strong>
    </div>
  );
}

export function UnreviewedBanner({ lang }: { lang: LangCode | null }) {
  const show = lang === null || PACK_STATUS[lang] === 'unreviewed-demo';
  if (!show) return null;
  return (
    <div className="unreviewed-banner" role="note" data-testid="unreviewed-banner">
      {en.unreviewedBanner}
    </div>
  );
}

export function NetworkNote({ text }: { text: string }) {
  return (
    <p className="network-note" data-testid="network-note">
      <Icon name="radio" />
      <span>{text}</span>
    </p>
  );
}

export function Page({ children }: { children: ReactNode }) {
  return <main id="main">{children}</main>;
}
