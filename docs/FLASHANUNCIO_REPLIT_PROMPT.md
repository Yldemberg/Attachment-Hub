# FlashAnúncio — Prompt completo para Replit Agent

> **Como usar:** cole este documento inteiro no Replit Agent (ou como `AGENTS.md` / prompt inicial do projeto). É a especificação fechada do produto. Não invente escopo além do descrito. Não altere o contrato N8N.

---

## 0. Missão

Construa o **FlashAnúncio**: um app SaaS enxuto, moderno e visualmente impecável, focado **somente** em:

1. Conectar contas de marketplace (**Integrações**: Mercado Livre + Amazon)
2. Criar anúncios a partir de um link (scrape Amazon/Shopee → revisão → publicação em ML ou Amazon)

Reutilize a **mesma lógica e os mesmos workflows N8N** já usados pelo produto iHub (prepare listing). O N8N/Apify já existe — o FlashAnúncio só precisa falar o contrato HTTP correto.

**Nome provisório / marca:** FlashAnúncio  
**Idioma da UI:** português (Brasil)

---

## 1. Visão do produto

### O que o usuário faz

1. Faz login (Supabase Auth)
2. Em **Integrações**, conecta uma ou mais lojas ML e/ou Amazon
3. Em **Criar anúncio**, cola um link de produto Amazon ou Shopee, escolhe a conta de destino
4. O sistema dispara o workflow N8N → scrape → rascunho
5. O usuário revisa/edita o rascunho e publica
6. O anúncio aparece na lista **Anúncios**

### Fora de escopo (NÃO implementar)

- Pedidos, perguntas, mensagens
- Inventário geral / mandate de estoque
- Stripe, planos, billing, trial gates complexos
- Diagnóstico de anúncios críticos
- Templates avançados de listing
- Shopee como **destino** de publicação (Shopee é só **fonte** de scrape)
- WhatsApp / alertas Full
- Dashboard com KPIs genéricos, calendários, “this week”, stats strips

---

## 2. Stack recomendada (Replit)

| Camada | Tecnologia |
| --- | --- |
| Frontend | React + Vite + TypeScript + Tailwind + shadcn/ui |
| Roteamento | Wouter ou React Router |
| Data fetching | TanStack Query |
| Backend | Node.js + Express (TypeScript) |
| Auth | Supabase Auth (JWT no `Authorization: Bearer`) |
| DB | Postgres via Supabase (`DATABASE_URL` pooler) |
| ORM | Drizzle ORM (preferido) ou SQL cru com migrations |
| Deploy | Replit (frontend + API no mesmo projeto ou monorepo simples `client/` + `server/`) |

Auth: validar JWT Supabase no backend (`SUPABASE_URL` + `SUPABASE_JWT_SECRET` / JWKS). Criar/atualizar linha em `profiles` no primeiro login (`id` = `auth.users.id`).

---

## 3. Arquitetura

```
[UI FlashAnúncio]
    │  JWT
    ▼
[API Express]
    ├── Supabase Auth + Postgres (profiles, accounts, products, listing_prepare_jobs, oauth_states)
    ├── Mercado Livre API (OAuth + create item)
    ├── Amazon SP-API / LWA (OAuth + putListingsItem)
    └── N8N webhooks (prepare)
            │
            ▼
        Apify scrape (Amazon / Shopee)
            │
            ▼
        POST /api/webhooks/n8n/listing-prepared  (Bearer N8N_WEBHOOK_SECRET)
```

### Fluxo E2E (obrigatório)

1. UI: URL Amazon/Shopee + conta destino (ML ou Amazon)
2. `POST /api/products/prepare-from-link` → cria job `listing_prepare_jobs` (`pending`/`processing`) → `dispatchPrepareToN8n`
3. N8N faz scrape (Apify) e monta draft → `POST {PUBLIC_URL}/api/webhooks/n8n/listing-prepared`
4. UI faz poll `GET /api/products/prepare-jobs/:jobId` a cada ~3s
5. Step 2: formulário de review (ML ou Amazon conforme draft)
6. `POST /api/products/publish-draft` → cria anúncio na API do marketplace → upsert em `products`
7. Redirect para lista / detalhe do anúncio

