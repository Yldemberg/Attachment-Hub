---
name: amazon-sp-api-private-setup
description: >-
  Guides Amazon SP-API app registration (Brazil) and iHub integration: LWA
  credentials, public OAuth (Website Authorization) or private token connect,
  amazon.ts client, sync listings, stock and create/update anúncios. Use when
  the user mentions Amazon Seller API, SP-API, cadastro Amazon, App_AMZ_iHub,
  conectar Amazon, or Amazon inventory/listings in iHub.
---

# Amazon SP-API — privado + OAuth público + iHub (fase 2)

## Quando usar

- Cadastro / credenciais LWA no Seller Central ou SPP
- Integração Amazon no iHub (connect OAuth, sync, estoque, anúncios)
- Debug de `AMAZON_*` env ou `POST /accounts/amazon/connect`

## Não fazer

- Não dump da documentação completa da SP-API
- Não commitir Client ID, Client Secret ou Refresh Token

O mandato de estoque do Inventário Geral espelha quantidade em anúncios ML **e** Amazon com o mesmo SKU (`POST /inventory/mandate-adjust` + `propagateStockBySku`).

## Conta dona do app (Developer Central)

Para **“Conectar → autorizar no browser”** (estilo ML):

1. App **público** (não só private self-authorize)
2. Cadastrar Redirect URI = `AMAZON_REDIRECT_URI` (ex.: `https://host/api/amazon/callback`)
3. Roles: Product Listing, Inventory and Order Tracking, Pricing
4. Copiar Application ID → `AMAZON_APPLICATION_ID`
5. Draft: manter `AMAZON_OAUTH_DRAFT=true` (`version=beta`); após publicação, `false`

App **privado** continua suportado via token manual / env (`AMAZON_REFRESH_TOKEN` + `AMAZON_SELLER_ID`).

## Credenciais (produção)

```
AMAZON_LWA_CLIENT_ID=
AMAZON_LWA_CLIENT_SECRET=
AMAZON_APPLICATION_ID=
AMAZON_REDIRECT_URI=https://seu-dominio/api/amazon/callback
AMAZON_OAUTH_DRAFT=true
AMAZON_REFRESH_TOKEN=   # opcional (fallback privado)
AMAZON_SELLER_ID=       # opcional (fallback privado)
AMAZON_MARKETPLACE_ID=A2Q3Y263D00KWC
```

## Fluxo iHub

1. UI **Integrações → Conectar Amazon** → `GET /accounts/amazon/connect/url` → Seller Central consent
2. Callback `GET /api/amazon/callback` (`spapi_oauth_code` + `selling_partner_id`) → refresh token por conta
3. Fallback: dialog “conectar com token” ou `POST /accounts/amazon/connect`
4. Sync catálogo / estoque / anúncios como antes

## Código-chave

| Peça | Path |
| --- | --- |
| Client LWA/SP-API + OAuth helpers | `artifacts/api-server/src/lib/amazon.ts` |
| Connect + OAuth callback | `artifacts/api-server/src/routes/accounts.ts` |
| Listings create/patch | `artifacts/api-server/src/lib/amazon-listings.ts` |
| Sync catálogo | `artifacts/api-server/src/lib/amazon-sync.ts` |
| UI | `artifacts/ihub/src/pages/Integrations.tsx` |

## Smoke test LWA

```bash
curl -s -X POST 'https://api.amazon.com/auth/o2/token' \
  -H 'Content-Type: application/x-www-form-urlencoded;charset=UTF-8' \
  -d "grant_type=refresh_token&refresh_token=REFRESH&client_id=ID&client_secret=SECRET"
```

```bash
curl -s 'https://sellingpartnerapi-na.amazon.com/sellers/v1/marketplaceParticipations' \
  -H "x-amz-access-token: ACCESS_TOKEN"
```

Detalhes de roles/endpoints: [reference.md](reference.md)
