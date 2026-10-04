/**
 * Records the three submission videos from the REAL running app (SIMULATED data), headless,
 * 1280x720, silent, with burned-in captions and a permanent SIMULATION strip.
 *
 *   npm run build:web && npx tsx scripts/record-videos.ts [team-intro|demo|teach]...
 *
 * Starts its own service on a spare port with a fresh data directory, records with Playwright's
 * video recorder (real-time pacing), then encodes to mp4 with ffmpeg. Nothing leaves this machine.
 */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from '@playwright/test';

const PORT = 4180;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.resolve('submission');
const W = 1280;
const H = 720;
const HOLD = Number(process.env.HOLD ?? 1.3); // multiplier on caption holds (reading time)

const BANNER = 'SIMULATION - synthetic data only - not a medical device';

const OVERLAY = `(() => {
  const BANNER = ${JSON.stringify(BANNER)};
  function mount() {
    if (!document.documentElement) return;
    if (document.getElementById('__ov_top')) return;
    const st = document.createElement('style');
    st.textContent = 'html{padding-top:30px!important;padding-bottom:84px!important}' +
      '#__ov_top{position:fixed;top:0;left:0;right:0;height:30px;z-index:2147483647;background:#ffd400;color:#000;' +
      'font:700 16px/30px system-ui,sans-serif;text-align:center;pointer-events:none}' +
      '#__ov_cap{position:fixed;bottom:0;left:0;right:0;min-height:84px;z-index:2147483647;background:#101820;color:#fff;' +
      'font:600 25px/1.3 system-ui,sans-serif;padding:12px 28px;box-sizing:border-box;pointer-events:none;display:none;' +
      'align-items:center;border-top:4px solid #ffd400}';
    document.documentElement.appendChild(st);
    const top = document.createElement('div'); top.id = '__ov_top'; top.textContent = BANNER;
    const cap = document.createElement('div'); cap.id = '__ov_cap';
    document.documentElement.appendChild(top); document.documentElement.appendChild(cap);
    const update = () => {
      let t = '';
      try { t = sessionStorage.getItem('__cap') || ''; } catch (e) {}
      cap.textContent = t; cap.style.display = t ? 'flex' : 'none';
    };
    update(); setInterval(update, 150);
  }
  mount();
  document.addEventListener('DOMContentLoaded', mount);
})();`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sim(action: string, body: unknown = {}): Promise<void> {
  const r = await fetch(`${BASE}/api/sim/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`sim ${action} -> ${r.status}`);
}

async function startServer(): Promise<{ proc: ChildProcess; dir: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhr-video-'));
  const proc = spawn('node_modules/.bin/tsx', ['src/server/index.ts'], {
    env: { ...process.env, RHR_PORT: String(PORT), RHR_DATA_DIR: dir },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${BASE}/`);
      if (r.ok) return { proc, dir };
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  throw new Error('service did not start');
}

class Recorder {
  t0 = 0;
  constructor(
    readonly page: Page,
    readonly ctx: BrowserContext,
  ) {}
  start() {
    this.t0 = Date.now();
  }
  elapsed() {
    return (Date.now() - this.t0) / 1000;
  }
  async caption(text: string) {
    await this.page.evaluate((t) => {
      try {
        sessionStorage.setItem('__cap', t);
      } catch {
        /* about:blank */
      }
    }, text);
  }
  /** Show a caption and hold so it can be read. */
  async say(text: string, holdMs: number) {
    await this.caption(text);
    await this.page.waitForTimeout(holdMs * HOLD);
  }
  async card(html: string, holdMs: number) {
    await this.caption('');
    const html2 = `<!doctype html><meta charset="utf-8"><title>card</title><style>
      body{margin:0;background:#fff;color:#101820;font:400 28px/1.45 system-ui,sans-serif;display:flex;align-items:center;min-height:100vh}
      main{max-width:1000px;margin:0 auto;padding:24px 40px}
      h1{font-size:56px;line-height:1.1;margin:0 0 18px} h2{font-size:40px;margin:0 0 16px}
      p{margin:0 0 14px} li{margin:0 0 10px} .small{font-size:22px;color:#333}
      .tag{display:inline-block;background:#101820;color:#fff;padding:2px 12px;border-radius:6px;font-size:22px;font-weight:700}
    </style><main>${html}</main>`;
    await this.page.route('**/__card', (r) =>
      r.fulfill({ contentType: 'text/html; charset=utf-8', body: html2 }),
    );
    await this.page.goto(`${BASE}/__card`);
    await this.page.waitForTimeout(holdMs);
  }
}

