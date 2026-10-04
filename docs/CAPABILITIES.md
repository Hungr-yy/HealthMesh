# Capability matrix

> **SIMULATION. SYNTHETIC DATA ONLY. Not production-ready.** Generated from `src/shared/capabilities.ts` by `npm run docs:capabilities`; shown in the app at `#/capabilities`.

- **Simulated**: the real-world part is replaced by a simulation or mock.
- **Implemented**: working code exists in this repository.
- **Evaluated**: checked by automated tests or scripts here **only**. Nothing has been evaluated with real users, real radios, or in the field.
- **Future**: what is not built or still missing.

| Area | Capability | Simulated | Implemented | Evaluated | Future / missing | Evidence and caveats |
| --- | --- | :-: | :-: | --- | --- | --- |
| A. Patient and assisted app | Screens A-H, 3 languages, assisted mode, 320px/RTL/200% text, request correction, Finish/lock | - | Yes | automated tests | Usability testing with patients and health workers; more languages | Playwright journeys at 320px and 1280px; axe 0 violations on recorded screens |
| A. Patient and assisted app | Voice input (speech-to-text) with typing fallback | - | Yes | automated tests | Real-browser accuracy for en/sw/ar is UNKNOWN; browser may send audio to a third party | Unit tests with deterministic mock; e2e with scripted fake Web Speech API |
| B. Village node service | Durable acceptance (fsynced write-ahead journal), replay after restart, torn-write recovery | - | Yes | automated tests | Target hardware; at-rest encryption; backup; separate asset cache | Restart, power-cut and real-process SIGKILL tests |
| B. Village node service | Node health indicators (availability, storage, queue age, radio adapter status, last sync) | Yes | Yes | automated tests | Real radio adapter status; battery and temperature from hardware | GET /api/node/health; unit test |
| C. Transport | Fixed route, stable ids, per-hop custody acks, bounded retry with backoff, TTL, dedupe | Yes | Yes | automated tests | Real radio links, framing, FEC, encryption; field range and airtime measurement | Deterministic simulator tests (loss, lost ack, duplicate, reorder, outage, expiry) |
| D. Gateway | Explicit module with its own inbox/outbox; independent radio vs upstream outages | Yes | Yes | automated tests | Separate gateway process and disk; real upstream connectivity | Gateway tests: upstream outage, return-side radio outage, duplicate on radio side |
| E. Clinic app | Inbox, claim, original + optional draft summary, human-approved replies, delivery history | - | Yes | automated tests | Review with real clinicians; clinical safety review of templates and wording | Service and Playwright tests; reply unsent until clinician approval |
| E. Clinic app | Clarification question (approved, linked) and linked follow-up in the same case | - | Yes | automated tests | Structured question templates | Service tests; Playwright demo |
| E. Clinic app | Team coverage statement, overdue vs review window, handover, closure with explicit outcome | - | Yes | automated tests | Rota integration; real service-hours calendar; escalation rules | Service tests; staffing is a stated value, never inferred; closure asserts no health outcome |
| F. AI and language assistance | Draft summary of the request | - | Yes | automated tests | AI model assistance, with its own availability, model version and data policy | Deterministic rules, NO AI model; always labelled a draft to verify against the original |
| F. AI and language assistance | Translation | Yes | Yes | automated tests | Real translation service with native-speaker review | Mock phrase dictionary only; always flagged as needing review; original preserved |
| G. Integration | Canonical model, per-destination adapters (DHIS2, FHIR), ack/retry/reconciliation | - | - | none | Entire module. No FHIR or DHIS2 interoperability is claimed | Not built |
| H. Administration | Consent wording version, service hours, review window, retention setting, attributed config changes | - | Yes | automated tests | Facilities, nodes, staff access management, language packs, incidents. The retention number is recorded but NOT enforced | Admin config endpoints with audit events |
| Cross-cutting | Role-based permissions enforced in the service (patient secret, CHW, reviewer, coordinator, operator, admin) | - | Yes | automated tests | Real identity and credential management; integration accounts; security review | Unauthorized-access tests at service and HTTP level. Demo tokens are NOT real authentication |
| Cross-cutting | Consent records and audit events (identifiers only, no content) | - | Yes | automated tests | Legal review of consent wording and retention; tamper-evident audit storage | Tests assert audit data holds no names or message text |
| Cross-cutting | Patient-unavailable workflow (pending-reply indicator, no-detail notifications) | - | - | none | Not built | Not built |
| Cross-cutting | At-rest encryption of the journal and drafts | - | - | none | Required before any real data | Not built; synthetic data only |

## Language capability matrix

| Language | UI text | Speech input | Translation | Review status |
| --- | --- | --- | --- | --- |
| English | Implemented (authored here; no clinical-wording review) | Adapter sends en-US to the browser Web Speech API; accuracy UNKNOWN | Not needed for the clinic; clinic replies are written in English | Not reviewed by a clinical or language reviewer |
| Swahili | Implemented, UNREVIEWED demo strings | Adapter sends sw-KE; browser support and accuracy UNKNOWN | Mock phrase dictionary (tiny); always flagged "needs review"; original kept | UNREVIEWED: needs a native-speaker medical reviewer |
| Arabic (right-to-left) | Implemented, UNREVIEWED demo strings, RTL layout | Adapter sends ar-SA; browser support and accuracy UNKNOWN | Mock phrase dictionary (tiny); always flagged "needs review"; original kept | UNREVIEWED: needs a native-speaker medical reviewer |

## Missing field-pilot prerequisites (not done)

- Country radio authorization and spectrum plan (amateur radio is not a deployment basis).
- Real radio hardware, power, enclosure, range and airtime measurements.
- Usability and comprehension testing with patients, community health workers and clinicians.
- Native-speaker medical review of every language pack and translation.
- Clinical safety review of templates, draft rules and escalation wording.
- Security and privacy review, at-rest encryption, real identity management.
- Consent wording and data-retention legal review; enforced retention.
- Integration design with the destination health information systems.
- Operations: staffing, incident process, support, upgrades and backups.
