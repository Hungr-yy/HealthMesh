import { ApiError } from '@shared/types';
import type { Engine } from './engine';
import type { JournalLike } from './journal';

/**
 * Shared journal for HOSTED DEMO MODE on serverless hosts, where several function instances can
 * serve one visitor and none of them has a disk. The same append-only command log the file
 * journal holds lives in a database; every instance replays it before serving a request and
 * appends its new commands atomically after, with an optimistic "nothing changed meanwhile"
 * check. Engine logic is untouched: state is still a pure replay of the log.
 *
 * SIMULATED service, synthetic data. This is a demo mechanism, not a clustering design.
 */

export interface LogRow {
  seq: number;
  rec: unknown;
}

export interface LogStore {
  /** Rows with seq > after, in order. */
  fetchAfter(after: number): Promise<LogRow[]>;
  /**
   * Atomically append `recs` iff the highest seq in the store is still `expectedLast`.
   * With `reset`, all earlier rows are deleted and a reset marker row precedes `recs`.
   * Returns the new highest seq, or null when someone else appended first.
   */
  append(expectedLast: number, recs: unknown[], reset: boolean): Promise<number | null>;
}

export const RESET_MARKER = { __reset: true } as const;
const isMarker = (r: unknown): boolean =>
  typeof r === 'object' && r !== null && (r as { __reset?: unknown }).__reset === true;

class Conflict extends Error {}

export class SharedJournal implements JournalLike {
  readonly file = 'shared database journal (hosted demo)';
  recoveredTornWrite = false;
  size = 0;
  private mirror: unknown[] = [];
  private pending: unknown[] = [];
  private resetPending = false;
  private lastSeq = 0;

  constructor(private readonly store: LogStore) {}

  // ---- JournalLike (synchronous side used by the engine)
  load(): unknown[] {
    return this.mirror;
  }
  append(record: unknown): void {
    this.pending.push(record);
    this.mirror.push(record);
    this.size += JSON.stringify(record).length + 1;
  }
  reset(): void {
    this.pending = [];
    this.mirror = [];
    this.resetPending = true;
    this.size = 0;
  }
  close(): void {
    /* nothing to close */
  }

  get dirty(): boolean {
    return this.pending.length > 0 || this.resetPending;
  }

  // ---- asynchronous side used around each request
  private absorb(rows: LogRow[]): void {
    for (const row of rows) {
      if (isMarker(row.rec)) {
        this.mirror = [];
        this.size = 0;
      } else {
        this.mirror.push(row.rec);
        this.size += JSON.stringify(row.rec).length + 1;
      }
      this.lastSeq = row.seq;
    }
  }

  /** Pull commands other instances appended; rebuild the engine's state if there were any. */
  async sync(engine: Engine): Promise<void> {
    const rows = await this.store.fetchAfter(this.lastSeq);
    if (!rows.length) return;
    this.absorb(rows);
    engine.replay();
  }

  /** Throw-away local state and rebuild everything from the store (used after a conflict). */
  async rebuild(engine: Engine): Promise<void> {
    this.mirror = [];
    this.pending = [];
    this.resetPending = false;
    this.size = 0;
    this.lastSeq = 0;
    this.absorb(await this.store.fetchAfter(0));
    engine.replay();
  }

  async flush(): Promise<void> {
    if (!this.dirty) return;
    const recs = this.resetPending ? [RESET_MARKER, ...this.pending] : this.pending;
    // our own appended records are already in the mirror; the store assigns their seq
    const last = await this.store.append(this.lastSeq, recs, this.resetPending);
    if (last === null) throw new Conflict('shared journal changed');
    this.lastSeq = last;
    this.pending = [];
    this.resetPending = false;
  }
}

/**
 * Serializes requests within one instance and wraps each as: sync -> run -> flush, retrying
 * from a clean rebuild if another instance appended in between.
 */
export class SharedRunner {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly engine: Engine,
    private readonly journal: SharedJournal,
  ) {}

  run<T>(call: () => Promise<T>): Promise<T> {
    const next = this.tail.then(() => this.once(call));
    this.tail = next.catch(() => undefined);
    return next;
  }

  private async once<T>(call: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 5; attempt++) {
      await this.journal.sync(this.engine);
      let result: T | undefined;
      let failure: unknown;
      let failed = false;
      try {
        result = await call();
      } catch (e) {
        failed = true;
        failure = e;
      }
      try {
        await this.journal.flush();
      } catch (e) {
        if (e instanceof Conflict) {
          await this.journal.rebuild(this.engine);
          continue;
        }
        throw e;
      }
      if (failed) throw failure;
      return result as T;
    }
    throw new ApiError('node_unavailable', 'The demo is busy. Please try again.', 503);
  }
}
