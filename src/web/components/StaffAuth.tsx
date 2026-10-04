import { useEffect, useState } from 'react';
import type { HttpClient } from '../lib/httpClient';

const KEY = 'rhr.staff.v1';

export interface DemoToken {
  role: string;
  name: string;
  token: string;
}

/** DEMO sign-in: choose a synthetic staff identity. Real identity management is not built. */
export function StaffSignIn({
  client,
  want,
  onChange,
}: {
  client: HttpClient;
  want: string;
  onChange: () => void;
}) {
  const [tokens, setTokens] = useState<DemoToken[]>([]);
  const [current, setCurrent] = useState<string>(() => window.sessionStorage.getItem(KEY) ?? '');
  useEffect(() => {
    let live = true;
    client
      .demoTokens()
      .then((t) => live && setTokens(t))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [client]);
  useEffect(() => {
    client.setStaffToken(current || undefined);
  }, [client, current]);
  return (
    <div className="card" data-testid="staff-signin">
      <label htmlFor="staff-select" style={{ fontWeight: 600 }}>
        Demo sign-in (synthetic staff, not real authentication)
      </label>
      <select
        id="staff-select"
        value={current}
        onChange={(e) => {
          const v = e.target.value;
          setCurrent(v);
          client.setStaffToken(v || undefined);
          if (v) window.sessionStorage.setItem(KEY, v);
          else window.sessionStorage.removeItem(KEY);
          onChange();
        }}
      >
        <option value="">Not signed in</option>
        {tokens.map((t) => (
          <option key={t.token} value={t.token}>
            {t.name} - {t.role}
            {t.role === want ? ' (needed here)' : ''}
          </option>
        ))}
      </select>
    </div>
  );
}

export function useStaffToken(): string {
  return window.sessionStorage.getItem(KEY) ?? '';
}