**URLs de fonte suportadas:** host contendo `amazon.`, `amzn.to`, `amzn.`, `shopee.`, ou `shope.ee`.

---

## 4. Secrets / Environment (Replit Secrets)

Configure **todos** estes secrets no Replit. Documente um `.env.example` no repo.

### Supabase / DB / Auth

```
DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
SUPABASE_URL=https://[project].supabase.co
SUPABASE_JWT_SECRET=[jwt secret do projeto Supabase]
VITE_SUPABASE_URL=https://[project].supabase.co
VITE_SUPABASE_ANON_KEY=[anon key]
```

### App público (callback N8N + OAuth redirects)

```
PUBLIC_URL=https://[seu-repl].replit.app
CORS_ALLOWED_ORIGINS=https://[seu-repl].replit.app
PORT=8080
NODE_ENV=production
LISTING_PREPARE_JOB_TIMEOUT_MS=60000
```

> `PUBLIC_URL` monta `callbackUrl = ${PUBLIC_URL}/api/webhooks/n8n/listing-prepared`  
> Redirects OAuth devem bater exatamente com o cadastrado nos apps ML/Amazon.

### Mercado Livre

```
ML_CLIENT_ID=
ML_CLIENT_SECRET=
ML_REDIRECT_URI=https://[seu-repl].replit.app/api/callback
```

### Amazon SP-API / LWA

```
AMAZON_LWA_CLIENT_ID=
AMAZON_LWA_CLIENT_SECRET=
AMAZON_APPLICATION_ID=amzn1.sp.solution.xxxxx
AMAZON_REDIRECT_URI=https://[seu-repl].replit.app/api/amazon/callback
AMAZON_OAUTH_DRAFT=true
AMAZON_MARKETPLACE_ID=A2Q3Y263D00KWC
# Fallback app privado (opcional):
AMAZON_REFRESH_TOKEN=
AMAZON_SELLER_ID=
```

### N8N (reusar workflows existentes — NÃO recriar scrape no app)

```
N8N_PREPARE_WEBHOOK_URL=https://n8n.odontflow.com.br/webhook/criar_anuncio
N8N_AMAZON_PREPARE_WEBHOOK_URL=https://n8n.odontflow.com.br/webhook/criar_anuncio_amazon
N8N_WEBHOOK_SECRET=[mesmo secret que o N8N envia no callback]
```

**Workflow IDs de referência (já existentes):**

| Destino | Path webhook | Workflow id |
| --- | --- | --- |
| Mercado Livre | `/webhook/criar_anuncio` | `CEPVkNgYzbpfdmAA` |
| Amazon | `/webhook/criar_anuncio_amazon` | `a8947c7e-6470-418f-b155-b24f42370bb2` |

Apify credentials ficam **dentro do N8N**, não no FlashAnúncio.

---

## 5. Schema SQL mínimo (Supabase Postgres)

Execute no SQL Editor do Supabase (ou via migrations). Ajuste RLS se quiser; a API valida ownership por `user_id` via JWT.

