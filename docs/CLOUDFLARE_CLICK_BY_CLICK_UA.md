# Cloudflare: покроковий запуск Weekend Flight Database без командного рядка

Перевірено для репозиторію https://github.com/Rupinskiy/weekend-flight-database, гілка **main**, Worker з назвою **weekend-flight-database**. Усі дії — у браузері, Python/Node.js локально не потрібні.

## 0. Що означають назви

- **Cloudflare Account ID** — ідентифікатор вашого облікового запису. Значення після dash.cloudflare.com/…/home. **Не вставляти в database_id.**
- **D1 Database ID** — унікальний UUID конкретної SQL-бази, який з'являється лише після створення D1.
- **wrangler.jsonc** — файл налаштувань Cloudflare **у корені GitHub-репозиторію**, а не всередині папки public чи src.
- **DB** — точне ім'я прив'язки до бази даних, яке використовує код через env.DB.
- **main** — виробнича (production) гілка GitHub. Оновлення файлів у main після Push origin запускає Cloudflare Builds.
- **Worker** — опублікований серверний JavaScript + статичний вебінтерфейс; **Pages окремо створювати не потрібно**.

## 1. Створити D1

1. Відкрийте свій Cloudflare Dashboard.
2. У лівому меню натисніть **Storage & databases** → **D1 SQL Database** (іноді назва **D1**).
3. Натисніть **Create database**.
4. Database name: **weekend-flight-database** (малі літери й дефіси, без пробілів).
5. Location: можна залишити автоматичне розміщення або вибрати **Western Europe**, якщо запропоновано. Jurisdiction — окрема настройка; не міняйте без потреби.
6. Натисніть **Create**. Відкриється сторінка новоствореної бази.
7. Знайдіть поле **Database ID** у Overview / Settings / Details, скопіюйте значення повністю. Це UUID у форматі на кшталт **12345678-abcd-4abc-8abc-1234567890ab** (лише приклад, НЕ використовуйте його).
8. Цю базу не потрібно наповнювати вручну SQL: поточний Worker створює таблиці при першому авторизованому запиті. Після запуску перевірте їх у D1 → Tables.

## 2. Вставити Database ID у GitHub

1. Відкрийте https://github.com/Rupinskiy/weekend-flight-database
2. На головній сторінці перейдіть до файлу **wrangler.jsonc** (він у корені поруч із package.json).
3. Натисніть іконку олівця **Edit this file**.
4. Знайдіть рядок із текстом **REPLACE_WITH_YOUR_CLOUDFLARE_D1_DATABASE_ID**.
5. Замініть **тільки** цей текст на скопійований справжній Database ID. Залишіть незмінними binding: **DB**, database_name: **weekend-flight-database**, name: **weekend-flight-database**.
6. Натисніть **Commit changes…** і підтвердьте коміт до **main**.
7. Якщо використовуєте GitHub Desktop, у ньому після вебредагування натисніть **Fetch origin → Pull origin** для синхронізації.

Приклад структури (UUID нижче вигаданий):

    "d1_databases": [
      {
        "binding": "DB",
        "database_name": "weekend-flight-database",
        "database_id": "12345678-abcd-4abc-8abc-1234567890ab"
      }
    ]

Не публікуйте паролі або API-ключі у цьому файлі.

## 3. Підключити репозиторій до Cloudflare Worker

