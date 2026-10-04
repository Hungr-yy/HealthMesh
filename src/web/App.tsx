import { useCallback, useEffect, useMemo, useState } from 'react';
import type { HealthMessagingClient } from '@shared/client';
import { DIRECTION } from '@shared/i18n';
import type { LangCode } from '@shared/types';
import { SimulationBanner, UnreviewedBanner } from './components/Chrome';
import { AnnounceProvider, Button } from './components/ui';
import { FixtureClient } from './lib/fixtureClient';
import { HttpClient } from './lib/httpClient';
import { DeviceSession } from './lib/session';
import { AdminApp } from './screens/AdminApp';
import { CapabilitiesApp } from './screens/CapabilitiesApp';
import { ClinicApp } from './screens/ClinicApp';
import { OperatorApp } from './screens/OperatorApp';
import { PatientApp } from './screens/PatientApp';
import { SimPanel } from './screens/SimPanel';

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
  const [patientLang, setPatientLang] = useState<LangCode | null>(null);
  const params = new URLSearchParams(window.location.search);
  const useFixtures = params.get('fixtures') === '1';

  const fixture = useMemo(() => (useFixtures ? new FixtureClient() : null), [useFixtures]);
  const http = useMemo(() => new HttpClient(''), []);
  const patientClient: HealthMessagingClient = fixture ?? http;
  const device = useMemo(() => new DeviceSession(window.sessionStorage, window.localStorage), []);
  const onLanguage = useCallback((l: LangCode | null) => setPatientLang(l), []);

  const area = route.startsWith('#/clinic')
    ? 'clinic'
    : route.startsWith('#/operator')
      ? 'operator'
      : route.startsWith('#/sim')
        ? 'sim'
        : route.startsWith('#/admin')
          ? 'admin'
          : route.startsWith('#/capabilities')
            ? 'capabilities'
            : 'patient';
  const lang: LangCode | null = area === 'patient' ? patientLang : null;

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
        {fixture ? null : (
          <nav className="nav-links" aria-label="Demo views">
            <a href="#/" aria-current={area === 'patient' ? 'page' : undefined}>
              Patient device
            </a>
            <a href="#/clinic" aria-current={area === 'clinic' ? 'page' : undefined}>
              Clinic
            </a>
            <a href="#/operator" aria-current={area === 'operator' ? 'page' : undefined}>
              Operator
            </a>
            <a href="#/admin" aria-current={area === 'admin' ? 'page' : undefined}>
              Admin
            </a>
            <a href="#/sim" aria-current={area === 'sim' ? 'page' : undefined}>
              Simulator
            </a>
            <a href="#/capabilities" aria-current={area === 'capabilities' ? 'page' : undefined}>
              Capabilities
            </a>
          </nav>
        )}
      </header>
      <main id="main" tabIndex={-1} className={area === 'patient' ? '' : 'wide'}>
        {area === 'patient' ? (
          <>
            <PatientApp client={patientClient} device={device} onLanguage={onLanguage} />
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
        {area === 'clinic' ? <ClinicApp client={http} /> : null}
        {area === 'operator' ? <OperatorApp client={http} /> : null}
        {area === 'sim' ? <SimPanel client={http} /> : null}
        {area === 'admin' ? <AdminApp client={http} /> : null}
        {area === 'capabilities' ? <CapabilitiesApp /> : null}
      </main>
    </AnnounceProvider>
  );
}
