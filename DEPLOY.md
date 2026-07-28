# Deployment Reference

This document describes how to build and deploy the iHub project outside of the
Replit development environment (e.g. when migrating to Supabase + a serverless
backend).

---

## Environment Variables

### API Server (`artifacts/api-server`)

| Variable | Example value | Required | Description |
|---|---|---|---|
| `DATABASE_URL` | `postgresql://user:pass@host:5432/ihub` | both | PostgreSQL connection string used by Drizzle ORM. In production, use Supabase's transaction pooler URL (port 6543) or direct connection (port 5432). |
| `SUPABASE_URL` | `https://xxxx.supabase.co` | both* | Supabase project URL. Used to derive the JWKS endpoint for remote JWT verification when `SUPABASE_JWT_SECRET` is not set. |
| `SUPABASE_JWT_SECRET` | `your-jwt-secret` | both* | HS256 secret from Supabase › Project Settings › API › JWT Secret. When set, tokens are verified locally without a network call. Supersedes remote JWKS. |
| `ML_CLIENT_ID` | `1234567890` | both | OAuth 2.0 client ID from Mercado Livre Developer Console. |
| `ML_CLIENT_SECRET` | `AbCd1234…` | both | OAuth 2.0 client secret from Mercado Livre Developer Console. |
| `ML_REDIRECT_URI` | `https://ihub.example.com/api/mercadolivre/callback` | both | Must match the redirect URI registered in Mercado Livre Developer Console. |
| `ML_WEBHOOK_SECRET` | `your-ml-webhook-secret` | both | Used to verify the HMAC signature on incoming Mercado Livre webhook notifications. |
| `AMAZON_LWA_CLIENT_ID` | `amzn1.application-oa2-client.…` | both* | LWA Client ID (shared by all seller stores). For browser OAuth use a **public** SP-API app. |
| `AMAZON_LWA_CLIENT_SECRET` | `…` | both* | LWA Client Secret. |
| `AMAZON_APPLICATION_ID` | `amzn1.sp.solution.…` | both* | SP-API Application ID used in Seller Central consent URL. Required for OAuth “Conectar Amazon”. |
| `AMAZON_REDIRECT_URI` | `https://ihub.example.com/api/amazon/callback` | both* | Must match the Redirect URI registered on the Amazon app. |
| `AMAZON_OAUTH_DRAFT` | `true` | both | When `true` (default), consent URL includes `version=beta` for draft apps. Set `false` after publication. |
| `AMAZON_REFRESH_TOKEN` | `Atzr|…` | both* | Optional legacy/private-app fallback for the first store (manual connect). |
| `AMAZON_SELLER_ID` | `AXXXXXXXXXXXX` | both* | Optional legacy default Selling Partner ID for manual connect. |
| `AMAZON_MARKETPLACE_ID` | `A2Q3Y263D00KWC` | both | Amazon Brazil marketplace id (default `A2Q3Y263D00KWC`). |
| `STRIPE_SECRET_KEY` | `sk_live_…` | both | Found in Stripe Dashboard › Developers › API Keys. Use `sk_test_…` in dev. |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` | both | Stripe webhook endpoint signing secret from Stripe Dashboard › Webhooks. |
| `CORS_ALLOWED_ORIGINS` | `https://ihub.example.com` | prod | Comma-separated list of allowed origins for the CORS middleware. When absent (local dev), all origins are permitted. When set, the server also enables `credentials: true` on CORS responses, which is required for cookie/header-based auth from a cross-origin frontend. |
| `LOG_LEVEL` | `info` | both | Pino log level: `trace` \| `debug` \| `info` \| `warn` \| `error` \| `fatal`. Defaults to `info`. |
| `NODE_ENV` | `production` | prod | Set to `production` to enable prod-optimised logging and behaviour. |
| `PORT` | `8080` | dev | Port the Express server listens on. Injected automatically by Replit; set explicitly in other environments. |

\* At least one of `SUPABASE_URL` or `SUPABASE_JWT_SECRET` must be provided for JWT verification to work.

### Frontend (`artifacts/ihub`)

All frontend variables are prefixed with `VITE_` and are inlined at build time.

| Variable | Example value | Required | Description |
|---|---|---|---|
| `VITE_API_URL` | `https://api.ihub.example.com` | prod | Base URL of the API server (no trailing slash). Leave empty in Replit dev so requests are proxied by the Vite dev server. |
| `VITE_SUPABASE_URL` | `https://xxxx.supabase.co` | both | Supabase project URL used by the Supabase JS client for auth and data. |
| `VITE_SUPABASE_ANON_KEY` | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…` | both | Public anon key from Supabase › Project Settings › API › Project API Keys. Safe to expose in the browser; row-level security enforces access control. |
| `PORT` | `3000` | dev | Port the Vite dev server listens on. Injected automatically by Replit. |
| `BASE_PATH` | `/` | dev | URL base path the Vite dev/preview server is mounted at. Injected automatically by Replit. |

---

## Build Commands

### Frontend

```bash
pnpm --filter @workspace/ihub build
```

Output is written to `artifacts/ihub/dist/public/`. Serve the contents of that
directory from any static host (Vercel, Netlify, Cloudflare Pages, etc.).

### API Server

```bash
pnpm --filter @workspace/api-server build
```

Output is written to `artifacts/api-server/dist/`. The entry point is
`dist/index.mjs` (ESM format, bundled by esbuild).

---

## Database Migrations (Drizzle)

The project uses Drizzle Kit's `push` workflow to sync the schema to the target
database. Run this before starting the API server against a fresh database:

```bash
# From the repo root — DATABASE_URL must be set in the environment
pnpm --filter @workspace/db push
```

To force-push schema changes without confirmation prompts:

```bash
pnpm --filter @workspace/db push-force
```

> **Note:** The `push` command applies schema changes directly without generating
> migration files. For production use, consider generating versioned migrations
> with `drizzle-kit generate` before switching to `drizzle-kit migrate`.

---

## Supabase Migration Notes

When migrating the database from the Replit-provisioned PostgreSQL to Supabase:

1. **Provision a Supabase project** and note the connection strings from
   Supabase › Project Settings › Database.
2. **Set `DATABASE_URL`** to the Supabase transaction pooler URL
   (`postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres`)
   for the API server in production.
3. **Run the Drizzle push** against the new Supabase database (see above).
4. **Set the Supabase auth variables** on both the frontend and the API server:
   - Frontend: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
   - Backend: `SUPABASE_URL`, `SUPABASE_JWT_SECRET`
5. **Update CORS**: set `CORS_ALLOWED_ORIGINS` on the API server to include the
   production frontend domain(s).

---

## Serverless Adapter Note

The API server is currently a long-running Express process
(`artifacts/api-server/src/index.ts`). To deploy it on a serverless platform
(e.g. Vercel, AWS Lambda, Cloudflare Workers), you will need to wrap the Express
`app` export with a serverless adapter. For example:

- **Vercel**: use the `@vercel/node` runtime by exporting `app` as the default
  export from an `api/` directory file, or use a community adapter such as
  `serverless-http`.
- **AWS Lambda**: use `aws-serverless-express` or `serverless-http`.
- **Cloudflare Workers**: requires porting to the `hono` or `itty-router` framework
  as Express cannot run in the V8 isolate environment.

No code changes are required today; this note is a reminder for the migration step.