```sql
-- profiles (id = auth.users.id)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY,
  full_name TEXT,
  email TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'mercadolivre', -- mercadolivre | amazon
  ml_user_id TEXT UNIQUE,
  ml_nickname TEXT,
  ml_email TEXT,
  amazon_seller_id TEXT,
  amazon_marketplace_id TEXT,
  amazon_store_name TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS accounts_user_id_idx ON accounts(user_id);

CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ml_item_id TEXT,
  amazon_sku TEXT,
  amazon_asin TEXT,
  amazon_product_type TEXT,
  title TEXT,
  sku TEXT,
  price NUMERIC(10,2),
  available_quantity INTEGER NOT NULL DEFAULT 0,
  status TEXT,
  listing_type TEXT,
  thumbnail TEXT,
  permalink TEXT,
  ml_category_id TEXT,
  variations_json JSONB,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS products_account_ml_item_unique
  ON products(account_id, ml_item_id) WHERE ml_item_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS products_account_amazon_sku_unique
  ON products(account_id, amazon_sku) WHERE amazon_sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS products_account_id_idx ON products(account_id);

DO $$ BEGIN
  CREATE TYPE listing_prepare_job_status AS ENUM (
    'pending', 'processing', 'completed', 'needs_review', 'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS listing_prepare_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  product_url TEXT NOT NULL,
  status listing_prepare_job_status NOT NULL DEFAULT 'pending',
  draft_json JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS listing_prepare_jobs_user_id_idx ON listing_prepare_jobs(user_id);
CREATE INDEX IF NOT EXISTS listing_prepare_jobs_status_idx ON listing_prepare_jobs(status);
```

**Nota:** não precisa de colunas Mercado Pago, Stripe, inventário, etc.

---

## 6. APIs obrigatórias

Prefixo: `/api`. Rotas autenticadas exigem `Authorization: Bearer <supabase_access_token>`, exceto callbacks OAuth e webhook N8N.

### 6.1 Auth / perfil

- Garantir `profiles` no primeiro request autenticado
- `GET /api/me` → perfil atual

### 6.2 Contas / Integrações

| Método | Path | Função |
| --- | --- | --- |
| GET | `/accounts` | Lista contas do usuário (ML + Amazon) |
| GET | `/accounts/connect/url` | URL OAuth Mercado Livre + grava `oauth_states` |
| GET | `/callback` (e alias `/accounts/connect/callback`) | Callback ML → tokens → upsert `accounts` → redirect `/integrations?success=true` |
| GET | `/accounts/amazon/connect/url` | URL consent Seller Central |
| GET | `/amazon/callback` (e alias `/accounts/amazon/connect/callback`) | Callback Amazon → LWA exchange → upsert |
| POST | `/accounts/amazon/connect` | Fallback token privado: body `{ sellerId, refreshToken, storeName? }` ou env fallback |
| DELETE | `/accounts/:id` | Desconectar |
| POST | `/accounts/:id/sync` | Sync leve (202); atualiza nickname/store e opcionalmente espelha listings recentes |
| GET | `/accounts/:id` | Detalhe |

**OAuth state:** UUID, TTL ~10 min, consumo único.

**Amazon OAuth:** se `AMAZON_OAUTH_DRAFT=true`, incluir `version=beta` na URL de consent. Marketplace BR: `A2Q3Y263D00KWC`.

### 6.3 Produtos / anúncios / prepare

| Método | Path | Função |
| --- | --- | --- |
| GET | `/products` | Lista anúncios do usuário (join accounts; filtros simples: platform, status, busca título/SKU) |
| GET | `/products/:id` | Detalhe |
| POST | `/products/prepare-from-link` | Body: `{ productUrl, accountId }` → job + dispatch N8N → `{ jobId }` |
| GET | `/products/prepare-jobs/:jobId` | Poll status + `draft` quando ready |
| POST | `/products/publish-draft` | Body: `{ jobId, draft, accountId? }` → publica ML ou Amazon |
| GET | `/products/amazon/product-types` | Helper autocomplete product type (review Amazon) |
| GET | `/products/amazon/browse-nodes` | Helper browse nodes (se necessário na review) |
| POST | `/products/pictures` | Upload/proxy de imagem (opcional; útil na review ML) |

### 6.4 Webhook N8N (sem JWT usuário)

| Método | Path | Auth |
| --- | --- | --- |
| POST | `/webhooks/n8n/listing-prepared` | `Authorization: Bearer N8N_WEBHOOK_SECRET` **ou** header `X-N8N-Secret` |

