## What and why

## Checklist

- [ ] `npm run check` passes (typecheck, lint, format, tests)
- [ ] `npm run test:e2e` passes if UI or flows changed (axe must report 0 violations)
- [ ] Only synthetic data; no real patient, clinic or phone data anywhere
- [ ] Simulation banners still visible on every screen I touched
- [ ] No new claim without a FACT / INFERENCE / UNKNOWN label and its measurement conditions
- [ ] No behaviour that diagnoses, prescribes or prioritizes without a human clinician
- [ ] New user-facing strings added to **all** language packs (en, sw, ar); sw/ar stay marked UNREVIEWED unless a qualified reviewer signed off
