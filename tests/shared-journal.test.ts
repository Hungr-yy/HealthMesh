import { describe, expect, it } from 'vitest';
import { Engine } from '../src/server/engine';
import {
  RESET_MARKER,
  SharedJournal,
  SharedRunner,
  type LogRow,
  type LogStore,
} from '../src/server/shared-journal';
import { newMsg } from './helpers';

/** In-memory stand-in for the database log with the same atomic-append contract as PgLogStore. */
class MemoryStore implements LogStore {
  rows: LogRow[] = [];
  next = 1;
  /** Test hook: runs once just before the next append (to simulate another instance racing). */
  beforeAppend: (() => Promise<void>) | null = null;
  async fetchAfter(after: number) {
    return this.rows.filter((r) => r.seq > after).map((r) => ({ ...r }));
  }
  async append(expectedLast: number, recs: unknown[], reset: boolean) {
    const hook = this.beforeAppend;
    this.beforeAppend = null;
    if (hook) await hook();
    const last = this.rows.length ? this.rows[this.rows.length - 1]!.seq : 0;
    if (last !== expectedLast) return null;
    if (reset) this.rows = [];
    for (const rec of recs) this.rows.push({ seq: this.next++, rec });
    return this.rows[this.rows.length - 1]!.seq;
  }
}

function instance(store: LogStore) {
  const journal = new SharedJournal(store);
  const engine = Engine.openWith(journal);
  const runner = new SharedRunner(engine, journal);
  return { journal, engine, runner, run: <T>(f: () => T) => runner.run(async () => f()) };
}

describe('shared journal: separate serverless instances agree on one demo state', () => {
  it('a case created on one instance is visible, and advances, on another', async () => {
    const store = new MemoryStore();
    const a = instance(store);
    const b = instance(store);
    const m = newMsg();
    await a.run(() => a.engine.submit(m.input, m.messageId, m.secret));
    const seenByB = await b.run(() =>
      b.engine.getCase(a.engine.state.cases.keys().next().value!, m.secret),
    );
    expect(seenByB.ref).toMatch(/^NR-/);
    await b.run(() => b.engine.advance(30));
    await a.run(() => undefined);
    expect(a.engine.state.tick).toBe(30);
    expect(b.engine.state.tick).toBe(30);
  });

  it('a duplicate submission (same message id) on another instance is still one case', async () => {
    const store = new MemoryStore();
    const a = instance(store);
    const b = instance(store);
    const m = newMsg();
    await a.run(() => a.engine.submit(m.input, m.messageId, m.secret));
    await b.run(() => b.engine.submit(m.input, m.messageId, m.secret));
    expect(a.engine.state.cases.size).toBe(1);
    await a.run(() => undefined);
    expect(a.engine.state.cases.size).toBe(1);
    expect(b.engine.state.cases.size).toBe(1);
  });

  it('reset on one instance clears the others', async () => {
    const store = new MemoryStore();
    const a = instance(store);
    const b = instance(store);
    await a.run(() => a.engine.advance(10));
    await b.run(() => undefined);
    expect(b.engine.state.tick).toBe(10);
    await a.run(() => a.engine.reset());
    await b.run(() => undefined);
    expect(b.engine.state.tick).toBe(0);
    expect(store.rows[0]!.rec).toEqual(RESET_MARKER);
    await b.run(() => b.engine.advance(3));
    await a.run(() => undefined);
    expect(a.engine.state.tick).toBe(3);
  });

  it('a racing append from another instance causes a clean retry, never a lost or doubled command', async () => {
    const store = new MemoryStore();
    const a = instance(store);
    const b = instance(store);
    // just before A's flush, B sneaks in an advance(5)
    store.beforeAppend = async () => {
      await b.run(() => b.engine.advance(5));
    };
    await a.run(() => a.engine.advance(2));
    await b.run(() => undefined);
    expect(a.engine.state.tick).toBe(7);
    expect(b.engine.state.tick).toBe(7);
    expect(store.rows.length).toBe(2); // exactly two commands in the log
  });

  it('restart replays the shared log', async () => {
    const store = new MemoryStore();
    const a = instance(store);
    await a.run(() => a.engine.advance(12));
    await a.run(() => a.engine.restart());
    expect(a.engine.state.tick).toBe(12);
  });
});
