import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@shared/types';

export interface Loaded<T> {
  data: T | null;
  error: ApiError | null;
  reload: () => void;
}

/** Load once and then poll at a bounded interval. Keeps the last good data on transient errors. */
export function usePolled<T>(fn: () => Promise<T>, deps: unknown[], intervalMs = 2000): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  useEffect(() => {
    let live = true;
    const run = () =>
      fnRef
        .current()
        .then((d) => {
          if (!live) return;
          setData(d);
          setError(null);
        })
        .catch((e: unknown) => {
          if (!live) return;
          setError(e instanceof ApiError ? e : new ApiError('network_error', String(e)));
        });
    const first = setTimeout(() => void run(), 0);
    const id = intervalMs > 0 ? setInterval(() => void run(), intervalMs) : undefined;
    return () => {
      live = false;
      clearTimeout(first);
      if (id) clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce, intervalMs]);
  return { data, error, reload };
}