Comportamento: localizar job por `jobId`, gravar `draft_json`, status `completed` \| `needs_review` \| `failed`, `completed_at`, `error_message`.

Validar secret com comparação timing-safe. Se `N8N_WEBHOOK_SECRET` estiver vazio em dev, pode aceitar (mas em prod deve estar setado).

---

## 7. Contrato N8N (NÃO ALTERAR SHAPES)

### 7.1 App → N8N (dispatch)

`POST` para:

- Conta ML → `N8N_PREPARE_WEBHOOK_URL`
- Conta Amazon → `N8N_AMAZON_PREPARE_WEBHOOK_URL`

Body JSON:

```json
{
  "jobId": "11111111-1111-4111-8111-111111111111",
  "productUrl": "https://www.amazon.com.br/dp/B0EXAMPLE01",
  "accountId": "22222222-2222-4222-8222-222222222222",
  "userId": "33333333-3333-4333-8333-333333333333",
  "callbackUrl": "https://SEU_PUBLIC_URL/api/webhooks/n8n/listing-prepared",
  "targetPlatform": "mercadolivre"
}
```

Para Amazon, `targetPlatform`: `"amazon"`.

Ack: HTTP 2xx rápido. Resultado **só** no callback.

### 7.2 N8N → App (callback)

```json
{
  "jobId": "…",
  "status": "completed",
  "targetPlatform": "mercadolivre",
  "draft": { }
}
```

`status`: `completed` | `needs_review` | `failed`  
Se `failed`: campo `error` (string).

### 7.3 Draft Mercado Livre (`N8nListingDraft`)

Shape **obrigatório** (não misturar campos Amazon):

```ts
type N8nListingDraft = {
  payload: {
    category_id: string;
    price?: number;
    currency_id?: string;
    available_quantity: number;
    buying_mode?: string;
    listing_type_id: string;
    condition: "new" | "used";
    pictures: Array<{ source: string }>;
    attributes: Array<{ id: string; value_name?: string; value_id?: string }>;
    family_name: string;
    sale_terms?: unknown[];
    shipping?: unknown;
  };
  _description?: string;
  _asin?: string | null;
  _pronto_para_publicar?: boolean;
  _attributes_ainda_pendentes?: unknown[];
  _attributes_preenchidos_inteligente?: unknown[];
  _erros_validacao_ml?: unknown[];
  _ihub_ui?: unknown;
};
```

Publicação ML: criar item na API ML com o `payload` revisado + descrição; upsert `products` (`ml_item_id`, título, preço, thumbnail, permalink, etc.).

### 7.4 Draft Amazon (`N8nAmazonListingDraft`)

```ts
type N8nAmazonListingDraft = {
  platform: "amazon";
  payload: {
    sellerSku: string;
    productType: string;
    requirements?: string; // usar "LISTING"
    attributes: Record<string, unknown>; // shape SP-API Listings Items
  };
  _marketplace_id?: string;
  _asin?: string | null; // ASIN FONTE (referência) — NÃO republicar o mesmo ASIN
  _description?: string;
  _bullet_points?: string[];
  _scraped_attributes?: Array<{ key: string; value: string }>;
  _pronto_para_publicar?: boolean;
  _product_type_sugerido?: string;
};
```

Regras de publicação Amazon (produto **novo** a partir do scrape):

- `requirements: "LISTING"` (Amazon cria ASIN novo)
- Sempre `supplier_declared_has_product_identifier_exemption: true`
- **Não** enviar `externally_assigned_product_identifier` (GTIN/EAN)
- **Não** usar `merchant_suggested_asin` apontando para o ASIN scrapado
- `model_name` ≤ 120 caracteres
- Chamar SP-API `putListingsItem` com atributos revisados
- Upsert `products` com `amazon_sku`, `amazon_asin`, `amazon_product_type`

