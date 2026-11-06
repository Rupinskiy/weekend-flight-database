# API-джерела: ключі, доступність і порядок підключення

Дані перевірені за публічною документацією на 5 листопада 2026 р. Фактичний entitlement конкретного ключа видно лише після авторизованого тестового виклику. Не множте квоти на кількість людей автоматично без підтвердження правил постачальника.

| Пріоритет | Сервіс | Отримати доступ | Який endpoint у v8 | Чи є live адаптер? | Важливе обмеження |
|---|---|---|---|---|---|
| 1 | **AirLabs** | https://airlabs.co/ | `GET /api/v9/routes` | **Так**: full airport catalog з offset | `routes` може не входити до Free; без confirmed season |
| 2 | **OAG Schedules** | https://developers.oag.com/ | `GET https://api.oag.com/schedules` | **Так**: queue, paging, effective rows | Окремий entitlement, перевірити контракт; це не Flight Explorer API |
| 3 | **OAG Flight Info Alerts** | https://knowledge.oag.com/docs/flight-info-alerts-overview | HTTPS Push `/webhooks/oag` | **Так**: signed webhook, дельти | Активувати HTTP Push у OAG Support; trial не означає unrestricted global |
| 4 | **AeroDataBox RapidAPI** | https://rapidapi.com/aedbx-aedbx/api/aerodatabox/pricing | `GET /flights/number/{num}/{date}` | **Так**: адресна перевірка | Basic ~400 units/місяць; підтвердити Tier endpoint |
| 5 | **AeroDataBox API.Market** | https://aerodatabox.com/pricing | Той самий логічний flight endpoint | **Так**, але host/header перевірити на виданому ключі | Trial 7 днів і 400 units, не поновлюваний за замовчуванням |
| 6 | **AeroDataBox Direct** | https://aerodatabox.com/ads-b | Прямий host | **Так**, за наявності кредитів | Безумовних безкоштовних кредитів не гарантовано |
| 7 | **SerpApi Google Flights** | https://serpapi.com/google-flights-api | `engine=google_flights`, one-way, booking token | **Так**: live search, watches | У Free 250 пошуків/місяць за поточним відкритим тарифом; квоти змінюються |
| 8 | **FlightAware** | https://www.flightaware.com/aeroapi/portal/ | — | Тільки зберігання профілю; **адаптера немає** | Personal має грошовий кредит, але scheduled page не гарантує повної бази |
| 9 | **Cirium** | https://developer.cirium.com/ | — | Тільки профіль | Доступ до повних аеропортових розкладів залежить від контракту |
| 10 | **Aviationstack** | https://aviationstack.com/pricing | — | Тільки профіль | Free дає поточні рейси, не повний майбутній сезон |
| 11 | **Duffel** | https://duffel.com/docs/api/offer-requests | — | Тільки профіль | Live booking-oriented, не для тисяч безкоштовних сканувань |

## Скільки ключів потрібно

- **Мінімум для першого наповнення:** **1 AirLabs Routes**, якщо він має entitlement.
- **Оптимальний для сезонності:** **+1 OAG Schedules** з доступом до `startDate/endDate` і operating days.
- **Для true delta:** **+1 OAG Flight Info Alerts subscription** і **1 signing key `whsec_...`** після активації HTTP Push.
- **Для конкретних дат:** **+1 AeroDataBox** (RapidAPI, API.Market або Direct).
- **Для актуальних цін:** **+1 SerpApi**.

Отже, практичний рекомендований набір: **4 API-доступи/підписки + OAG signing secret**. Додаткові ключі інших членів сім'ї можна додавати, але це не гарантує множення провайдерських лімітів або entitlement.

## Порядок використання

1. AirLabs/OAG — каталог, тобто найдешевший спосіб знайти *всі можливі напрямки*.
2. OAG Schedules — підтвердження сезонів; OAG HTTP Push — наступні зміни.
3. AeroDataBox — лише адресна перевірка невизначених дат, не повний повторний збір кожного weekend.
4. SerpApi — лише shortlisted routes після локальної фільтрації.
5. Не робіть `FlightAware`/`Aviationstack` рівноцінним джерелом сезонного каталогу без доведеного доступу до потрібних функцій.

## Бюджети у вебпанелі

- Для кожного профілю введіть **власний `quota`** — він може означати запити або units залежно від провайдера.
- Локальний лічильник — **орієнтовний**: фактичний тарифікаційний лічильник завжди звіряйте в кабінеті провайдера. AeroDataBox різні endpoint-ів має різну вартість; у v8 адресна перевірка припускає 2 units, перевірте контракт і скоригуйте бюджет.
- Для профілів із спільним провайдерським обмеженням задайте **однаковий `quota_group` та `group_limit`**. Система не буде продовжувати роботу, коли закінчиться груповий бюджет.
- Після закінчення trial встановіть `expires_at`; прострочений профіль ігнорується.
- Кнопка «Нова квота» скидає локальне використання **лише після реального поновлення** відповідного тарифного періоду.

## Де перевірити API-документацію

- AirLabs routes: https://airlabs.co/docs/routes
- OAG schedules: https://knowledge.oag.com/docs/schedules-api-response-layout-descriptions
- OAG signed HTTP push: https://knowledge.oag.com/docs/flight-info-alerts-http-pushbeta
- AeroDataBox flight number + date: https://aerodatabox.com/flight-history/
- SerpApi: https://serpapi.com/google-flights-api
