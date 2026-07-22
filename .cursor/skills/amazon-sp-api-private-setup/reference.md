# SP-API — referência (app privado BR)

## Fase 2 iHub (implementada)

- Connect: `POST /accounts/amazon/connect` (credenciais no env do servidor)
- Client: `artifacts/api-server/src/lib/amazon.ts`
- Sync / listings: `amazon-sync.ts`, `amazon-listings.ts`
- UI: Integrações → Conectar Amazon

## Marketplace e região

| Item | Valor |
| --- | --- |
| País | Brasil |
| `marketplaceId` | `A2Q3Y263D00KWC` |
| Country code | `BR` |
| Seller Central | https://sellercentral.amazon.com.br |
| Região SP-API | North America (mesmo grupo CA/US/MX/BR) |
| Endpoint SP-API | `https://sellingpartnerapi-na.amazon.com` |
| LWA token URL | `https://api.amazon.com/auth/o2/token` |

Fonte marketplace IDs: [Marketplace IDs](https://developer-docs.amazon.com/sp-api/docs/marketplace-ids)

## Roles recomendados (fase iHub: estoque + anúncios)

Pedir no Developer Profile / no app (nomes podem aparecer em inglês):

| Role | Para quê |
| --- | --- |
| **Product Listing** | Criar/atualizar anúncios e catálogo |
| **Inventory and Order Tracking** | Estoque e acompanhamento de pedidos |
| **Pricing** | Preços dos anúncios |

Adiar (se não precisar agora):

| Role | Motivo |
| --- | --- |
| Roles **Restricted** / PII (Buyer info detalhado, etc.) | Exigem compliance extra; não necessários para MVP estoque/anúncios |
| Finance / Tax / Advertising | Só se o use case exigir |

Definições oficiais: [Roles in the Selling Partner API](https://developer-docs.amazon.com/sp-api/docs/roles-in-the-selling-partner-api)

## LWA — troca de tokens

### Refresh → access (runtime)

```
POST https://api.amazon.com/auth/o2/token
Content-Type: application/x-www-form-urlencoded;charset=UTF-8

grant_type=refresh_token
&refresh_token={AMAZON_REFRESH_TOKEN}
&client_id={AMAZON_LWA_CLIENT_ID}
&client_secret={AMAZON_LWA_CLIENT_SECRET}
```

Resposta típica:

```json
{
  "access_token": "Atza|...",
  "token_type": "bearer",
  "expires_in": 3600
}
```

Usar `access_token` no header `x-amz-access-token` das chamadas SP-API (padrão atual LWA-only; Sem SigV4 obrigatório).

## Credenciais — checklist de segurança

- [ ] Client ID / Secret / Refresh Token só em secret store ou `.env` local
- [ ] `.env` no `.gitignore`
- [ ] Sem tokens em logs, URLs ou frontend
- [ ] Refresh token tratado como senha de longa duração
- [ ] Primary User é quem faz self-authorize
- [ ] `AMAZON_SELLER_ID` configurado (Listings Items API)

## IAM / AWS

Desde **2 out 2023**, SP-API **não exige** AWS IAM nem Signature Version 4 para autenticação. Só LWA. Guias LATAM antigos que pedem “IAM ARN da função” estão desatualizados se a UI atual não solicitar o campo.

## Links oficiais

| Tópico | URL |
| --- | --- |
| Onboarding overview | https://developer-docs.amazon.com/sp-api/docs/onboarding-overview |
| Private developer | https://developer-docs.amazon.com/sp-api/docs/register-as-a-private-developer |
| Self-authorization | https://developer-docs.amazon.com/sp-api/docs/self-authorization |
| Marketplace IDs | https://developer-docs.amazon.com/sp-api/docs/marketplace-ids |
| Roles | https://developer-docs.amazon.com/sp-api/docs/roles-in-the-selling-partner-api |
| Connect to SP-API | https://developer-docs.amazon.com/sp-api/docs/connecting-to-the-selling-partner-api |
| LATAM (contexto BR; validar vs docs oficiais) | https://pt-br-group.readme.io/amazon-latam/docs |

## Texto sugerido para Use Cases (copiar/adaptar)

> Aplicação privada interna (iHub) para a própria organização vendedora na Amazon Brasil. Objetivo: sincronizar estoque, consultar catálogo/anúncios e criar ou atualizar listagens via Selling Partner API. Dados acessados apenas pela nossa conta Seller. Tokens LWA armazenados de forma segura no servidor; sem compartilhamento com terceiros.

## Texto sugerido para Security Controls (adaptar à realidade)

- Credenciais e refresh tokens em variáveis de ambiente / vault, não em código-fonte
- Acesso ao servidor/API restrito a usuários autenticados da organização
- Sem armazenamento de PII de compradores nesta fase
- Logs sem tokens ou secrets
- HTTPS em trânsito
