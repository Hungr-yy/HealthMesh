import { useCallback, useEffect, useMemo, useState } from 'react';
import type { HealthMessagingClient } from '@shared/client';
import { DIRECTION } from '@shared/i18n';
import type { LangCode } from '@shared/types';
import { SimulationBanner, UnreviewedBanner } from './components/Chrome';
import { AnnounceProvider, Button } from './components/ui';
import { FixtureClient } from './lib/fixtureClient';
import { HttpClient } from './lib/httpClient';
import { DeviceSession } from './lib/session';
import { PatientApp } from './screens/PatientApp';

function useHashRoute(): string {
  const [hash, setHash] = useState(() => window.location.hash || '#/');
  useEffect(() => {
    const on = () => setHash(window.location.hash || '#/');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

export function App() {
  const route = useHashRoute();
  const [lang, setLang] = useState<LangCode | null>(null);
  const params = new URLSearchParams(window.location.search);
  const useFixtures = params.get('fixtures') === '1';

  const fixture = useMemo(() => (useFixtures ? new FixtureClient() : null), [useFixtures]);
  const client: HealthMessagingClient = useMemo(() => fixture ?? new HttpClient(''), [fixture]);
  const device = useMemo(() => new DeviceSession(window.sessionStorage, window.localStorage), []);
  const onLanguage = useCallback((l: LangCode | null) => setLang(l), []);

  useEffect(() => {
    const l = lang ?? 'en';
    document.documentElement.lang = l;
    document.documentElement.dir = DIRECTION[l];
  }, [lang]);

  return (
    <AnnounceProvider>
      <a
        href="#main"
        className="skip-link"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main')?.focus();
        }}
      >
        Skip to main content
      </a>
      <SimulationBanner lang={lang ?? 'en'} />
      <UnreviewedBanner lang={lang} />
      <header className="app-header">
        <span className="brand">Rural Health Radio</span>
      </header>
      <main id="main" tabIndex={-1}>
        {route.startsWith('#/') ? (
          <>
            <PatientApp client={client} device={device} onLanguage={onLanguage} />
            {fixture ? (
              <div className="fixture-bar" data-testid="fixture-bar">
                <p className="small">Fixture mode (SIMULATION): stage is advanced by hand.</p>
                <Button
                  variant="secondary"
                  inline
                  onClick={() => fixture.advance()}
                  data-testid="fixture-advance"
                >
                  Advance fixture stage
                </Button>
              </div>
            ) : null}
          </>
        ) : null}
      </main>
    </AnnounceProvider>
  );
}
