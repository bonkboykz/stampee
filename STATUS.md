# Stampee — Migration & Deployment Status

Snapshot of the in-flight migration from Supabase → self-hosted backend on Railway. Use this to resume work in a fresh session.

Last sync: 2026-06-11.

---

## TL;DR

- Fork lives at `bonkboykz/stampee` (public). Upstream remote → `danlim26/stampee`.
- Frontend is a Vite SPA hosted on Railway `web` service.
- Backend is a Hono + Drizzle + raw pg + JWT API hosted on Railway `api` service.
- Supabase is **fully removed**. PLpgSQL RPC functions were carried over with `auth.uid()` → `app.uid()` (reads a per-transaction GUC set by the API before each call).
- Bucket `campaign-assets` (Railway object storage) is **private**; the API exposes a public read-proxy at `GET /storage/campaign-assets/:owner/:kind/:filename` with `cache-control: public, max-age=31536000, immutable`.
- Email flows (verify, password reset) are intentionally stubbed (no SMTP wired yet).
- Tooling: **bun** + **biome**. `bun.lock` committed at root and in `api/`.

---

## Live URLs

| Surface | URL |
|---|---|
| Frontend (SPA) | https://web-production-6c903.up.railway.app |
| Backend API | https://api-production-feb9.up.railway.app |
| API health | https://api-production-feb9.up.railway.app/health |
| GitHub fork | https://github.com/bonkboykz/stampee |
| Railway project dashboard | https://railway.com/project/aba61cdf-783d-47b2-8e0a-20fba647b302 |

---

## Railway project (workspace = "Rama")

- Project: `stampee` — id `aba61cdf-783d-47b2-8e0a-20fba647b302`
- Environment: `production` — id `ac6b802c-3f3e-4356-9eea-b49ec7ed75f2`
- Workspace: `Rama` — id `bf115d2c-a045-4855-811b-003db515d0a3`

### Services

| Name | id | Notes |
|---|---|---|
| Postgres | `a4082e0c-6710-4741-a4ba-d3e8c5f00837` | Volume mounted, schema applied via Drizzle + RPC SQL |
| Redis | `7f8ffc97-5057-4618-bdbc-7e0359d41365` | Currently unused at runtime (planned for rate limiting / session blocklist) |
| api | `16485b68-4e06-42c8-b2d1-c9e0133e7825` | `rootDirectory=/api`, watch `api/**`, pre-deploy `bun run db:migrate`, healthcheck `/health` |
| web | `9d12318d-7721-459f-a671-e4e9f5710cbe` | `rootDirectory=/`, build `bun run build`, start `serve -s dist -l $PORT` |

### Bucket

- Name in Railway: `campaign-assets` (actual S3 bucket name from creds: `campaign-assets-yweilss6k`)
- id: `2434ed99-2d67-40db-b6da-2b96b147b729`
- Region: `sjc`
- Endpoint: `https://t3.storageapi.dev`
- **Private** — anonymous reads return 403. We proxy reads via the API (see Storage proxy below).

### Environment variables (set in Railway, NOT here)

Pull with `railway variables --service <id> --json`.

**api:**
`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `PORT=8080`, `CORS_ORIGIN`, `PUBLIC_API_URL`, `BUCKET_ENDPOINT`, `BUCKET_REGION`, `BUCKET_ACCESS_KEY`, `BUCKET_SECRET_KEY`, `BUCKET_NAME`, `BUCKET_PUBLIC_BASE_URL` (last one unused after the proxy switch — kept for now)

**web:**
`VITE_API_URL`, `VITE_APP_URL`, `VITE_BUCKET_PUBLIC_BASE_URL` (unused, kept for now)

---

## Demo / test credentials

Owner accounts on the live deployment (all created during testing — `email_verified=true`):

| Email | Password | Slug | Notes |
|---|---|---|---|
| `demo@stampee.local` | `demo12345` | `demo` | Has campaign **Vice City Hookah Loyalty** (id `vice-city-hookah-eeqg2c`) + user-created "Midnight Brew" |
| `probe1@stampee.local` | `probe1234` | `probe-1` | First probe, has 1 test campaign "Coffee" |

Public signup URL pattern: `https://web-production-6c903.up.railway.app/:slug/join/:campaignId`

Example: https://web-production-6c903.up.railway.app/demo/join/vice-city-hookah-eeqg2c