1. У лівому меню Cloudflare розкрийте **Compute** → **Workers & Pages**.
2. Натисніть **Create application**.
3. Оберіть **GitHub** / **Import a repository** (назви можуть незначно відрізнятися, залежно від інтерфейсу).
4. За запитом Cloudflare натисніть **Connect GitHub**, авторизуйте GitHub-акаунт **Rupinskiy**. Якщо репозиторію немає в списку, на GitHub сторінці дозволів Cloudflare GitHub App виберіть **Only select repositories** і додайте **weekend-flight-database**.
5. Виберіть **Rupinskiy/weekend-flight-database**; НЕ створюйте Pages-проєкт із директорією public.
6. Конфігурація нового Worker:
   - **Project / Worker name:** weekend-flight-database (це значення повинно збігатися з name у wrangler.jsonc);
   - **Production branch:** main;
   - **Root directory:** корінь репозиторію (порожнє поле або /, НЕ public);
   - **Build command:** npm run check (або залиште порожнім, якщо build необов'язковий);
   - **Deploy command:** npx wrangler deploy;
   - **Framework preset:** None / No framework, якщо поле є.
7. Натисніть **Save and Deploy**. Cloudflare сам встановить залежності Node у своєму хмарному середовищі.
8. Відкрийте **Workers & Pages → weekend-flight-database → Deployments / Builds**. Дочекайтеся стану Success. Якщо Failure — відкрийте Build logs і скопіюйте текст помилки без секретів.
9. Якщо ви вже створили Worker раніше: відкрийте Worker → **Settings → Builds → Connect** і вкажіть цей GitHub-репозиторій. Не створюйте другий Worker із такою ж назвою.

Документація: https://developers.cloudflare.com/workers/ci-cd/builds/

## 4. Перевірити зв'язок Worker із D1

1. У Cloudflare перейдіть до **Compute → Workers & Pages → weekend-flight-database**.
2. Відкрийте вкладку **Bindings**. Очікується прив'язка **DB → D1 → weekend-flight-database**.
3. Якщо Binding відсутній: **Add binding → D1 database**, variable name **DB**, database **weekend-flight-database**, **Add binding**. За потреби **Redeploy**. При подальших деплоях джерелом конфігурації лишається wrangler.jsonc.
4. Якщо Cloudflare говорить про невідомий database_id, знову перевірте **фактичний Database ID**, а не Account ID.

## 5. Додати три серверні секрети

Вкладка **Settings → Variables and Secrets → Add** у потрібному Worker. Для кожної змінної оберіть Type **Secret** (не Plaintext). Введіть Name і Value, натисніть **Deploy** / **Save and deploy**, відповідно до поточного інтерфейсу.

| Name | Звідки взяти Value | Порада |
|---|---|---|
| ADMIN_PASSWORD | Вигадати власний сильний пароль для входу в панель | Можна створити в менеджері паролів, 20+ символів |
| SESSION_SECRET | Випадковий 32-байтовий секрет, незалежний від пароля | Скористатися локальним інструментом tools/secret-generator.html |
| ENCRYPTION_SECRET | Другий незалежний 32-байтовий секрет | НЕ загубити й НЕ змінювати після збереження API-ключів |

Секрети — **значення**, а не назви файлів і не ліцензії. Їх не потрібно десь запитувати: ви генеруєте їх самостійно.

Інструмент **tools/secret-generator.html** працює офлайн у браузері: на GitHub відкрийте файл → Download raw file → двічі клацніть завантажений HTML → Generate → скопіюйте SESSION_SECRET та ENCRYPTION_SECRET. Генератор не надсилає значення в мережу. За бажанням ADMIN_PASSWORD також створіть у менеджері паролів.

Не вводьте ці секрети у GitHub README, Issues, Commit, Cloudflare Build command чи чат. Якщо втратити ENCRYPTION_SECRET після введення ключів, наявні зашифровані ключі потрібно буде вводити повторно.

Офіційна інструкція Cloudflare: https://developers.cloudflare.com/workers/configuration/secrets/

## 6. Де взяти адресу вебзастосунку

1. Після Success перейдіть до **Workers & Pages → weekend-flight-database → Overview**.
2. Знайдіть **Visit / Preview / Domains & Routes** і посилання формату:
   **https://weekend-flight-database.ВАШ-ПІДДОМЕН.workers.dev**
3. Натисніть саме **фактичне посилання, яке показує Cloudflare**; домен субакаунта не можна вгадати з Account ID.
4. Для діагностики відкрийте **https://...workers.dev/api/health**. Очікується JSON, де **ok: true**, **configured: true**, **version: 8.1.0-rc2** (або новіша).
5. Поверніться на адресу без /api/health, увійдіть з ADMIN_PASSWORD.
6. Якщо екран відкрився, але логін повертає помилку — перевірте Secrets і D1 binding; якщо 404 — переконайтеся, що це Worker, а не окремий Pages static deploy.

## 7. Що відбувається після оновлення main

- В GitHub Desktop ви змінюєте файл, натискаєте **Commit to main**, потім **Push origin**.
- GitHub зберігає нову версію коду. Workflow у **Actions** перевіряє синтаксис і тести.
- Cloudflare **Workers Builds** отримує повідомлення про push у виробничу гілку **main**, сам збирає код і опубліковує нову версію Worker.
- **D1 існує окремо** від GitHub: чергове оновлення коду не є командою очистити базу. Важливі зміни SQL-схеми мають бути сумісними зі старою базою.
- Якщо хочете спочатку перевірити зміну: створіть окрему гілку, відкрийте PR, перегляньте CI та Merge PR у main.

## 8. Перший реальний тест

1. Відкрийте /api/health: ok=true і configured=true.
2. Ввійдіть з ADMIN_PASSWORD.
3. Додайте **один** API-ключ через вкладку профілів.
4. Створіть задачу лише для **STN**; не запускайте відразу всі британські аеропорти.
5. Запитайте першу сторінку; перевірте статус, квоти, нормалізовані дні/часи й D1.
6. Лише після успішного тесту розширте набір аеропортів.
7. Для OAG потрібні окремі права на Schedules та Delta; самі секрети Cloudflare не видають права на ці сервіси.

## 9. Поширені труднощі

| Симптом | Перевірити |
|---|---|
| Build failed: invalid D1 database id | Значення database_id у wrangler.jsonc повинно бути UUID вашої D1 |
| Cloudflare не бачить репозиторій | Дозволи GitHub App, вибір акаунта Rupinskiy |
| Worker name mismatch | Worker name у Cloudflare дорівнює name у wrangler.jsonc |
| /api/health configured=false | Не додано один із трьох секретів |
| Відкривається сайт, але логін помиляється | D1 binding, ADMIN_PASSWORD, SESSION_SECRET, журнали Worker |
| Після заміни ENCRYPTION_SECRET старі ключі не читаються | Відновити попередній секрет або перевнести ключі |
| API 401/403 | Ключ/тариф/endpoint провайдера, а не проблема Cloudflare |
| API 429 | Ліміт провайдера; зупинити збір до поновлення бюджету |

Поточна версія репозиторію — **release candidate**, а не live-протестована production-система. Зелені GitHub Actions підтверджують тести коду, але не реальні права OAG/AirLabs і не успішний Cloudflare deployment.
