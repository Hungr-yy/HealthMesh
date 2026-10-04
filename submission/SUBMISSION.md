# Rural Health Radio - submission

> **SIMULATION. SYNTHETIC DATA ONLY. NOT A MEDICAL DEVICE.** Nothing here transmits over a real radio, reaches a real clinic, or involves a real patient. Nothing has been evaluated with real users, real radios, or in the field.

**Team:** Tejas Chaudhari
**Repository:** https://github.com/Hungr-yy/HealthMesh

## Links

- **Working demo link:** <https://rural-health-radio.vercel.app> (deploy steps in [`docs/DEPLOY.md`](../docs/DEPLOY.md)). The hosted demo shows the banner "Hosted demo: state may reset; durable journal is demonstrated in the local build and tests".
- **Repository:** https://github.com/Hungr-yy/HealthMesh
- **Videos:** `team-intro.mp4`, `demo.mp4`, `teach.mp4` in this folder.

## Summary

Rural Health Radio is a simulated prototype of delay-tolerant health messaging. A person with no reliable connection writes a short request; a village node saves it durably before it says "accepted"; the request is relayed hop by hop through a gateway to a clinic; a clinician compares the original with an optional draft summary and approves a reply; the reply travels back. At every step the screen states only what is actually known and what to do next.

## Problem

People far from a clinic may not have a reliable connection, so a service that needs a live link fails exactly when it is needed. A message has to survive delays, power cuts and dropped links, and the sender still needs an honest answer to "did anyone get it?" (This is the design premise of the project; this submission contains no field data about any community.)

## Solution

- **Save first, then forward.** Every command is written to an fsynced journal before it is acknowledged; state is rebuilt by replay after a restart.
- **Honest status.** Waiting to send, reached the gateway, the clinic received it, a reply arrived, the reply was opened: each shown only from evidence. The gateway acknowledgement and the clinic acknowledgement are separate facts.
- **Human approval.** No reply leaves the clinic without a clinician's approval; this is enforced in the service for every other role.
- **Clinic workflow.** Clarification questions linked to the case, corrections as linked versions, honest withdrawal, a stated (never inferred) coverage value, overdue-versus-review-window, audited handover, and closure with an explicit outcome.
- **Privacy basics.** A case reference alone opens nothing; shared-device lock clears the screen; the operator view never contains patient content; consent records and audit events hold identifiers only.

## How it works

1. Noor writes a request (typing, or optional speech-to-text; Swahili and Arabic are UNREVIEWED demo strings).
2. The **village node** journals it and answers "accepted - waiting to send" even with no uplink.
3. A simulated chain of **relays** passes custody hop by hop with acknowledgements, bounded retries and duplicate suppression.
4. The **gateway** (an explicit module with its own inbox and outbox, and separate radio-side and upstream-side outage handling) acknowledges to the village, then forwards to the clinic when its upstream is available.
5. The **clinic** reviews the original, may use the draft summary (deterministic rules, no AI), and a clinician approves a reply.
6. The reply returns through the gateway outbox and relays to the village device; "arrived" and "opened" are recorded separately.
7. The **operator** sees node health and custody events only.

See the capability matrix: [`docs/CAPABILITIES.md`](../docs/CAPABILITIES.md) (also in the app at `#/capabilities`).

## Videos (silent, captions burned in, 1280x720, each under 60 s)

Recorded headlessly from the running app by `scripts/record-videos.ts`. Durations measured with ffprobe.

| File                               | Length  | Content                                                                                                                                                                                        |
| ---------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`team-intro.mp4`](team-intro.mp4) | 53.92 s | Project, problem, team, simulation disclaimer                                                                                                                                                  |
| [`demo.mp4`](demo.mp4)             | 52.08 s | Full scripted demo: offline acceptance, restart, restore, separate gateway and clinic acks, clinician approval, return-path interruption, duplicate injection to one case, operator view, lock |
| [`teach.mp4`](teach.mp4)           | 54.00 s | Durable queue, relay states, human-approved replies, failure handling, honest limits                                                                                                           |

