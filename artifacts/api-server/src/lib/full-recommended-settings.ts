/**
 * Critérios recomendados Gestão Full (lead real ~9d com folga de agenda,
 * vendas oscilantes curvas A/B). Ver plano de configuração do produto.
 *
 * - lead 12 = 9 reais (1+2+4+2) + 3 folga → alerta crítico a tempo
 * - meta 25 ≈ lead folgado + estoque operacional
 * - período 15 reage a promo sem ruído de 7d
 * - parado off no WhatsApp (revisar na tela)
 */
export const FULL_RECOMMENDED_SETTINGS = {
  coverageTargetDays: 25,
  leadTimeDays: 12,
  salesPeriodDays: 15,
  stuckMultiplier: 2,
  alertRuptura: true,
  alertCritico: true,
  alertParado: false,
  alertCooldownHours: 24,
} as const;

export type FullRecommendedSettings = typeof FULL_RECOMMENDED_SETTINGS;
