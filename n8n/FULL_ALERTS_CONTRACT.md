# Contrato iHub ↔ N8N — Alertas Gestão Full (WhatsApp / Evolution API)

## Fluxo

1. Job iHub (`FULL_ALERTS_INTERVAL_MS`, default 1h) ou `POST /api/full/alerts/run`
2. iHub → `POST N8N_FULL_ALERTS_WEBHOOK_URL` com payload abaixo
3. N8N formata mensagem e chama Evolution API `POST /message/sendText`
4. iHub grava `full_alert_log` (cooldown por SKU + tipo)

Credenciais Evolution (`EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE`) ficam **somente no N8N**.

---

## iHub → N8N

**Método:** `POST`  
**URL:** `N8N_FULL_ALERTS_WEBHOOK_URL` (ex. `/webhook/full_alerts`)  
**Header opcional:** `X-N8N-Secret: <N8N_WEBHOOK_SECRET>`

| Campo | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `accountId` | uuid | sim | Conta ML |
| `accountNickname` | string \| null | não | Nickname ML |
| `phone` | string | sim | Somente dígitos (ex. `5511999999999`) |
| `alerts` | array | sim | Até 40 itens |
| `generatedAt` | ISO datetime | sim | Momento do job |

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

### Exemplo

```json
{
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

Ack: HTTP `2xx` rápido.

Defaults recomendados no iHub (novas contas / botão na UI): meta **25**d, lead **12**d, período **15**d; WhatsApp com ruptura+crítico (parado off). Ver `full-recommended-settings.ts`.

### Mensagem WhatsApp (nó Formatar mensagem)

Formatação WhatsApp (`*negrito*`, `_itálico_`) + emojis por tipo:

- 🔴 RUPTURA · 🟠 CRÍTICO · ⚪ PARADO
- Negrito em: tipo, SKU, estoque, vendas/dia, cobertura, qtd e data de envio
- Data `sendBy` em `DD/MM/AAAA`; até 25 alertas por mensagem

Workflow de referência: [`workflows/full_alerts_whatsapp.json`](workflows/full_alerts_whatsapp.json)  
Preview: `node --experimental-strip-types n8n/examples/preview-full-alerts-message.mts`

---

## Fase 2 / 3 (roadmap — não no MVP)

- Estoque em trânsito (inbound) na fórmula `qtd_sugerida`
- Export CSV / checklist de envio para upload no Seller Center
- Vendas perdidas estimadas (R$) em ruptura
- Curva ABC Full + regras de cobertura por curva
- Cap de envio pelo Inventário Geral (mandate local)
- Space management / capacidade do CD
- Custos de warehousing (`ml-billing`) para priorizar estoque parado caro
