# Незалежний повторний QA-аудит v8.1 RC2 — 5 листопада 2026

## Загальний висновок

**Локальні тести пройдені (32/32); production readiness НЕ підтверджена.** Переглянуто фактичні файли v8 та відповідність попереднім обіцянкам, а не тільки попередній QA-звіт. Live deployment, Cloudflare Free CPU/SQL and external vendor entitlements не можуть бути підтверджені без робочого середовища і ключів.

## Виявлені дефекти RC1 та виправлення RC2

1. **CRITICAL: понад 50 D1 SQL statements в одному Cloudflare Free invocation.** AirLabs page of 50, OAG page of 100, OAG Delta batches до 100 та великі v7/OAG imports створювали перевищення. **Виправлено логіку:** AirLabs page до 15, staging, commit batch 5; OAG page до 100 із bulk staging і commit batch 5; Delta >4 у durable queue; великі імпорти — через staged jobs. Нові тести (23 AirLabs, 100 OAG, 20 deltas) успішні.
2. **HIGH: неповні сторінки могли бути помилково позначені COMPLETE.** Якщо нормалізатор відхиляє хоча б один рядок, тепер статус `INCOMPLETE`; збереження валідних рядків триває окремо.
3. **HIGH: повернення старих квот вручну.** Кнопка reset існує, але **немає автоматичного визначення місячних renewal**, тому не можна рахувати квоти п'яти ключів як гарантовано незалежні.
4. **HIGH: інструкція вимагала приватний репозиторій.** Замінено на Public. Секрети Cloudflare як і раніше необхідні.

## Повторна відповідність вимогам

| Вимога | Фактичний стан |
|---|---|
| GitHub + браузер без Python | Код готовий, без реального Cloudflare deploy |
| Public repository | Сумісний; repo ще не створений |
| Шифровані API профілі для кількох власників | Реалізовані; рольової multiuser авторизації немає |
| Автоматична ротація ключів після квоти | `chooseProfile` обирає інший дозволений профіль з quota; **конкурентний розподіл квот не атомарний**, вимагає додаткового QA |
| Повний AirLabs catalog + сезонні OAG rules | Шляхи реалізовано; vendor entitlement/contract не підтверджено |
| OAG двосторонній delta | Event handler + журнал; **повна реконструкція перенесених сезонних меж і vendor live event shapes не доведена** |
| Датовані винятки | Зберігаються; гарантія позитивної live перевірки залежить від провайдера |
| Верифікація усіх перевізників | Показник отриманих записів, **не незалежна сертифікація 100% покриття** |
| Поточні тарифи | One-way SerpApi API, без open-jaw комбінацій у єдиному запиті |
| Алерти | Записи в базі/журнал, **немає push/email доставки** |
| Календарі Анни/Саші | ICS simple events; RRULE/часові накладання не повністю реалізовані |
| FlixBus/rail/multi-airport foreign open-jaw | Наступний етап, не реалізовано |
| Long haul | Початкове розширення календаря; без перевірених багатосегментних тарифів |
| Free Cloudflare | Пакетування зменшено; **10 мс CPU та реальну D1 boundary потрібно перевірити live** |
| Постійна SQLite/D1 | D1 SQL сховище; GitHub зберігає код, а не версії live бази |

## Незакриті пріоритетні ризики

- **P0 / релізний блокер:** Live Worker Free deployment + D1 API checks; до цього не називати версію production.
- **P0:** Автоматичне підтвердження нових сезонних графіків OAG та tombstones/deletions при зміні меж `valid_from`, `valid_to`. Поточний `schedule_rules` key включає ці межі, отже нове правило може залишити попереднє активним до окремої reconcile операції.
- **P0:** Повний незалежний airline coverage audit неможливий тільки на одній Routes API.
- **P1:** Реальні vendor request/response контрактні тести для AeroDataBox RapidAPI, API.Market, OAG, AirLabs.
- **P1:** Доповнити rate limit/serial queue атомарністю; OAG delta order and rollback after partial failures; safe replay.
- **P1:** При масштабуванні опрацювання `candidates` до 10 000 rules × 365 днів може перевищити Workers Free 10 мс CPU; потрібна materialized cache і посторінкове виконання.
- **P1:** Вхід через один admin password не дозволяє незалежні family roles. Для масового внесення ключів іншими користувачами потрібні окремі логіни, підтвердження дозволів і audit trail.
- **P1:** Додати email/push alert, backup/export D1 і інтеграційні E2E-тести браузера.

## Перевірки та доказова база

У контрольованому локальному Node 22 середовищі: `npm run check` успішно, `npm test` **32 із 32**; тестові SQL-запити виконувалися SQLite `node:sqlite` на синтетичних відповідях API. У пакеті відсутні реальні API-ключі, дампи сімейних календарів і Cloudflare token. Тести НЕ доводять готовність OAG Alert HTTP Push beta, Cloudflare Worker (Free) CPU budget чи одержання конкретних рейсів на реальних тарифах.

## Приймальний порядок

1. GitHub Actions на Public repo — Success;
2. Cloudflare Worker Free — deployed без errors;
3. D1 init, login, secret, basic route;
4. AirLabs 1 page STN, staging COMMITTING, finish, D1 Metrics;
5. OAG 1 page з фактичними сезонами та різними діапазонами дії;
6. Delta real signed webhook + cancellation + effective-period shift;
7. Вибіркова перевірка airlines/routes з незалежним довідником;
8. ICS complex events та відповідність календарям;
9. SerpApi exact fares, baggage and alert transaction;
10. Cloudflare consumption stays inside Free limits, re-run after deployment.
