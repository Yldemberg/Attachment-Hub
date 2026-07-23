# Workflows N8N (exports)

Dois workflows separados — **não misturar** payload ML e Amazon no mesmo fluxo.

| Arquivo | Webhook | Env iHub | Payload final |
| --- | --- | --- | --- |
| [`criar_anuncio.json`](criar_anuncio.json) | `/webhook/criar_anuncio` | `N8N_PREPARE_WEBHOOK_URL` | Mercado Livre (`N8nListingDraft`) |
| [`criar_anuncio_amazon.json`](criar_anuncio_amazon.json) | `/webhook/criar_anuncio_amazon` | `N8N_AMAZON_PREPARE_WEBHOOK_URL` | Amazon SP-API (`N8nAmazonListingDraft`) |

O iHub escolhe a URL conforme `accounts.platform` da conta de destino.

## Importar no odontflow

### ML (já existente — manter)
1. Se você **não** alterou o workflow em produção, não precisa reimportar o ML.
2. Se reimportou a versão com branch Amazon, reimporte `criar_anuncio.json` (só ML de novo).

### Amazon (novo)
1. N8N → **Import from File** → `criar_anuncio_amazon.json`
2. Revisar credenciais Apify e o nó **Enviar Amazon Draft ao iHub** (secret Bearer)
3. Ativar o workflow
4. Conferir URL pública: `https://n8n.odontflow.com.br/webhook/criar_anuncio_amazon`
5. No iHub/Replit Secrets: `N8N_AMAZON_PREPARE_WEBHOOK_URL=https://n8n.odontflow.com.br/webhook/criar_anuncio_amazon`

## Contrato

Ver [../CONTRACT.md](../CONTRACT.md).