Exemplo resumido de draft Amazon:

```json
{
  "platform": "amazon",
  "payload": {
    "sellerSku": "SKU-001",
    "productType": "SHOES",
    "requirements": "LISTING",
    "attributes": {
      "item_name": [{ "value": "Título", "marketplace_id": "A2Q3Y263D00KWC" }],
      "condition_type": [{ "value": "new_new", "marketplace_id": "A2Q3Y263D00KWC" }],
      "brand": [{ "value": "Marca", "marketplace_id": "A2Q3Y263D00KWC" }],
      "bullet_point": [{ "value": "Benefício 1", "marketplace_id": "A2Q3Y263D00KWC" }],
      "fulfillment_availability": [
        { "fulfillment_channel_code": "DEFAULT", "quantity": 5 }
      ],
      "purchasable_offer": [
        {
          "marketplace_id": "A2Q3Y263D00KWC",
          "currency": "BRL",
          "our_price": [{ "schedule": [{ "value_with_tax": 199.9 }] }]
        }
      ],
      "main_product_image_locator": [
        { "media_location": "https://example.com/img.jpg", "marketplace_id": "A2Q3Y263D00KWC" }
      ]
    }
  },
  "_marketplace_id": "A2Q3Y263D00KWC",
  "_asin": "B0…",
  "_description": "…",
  "_bullet_points": ["Benefício 1", "Benefício 2"],
  "_scraped_attributes": [{ "key": "Cor", "value": "Preto" }],
  "_pronto_para_publicar": false,
  "_product_type_sugerido": "SHOES"
}
```

---

## 8. Telas e UX (critérios de aceite)

Rotas sugeridas:

| Path | Tela |
| --- | --- |
| `/login`, `/signup` | Auth Supabase |
| `/` | Redirect → `/ads` ou `/create` |
| `/integrations` | Integrações |
| `/ads` | Lista de anúncios |
| `/ads/new` ou `/create` | Wizard criar anúncio |
| `/ads/:id` | Detalhe simples |

Shell autenticado: sidebar/topnav com **FlashAnúncio** (marca forte), links Integrações / Anúncios / Criar.

### 8.1 Integrações (`/integrations`)

Espelhar o papel da tela Integrações do iHub:

- Cards/áreas claras para **Mercado Livre** e **Amazon**
- Botão **Conectar conta ML** → OAuth browser
- Botão **Conectar Amazon** → OAuth Seller Central
- Dialog secundário: **Ou conectar com token (app privado)** (sellerId + refreshToken)
- Lista de contas conectadas com badge ML / AMZ, nickname/store, status ativo, last sync
- Ações: Sincronizar, Desconectar (com confirmação)
- Toasts de sucesso/erro via query params (`?success=true`, `?success=amazon`, `?error=…`) e limpar URL
- **Não** incluir Mercado Pago nem Shopee “em breve” a menos que sobre espaço — priorize ML + Amazon funcionando

**Aceite:** usuário autentica, conecta ML e Amazon, vê as contas listadas, desconecta sem quebrar.

### 8.2 Criar anúncio (`/ads/new`)

Wizard em **2 steps** (igual iHub Produtos → Criar):

**Step 1 — Link + conta**

- Input de URL (Amazon/Shopee) com validação de host
- Seletor de conta destino (ML e Amazon misturados; mostrar plataforma)
- CTA “Preparar anúncio”
- Loading state elegante enquanto job processa (poll 3s; timeout ~60s configurável)
- Erros: URL inválida, sem contas, N8N falhou, timeout

**Step 2 — Review**

- Se draft ML → formulário: título/`family_name`, preço, quantidade, categoria, fotos, atributos, descrição, listing type, condition; destacar `_erros_validacao_ml` / pendências; bloquear publish se `canPublish` falso
- Se draft Amazon (`platform === "amazon"`) → formulário: sellerSku, productType, item_name, brand, price, qty, bullets, description, imagens, atributos scrapados editáveis; aplicar GTIN exemption automaticamente antes do publish
- CTA “Publicar”
- Sucesso → toast + navegar para lista/detalhe

