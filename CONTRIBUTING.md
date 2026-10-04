# Contributing

Rural Health Radio is a **simulated prototype**. Please keep that true: nothing here is a medical device, nothing transmits over a real radio, and only synthetic data is allowed.

## Setup

```bash
npm ci
npx playwright install chromium   # only needed for browser tests
npm run dev                        # service on :8787, web on :5173
```

Node 20 or newer. The local service stores data in a fsynced JSON-lines journal under `data/` (override with `RHR_DATA_DIR`; port with `RHR_PORT`).

## Before you open a pull request

```bash
npm run check        # typecheck + lint + format:check + vitest
npm run test:e2e     # builds, starts the real service, runs Playwright + axe (2 viewports)
```

CI runs the same commands (`.github/workflows/ci.yml`). Use `npm run format` to fix formatting.

## Project layout

| Path         | What lives there                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| `src/shared` | Types, the typed client interfaces, tracks, compact codec, draft rules, mock translator, i18n, fixtures |
| `src/server` | Event-sourced engine, write-ahead journal, relay simulator, auth, HTTP router                           |
| `src/web`    | React UI: patient screens A-H, clinic, operator, simulator panel                                        |
| `tests`      | Vitest: shared logic, durability (incl. SIGKILL), relay simulator, HTTP API                             |
| `e2e`        | Playwright: journey, languages/assist, failures, accessibility                                          |
| `scripts`    | Reproducible measurements (`evidence:bytes`, `evidence:contrast`)                                       |
| `docs`       | Demo walkthrough, screenshots, axe results, measurements                                                |

## Ground rules

1. **UI talks to the typed client interface** (`HealthMessagingClient`, `ClinicClient`, `OperatorClient`), never to the transport directly. The HTTP client and the fixture client must stay interchangeable.
2. **Honest states.** A message is only "sent"/"received" when the evidence says so. Never show an invented ETA or a fabricated delivery state. Unknown stays "unknown".
3. **Human in the loop.** Clinical replies are approved by a clinician. No autonomous diagnosis, prescription, or priority; assistance output is a draft with provenance.
4. **Evidence discipline.** Every number in docs comes from a script or test you can rerun, with its conditions. Label claims FACT, INFERENCE, or UNKNOWN.
5. **Languages.** Add every new string to all packs in `src/shared/i18n`. A key-parity test enforces this. Swahili and Arabic are **UNREVIEWED** demo strings; do not remove that disclosure without a qualified reviewer.
6. **Accessibility.** Keep 320px layouts, 200% text, visible focus, live-region announcements, RTL support. axe must report 0 violations.
7. **Privacy.** No real personal data in fixtures, tests, screenshots, or issues.

## Commits

Small, focused commits with [Conventional Commit](https://www.conventionalcommits.org/) prefixes (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`). Keep history clean: tests and code for a change travel together.
