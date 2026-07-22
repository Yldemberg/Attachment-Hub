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
  if (!product.mlItemId) {
    throw new ProductListingStatusError("Produto sem mlItemId (não ML)", "INVALID_STATUS");
  }
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

export type BulkListingStatusResult = {
  productId: string;
  mlItemId: string | null;
  ok: boolean;
  error?: string;
  skipped?: boolean;
};

export type BulkListingStatusSummary = {
  updated: number;
  skipped: number;
  failed: number;
};

const BULK_CHUNK_SIZE = 3;

/** Pausa ou ativa vários anúncios; erros individuais não abortam o lote. */
export async function bulkChangeProductListingStatus(
  userId: string,
  productIds: string[],
  status: ListingStatus,
): Promise<{
  status: ListingStatus;
  results: BulkListingStatusResult[];
  summary: BulkListingStatusSummary;
}> {
  const uniqueIds = [...new Set(productIds)];
  const results: BulkListingStatusResult[] = [];

  const accountIds = await getUserAccountIds(userId);
  if (accountIds.length === 0) {
    for (const id of uniqueIds) {
      results.push({
        productId: id,
        mlItemId: null,
        ok: false,
        error: "Anúncio não encontrado",
      });
    }
    return {
      status,
      results,
      summary: { updated: 0, skipped: 0, failed: uniqueIds.length },
    };
  }

  const db = getDb();
  const products = await db
    .select()
    .from(productsTable)
    .where(and(inArray(productsTable.id, uniqueIds), inArray(productsTable.accountId, accountIds)));

  const productMap = new Map(products.map((p) => [p.id, p]));
  const toProcess: Product[] = [];

  for (const id of uniqueIds) {
    const product = productMap.get(id);
    if (!product) {
      results.push({
        productId: id,
        mlItemId: null,
        ok: false,
        error: "Anúncio não encontrado",
      });
      continue;
    }
    if (product.status !== "active" && product.status !== "paused") {
      results.push({
        productId: id,
        mlItemId: product.mlItemId,
        ok: false,
        skipped: true,
        error: "Só é possível ativar ou pausar anúncios ativos ou pausados",
      });
      continue;
    }
    if (product.status === status) {
      results.push({
        productId: id,
        mlItemId: product.mlItemId,
        ok: true,
        skipped: true,
      });
      continue;
    }
    toProcess.push(product);
  }

  for (let i = 0; i < toProcess.length; i += BULK_CHUNK_SIZE) {
    const chunk = toProcess.slice(i, i + BULK_CHUNK_SIZE);
    const chunkResults = await Promise.all(
      chunk.map(async (product): Promise<BulkListingStatusResult> => {
        try {
          await setProductListingStatus(product, status);
          return { productId: product.id, mlItemId: product.mlItemId, ok: true };
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Erro desconhecido";
          return { productId: product.id, mlItemId: product.mlItemId, ok: false, error: msg };
        }
      }),
    );
    results.push(...chunkResults);
  }

  const summary: BulkListingStatusSummary = {
    updated: results.filter((r) => r.ok && !r.skipped).length,
    skipped: results.filter((r) => r.skipped).length,
    failed: results.filter((r) => !r.ok && !r.skipped).length,
  };

  return { status, results, summary };
}