---

## Architecture decisions worth remembering

1. **RPCs stayed as PLpgSQL** (not rewritten in TS).
   - `api/src/sql/rpc/100_functions.sql` mirrors the original `supabase/migration.sql` functions.
   - Functions reference `app.uid()` instead of `auth.uid()`.
   - `app.uid()` reads `current_setting('app.user_id', true)::uuid`.
   - Backend wraps every RPC call inside a transaction via `withUid(userId, fn)` in `api/src/db/rpc.ts`. This does `SET LOCAL app.user_id = $1` then runs your query.
   - **Why kept as PLpgSQL**: existing logic was 53KB of working SQL; faster to adapt than to rewrite.

2. **`auth.users` was replaced with our own `users` table.**
   - `handle_new_user` trigger is gone — the signup endpoint creates `users` + `profiles` in one transaction.
   - `create_staff_account`, `update_staff_pin`, `delete_staff_account`, `delete_own_account` PLpgSQL functions were **dropped** — handled in `api/src/routes/auth.ts` instead (need to touch our `users` table + `staff_credentials`, not Supabase's `auth.users`).

3. **Staff PIN is a separate credential.**
   - `users.password_hash` = owner's bcrypt password.
   - `staff_credentials.pin_hash` = staff PIN (4–6 digits, bcrypt-hashed).
   - Staff login endpoint = `/auth/staff-login` (email + pin + orgId).
   - Owner login endpoint = `/auth/login` (email + password).

4. **Email is disabled.**
   - Signup auto-verifies (`email_verified: true`, profile `status: 'verified'`).
   - `/auth/resend-verification` is a 200 no-op.
   - `/auth/reset-password` returns 501.
   - UI (ForgotPassword page, verify banner) is still there but hits no-op endpoints.

5. **Bucket is private; reads go through the API proxy.**
   - `PUT` (upload, authed): `POST /storage/campaign-assets` returns `{ publicUrl, path }` where `publicUrl = ${PUBLIC_API_URL}/storage/campaign-assets/${path}`.
   - `GET` (public, anonymous): `GET /storage/campaign-assets/:owner/:kind/:filename` streams the bucket object back with `cache-control: public, max-age=31536000, immutable`.
   - **Why proxy and not bucket policy**: Railway buckets don't honor S3 `ACL: 'public-read'`. Object-level public ACLs are not exposed via Railway's S3 surface.

6. **Tooling**
   - `bun` is the canonical package manager + runner. `bun.lock` is committed; do not regenerate with npm.
   - `biome` is the linter/formatter. `biome.json` lives at root.

---

## Code layout

```
stampee/
├── api/                          # backend
│   ├── src/
│   │   ├── index.ts              # Hono entrypoint + CORS
│   │   ├── db/
│   │   │   ├── schema.ts         # Drizzle: users, profiles, campaigns,
│   │   │   │                     #          customers, issued_cards,
│   │   │   │                     #          transactions, license_keys,
│   │   │   │                     #          staff_credentials
│   │   │   ├── client.ts         # pg pool + drizzle wrapper
│   │   │   ├── migrate.ts        # runs drizzle migrate, then applies sql/rpc/*.sql
│   │   │   ├── rpc.ts            # withUid() helper
│   │   │   └── migrations/       # generated by drizzle-kit
│   │   ├── sql/rpc/
│   │   │   ├── 001_extensions.sql  # pgcrypto + app.uid()
│   │   │   └── 100_functions.sql   # ported PLpgSQL RPCs
│   │   ├── auth/                 # jwt + bcrypt + middleware
│   │   ├── lib/                  # s3, redis, errors
│   │   └── routes/               # auth, profiles, campaigns, customers,
│   │                             # issuedCards, licenseKeys, publicSignup, storage
│   ├── drizzle.config.ts
│   ├── package.json
│   └── tsconfig.json
│
├── lib/
│   ├── api.ts                    # JWT-aware fetch client. localStorage token store.
│   ├── db/                       # thin wrappers around api routes; preserve original signatures
│   ├── storage/campaignAssets.ts # POST /storage/campaign-assets via multipart
│   └── …                         # untouched: utils, slug, siteConfig, etc.
│
├── components/
│   ├── AuthProvider.tsx          # rewritten; uses api.ts + tokenStore
│   ├── PublicCampaignSignupPage.tsx  # isSupabaseConfigured → isApiConfigured
│   └── …                         # most components unchanged (they call lib/db/*)
│
├── App.tsx                       # PublicCardWrapper uses fetchPublicCard(); rest unchanged
├── vite-env.d.ts                 # ImportMeta.env types + qr-scanner worker shim
├── biome.json
└── STATUS.md                     # ← this file
```

---

## Verification recipes (run from local against live)

### Quick smoke
```js
// Signup → /me roundtrip
const API = "https://api-production-feb9.up.railway.app";
const r = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'demo@stampee.local', password: 'demo12345' })
});
const { token } = await r.json();
const me = await fetch(API + '/auth/me', { headers: { authorization: 'Bearer ' + token }});
console.log(me.status, await me.json());
```

### Migration was applied
```bash
# Uses the PUBLIC database URL (proxy.rlwy.net) — DO NOT inline; pull via:
RAILWAY_CALLER="skill:use-railway@1.2.1" RAILWAY_AGENT_SESSION="…" \
  railway variables --service a4082e0c-6710-4741-a4ba-d3e8c5f00837 --json | jq -r .DATABASE_PUBLIC_URL
# Then `psql <url> -c '\dt public.*'` should show 8 tables (or just hit /auth/signup and look for relation errors in deploy logs).
```

### Forced re-deploy with a fresh migration
```bash
cd /Users/yesset/Desktop/rama/stampee/api
DATABASE_URL='<DATABASE_PUBLIC_URL from railway variables>' \
JWT_SECRET='<any non-empty>' \
bun run db:migrate
# This applies Drizzle migrations + RPC SQL idempotently. Safe to re-run.
```

### Bucket reads
- Direct (private, returns 403): `https://t3.storageapi.dev/campaign-assets-yweilss6k/<path>`
- Proxy (public, 200): `https://api-production-feb9.up.railway.app/storage/campaign-assets/<owner>/<kind>/<filename>`

---

## Open items / known gaps

- [ ] **Email flows**: signup auto-verifies. If we want real verify/reset, wire up an SMTP provider (Resend recommended, mentioned earlier) and:
  - swap `/auth/resend-verification` and `/auth/reset-password` to real implementations
  - flip new signups to `email_verified=false` and gate login on it
  - add a token-based confirm endpoint
- [ ] **Redis is provisioned but unused.** Originally planned for rate limiting + a refresh-token blocklist. Currently `redis` connect happens but no calls are made.
- [ ] **Bucket cleanup on campaign delete** — when a campaign's `logo_image` / `background_image` references our proxy, we don't actively delete the underlying bucket object. Frontend hits `POST /storage/campaign-assets/delete` only when the user explicitly removes/replaces an asset.
- [ ] **`@types/react@18` vs runtime `react@18.3.1`** is fine, but a number of pre-existing latent TS issues exist (lucide-react variance, discriminated-union narrowing in some pages). `vite build` works; `tsc --noEmit` from root produces non-blocking warnings.
- [ ] **`vercel.json` is still in the repo.** Harmless on Railway. Remove if/when the original Vercel path is no longer relevant.
- [ ] **`@vercel/analytics` dependency** is also still present. Same: harmless, kept for parity with upstream.
- [ ] **No automated tests.** Verification is manual via the recipes above and the live URLs.

---

## How to deploy a change

1. Branch off `main`, do work, push.
2. Railway auto-deploys on push to `bonkboykz/stampee` `main`. The `api` service only rebuilds when paths under `api/**` change (watch pattern). The `web` service rebuilds for any other change.
3. If the `api` Postgres schema changed, the pre-deploy command (`bun run db:migrate`) handles it. New Drizzle migrations should be generated locally with `bun run db:generate` and committed.
4. If a deploy is "SKIPPED — no changes detected in watch paths", run `railway up --service <id>` from the repo root to force-deploy a snapshot.

---

## How to roll back / nuke and start over

- Delete a service: `railway service delete --service <id> --yes` (CLI requires interactive confirm sometimes — pass `--yes`).
- Wipe DB: drop the Postgres volume in Railway UI, redeploy api. Pre-deploy migration will rebuild the schema.
- Forget all sessions: rotate `JWT_SECRET` in api env vars and redeploy. All existing tokens become invalid immediately.