async function record(
  name: string,
  script: (r: Recorder) => Promise<void>,
  prep?: () => Promise<void>,
): Promise<{ file: string; seconds: number }> {
  await sim('reset');
  if (prep) await prep();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `rhr-rec-${name}-`));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    recordVideo: { dir: tmp, size: { width: W, height: H } },
  });
  await ctx.addInitScript(OVERLAY);
  const tPage = Date.now();
  const page = await ctx.newPage();
  const rec = new Recorder(page, ctx);
  await page.goto(`${BASE}/__card`).catch(() => undefined);
  rec.start();
  const trim = Math.max(0.2, (rec.t0 - tPage) / 1000 - 0.1);
  await script(rec);
  const seconds = rec.elapsed();
  const video = page.video();
  await ctx.close();
  await browser.close();
  const webm = await video!.path();
  const mp4 = path.join(OUT, `${name}.mp4`);
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-ss',
    '0.5',
    '-i',
    webm,
    '-an',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-crf',
    '23',
    '-r',
    '25',
    '-movflags',
    '+faststart',
    mp4,
  ]);
  const dur = Number(
    execFileSync('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'csv=p=0',
      mp4,
    ]).toString(),
  );
  console.log(
    `${name}: script ${seconds.toFixed(1)}s, mp4 ${dur.toFixed(2)}s, ${fs.statSync(mp4).size} bytes`,
  );
  if (dur >= 60) throw new Error(`${name} is ${dur}s (must be < 60)`);
  return { file: mp4, seconds: dur };
}

/* ------------------------------------------------------------------ scripts */

async function teamIntro(r: Recorder) {
  await r.card(
    `<span class="tag">SIMULATED PROTOTYPE</span>
     <h1>Rural Health Radio</h1>
     <p>Delay-tolerant health messaging for people who cannot count on a connection.</p>
     <p class="small">Team: Tejas Chaudhari</p>`,
    8000,
  );
  await r.card(
    `<h2>The problem we designed for</h2>
     <p>Someone far from a clinic may have no reliable signal. A call or app that needs a live connection simply fails.</p>
     <p>So a message has to survive delays, power cuts and dropped links, and the sender still needs an honest answer to one question: <strong>did anyone get it?</strong></p>`,
    11000,
  );
  await r.card(
    `<h2>What this prototype shows</h2>
     <ul>
       <li>Write once; the village node saves it durably, then forwards it hop by hop.</li>
       <li>The screen says only what is known, and what to do next.</li>
       <li>A clinician reads the original and approves every reply.</li>
     </ul>`,
    10000,
  );
  await r.page.goto(`${BASE}/`);
  await r.say('The real app, running locally in a simulator: the patient starts here.', 6500);
  await r.card(
    `<span class="tag">READ THIS</span>
     <h2>Everything here is simulated</h2>
     <p>Synthetic data only. No real radio, clinic or patient. Not a medical device.</p>
     <p>Swahili and Arabic text is unreviewed. Nothing has been evaluated with real users.</p>
     <p class="small">Team: Tejas Chaudhari</p>`,
    8500,
  );
}

async function demo(r: Recorder) {
  const p = r.page;
  await p.goto(`${BASE}/`);
  await r.say('Noor (synthetic) is far from the clinic. The uplink is DOWN.', 2200);
  await p.getByTestId('lang-en').click();
  await p.getByTestId('mode-self').click();
  await p.getByTestId('ask-clinic').click();
  await p.getByTestId('type-follow_up').click();
  await p.locator('#name').fill('Noor (synthetic)');
  await p.locator('#details').fill('I need a follow-up. My medicine has run out.');
  await r.say('1. Noor confirms a follow-up request while upstream is disconnected.', 1200);
  await p.getByTestId('details-next').click();
  await p.getByTestId('confirm-right').click();
  await p.getByTestId('consent1').check();
  await p.getByTestId('consent2').check();
  await p.getByTestId('send-request').click();
  await p.getByTestId('no-upstream').waitFor();
  await r.say(
    '2. Accepted durably on the village node. Status: "Waiting to send". Not "sent".',
    3200,
  );
  const ref = ((await p.getByTestId('case-ref').textContent()) ?? '').trim();

  await p.goto(`${BASE}/#/sim`);
  await p.getByTestId('restart').click();
  await r.say('3. Restart the local service: its state is rebuilt from the journal on disk.', 2400);
  await p.goto(`${BASE}/#/`);
  await p.reload();
  await r.say(`Same reference (${ref}) and still queued after the restart.`, 2200);

  await sim('link', { index: 3, up: false });
  await p.goto(`${BASE}/#/sim`);
  await p.getByTestId('link-0').click();
  await p.getByTestId('advance-60').click();
  await r.caption('4. Relay restored (village to ridge). Gateway-to-clinic upstream stays down.');
  await p.waitForTimeout(1800);
  await p.goto(`${BASE}/#/`);
  await p.reload();
  await r.say(
    '5. Gateway ack only: "Reached the gateway". The clinic has NOT acknowledged it.',
    3400,
  );

  await sim('config', { faults: [{ flowKind: 'request', hop: 3, attempt: 1, fault: 'lose_ack' }] });
  await sim('link', { index: 3, up: true });
  await sim('advance', { ticks: 120 });
  await p.reload();
  await r.say(
    'Clinic ack arrives separately: "The clinic received it". A duplicate was injected too.',
    3000,
  );

  await p.goto(`${BASE}/#/clinic`);
  await p.reload();
  await p.locator('#staff-select').selectOption('demo-token-clinician-amina');
  await p.getByTestId(`inbox-${ref}`).click();
  await r.say('6. Clinician compares the original with the optional draft summary.', 3200);
  await p.getByTestId('claim').click();
  await p.getByTestId('start-review').click();
  await sim('link', { index: 1, up: false });
  await p.getByTestId('go-reply').click();
  await p.locator('#tpl').selectOption('follow-up-thursday');
  await p.getByTestId('approve-confirm').check();
  await p.getByTestId('approve-reply').click();
  await p.getByTestId('approved-record').waitFor();
  await r.say('The clinician approves the reply. Nothing is sent without this step.', 2600);

  await sim('advance', { ticks: 150 });
  await p.goto(`${BASE}/#/`);
  await p.reload();
  await r.say(
    '7. Return path interrupted: the approved reply waits, no reply on the village device.',
    2800,
  );
  await sim('link', { index: 1, up: true });
  await sim('advance', { ticks: 200 });
  await p.reload();
  await p.getByTestId('open-reply').click();
  await r.say(
    'Path restored: Noor retrieves the reply at the village. "Opened" is confirmed separately.',
    3200,
  );

  await p.goto(`${BASE}/#/operator`);
  await p.reload();
  await p.locator('#staff-select').selectOption('demo-token-operator-ops');
  await p.getByTestId('events-table').waitFor();
  await r.say(
    '8. Duplicate delivery: events show it suppressed. ONE logical case. 9. Operator sees no patient content.',
    4600,
  );

  await p.goto(`${BASE}/#/`);
  await p.reload();
  await p.getByTestId('lock-device').click();
  await r.say(
    '10. Lock the shared device: the reply and the request are cleared from the screen.',
    3200,
  );
}

