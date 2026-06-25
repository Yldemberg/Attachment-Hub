import { eq, and, inArray } from "drizzle-orm";
import { productsTable, type Product } from "@workspace/db/schema";
import { getDb } from "./db";
import { getUserAccountIds } from "./account-scope";
import { ml } from "./mercadolivre";

export type ListingStatus = "active" | "paused";

export class ProductListingStatusError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_FOUND" | "INVALID_STATUS" | "ML_API_ERROR" | "BAD_REQUEST",
  ) {
    super(message);
    this.name = "ProductListingStatusError";
  }
}

async function setProductListingStatus(
  product: Pick<Product, "id" | "accountId" | "mlItemId">,
  status: ListingStatus,
): Promise<void> {
  const db = getDb();
  await ml.put(product.accountId, `/items/${encodeURIComponent(product.mlItemId)}`, { status });
  await db
    .update(productsTable)
    .set({ status, updatedAt: new Date() })
    .where(eq(productsTable.id, product.id));
}

/** Mesma lógica de PATCH /products/:id/status — usada na tela Produtos. */
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