**Aceite:** link Amazon → conta ML → draft → editar → publica no ML; link Amazon → conta Amazon → draft Amazon → publica via SP-API.

### 8.3 Lista Anúncios (`/ads`)

- Tabela/lista enxuta: thumbnail, título, plataforma, SKU/ML id, preço, status, link externo
- Filtros básicos + CTA “Criar anúncio”
- Empty state bonito convidando a conectar integração ou criar o primeiro anúncio

---

## 9. Design — FlashAnúncio (obrigatório ficar premium)

Objetivo: **muito mais bonito, moderno e atrativo** que um CRUD genérico. Uma composição clara, não um dashboard lotado.

### Direção visual

- **Marca primeiro:** “FlashAnúncio” deve ser sinal hero-level na landing/login e no shell (não só texto minúsculo na nav)
- **Tipografia expressiva:** use fontes Google distintas (ex.: display `Syne` ou `Outfit` + body `DM Sans` ou `Sora`). **Proibido** Inter, Roboto, Arial, system-ui como face principal
- **Atmosfera:** fundo com gradiente sutil + padrão geométrico leve ou grain; evitar flat branco único
- **Paleta própria** (CSS variables). Sugestão (pode ajustar, mas mantenha coerência):
  - Base: azul-noite profundo `#0B1220` + superfície `#121A2B`
  - Accent elétrico (flash): ciano-lima `#3DFFC8` ou âmbar elétrico `#FFB020`
  - Texto: off-white `#EEF2FF` / muted `#9AA6C1`
  - ML tint: amarelo ML suave; Amazon tint: laranja suave — só em badges, não no tema global
- **Evitar looks AI clichê:** purple-on-white, purple→indigo gradients, cream+#terracotta serif, broadsheet newspaper, glow neon exagerado, pills `rounded-full` em excesso, multi-shadow pesado, emojis decorativos
- **Hero budget (login/landing):** marca + 1 headline + 1 frase + 1 CTA (+ visual de fundo). Sem stats, sem cards de feature no first viewport
- **Cards:** usar só onde há interação (conta conectada, step do wizard). Evitar cardificar tudo
- **Motion (mín. 2–3):**
  1. Entrada suave do shell / page transition
  2. Stepper do wizard com progress animado
  3. Estado “scraping…” com pulse/shimmer intencional (não spinner genérico infinito sem copy)
- **Mobile-first:** Integrações e wizard usáveis em 390px

### Microcopy

- “Preparando anúncio a partir do link…”
- “Revisão necessária — complete os campos destacados”
- “Publicado no Mercado Livre” / “Enviado à Amazon”

---

## 10. O que espelhar do iHub vs o que redesenhar

Se você tiver acesso ao monorepo iHub, use como **referência de comportamento** (não clone o visual):

| Peça | Referência iHub | No FlashAnúncio |
| --- | --- | --- |
| Wizard criar | `ProductCreate.tsx` + forms N8N/Amazon | Reimplementar UX/UI nova; mesma máquina de estados |
| Integrações | `Integrations.tsx` | Redesign; mesmas conexões ML/Amazon |
| Dispatch/contrato | `n8n-listings.ts`, `CONTRACT.md` | Copiar contrato byte-a-byte |
| Jobs | `listing-prepare-jobs.ts` | Mesma semântica de status |
| Publish ML/Amazon | `ml-listings.ts`, `amazon-listings.ts`, `amazon.ts` | Portar lógica essencial |
| Accounts OAuth | `routes/accounts.ts` | Portar |
| Design / layout | `AppLayout`, tokens Inter sky-blue | **Descartar** — design novo FlashAnúncio |

**Não porte:** orders, questions, inventory, stripe, full gestão, templates, diagnóstico.

