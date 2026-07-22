---
name: amazon-sp-api-private-setup
description: >-
  Guides Amazon SP-API private app registration (Brazil) and iHub phase-2
  integration: LWA credentials, private app, connect via env, amazon.ts client,
  sync listings, stock and create/update anúncios. Use when the user mentions
  Amazon Seller API, SP-API, cadastro Amazon, App_AMZ_iHub, conectar Amazon,
  or Amazon inventory/listings in iHub.
---

# Amazon SP-API — privado + iHub (fase 2)

## Quando usar

- Cadastro / credenciais LWA no Seller Central ou SPP
- Integração Amazon no iHub (connect, sync, estoque, anúncios)
- Debug de `AMAZON_*` env ou `POST /accounts/amazon/connect`

## Não fazer

- Não dump da documentação completa da SP-API
- Não criar app **público** / OAuth Appstore multi-vendedor
- Não commitir Client ID, Client Secret ou Refresh Token
- Não propagar mandato de estoque ML↔Amazon (fase atual)

## Credenciais (produção)

Env no servidor:

```
AMAZON_LWA_CLIENT_ID=
AMAZON_LWA_CLIENT_SECRET=
AMAZON_REFRESH_TOKEN=
AMAZON_SELLER_ID=
AMAZON_MARKETPLACE_ID=A2Q3Y263D00KWC
```

`AMAZON_SELLER_ID` = Selling Partner / merchant ID (Seller Central).

## Fluxo iHub

1. Credenciais no env → UI **Integrações → Conectar Amazon** → `POST /accounts/amazon/connect`
2. Cria/atualiza `accounts.platform = amazon` e dispara `syncAmazonAccount`
3. Catálogo via Listings Items API → `products.amazonSku` / `amazonAsin`
4. Estoque: `PATCH /products/:id/stock` → `patchListingsItem`
5. Criar anúncio: `POST /products` com conta Amazon + `sellerSku` + `productType` + título/preço/qty

## Código-chave

| Peça | Path |
| --- | --- |
| Client LWA/SP-API | `artifacts/api-server/src/lib/amazon.ts` |
| Listings create/patch | `artifacts/api-server/src/lib/amazon-listings.ts` |
| Sync catálogo | `artifacts/api-server/src/lib/amazon-sync.ts` |
| Connect route | `POST /accounts/amazon/connect` em `routes/accounts.ts` |
| UI | `artifacts/ihub/src/pages/Integrations.tsx` |

## Cadastro (referência rápida)

1. Conta Professional BR + Primary User
2. Developer Profile = Private → roles Product Listing, Inventory and Order Tracking, Pricing
3. App SP-API privado (Produção)
4. Self-authorize → Refresh Token + LWA Client ID/Secret

Detalhes de roles/endpoints: [reference.md](reference.md)

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
