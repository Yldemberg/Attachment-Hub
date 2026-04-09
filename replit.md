# iHub — Marketplace Management Hub

## Overview

pnpm workspace monorepo for iHub, a PWA that centralizes Mercado Livre marketplace management. Centralized product/stock, order, and question management for small-to-medium Brazilian marketplace sellers.

## Architecture

- **Frontend** (Task 3): `artifacts/ihub` — React + Vite PWA with Supabase Auth
- **Backend**: `artifacts/api-server` — Express 5 + TypeScript REST API
- **Database**: `lib/db` — Drizzle ORM schema for Supabase (PostgreSQL)
- **API contract**: `lib/api-spec/openapi.yaml` — OpenAPI 3.1 spec (source of truth)
- **Generated client**: `lib/api-client-react` — React Query hooks via Orval codegen
- **Generated Zod schemas**: `lib/api-zod` — validation schemas via Orval codegen

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **API framework**: Express 5
- **Auth**: Supabase Auth (JWT validated via `jose` in `artifacts/api-server/src/lib/auth.ts`)
- **Database**: Supabase (PostgreSQL) + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Payments**: Stripe (subscriptions + webhooks)
- **External**: Mercado Livre API (OAuth 2.0 + REST)

## Database Schema (lib/db/src/schema/)

Tables: `profiles`, `accounts`, `products`, `orders`, `questions`, `notifications`

- **profiles** — 1:1 with Supabase auth.users; plan, trial_ends_at, Stripe IDs
- **accounts** — ML account integrations; OAuth tokens, sync status
- **products** — ML listings; stock (available_quantity is most critical field), SKU
- **orders** — ML orders; buyer info, items_json, shipping status
- **questions** — ML customer questions; answer text/date
- **notifications** — In-app notifications; Supabase Realtime enabled

Full Supabase SQL migration (RLS policies + triggers): `scripts/supabase-ihub-full-schema.sql`

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Environment Variables Required

### Backend (artifacts/api-server)
- `DATABASE_URL` — PostgreSQL connection string
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_ANON_KEY` — Supabase anon/public key
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role key
- `SUPABASE_JWT_SECRET` — JWT secret for token validation
- `ML_CLIENT_ID` — Mercado Livre app client ID
- `ML_CLIENT_SECRET` — Mercado Livre app client secret
- `ML_REDIRECT_URI` — OAuth callback URL
- `STRIPE_SECRET_KEY` — Stripe secret key
- `STRIPE_WEBHOOK_SECRET` — Stripe webhook signing secret
- `PORT` — Server port

### Frontend (artifacts/ihub — Task 3)
- `VITE_SUPABASE_URL` — Same as SUPABASE_URL
- `VITE_SUPABASE_ANON_KEY` — Same as SUPABASE_ANON_KEY
- `VITE_STRIPE_PUBLISHABLE_KEY` — Stripe publishable key

## Business Rules (Critical)

- **SKU stock sync** — Updating stock via PATCH /api/products/sku/:sku/stock updates ALL products with same SKU; skip is_full=true products (ML Fulfillment items cannot have stock edited)
- **ML token refresh** — Before every ML API call, check if token_expires_at < NOW()+5min; refresh automatically
- **Trial enforcement** — 402 returned after trial_ends_at; trial = 30 days from signup
- **Multi-tenant** — user_id in every DB query; RLS enforced via Supabase + service_role on backend

## API Endpoints (all at /api prefix)

- `GET /healthz` — health check (no auth)
- `GET /auth/me` — current user profile
- `GET /accounts` — list ML accounts
- `GET /accounts/connect/url` — ML OAuth URL
- `GET /accounts/connect/callback` — OAuth callback (no auth)
- `GET|DELETE /accounts/:id` — account detail/delete
- `POST /accounts/:id/sync` — trigger full ML sync
- `GET /products` — list with filters (account_id, status, search, page, limit)
- `GET /products/low-stock` — products below threshold
- `GET /products/:id` — product detail
- `PATCH /products/sku/:sku/stock` — update stock by SKU
- `GET /orders` — list with filters
- `GET /orders/:id` — order detail
- `GET /questions` — list with filters
- `GET /questions/:id` — question detail
- `POST /questions/:id/answer` — answer a question via ML API
- `GET /notifications` — list notifications
- `PATCH /notifications/:id/read` — mark read
- `PATCH /notifications/read-all` — mark all read
- `GET /dashboard/summary` — KPI summary
- `GET /dashboard/sales-chart` — sales data for chart
- `POST /webhooks/mercadolivre` — ML webhook (no auth, async processing)
- `POST /webhooks/stripe` — Stripe webhook (no auth, validates signature)