---

## 11. Ordem de implementação (Replit Agent)

Siga nesta ordem e pare para validar cada etapa:

1. **Scaffold** `client/` + `server/`, Tailwind, scripts `dev`/`build`/`start` no Replit
2. **Secrets** + `.env.example` + healthcheck `GET /api/health`
3. **Supabase:** criar projeto (ou usar existente), rodar SQL da seção 5, Auth email/password
4. **Auth UI** login/signup + middleware JWT no Express + `GET /api/me` + bootstrap `profiles`
5. **Schema Drizzle** alinhado às tabelas
6. **Integrações backend** OAuth ML + Amazon + token fallback + list/delete
7. **Integrações UI** com design FlashAnúncio
8. **Prepare pipeline:** `prepare-from-link`, dispatch N8N, webhook callback, poll job
9. **Review UI** ML + Amazon + `publish-draft` (ML create item + Amazon putListingsItem)
10. **Lista Anúncios** + empty states
11. **Polish:** motion, erros, loading, mobile, README com secrets e redirects OAuth
12. **Smoke tests** (seção 12)

---

## 12. Smoke tests (aceite final)

### A. Auth

- [ ] Signup/login Supabase funciona
- [ ] Request sem token → 401

### B. Integrações

- [ ] `GET /accounts/connect/url` retorna URL ML; callback grava conta
- [ ] Amazon OAuth ou `POST /accounts/amazon/connect` grava conta `platform=amazon`
- [ ] Listagem mostra ambas; delete remove

### C. Prepare → Publish ML

- [ ] `POST /products/prepare-from-link` com URL Amazon + account ML → `jobId`
- [ ] N8N callback chega autenticado; job `completed` ou `needs_review` com draft ML
- [ ] Poll retorna draft; publish cria item ML e linha em `products` com `ml_item_id`

### D. Prepare → Publish Amazon

- [ ] Mesmo fluxo com account Amazon → webhook Amazon → draft `platform: amazon`
- [ ] Publish chama SP-API com `requirements: LISTING` + GTIN exemption
- [ ] `products` com `amazon_sku` / `amazon_asin`

### E. UX

- [ ] Design não parece template roxo genérico; marca FlashAnúncio evidente
- [ ] Wizard mobile ok; estados de loading/erro claros
- [ ] Timeout de prepare tratado com mensagem acionável

---

## 13. README mínimo que o Agent deve gerar

Incluir:

1. Como configurar Secrets no Replit
2. Redirect URIs para cadastrar no app ML e no Amazon Developer Central
3. Que o scrape depende do N8N externo (URLs dos webhooks)
4. Comandos `npm run dev` / start
5. Domínio `PUBLIC_URL` deve ser alcançável pelo N8N (callback)

---

## 14. Restrições finais para o Agent

- **Não** reimplementar scraper dentro do FlashAnúncio (Apify fica no N8N)
- **Não** mudar nomes de campos do contrato N8N
- **Não** publicar Amazon como offer no ASIN scrapado — sempre listing novo (`LISTING` + exemption)
- **Não** adicionar billing/Stripe neste MVP
- **Não** usar Inter/Roboto nem tema purple default
- Preferir código simples, tipado, com erros HTTP claros em português
- Tokens de marketplace **nunca** vão para o frontend; só o backend fala com ML/Amazon/N8N

---

## 15. Prompt curto (opcional — primeira mensagem)

Se quiser uma mensagem curta antes de colar este doc:

> Implemente o app **FlashAnúncio** conforme a especificação completa anexada (`FLASHANUNCIO_REPLIT_PROMPT.md`). É um SaaS focado só em Integrações (ML + Amazon) e criação de anúncios via scrape usando os webhooks N8N existentes. Use Supabase (Auth + Postgres). Design premium com marca FlashAnúncio. Não saia do escopo.

Em seguida, anexe **este arquivo inteiro**.
