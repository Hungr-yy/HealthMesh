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

## Run it yourself

`npm run dev`, open http://localhost:5173, then use `#/sim` to advance virtual time and inject faults, `#/clinic` to approve a reply as the demo clinician.
