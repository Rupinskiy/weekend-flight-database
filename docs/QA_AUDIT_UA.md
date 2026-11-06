> **ОНОВЛЕННЯ v8.1 RC2, 5 листопада 2026.** Оригінальний 29-тестовий аудит RC1 не врахував Cloudflare Free D1 50-запитний ліміт на invocation. У RC2 обробку AirLabs, OAG та великих OAG Delta пакетів перенесено в staging і невеликі commit-пакети. Наразі 32 локальні тести пройдено, зокрема 100 OAG records / 23 AirLabs records / 20 delta events. Реальний Workers Free smoke/E2E та перевірка OAG entitlement **не виконані**. Гарантована 100% повнота авіакомпаній, повна обробка зміни меж сезонного періоду та автоматичне надсилання цінових сповіщень **ще не реалізовані**. Докладно: `docs/QA_REAUDIT_2026-11-05_UA.md`.

# QA-аудит v8 RC1 — три проходи

**Межа доказів:** CI і локальні тести працюють на Node 22 з in-memory SQLite-моделлю Cloudflare D1 та синтетичними API-даними. У цьому сеансі **немає** приватних ключів користувача, а отже неможливо довести live OAG entitlement, фактичне покриття авіакомпаній або 100% роботу Cloudflare після розгортання.

## Прохід 1 — продуктова відповідність

| Вимога | Статус | Коментар |
|---|---|---|
| Замість Python — GitHub + вебсторінка | **Готовий код, не розгорнуто** | Worker/Assets/D1, інтеграція GitHub Cloudflare Builds |
| Повний каталог усіх днів і годин | **Реалізовано** | AirLabs catalog + OAG effective import, без weekend фільтра на запис |
| Сезонність і зміни графіків | **Реалізовано** | startDate/endDate/operating days; history revisions |
| OAG signed Delta для обох UK-напрямків | **Реалізована обробка**, вендорський trial не підтверджено | Signed HTTP Push + D1 revisions + dated exceptions; конфігурація alerts у OAG Support |
| OAG Schedules прямий API | **Код реалізовано; live entitlement не підтверджено** | Укладання черги + paging.next; є запасний JSON-імпорт |
| Гарантована верифікація конкретних дат | **Частково** | AeroDataBox live запит; не можна гарантувати відсутність gaps або відкритість продажів |
| 100% усіх авіакомпаній | **Не підтверджено** | Потрібен незалежний еталон і права на всі маршрути |
| Квиткові тарифи | **Реалізовано адресний API-пошук** | SerpApi, currency GBP, price observations |
| Алерти про ціни | **Локальний журнал/спостереження** | Cron перевіряє; email/push канал ще не підключений |
| 5–100+ сімейних ключів | **Реалізовано технічно** | Окремі власники, шифрування, бюджети, expiry; не гарантується правомірне множення тарифів |
| Сімейні календарі | **Частково** | ICS upload + all-day blocks; немає OAuth live-sync і всіх RRULE overrides |
| Long-haul/канікули | **Основа** | Всі дні у каталозі, режим `all`; немає повної інтермодальної оптимізації |
| FlixBus/GTFS, train, foreign open jaw | **Не входить** | Після перевіреного каталогу; не обіцяється у v8 |
| GitHub PR/versioning | **Підготовлено** | CI workflow, можна використовувати з наявним репо; сам репо ще створити |

## Прохід 2 — контракти й цілісність даних

- AirLabs `limit=50`/offset/`request.has_more`, staging до повної пагінації, zero rows не позначають scope як підтверджений.
- OAG `startDate`, `endDate`, `legDaysOfOperation`, `paging.next`; вендорський endpoint контракту/entitlement не перевірено live.
- OAG v2 Delta → dated instance vs effective rule, replay by `webhook-id`, HMAC & timestamp; немає випадкової зміни цілого сезону при разовій відміні.
- D1: ревізії append-only; `schedule_rules` зберігаються, навіть якщо не проходять time window; source unknown season не видається за підтверджений.
- Ціни SerpApi: зберігається date-based offer і provider timestamp; не гарантує остаточної ціни при оплаті.
- Профілі ключів: AES-GCM, mask list, permission, shared quota group, expiry, budget check до API.
- Реліз не включає фактичні ключі або робочу D1-базу.

