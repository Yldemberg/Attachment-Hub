# Contrato iHub ↔ N8N (prepare listing)

Fonte de verdade no código:

- Dispatch: [`artifacts/api-server/src/lib/n8n-listings.ts`](../artifacts/api-server/src/lib/n8n-listings.ts) → `dispatchPrepareToN8n`
- Draft ML: `N8nListingDraft` — quando `targetPlatform=mercadolivre` (**não alterar shape**)
- Draft Amazon: `N8nAmazonListingDraft` — quando `targetPlatform=amazon` (Listings Items / SP-API)
- Callback: `POST /api/webhooks/n8n/listing-prepared`

---

## 1. iHub → N8N (iniciar prepare)

**Método:** `POST`  
**URL:**
- ML → `N8N_PREPARE_WEBHOOK_URL` → `/webhook/criar_anuncio` → [`criar_anuncio.json`](workflows/criar_anuncio.json)
- Amazon → `N8N_AMAZON_PREPARE_WEBHOOK_URL` → `/webhook/criar_anuncio_amazon` → [`criar_anuncio_amazon.json`](workflows/criar_anuncio_amazon.json)

| Campo | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `jobId` | uuid | sim | Job no iHub |
| `productUrl` | url | sim | Link Amazon/Shopee (fonte do scrape) |
| `accountId` | uuid | sim | Conta de **destino** (ML ou Amazon) |
| `userId` | uuid | sim | Usuário iHub |
| `callbackUrl` | url | sim | Webhook de retorno |
| `targetPlatform` | `mercadolivre` \| `amazon` | sim | Eco / documentação; a **URL** do webhook já separa os fluxos |

- Conta ML → draft Mercado Livre (workflow ML, shape inalterado).
- Conta Amazon → draft Amazon SP-API (workflow Amazon dedicado).

Exemplos: [prepare-request.json](examples/prepare-request.json), [prepare-request-amazon.json](examples/prepare-request-amazon.json).

Ack: HTTP `2xx` rápido; resultado no callback.

---

## 2. N8N → iHub (callback)

`POST` em `callbackUrl` com `Authorization: Bearer <N8N_WEBHOOK_SECRET>` ou `X-N8N-Secret`.

| Campo | Obrigatório | Descrição |
| --- | --- | --- |
| `jobId` | sim | Mesmo job |
| `status` | sim | `completed` \| `needs_review` \| `failed` |
| `targetPlatform` | recomendado | Eco do destino |
| `draft` | se ok | Seção 3 (ML) ou 4 (Amazon) |
| `error` | se failed | Mensagem |

---

## 3. Draft Mercado Livre (`N8nListingDraft`) — manter

`payload`: `category_id`, `available_quantity`, `listing_type_id`, `condition`, `pictures[]`, `attributes[]`, `family_name` (+ opcionais).

Metadados: `_description`, `_asin`, `_pronto_para_publicar`, `_attributes_*`, `_erros_validacao_ml`, `_ihub_ui`, etc.

Exemplos: [listing-prepared-completed.json](examples/listing-prepared-completed.json), [listing-prepared-needs-review.json](examples/listing-prepared-needs-review.json).

---

## 4. Draft Amazon (`N8nAmazonListingDraft`)

Alinha ao Listings Items API (`putListingsItem`).

Além de `payload.attributes` (SP-API), o prepare Amazon deve trazer tudo o que o scrape capturou:

| Campo | Descrição |
| --- | --- |
| `_scraped_attributes` | Lista `{ key, value }` da página Amazon |
| `_bullet_points` | Features / bullets (até 10; 5 vão em `bullet_point`) |
| `_description` | Descrição completa |
| `_asin` | ASIN **fonte** (referência); a publicação cria ASIN **novo** (sem `merchant_suggested_asin`) |

Produto novo a partir do scrape:

- Sempre `supplier_declared_has_product_identifier_exemption: true`
- **Não** enviar `externally_assigned_product_identifier` (GTIN/EAN)
- `model_name` com no máximo **12** caracteres
- `requirements: LISTING` (Amazon cria o ASIN)

O frontend do iHub exibe e permite editar esses campos antes de `putListingsItem` com `requirements: LISTING`.

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
      "bullet_point": [
        { "value": "Benefício 1", "marketplace_id": "A2Q3Y263D00KWC" }
      ],
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
        { "media_location": "https://…/img.jpg", "marketplace_id": "A2Q3Y263D00KWC" }
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

Exemplo: [listing-prepared-amazon-needs-review.json](examples/listing-prepared-amazon-needs-review.json).

Publicação no iHub: `createAmazonListing` / SP-API com os atributos revisados.

---

## 5. Checklist N8N

### Workflow ML (`criar_anuncio`)
- [ ] Payload final = `N8nListingDraft` (sem campos Amazon)
- [ ] Webhook path `criar_anuncio`

### Workflow Amazon (`criar_anuncio_amazon`)
- [ ] Webhook path `criar_anuncio_amazon`
- [ ] Payload final = `N8nAmazonListingDraft` (`platform: amazon`)
- [ ] Callback com `jobId`, `status`, `draft`
- [ ] Preferir `callbackUrl` do request no nó HTTP final
