# Security

- Do not commit API keys, .env, D1 exports, passports, private calendar tokens or cloud credentials.
- Set ADMIN_PASSWORD, SESSION_SECRET and ENCRYPTION_SECRET as **Cloudflare Worker Secrets**.
- All third-party API keys entered in the panel are encrypted using AES-GCM and stored in D1; an owner must authorize their use.
- Use Cloudflare Access to further restrict the dashboard.
- Rotate secrets when exposed. Rotating ENCRYPTION_SECRET without re-encrypting stored API keys makes them unreadable. Make a secure backup in your password manager.
- OAG Push must use signed HMAC or a configured webhook key. Never make the webhook publicly unauthenticated.
- Report vulnerabilities privately, not in public GitHub issues.
