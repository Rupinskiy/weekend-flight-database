# Weekend Flight Database v8.1 RC2 (Public GitHub + Cloudflare)

Public repository is supported. Never commit secrets. See `docs/PUBLIC_CLOUDFLARE_STUDENT_UA.md` and `docs/QA_REAUDIT_2026-11-05_UA.md`. This is a release candidate, not a verified live deployment.

# Weekend Flight Database

**GitHub-first flight schedules, seasonal changes, OAG Delta events, family calendar and targeted fare searches.**

Це вебзастосунок: GitHub для коду та PR, Cloudflare Workers для API й інтерфейсу, Cloudflare D1 для накопичувальної бази. Користувачеві не потрібні локальні Python, Node або командний рядок.

- **[Основний опис українською](README_UA.md)**
- **[Повна інструкція запуску через GitHub Desktop](docs/DEPLOY_UA.md)**
- **[Де отримувати ключі та які функції вони відкривають](docs/API_ACCESS_UA.md)**
- **[Двосторонній OAG HTTP Push](docs/OAG_HTTP_PUSH_UA.md)**
- **[QA-аудит та відкриті обмеження](docs/QA_AUDIT_UA.md)**
- **[Перенесення даних із v7](docs/MIGRATION_V7_UA.md)**

Release: **v8.0 RC1**. Автоматичні локальні тести виконано на імітованих провайдерських відповідях. Live API entitlement та хмарне розгортання потребують окремих приймальних тестів після підключення користувача.
