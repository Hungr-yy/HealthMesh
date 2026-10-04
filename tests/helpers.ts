import { fork, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { newSecret, newUuid } from '@shared/ids';
import { NOOR_INPUT } from '@shared/fixtures';
import type { RequestInput } from '@shared/types';
import { Engine } from '../src/server/engine';

export function tmpDir(prefix = 'rhr-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function openEngine(dir: string | null = tmpDir()): { engine: Engine; dir: string | null } {
  return { engine: Engine.open(dir), dir };
}

export function newMsg(input: Partial<RequestInput> = {}) {
  return { messageId: newUuid(), secret: newSecret(), input: { ...NOOR_INPUT, ...input } };
}

/** Spawn the real service as a child process so we can SIGKILL it (true crash, no cleanup). */
export async function startService(
  dataDir: string,
  port: number,
  extraEnv: Record<string, string> = {},
): Promise<{ proc: ChildProcess; url: string }> {
  const proc = fork(path.resolve('node_modules/tsx/dist/cli.mjs'), ['src/server/index.ts'], {
    env: { ...process.env, RHR_DATA_DIR: dataDir, RHR_PORT: String(port), ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${url}/api/health`);
      if (r.ok) return { proc, url };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill('SIGKILL');
  throw new Error('service did not start');
}

export function freePort(): number {
  return 20000 + Math.floor(Math.random() * 20000);
}
