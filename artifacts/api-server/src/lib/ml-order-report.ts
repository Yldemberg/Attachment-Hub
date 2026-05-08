import { ordersTable } from "@workspace/db/schema";
import { sql } from "drizzle-orm";

/** Status ML pós-pagamento (pagamento aprovado / pedido em preparação). */
export const PAID_ORDER_STATUSES = ["paid", "confirmed"] as const;

/**
 * Fuso usado no painel do Mercado Livre para vendedores no Brasil.
 * Contagens por "dia" seguem o calendário deste fuso — não o TZ do servidor.
 */
export const ML_REPORT_TZ = "America/Sao_Paulo";

/** Data civil (DATE) em ML_REPORT_TZ: fecha ML ou criação do pedido. */
export const orderPaidLocalDateSp = sql`
  CAST(timezone(${sql.raw(`'${ML_REPORT_TZ}'`)}, coalesce(${ordersTable.dateClosed}, ${ordersTable.dateCreated})) AS date)
`;

/** Pedido pago cuja data de referência cai no mesmo dia civil que "agora" no Brasil. */
export const isPaidOrderTodaySp = sql`
  ${orderPaidLocalDateSp} = CAST(timezone(${sql.raw(`'${ML_REPORT_TZ}'`)}, now()) AS date)
`;

/** Pedido pago no mês civil atual em ML_REPORT_TZ. */
export const isPaidOrderThisCalendarMonthSp = sql`
  to_char(timezone(${sql.raw(`'${ML_REPORT_TZ}'`)}, coalesce(${ordersTable.dateClosed}, ${ordersTable.dateCreated})), 'YYYY-MM')
  = to_char(timezone(${sql.raw(`'${ML_REPORT_TZ}'`)}, now()), 'YYYY-MM')
`;

export const orderSortInstant = sql`coalesce(${ordersTable.dateClosed}, ${ordersTable.dateCreated})`;
