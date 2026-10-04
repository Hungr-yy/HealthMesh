# Noor journey walkthrough (SIMULATED)

> Simulation. Synthetic patient "Noor (synthetic)". Nothing here was sent anywhere. Screenshots are produced by `npm run test:e2e`; each pair is mobile 320px and desktop 1280px.

Directories: `docs/screenshots/mobile-320/` and `docs/screenshots/desktop-1280/` (same file names). Per-screen axe results: `docs/axe-results.json`.

## Patient journey (screens A-H)

| Step | Screen                        | File                                |
| ---- | ----------------------------- | ----------------------------------- |
| A    | Language access               | `01-A-language-access.png`          |
| B    | Home                          | `02-B-home.png`                     |
| C    | Choose request                | `03-C-choose-request.png`           |
| D    | Details                       | `04-D-details.png`                  |
| E    | "Is this what you meant?"     | `05-E-confirm-understanding.png`    |
| F    | Review and consent            | `06-F-review-consent.png`           |
| G    | Receipt: waiting to send      | `07-G-receipt-waiting-to-send.png`  |
| G    | Receipt: relaying             | `08-G-receipt-relaying.png`         |
| G    | Receipt: clinic received      | `09-G-receipt-clinic-received.png`  |
| G    | Receipt: reply arrived        | `15-G-receipt-reply-arrived.png`    |
| H    | Reply arrived, not yet opened | `16-H-reply-arrived-not-opened.png` |
| H    | Reply opened                  | `17-H-reply-opened.png`             |
| -    | Done, device cleared          | `18-done-device-cleared.png`        |

## Clinic and operator

| Screen                                  | File                           |
| --------------------------------------- | ------------------------------ |
| Clinic inbox                            | `10-clinic-inbox.png`          |
| Clinic case                             | `11-clinic-case.png`           |
| Reply editor (draft, not sent)          | `12-clinic-reply-editor.png`   |
| Reply approved by clinician             | `13-clinic-reply-approved.png` |
| Operator dashboard (no patient content) | `14-operator-dashboard.png`    |

## Languages and assistance

`20-sw-B-home`, `21-sw-E-confirm-translation-needs-review`, `22-sw-G-receipt`, `23-sw-clinic-case-original-and-mock-translation`, `24-sw-H-reply-in-swahili-needs-review`, `25-ar-A-language-rtl`, `26-ar-E-confirm-rtl`, `27-ar-G-receipt-rtl`, `28-E-uncertain-highlighted`, `29-sw-E-translation-unavailable`, `30-clinic-translation-unavailable`, `31-sw-H-reply-untranslated-fallback`, `32-assisted-G-receipt-patient-A`, `33-assisted-check-reference-rejected`, `34-assisted-H-record-assisted-reading` (all `.png`). Swahili and Arabic are UNREVIEWED demo strings.

## Failure and recovery states

`40-fail-node-unavailable-draft-not-accepted`, `41-fail-storage-nearly-full`, `42-fail-lost-ack-uncertain`, `43-fail-no-upstream-signal`, `44-fail-power-off-receipt`, `45-fail-expired`, `46-fail-intervention-required`, `47-delayed-clinic-response-ages-only`, `48-withdraw-explained` (all `.png`).

## Spec section 15 demo (outage to lock), SIMULATED

Automated as `e2e/spec-demo.spec.ts` (both viewports). Files in `docs/screenshots/<viewport>/`:

| Step                                                            | File                                           |
| --------------------------------------------------------------- | ---------------------------------------------- |
| 1-2. Accepted durably while upstream is disconnected            | `70-spec-1-accepted-while-upstream-down`       |
| 3. After a service restart, still queued                        | `71-spec-2-after-service-restart-still-queued` |
| 4-5. Gateway ack; the clinic has NOT acknowledged               | `72-spec-3-gateway-ack-clinic-not-yet`         |
| Operator: gateway holds the request (upstream side unavailable) | `73-spec-4-operator-gateway-holds-request`     |
| 8. Duplicate injected, one logical case; clinic ack is separate | `74-spec-5-duplicate-injected-one-case`        |
| 6. Clinic compares original with the optional draft             | `75-spec-6-clinic-original-and-draft`          |
| 6. Clinician approves                                           | `76-spec-7-reply-approved-by-clinician`        |
| 7. Return path interrupted: reply waits in the gateway outbox   | `77-spec-8-return-path-interrupted`            |
| 7. Reply retrieved at the village after the path is restored    | `78-spec-9-reply-retrieved-at-village`         |
| 9. Operator view without patient content                        | `79-spec-10-operator-view-no-patient-content`  |
| 10. Shared device locked                                        | `80-spec-11-device-locked`                     |

## Stage A: clarification, coverage, administration, matrices

`90-clinic-clarification-question-approved`, `91-patient-clinic-question`, `92-clinic-conversation-linked-answer`, `93-clinic-coverage-overdue-stale-statement`, `94-clinic-handover-and-closed-with-outcome`, `95-admin-config-audit-permissions`, `96-capability-matrix` (all `.png`; from `e2e/stage-a-ui.spec.ts`).

## Voice input

`50-voice-D-ready` ... `60-ar-voice-E-confirm-flag-rtl` (consent line, listening, transcript added and edited, flag on the confirm screen, unsupported / denied / mid-capture error fallbacks, Arabic RTL). These use a scripted fake of the Web Speech API: real-browser accuracy is UNKNOWN.

## Run it yourself

`npm run dev`, open http://localhost:5173, then use `#/sim` to advance virtual time and inject faults, `#/clinic` to approve a reply as the demo clinician.