async function teach(r: Recorder) {
  const p = r.page;
  await r.card(
    `<h2>How it works: store, then forward</h2>
     <p>Every step saves to disk <em>before</em> it is acknowledged. Each hop keeps custody until the next hop acknowledges.</p>`,
    5500,
  );
  await p.goto(`${BASE}/`);
  await p.getByTestId('lang-en').click();
  await p.getByTestId('mode-self').click();
  await p.getByTestId('ask-clinic').click();
  await p.getByTestId('type-follow_up').click();
  await p.locator('#details').fill('Please confirm my follow-up visit.');
  await p.getByTestId('details-next').click();
  await p.getByTestId('confirm-right').click();
  await p.getByTestId('consent1').check();
  await p.getByTestId('consent2').check();
  await p.getByTestId('send-request').click();
  await p.getByTestId('tracks').waitFor();
  await r.say('Durable queue: the request is saved on the village node first.', 3000);
  await p.goto(`${BASE}/#/sim`);
  await p.getByTestId('power-cut').click();
  await r.say('Power cut and reboot from disk (simulated): nothing accepted is lost.', 3200);
  await sim('link', { index: 3, up: false });
  await sim('advance', { ticks: 90 });
  await p.goto(`${BASE}/#/`);
  await p.reload();
  await r.say(
    'Relay states appear only on evidence: here the gateway has it, the clinic does not yet.',
    4800,
  );
  await sim('link', { index: 3, up: true });
  await sim('advance', { ticks: 120 });

  await p.goto(`${BASE}/#/admin`);
  await p.reload();
  await p.locator('#staff-select').selectOption('demo-token-admin-zawadi');
  await p.getByTestId('permissions-table').scrollIntoViewIfNeeded();
  await r.say(
    'Human approval: only the clinician role may approve a reply. Enforced in the service.',
    5200,
  );

  await r.card(
    `<h2>When things go wrong</h2>
     <ul>
       <li>Lost acknowledgements and duplicates: the same message id, one case.</li>
       <li>Retries are bounded; then it asks for help instead of spinning.</li>
       <li>Expired or withdrawn: explained plainly, forwarded copies cannot be erased.</li>
     </ul>`,
    8000,
  );
  await p.goto(`${BASE}/#/capabilities`);
  await p.reload();
  await r.say(
    'Honest limits: this page lists what is simulated, implemented, evaluated or future.',
    5200,
  );
  await p.getByTestId('language-matrix').scrollIntoViewIfNeeded();
  await r.say(
    'Swahili and Arabic are UNREVIEWED demo strings. Nothing is evaluated with real users.',
    5200,
  );
  await r.card(
    `<span class="tag">NOT PROVEN</span>
     <h2>Honest limits</h2>
     <p>No real radio, range or hardware tested. No real users. No clinical or security review.</p>
     <p class="small">Team: Tejas Chaudhari</p>`,
    5500,
  );
}

const ALL: Record<string, { fn: (r: Recorder) => Promise<void>; prep?: () => Promise<void> }> = {
  'team-intro': { fn: teamIntro },
  demo: { fn: demo, prep: () => sim('link', { index: 0, up: false }) },
  teach: { fn: teach },
};

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const which = process.argv.slice(2).filter((a) => a in ALL);
  const names = which.length ? which : Object.keys(ALL);
  const { proc, dir } = await startServer();
  try {
    for (const n of names) await record(n, ALL[n]!.fn, ALL[n]!.prep);
  } finally {
    proc.kill('SIGTERM');
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
