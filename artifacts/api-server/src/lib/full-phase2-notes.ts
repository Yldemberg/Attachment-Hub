/**
 * Roadmap pós-MVP Gestão Full (não implementado).
 *
 * Fase 2:
 * - ~~Considerar inbound em trânsito nas sugestões (em_transito > 0)~~ (registro manual no iHub)
 * - Export CSV / checklist de envio alinhado ao Seller Center
 * - Estimativa de vendas perdidas (média diária × dias em ruptura × preço)
 * - Filtro ABC e “ações necessárias”
 * - Cruzar com Inventário Geral (cap de envio pelo mandate local)
 * - Auto-fechar inbound via operations ML (inbound_reception)
 *
 * Fase 3:
 * - Space / capacidade (limites de armazenamento ML)
 * - Custos Full (warehousing) via ml-billing
 * - Multi-regra por curva (A=45 dias, C=15 dias)
 *
 * Ver também: n8n/FULL_ALERTS_CONTRACT.md
 */
export const FULL_PHASE2_NOTES = true;
