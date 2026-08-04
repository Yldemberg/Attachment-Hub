# Contrato iHub ↔ N8N — Alertas WhatsApp (Gestão Full + Perguntas / Evolution API)

## Fluxo

1. **Gestão Full:** job iHub (`FULL_ALERTS_INTERVAL_MS`, default 1h) ou `POST /api/full/alerts/run`
2. **Perguntas:** webhook ML `questions` → notificação `new_question` → `notifyNewQuestionWhatsApp`
3. iHub → `POST N8N_FULL_ALERTS_WEBHOOK_URL` com payload abaixo (`kind`: `full` | `question`)
4. N8N formata mensagem e chama Evolution API `POST /message/sendText`
5. iHub grava `full_alert_log` (cooldown)

Credenciais Evolution (`EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE`) ficam **somente no N8N**.

Telefone e toggles: `full_settings` (mesmo WhatsApp da Gestão Full; `alertQuestions` para perguntas).

---

## iHub → N8N

**Método:** `POST`  
**URL:** `N8N_FULL_ALERTS_WEBHOOK_URL` (ex. `/webhook/full_alerts`)  
**Header opcional:** `X-N8N-Secret: <N8N_WEBHOOK_SECRET>`

### Campos comuns

| Campo | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `kind` | `full` \| `question` | não (default `full`) | Tipo da mensagem |
| `accountId` | uuid | sim | Conta ML |
| `accountNickname` | string \| null | não | Nickname ML |
| `phone` | string | sim | Somente dígitos (ex. `5511999999999`) |
| `generatedAt` | ISO datetime | sim | Momento do envio |

---

## kind = `full` (Gestão Full)

| Campo | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `alerts` | array | sim | Até 40 itens |

### Item `alerts[]`

| Campo | Tipo | Descrição |
| --- | --- | --- |
| `type` | `ruptura` \| `critico` \| `parado` \| `saudavel` | Tipo do alerta |
| `sku` | string | SKU |
| `title` | string | Título do anúncio |
| `stockFull` | number | Estoque disponível no CD |
| `salesPerDay` | number | Velocidade no período |
| `suggestedQty` | number | Qtd sugerida de envio |
| `sendBy` | `YYYY-MM-DD` \| null | Data sugerida para enviar |
| `coverageDays` | number \| null | Dias de cobertura |

### Exemplo Full

```json
{
  "kind": "full",
  "accountId": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  "accountNickname": "LOJA_EXEMPLO",
  "phone": "5511999999999",
  "generatedAt": "2026-08-01T18:00:00.000Z",
  "alerts": [
    {
      "type": "ruptura",
      "sku": "ABC-1",
      "title": "Produto Exemplo",
      "stockFull": 0,
      "salesPerDay": 2.4,
      "suggestedQty": 72,
      "sendBy": "2026-08-03",
      "coverageDays": 0
    }
  ]
}
```

### Mensagem WhatsApp (Full)

- 🔴 RUPTURA · 🟠 CRÍTICO · ⚪ PARADO
- Até 25 alertas por mensagem

---

## kind = `question` (Nova pergunta)

| Campo | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `question` | object | sim | Dados da pergunta |

### `question`

| Campo | Tipo | Descrição |
| --- | --- | --- |
| `id` | string | ID ML da pergunta |
| `fromNickname` | string \| null | Comprador |
| `text` | string | Texto da pergunta |
| `itemId` | string \| null | MLB do anúncio |
| `permalink` | string \| null | Link do anúncio |

### Exemplo Pergunta

```json
{
  "kind": "question",
  "accountId": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  "accountNickname": "LOJA_EXEMPLO",
  "phone": "5511999999999",
  "generatedAt": "2026-08-04T22:00:00.000Z",
  "question": {
    "id": "1234567890",
    "fromNickname": "COMPRADOR123",
    "text": "Tem na cor azul?",
    "itemId": "MLB123",
    "permalink": "https://produto.mercadolivre.com.br/MLB-123"
  }
}
```

Ack: HTTP `2xx` rápido.

Defaults recomendados no iHub: meta **25**d, lead **12**d, período **15**d; WhatsApp com ruptura+crítico (parado off); `alertQuestions` on. Ver `full-recommended-settings.ts`.

Workflow de referência: [`workflows/full_alerts_whatsapp.json`](workflows/full_alerts_whatsapp.json)  
Preview Full: `node --experimental-strip-types n8n/examples/preview-full-alerts-message.mts`

---

## Fase 2 / 3 (roadmap — não no MVP)

- Estoque em trânsito (inbound) na fórmula `qtd_sugerida`
- Export CSV / checklist de envio para upload no Seller Center
- Vendas perdidas estimadas (R$) em ruptura
- Curva ABC Full + regras de cobertura por curva
- Cap de envio pelo Inventário Geral (mandate local)
- Space management / capacidade do CD
- Custos de warehousing (`ml-billing`) para priorizar estoque parado caro
