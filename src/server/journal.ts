import fs from 'node:fs';
import path from 'node:path';

/** What the engine needs from a journal: the file journal below, or the shared (database) one. */
export interface JournalLike {
  readonly file: string;
  readonly size: number;
  recoveredTornWrite: boolean;
  load(): unknown[];
  append(record: unknown): void;
  reset(): void;
  close(): void;
}

/**
 * Append-only JSON-lines journal with fsync on every append (write-ahead).
 * A torn final line (crash mid-write) is detected on load and truncated.
 */
export class Journal implements JournalLike {
  private fd: number;
  readonly file: string;
  size: number;
  /** Set when load() had to drop a torn trailing record. */
  recoveredTornWrite = false;

  constructor(dir: string, name = 'journal.jsonl') {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, name);
    this.fd = fs.openSync(this.file, 'a+');
    this.size = fs.fstatSync(this.fd).size;
  }

  /** Read all intact records. Truncates a torn tail (no trailing newline or bad JSON). */
  load(): unknown[] {
    const buf = fs.readFileSync(this.file);
    const out: unknown[] = [];
    let start = 0;
    let good = 0;
    while (start < buf.length) {
      const nl = buf.indexOf(10, start);
      if (nl === -1) {
        this.recoveredTornWrite = true;
        break;
      }
      const line = buf.subarray(start, nl).toString('utf8');
      if (line.trim() !== '') {
        try {
          out.push(JSON.parse(line));
        } catch {
          this.recoveredTornWrite = true;
          break;
        }
      }
      good = nl + 1;
      start = nl + 1;
    }
    if (this.recoveredTornWrite) {
      fs.ftruncateSync(this.fd, good);
      this.size = good;
    }
    return out;
  }

  append(record: unknown): void {
    const line = `${JSON.stringify(record)}\n`;
    const buf = Buffer.from(line);
    fs.writeSync(this.fd, buf);
    fs.fsyncSync(this.fd);
    this.size += buf.length;
  }

  /** Demo reset: discard all records. */
  reset(): void {
    fs.ftruncateSync(this.fd, 0);
    this.size = 0;
  }

  close(): void {
    try {
      fs.closeSync(this.fd);
    } catch {
      /* already closed */
    }
  }
}