## Прохід 3 — автоматизоване QA

`npm run check` та `npm test`. Тестовий пакет включає:
- авторизацію, CSRF origin check, expired/invalid session;
- створення SQL-таблиць і clean setup;
- encrypt/decrypt API-ключів та відсутність secret у GET;
- тестовий AirLabs HTTP із бюджетом і повною сторінкою;
- тестовий OAG effective paging;
- signed HMAC OAG webhook і дедуплікацію;
- імпорт v7 JSON/CSV;
- all-day ICS blocks;
- реалізацію timetable по днях і періодах;
- same-return-airport для non-London, flexible-London rule;
- basic SerpApi response normalization.

**Знайдені й виправлені під час QA проблеми:** неправильно заданий hash-алгоритм HMAC; base64 cookie із `=`; ініціалізація D1 між ізольованими середовищами тестів; OAG v2 carrier/date і дні формату `1234567`; помилковий порядок пріоритету scan-jobs; v7 weekday names; повторні ERROR-завдання в Cron; бюджет 0 сприймався як необмежений; відсутність загальної пагінації експорту.

## Критичні acceptance tests перед реальним використанням

- [ ] GitHub Actions зелений після першого push.
- [ ] Cloudflare Workers Builds deploy success без Node/Python на ПК.
- [ ] D1 створюється й перший login успішний.
- [ ] AirLabs ключ має Routes entitlement (403 → немає доступу, не помилка парсера).
- [ ] Кількість рейсів STN/LGW сходиться хоча б із незалежним OAG/розкладом аеропорту.
- [ ] OAG Schedules повернув сезонні межі для потрібних 2 UK аеропортів.
- [ ] OAG HTTP Push activated + genuine signed event прийнято; replay не дублюється.
- [ ] Після CANCELLED dated event weekly rule незмінний, але event відображений.
- [ ] AeroDataBox verification повертає саме потрібну дату/номер, не просто схожий рейс.
- [ ] SerpApi actual price збігається з відкритою сторінкою продавця в межах очікуваного відставання.
- [ ] Імпорт ICS із реальними RRULE/Sasha School/Anna events не відсікає поїздки на вечір після занять.
- [ ] Вебпанель перевірена на вашому браузері, мобільному й при поганій мережі.
- [ ] Без надмірних платних API-запитів, перевірка повного ліміту в billing порталі.

## Залишкові ризики

| ID | Severity | Ризик |
|---|---|---|
| QA-01 | Critical | Немає live entitlement/серверного deployment тесту із власними ключами |
| QA-02 | High | Vendor may change JSON shape or authentication header for API.Market |
| QA-03 | High | OAG Alert Push beta requires OAG Support; без нього немає true delta feed |
| QA-04 | High | 100% покриття не може вважатися сертифікованим без незалежного повного еталона |
| QA-05 | Medium | ICS timezone, RRULE, RECURRENCE-ID, робочі інтервали часу частково підтримані |
| QA-06 | Medium | Серверні Free-tier квоти Cloudflare/D1 та OAG можуть вимагати зміни cadences |
| QA-07 | Medium | Cron in-app price watch, але немає зовнішнього email/push відправлення |
| QA-08 | Medium | Backup Cloudflare D1 треба окремо налагодити; GitHub не version-controls live database |
| QA-09 | Medium | UK та foreign airports hardcoded list: можна розширити конфігурацію в майбутньому |
| QA-10 | Medium | Full GUI Playwright/real browser E2E та provider contract tests не завершені |

**Рекомендований статус:** **Release Candidate для підключення й приймальних тестів**, не Production Certified.
