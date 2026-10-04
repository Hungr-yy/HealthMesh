/** Simulated time: 1 tick = 1 simulated minute. Epoch is a fixed, clearly fictional start. */
export const SIM_EPOCH_MS = Date.UTC(2026, 9, 4, 8, 0, 0);
export const TICK_MS = 60_000;

export function tickToIso(tick: number): string {
  return new Date(SIM_EPOCH_MS + tick * TICK_MS).toISOString();
}

export function isoToTick(iso: string): number {
  return Math.round((Date.parse(iso) - SIM_EPOCH_MS) / TICK_MS);
}

/** "5 min", "2 h 10 min", "3 d 4 h". Ages only; never an arrival estimate. */
export function formatAge(ticks: number): string {
  const t = Math.max(0, Math.floor(ticks));
  if (t < 1) return 'under 1 min';
  if (t < 60) return `${t} min`;
  const h = Math.floor(t / 60);
  if (h < 24) {
    const m = t % 60;
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d} d ${rh} h` : `${d} d`;
}
