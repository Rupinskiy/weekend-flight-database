# Публічний GitHub, Cloudflare Free та студентські пільги — 5.11.2026

## 1. Відкритий репозиторій

У GitHub Desktop → File → New Repository → `weekend-flight-database` → розмістіть в ньому всі розпаковані файли (разом із `.github` та `.gitignore`) → Commit → Publish Repository → **Keep this code private: OFF**. Для Cloudflare підходять і Public, і Private; студентська ліцензія GitHub не потрібна. Стандартні GitHub Actions на публічних репозиторіях безкоштовні без обмеження хвилин. Створення нового репозиторію недоступне в поточному ChatGPT GitHub-конекторі, його потрібно створити один раз в UI.

## 2. Cloudflare Free

| Ресурс | Ліміт Free | Практика |
|---|---:|---|
| Workers requests | 100 000/добу | Вебпанель, Cron, API |
| CPU на звичайний запит | 10 мс | Немає гарантії для важких пошуків |
| D1 запитів на Worker invocation | 50 | У v8.1 введено staging та маленькі COMMITING-пачки |
| D1 rows read | 5 млн/добу | Потрібні індекси на великих таблицях |
| D1 rows written | 100 000/добу | Достатньо для початкового MVP |
| D1 storage | 5 ГБ загалом, 500 МБ на одну базу | Головне обмеження зростання каталогу |
| Workers Builds | 3 000 build-хв/місяць | Повинно вистачити на CI/CD особистого проєкту |

Paid Workers: **від $5/міс.** + плата за перевищення. Workers Paid суттєво підвищує CPU/SQL-ліміти. Сторонні авіаційні API оплачуються окремо. Офіційно: https://developers.cloudflare.com/workers/platform/pricing/ ; https://developers.cloudflare.com/workers/platform/limits/ ; https://developers.cloudflare.com/d1/platform/pricing/ ; https://developers.cloudflare.com/d1/platform/limits/ ; https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/ .

## 3. Студентські програми

GitHub Student Developer Pack: https://education.github.com/pack — для верифікованих студентів GitHub Pro, Copilot, Codespaces. Не дає автоматично Cloudflare Paid.

Cloudflare for Students: https://www.cloudflare.com/students/ — станом на цю дату, опубліковані умови: **18+, студенти США, перевірена `.edu` billing email**, 12 місяців покриття базової Workers Paid вартості. Звичайний британський `.ac.uk` не є автоматично допустимим. У Cloudflare є процедура запиту додавання інших освітніх доменів: https://blog.cloudflare.com/workers-for-students/ . Потрібно перевірити реальне зарахування пільги в білінговому кабінеті перш ніж активувати Paid.

## 4. Поетапний запуск без локального Python/Node/CLI

1. Створіть **Public** репозиторій через GitHub Desktop (усі файли з ZIP).
2. У https://dash.cloudflare.com/ створіть безкоштовний акаунт, Workers Free.
3. `Storage & Databases → D1 → Create database`, назва `weekend-flight-database`. Скопіюйте Database ID.
4. На GitHub у `wrangler.jsonc` замініть `REPLACE_WITH_YOUR_CLOUDFLARE_D1_DATABASE_ID` справжнім UUID, Commit.
5. Cloudflare → Workers & Pages → Create application → GitHub; авторизуйте GitHub Apps доступ тільки до нового репозиторію.
6. Назва Worker має дорівнювати `weekend-flight-database`; branch `main`; root `/`; build command `npm install --no-audit --no-fund`; deploy command `npx wrangler deploy` (команду виконує хмарний CI, не Windows).
7. `Worker → Settings → Variables and Secrets`: додайте секрети `ADMIN_PASSWORD`, `SESSION_SECRET`, `ENCRYPTION_SECRET` як **Secret**, не plaintext. Два останні — різні випадкові фрази щонайменше 32 символи; збережіть резервну копію в менеджері паролів.
8. Відкрийте URL `*.workers.dev` і увійдіть, потім додайте AirLabs/OAG/SerpApi ключі у вкладці API. Ці ключі зберігаються шифровано у D1 і не входять до Git.
9. Перший збір: STN → OUT → одна API-сторінка; за її успіху продовжуйте через `COMMITTING` без додаткових запитів до постачальника. Перевірте Cloudflare Worker Logs та D1 Metrics, потім лише розширюйте збір.
10. Для подальших змін: GitHub Desktop Commit/Push → GitHub Actions → Cloudflare auto deploy. D1 дані залишаються на Cloudflare, а не у версіях Git.

## 5. Необхідна відмінність

Публічність GitHub означає доступність **коду**. API-ключі, логіни, паролі, сімейні календарі й приватні тарифи не потрібно публікувати. Навіть маловідомі GitHub репозиторії автоматично скануються ботами. Хмарну вебпанель захищає ADMIN_PASSWORD; для кількох різних людей потрібно додаткове керування ролями, якого в RC2 ще немає.
