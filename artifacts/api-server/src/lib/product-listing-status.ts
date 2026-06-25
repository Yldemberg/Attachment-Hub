import { eq, and, inArray } from "drizzle-orm";
import { productsTable } from "@workspace/db/schema";
import { getDb } from "./db";
import { getUserAccountIds } from "./account-scope";
import { setProductListingStatus, type ListingStatus } from "./cross-docking-listings";

export class ProductListingStatusError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_FOUND" | "INVALID_STATUS" | "ML_API_ERROR" | "BAD_REQUEST",
  ) {
    super(message);
    this.name = "ProductListingStatusError";
  }
}

/** Mesma lógica de PATCH /products/:id/status — usada na tela Produtos e no Modo Férias. */
export async function changeProductListingStatus(
  userId: string,
  productId: string,
  status: ListingStatus,
): Promise<{ productId: string; status: ListingStatus }> {
  const db = getDb();
  const accountIds = await getUserAccountIds(userId);
  if (accountIds.length === 0) {
    throw new ProductListingStatusError("Product not found", "NOT_FOUND");
  }

  const [product] = await db
    .select()
    .from(productsTable)
    .where(and(eq(productsTable.id, productId), inArray(productsTable.accountId, accountIds)));

  if (!product) {
    throw new ProductListingStatusError("Product not found", "NOT_FOUND");
  }

  if (product.status !== "active" && product.status !== "paused") {
    throw new ProductListingStatusError(
      "Só é possível ativar ou pausar anúncios ativos ou pausados",
      "INVALID_STATUS",
    );
  }

  if (product.status === status) {
    return { productId: product.id, status };
  }

  try {
    await setProductListingStatus(product, status);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro desconhecido";
    if (msg.startsWith("ML API")) {
      throw new ProductListingStatusError(msg, "ML_API_ERROR");
    }
    throw err;
  }

  return { productId: product.id, status };
}