## Simulated vs not

| Simulated                                                                         | Real code in this repo                                                     | Not built / not done                                                                                         |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Radio links, relays, gateway-to-clinic upstream, virtual time and scripted faults | Local service with an fsynced journal; engine, roles, audit, UI            | Real radio, hardware, range or airtime testing                                                               |
| Clinic station and staff (demo tokens, synthetic names)                           | Role-based permissions enforced in the service                             | Real identity, at-rest encryption, enforced retention                                                        |
| Translation (mock phrase dictionary)                                              | Draft summary (deterministic rules)                                        | AI model assistance, DHIS2 / FHIR integration, patient-unavailable workflow, a separate gateway process/disk |
| Voice input verified against a scripted fake of the browser API                   | Voice input adapter and UI (real browsers may send audio to a third party) | Real-browser speech accuracy (UNKNOWN); reviewed Swahili/Arabic text; any evaluation with real users         |

## Tech stack

TypeScript 6, React 19, Vite 8, Node 20 (plain `http` service, JSON-lines journal), Vitest, Playwright with axe-core 4.13.0, ffmpeg for the videos. No external services.

## Measured results (from [`VERIFICATION.md`](../VERIFICATION.md); simulator and local service on a development machine, 2026-10-04)

- **FACT:** `tsc --noEmit` 0 errors; ESLint 0 errors and 0 warnings; Prettier clean.
- **FACT:** Vitest **93 of 93 passed** (9 files), including a real-process SIGKILL durability test, simulator fault tests, unauthorized-access tests and gateway outage tests.
- **FACT:** Playwright **68 of 68 passed** (2 viewports, 320x640 and 1280x800), including the full scripted demo (`e2e/spec-demo.spec.ts`).
- **FACT:** axe-core **142 scans over 71 screens x 2 viewports, 0 violations**. Limit: axe finds only a subset of accessibility problems; screen readers and real devices are UNKNOWN.
- **FACT:** encoded request size for the Noor English example: 389 bytes as JSON, 135 bytes with the prototype codec, 118 bytes with codec plus deflate (no encryption, FEC or framing; conditions in `docs/measurements/request-bytes.md`).
- **INFERENCE (assumptions stated there):** with assumed 128-byte frames and a 1200 bps link, that request fits in 2 frames, about 1.0 s. Not an RF measurement.
- **UNKNOWN:** everything about real users, real radios, real clinics, clinical safety, security review, and real-browser speech accuracy.

## Live demo

<https://rural-health-radio.vercel.app> - the same simulated service with synthetic data and a banner on every screen. State is one shared, resettable demo state for all visitors, kept in a database-backed command log; restart-durability of the on-disk journal is shown in the local build and tests rather than on the hosted URL.

## Run it

```bash
npm ci
npm run dev        # service :8787 + web UI :5173 -> http://localhost:5173
npm run check      # typecheck + lint + format + Vitest
npm run test:e2e   # builds, starts the service, Playwright + axe (needs: npx playwright install chromium)
npm run build:web && npx tsx scripts/record-videos.ts   # re-record the videos (needs ffmpeg)
```

Views: patient `#/`, clinic `#/clinic`, operator `#/operator`, admin `#/admin`, simulator `#/sim`, capabilities `#/capabilities`.

## Short description (139 words)

Rural Health Radio is a simulated prototype of delay-tolerant health messaging for people who cannot rely on a connection. A person writes a short request; a village node saves it durably before saying "accepted", then relays it hop by hop through a gateway to a clinic. A clinician compares the original with an optional draft summary and approves the reply, which travels back. The screen only claims what is known: waiting, gateway has it, clinic received it, reply arrived, reply opened. We tested outages, restarts, lost acknowledgements and duplicate delivery, which produces one case. Roles are enforced in the service, and the operator never sees patient content. It runs entirely in a simulator with synthetic data: no real radio, clinic, patient or users, and Swahili and Arabic text is unreviewed. It is not a medical device. Team: Tejas Chaudhari.
