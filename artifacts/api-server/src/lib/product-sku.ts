import { productsTable } from "@workspace/db/schema";
import { or, sql, type SQL } from "drizzle-orm";

/**
 * Match listings by seller SKU across ML (`sku`) and Amazon (`sku` / `amazon_sku`).
 * Case-insensitive so "K3NecPre" e "k3necpre" caem no mesmo mandato.
 */
export function productsMatchSellerSku(sku: string): SQL {
  const needle = sku.trim();
  return or(
    sql`lower(trim(coalesce(${productsTable.sku}, ''))) = lower(${needle})`,
    sql`lower(trim(coalesce(${productsTable.amazonSku}, ''))) = lower(${needle})`,
  )!;
}

export function isAmazonProductRow(row: {
  platform?: string | null;
  amazonSku?: string | null;
  mlItemId?: string | null;
}): boolean {
  return row.platform === "amazon" || !!row.amazonSku?.trim();
}
