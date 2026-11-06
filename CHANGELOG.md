# Changelog

## 8.1.0 RC2 (2026-11-05)
- Public GitHub docs and Cloudflare Free/student pricing.
- Staged AirLabs/OAG imports with small commit batches.
- Large delta events queued; guards for rejected/incomplete pages.
- v7/OAG bulk imports staged and resumed via OAG queue.
- 32 unit/integration-like tests on synthetic SQLite model.
- Cloudflare live and vendor-entitlement testing still pending.

# Changelog

## v8.0.0-rc1 — 2026-11-05

- Заміна локального Python/Streamlit на JavaScript Cloudflare Worker + Assets + D1.
- Готовий GitHub Actions CI і автоматична Cloudflare Git integration.
- Захищена вебпанель, HttpOnly session, AES-GCM API-key storage.
- Multi-owner API profiles, aggregate quota groups, trial expiry and manual renewal.
- AirLabs Routes airport-wide pagination and resume.
- OAG effective schedules direct queue and JSON import.
- Signed OAG HTTP Push — v2 dated instance vs effective rules, D1 revisions and replay detection.
- Адресна AeroDataBox flight-number verification, SerpApi pricing and threshold watch.
- ICS basic family calendar, local weekend/long-haul candidate mode.
- v7 CSV schedule rules import through the browser.
- QA: native Node tests + in-memory SQL model, security regression checks.

### Known gaps

- Vendor entitlement not verified with user's production keys.
- FlightAware/Cirium/Aviationstack/Duffel profiles without live collectors.
- Full OAuth Google Calendar + RRULE/RECURRENCE-ID, foreign open-jaw/transit and email push alerts not implemented.
- Globally verified airline coverage not established.
