# Verification

> **SIMULATION. SYNTHETIC DATA ONLY.** Everything below was measured on a development machine against the simulator and a local service. None of it says anything about real radio links, real users, real clinics, or clinical safety.

Labels: **FACT** = measured/tested here, conditions stated, reproducible. **INFERENCE** = reasoning from facts plus stated assumptions. **UNKNOWN** = not known.

Environment: Linux, Node v20.19.2, headless Chromium via Playwright, TypeScript 6, Vite 8, Vitest. Tested date: 2026-10-04.

## 1. Static checks (FACT)

| Command                                                             | Result               |
| ------------------------------------------------------------------- | -------------------- |
| `npm run typecheck` (`tsc --noEmit`)                                | 0 errors             |
| `npm run lint` (ESLint flat config, typescript-eslint, react-hooks) | 0 errors, 0 warnings |
| `npm run format:check` (Prettier)                                   | all files formatted  |

## 2. Unit and service tests (FACT): `npm test`

**8 files, 88 tests, 88 passed, 0 failed** (Vitest, about 2 s).

| File                              | Tests | Covers                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/shared.test.ts`            |    13 | codec round-trip (en/sw/ar), language-pack key parity, tracks never regress or claim clinic receipt early, event de-duplication and ordering, mock translation and draft rules                                                                                                                                                                                                                    |
| `tests/session.test.ts`           |     3 | switching patient wipes drafts/secrets/cases, 24 h draft retention, lock wipes all                                                                                                                                                                                                                                                                                                                |
| `tests/phase2-durability.test.ts` |     8 | restart replay, torn final record dropped, real-process **SIGKILL** after an acknowledged accept, idempotent message id, id conflict, storage nearly full, 401 without credential                                                                                                                                                                                                                 |
| `tests/relay.test.ts`             |    18 | full journey; restart; power interruption; lost ack and lost submission response; duplicate delivery at the clinic hop; reordered acks; outage then restore; bounded retry; expiry and linked resubmission; patient isolation; **reply unsent until clinician approval**; translation failure; operator view has no content                                                                       |
| `tests/api.test.ts`               |     6 | HTTP role checks on a real service process (clinic, operator, Stage A endpoints), typed storage-full / node-unavailable errors, malformed and oversize input, `RHR_SIM_CONTROLS=off` removes every simulator endpoint                                                                                                                                                                             |
| `tests/speech.test.ts`            |    14 | voice: adapter feature detection and error mapping, deterministic mock scenarios, locale per language, voice flag survives the codec                                                                                                                                                                                                                                                              |
| `tests/hosted.test.ts`            |     4 | hosted-demo mode: the Vercel serverless entry called with a raw Node request (and with a platform-pre-parsed body) reports hosted mode with the exact banner wording, keeps simulator state across requests on a warm instance, and rejects malformed JSON / unknown routes                                                                                                                       |
| `tests/stage-a.test.ts`           |    22 | gateway inbox/outbox with independent radio and upstream outages (and restart); permission table and unauthorized access (operator/admin never read clinical content); clarification link validation and idempotent approval; correction/withdrawal; coverage, overdue, handover, closure; consent records; audit events hold no names or text; admin config; node health; capability doc in sync |

## 3. Browser tests (FACT): `npm run test:e2e`

Real service + built UI, headless Chromium, two viewports (320x640 and 1280x800), each full run starting from a fresh data directory.

**68 tests, 68 passed, 0 failed** (about 2.5 min), one full run on 2026-10-04 that produced the committed screenshots and axe file.

| Spec                       | Tests | Covers                                                                                                                                                                                                                                                                                              |
| -------------------------- | ----: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `noor-journey.spec.ts`     |     2 | Noor journey A-H, clinic inbox, case, reply editor and approval, operator dashboard, reply arrival and open, device cleared                                                                                                                                                                         |
| `languages-assist.spec.ts` |    12 | Swahili and Arabic (UNREVIEWED banner, RTL), translation flagged / unavailable, uncertain highlights, assisted mode without leakage between patients, recorded assisted reading                                                                                                                     |
| `failures.spec.ts`         |    20 | node unavailable, storage nearly full, lost response, no upstream signal, power-off on receipt, expiry and resubmission, bounded retry, delayed response shows ages only, withdrawal                                                                                                                |
| `accessibility.spec.ts`    |     4 | 200% text at 320px, focus placement, visible focus ring, no animation, live region, RTL attributes                                                                                                                                                                                                  |
| `phase1-fixtures.spec.ts`  |     2 | keyboard-operable flow on static fixtures, 48x48 px primary targets                                                                                                                                                                                                                                 |
| `voice.spec.ts`            |    19 | voice input against a scripted FAKE Web Speech API: consent line, keyboard and 48 px targets, decline, unsupported, permission denied, mid-capture error, Arabic RTL, Swahili locale, 200% text at 320px                                                                                            |
| `hosted.spec.ts`           |     1 | the hosted-demo banner is shown on every view exactly when the service reports hosted mode, never in the local build or on fixtures; SIMULATION banner always                                                                                                                                       |
| `spec-demo.spec.ts`        |     2 | **spec section 15 demo**, both viewports: accepted while upstream is down, service restart, gateway ack without clinic ack, operator gateway panel, injected duplicate produces ONE case, clinician approval, return-path interruption and recovery, operator view has no patient text, device lock |
| `stage-a-ui.spec.ts`       |     6 | clarification question and linked answer in one conversation, coverage statement and overdue badge, handover, closure with explicit outcome, admin settings change in the audit trail, permission table, capability and language matrices                                                           |

## 4. Accessibility (FACT, with limits)

- **axe-core 4.13.0 via @axe-core/playwright, scanned on every recorded screen: 142 scans (71 screens x 2 viewports), 0 violations** (1725 rule passes at 320px, 1745 at 1280px). Raw data: `docs/axe-results.json`.
- Contrast ratios computed from the stylesheet: all text pairs pass 4.5:1 (lowest: muted text on page background 7.87:1); control border 4.07:1 and focus ring 8.48:1 to 9.89:1 against their backgrounds (non-text 3:1). See `docs/measurements/contrast.md`. The focus ring is drawn outside the control, so it is measured against the surrounding background.
- Layout: no horizontal scroll at 320px on any recorded screen; 200% text checked on the journey in `accessibility.spec.ts`.
- **Not covered:** axe finds only a subset of WCAG issues. **UNKNOWN:** behaviour with real screen readers (TalkBack, VoiceOver, NVDA), switch access, low-end devices, outdoor glare.

## 5. Encoded request size (FACT for the bytes, INFERENCE for frames and airtime)

`npm run evidence:bytes` -> `docs/measurements/request-bytes.md`.

Conditions: prototype codec (`src/shared/codec.ts`), 16-byte message id, UTF-8, synthetic fixtures; **no encryption, FEC, or radio framing**; JSON = the POST body the browser sends to the local node; deflate = raw level 9 of the codec bytes. The 300/1000-character cases repeat one sentence, so their deflate sizes are unrealistically small and must not be generalized.

| Case                          | JSON | codec | codec + deflate |
| ----------------------------- | ---: | ----: | --------------: |
| Noor, English                 |  389 |   135 |             118 |
| Noor, Swahili (UNREVIEWED)    |  362 |   108 |              95 |
| Noor, Arabic (UNREVIEWED)     |  390 |   136 |             113 |
| Minimal (type + 12-char note) |  291 |    33 |              30 |
| Assisted entry with contact   |  438 |   169 |             139 |
| 300-character note            |  623 |   370 |             100 |
| 1000-character note           | 1323 |  1070 |             107 |

INFERENCE: with assumed 128-byte frames and 8-byte overhead, a Noor English request fits in 2 frames, about 1.0 s at an assumed 1200 bps. These are arithmetic on assumptions, not RF results. Base64 transport would add about 33% (from the source plan; not measured here).

## 6. What is NOT validated (UNKNOWN)

- **Real users.** No usability testing with patients, community health workers, or clinicians. Time-to-complete, error rates, comprehension, and trust are unmeasured. Any success target in the plan is a target only.
- **Real RF and hardware.** No radio, range, power, duty-cycle, latency, or throughput measurement. Simulator loss and delays are scripted, not modelled on real links. Country radio authorization is unresolved.
- **Translation and language quality.** Swahili and Arabic strings are UNREVIEWED demo text; the translator is a tiny phrase dictionary.
- **Clinical safety.** Templates, draft rules, and escalation wording have had no clinical review. The prototype does not diagnose, prescribe, or prioritize on its own; humans approve every reply.
- **Security and privacy.** No security review or penetration test. No at-rest encryption; demo tokens are not authentication; no consent/retention legal review.
- **Scale and long-run behaviour.** No load, soak, multi-device, or clock-skew testing. Node clocks are modelled as unsynced.
- **Voice input accuracy.** Voice input is implemented behind a swappable adapter (`src/web/lib/speech.ts`) and tested only against a deterministic mock and a scripted fake of the Web Speech API. Real-browser speech recognition accuracy (en-US, sw-KE, ar-SA) and which third-party service a given browser sends audio to are **UNKNOWN**.
- **Integrations** (DHIS2, FHIR, LLM assistance) are plan only.
- **Gateway realism.** The gateway inbox/outbox are an explicit module, but their state is derived from the same journal as the rest of the simulation: no separate gateway process, disk or real upstream link exists. Radio-vs-upstream outage handling is tested in the simulator only.
- **Stage A items not built:** patient-unavailable workflow, integration service, at-rest encryption, real identity (demo tokens only), enforced retention, facilities / nodes / staff-access / incident administration.
- **Staffing and overdue.** Coverage is a stated value; the overdue flag compares simulated age to a configured review window. No real rota, calendar or escalation exists.
- **Videos.** The three submission videos are screen recordings of the simulator driven by a script (`scripts/record-videos.ts`); they show scripted behaviour, not user research.

## 7. Hosted demo (FACT for what was run; UNKNOWN for real hosts)

Hosted demo mode = the same service and synthetic data, a banner on every screen, journal in the temp directory. Nothing was deployed or pushed. See [docs/DEPLOY.md](docs/DEPLOY.md).

| Target (run on this machine)                                                                                                                                                 | Result                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `RHR_E2E_TARGET=hosted`: bundled single Node server (`dist-server/server.mjs`, what the Docker image runs)                                                                   | full Playwright suite 67 of 67 passed; `hosted.spec` 1 of 1 passed separately                                   |
| `RHR_E2E_TARGET=vercel-sim`: `.vercel/output` served by a Node stand-in for the platform router, function called with raw Node req/res                                       | full suite 68 of 68 passed (incl. Noor journey, spec section 15 demo, Stage A UI, axe on every recorded screen) |
| Image emulation: only `dist/` + `dist-server/` copied to an empty directory, no `node_modules`, started with the Dockerfile's environment (`PORT=10000`, `RHR_HOST=0.0.0.0`) | `noor-journey`, `spec-demo`, `stage-a-ui`, `hosted` specs: 11 of 11 passed                                      |

- **UNKNOWN / not run:** the Dockerfile was **not built** (no Docker on this machine); the Render Blueprint and `vercel.json` were **not exercised** on Render or Vercel; `vercel dev` / `vercel build` were not run (no account or login used). The Vercel route (`/api/*` to the function keeping the original `req.url`) is the documented platform behaviour, not something observed here.
- **Limitation (FACT by design):** on a hosted URL, state lives in one instance's temp disk or memory. It resets on redeploy, idle spin-down or cold start, and on Vercel separate warm instances do not share state, so a multi-step flow can lose its case mid-demo. Restart durability is therefore demonstrated in the local build and tests (including a real-process SIGKILL test), not on the hosted URL.
- The simulator endpoints are unauthenticated on the public URL (anyone can reset or advance the shared demo).

## 8. Reproduce

```bash
npm ci && npx playwright install chromium
npm run check && npm run test:e2e
npm run evidence:bytes && npm run evidence:contrast
```

Run note: the full Playwright suite passed (see section 3) in the run that produced the committed screenshots and axe file. An earlier 40-test suite (before voice and Stage A) passed twice back to back; the 68-test suite has been run in full once on the local target.

Hosted targets: `RHR_E2E_TARGET=hosted|vercel-sim RHR_E2E_OUT=/tmp/out npx playwright test`.

Regenerate docs: `npm run docs:capabilities`. Re-record videos: `npm run build:web && npx tsx scripts/record-videos.ts`.
