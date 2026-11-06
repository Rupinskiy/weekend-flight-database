# OAG Delta: двостороннє внесення змін без порушення сезонної логіки

**Важливо:** йдеться не про зміну status лише одного рядка. OAG може передавати **effective schedule records** (період + дні виконання) та **schedule instances** (конкретна дата). Вони мають різний зміст.

## Підтримувані напрямки

- Із усіх вибраних британських аеропортів (departures).
- До всіх вибраних британських аеропортів (arrivals).
- Вхідне повідомлення може змінити `schedule_rules`, `schedule_exceptions` та журнал `delta_events`.
- Операції: ADDED, UPDATED, REINSTATED, CANCELLED, DELETED, REMOVED. У D1 немає автоматичного строкового видалення історії.

## Режим доставки

Реалізований **HTTP Push Beta**, а не Azure Event Hubs consumer. Причина: у безсерверному Cloudflare Worker HTTPS Push не потребує постійно відкритого AMQP/Kafka з'єднання. OAG підтверджує HTTP Push, але налаштовує його через Support, а не самостійно через frontend.

**Endpoint:** `https://YOUR-SUBDOMAIN.workers.dev/webhooks/oag`

**Авторизація:** попросіть OAG Standard Webhooks HMAC SHA-256 signing із ключем `whsec_<Base64>` та `changeIndicators`. Ключ додайте у панелі як провайдер `oag_webhook` або як секрет Cloudflare `OAG_WEBHOOK_SIGNING_KEY`.

При кожній події сервер:

1. Приймає POST не довший за дозволений розмір.
2. Перевіряє `webhook-id`, `webhook-timestamp` (вікно ±5 хвилин) та `webhook-signature` над канонічним `id.timestamp.raw-body`.
3. Перевіряє ідентифікатор у журналі дельт; повторний webhook не застосовується вдруге.
4. Якщо є effective-rule: нормалізує дні/період, змінює `schedule_rules`, записує `schedule_revisions`. Для вилучення/скасування ставить `state='DELETED'`, зберігаючи історію.
5. Якщо є лише flight instance: записує датований виняток до `schedule_exceptions`, **не змінюючи загальне weekly-rule**.
6. Залишає повідомлення OAG у `delta_events` для аудиту.

## Коли не можна заявляти завершений Delta

- Якщо OAG HTTP Push ще не активований для акаунту, endpoint працює, але **live-потік не надходить**.
- Якщо OAG trial має обмежені підписки за airport/carrier, не всі зміни світу доставляються; метрика `coverage` вказує межі фактичного збору.
- Якщо підписаний потік не надходив унаслідок збою, потрібна адресна звірка OAG Schedules, а не вважати всі старі записи незмінними.
- OAG schema v1 Event Hubs відрізняється від v2 HTTP Push. Цей Worker приймає v2 HTTP Push й ручний JSON-імпорт; прямий Event Hubs consumer не реалізований.

Офіційна документація: https://knowledge.oag.com/docs/flight-info-alerts-http-pushbeta
