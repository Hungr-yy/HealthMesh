import { neon } from '@neondatabase/serverless';
import type { LogRow, LogStore } from './shared-journal';

/** LogStore on Postgres (Neon over HTTP). One table, one advisory lock for appends. */
export class PgLogStore implements LogStore {
  private readonly sql;
  private ready: Promise<void> | null = null;

  constructor(url: string) {
    this.sql = neon(url);
  }

  private init(): Promise<void> {
    this.ready ??= this.sql`CREATE TABLE IF NOT EXISTS rhr_journal (
        seq bigserial PRIMARY KEY,
        rec jsonb NOT NULL
      )`.then(() => undefined);
    return this.ready;
  }

  async fetchAfter(after: number): Promise<LogRow[]> {
    await this.init();
    const rows = (await this
      .sql`SELECT seq, rec FROM rhr_journal WHERE seq > ${after} ORDER BY seq`) as Array<{
      seq: string | number;
      rec: unknown;
    }>;
    return rows.map((r) => ({ seq: Number(r.seq), rec: r.rec }));
  }

  async append(expectedLast: number, recs: unknown[], reset: boolean): Promise<number | null> {
    await this.init();
    const payload = JSON.stringify(recs);
    const [, inserted] = await this.sql.transaction([
      this.sql`SELECT pg_advisory_xact_lock(7042)`,
      this.sql`WITH cur AS (SELECT COALESCE(MAX(seq), 0) AS m FROM rhr_journal),
          del AS (
            DELETE FROM rhr_journal
            WHERE ${reset}::boolean AND (SELECT m FROM cur) = ${expectedLast}::bigint
            RETURNING 1
          )
        INSERT INTO rhr_journal (rec)
        SELECT r FROM jsonb_array_elements(${payload}::jsonb) AS r
        WHERE (SELECT m FROM cur) = ${expectedLast}::bigint
        RETURNING seq`,
    ]);
    const rows = inserted as Array<{ seq: string | number }>;
    if (!rows.length) return null;
    return Math.max(...rows.map((r) => Number(r.seq)));
  }
}
