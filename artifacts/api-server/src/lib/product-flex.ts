import { eq, and, inArray } from "drizzle-orm";
import { productsTable, type Product } from "@workspace/db/schema";
import { getDb } from "./db";
import { getUserAccountIds } from "./account-scope";
import { getMlEffectiveLogisticType, ml, type MlItem } from "./mercadolivre";

export class ProductFlexError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_FOUND" | "INVALID_STATUS" | "ML_API_ERROR" | "BAD_REQUEST",
  ) {
    super(message);
    this.name = "ProductFlexError";
  }
}

export type BulkProductFlexResult = {
  productId: string;
  mlItemId: string | null;
  ok: boolean;
  error?: string;
  skipped?: boolean;
};

export type BulkProductFlexSummary = {
  updated: number;
  skipped: number;
  failed: number;
};

const BULK_CHUNK_SIZE = 3;

function mlSiteIdFromItemId(mlItemId: string): string {
  const prefix = mlItemId.slice(0, 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(prefix)) {
    throw new ProductFlexError(
      `ID de anúncio inválido para Flex (${mlItemId})`,
      "INVALID_STATUS",
    );
  }
  return prefix;
}

function productOffersFlex(product: Pick<Product, "isFlex" | "logisticType">): boolean {
  if (product.isFlex) return true;
  const logistic = product.logisticType ?? "";
  return logistic.includes("self_service");
}

function flexSelfServicePath(mlItemId: string): string {
  const siteId = mlSiteIdFromItemId(mlItemId);
  return `/sites/${siteId}/shipping/selfservice/items/${encodeURIComponent(mlItemId)}`;
}

function isAlreadyInFlexStateError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.toLowerCase().includes("item is already in flex");
}

function mapMlFlexError(err: unknown): ProductFlexError {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (lower.includes("item down")) {
    return new ProductFlexError(
      "Este anúncio não pode oferecer Flex",
      "INVALID_STATUS",
    );
  }
  if (msg.includes("ML API 403")) {
    return new ProductFlexError("Conta sem Flex ativo no Mercado Livre", "ML_API_ERROR");
  }
  if (msg.startsWith("ML API")) {
    return new ProductFlexError(msg, "ML_API_ERROR");
  }
  return err instanceof ProductFlexError
    ? err
    : new ProductFlexError(msg || "Erro desconhecido", "ML_API_ERROR");
}

function itemIsFlex(item: MlItem): boolean {
  return Array.isArray(item.shipping?.tags) && item.shipping.tags!.includes("self_service_in");
}

async function refreshProductFlexFromMl(
  product: Pick<Product, "id" | "accountId" | "mlItemId">,
): Promise<{ isFlex: boolean; logisticType: string | null }> {
  if (!product.mlItemId) {
    throw new ProductFlexError("Produto sem mlItemId (não ML)", "INVALID_STATUS");
  }
  const item = await ml.get<MlItem>(
    product.accountId,
    `/items/${encodeURIComponent(product.mlItemId)}`,
  );
  const isFlex = itemIsFlex(item);
  const logisticType = getMlEffectiveLogisticType(item);
  const db = getDb();
  await db
    .update(productsTable)
    .set({ isFlex, logisticType, updatedAt: new Date() })
    .where(eq(productsTable.id, product.id));
  return { isFlex, logisticType };
}

async function setProductFlex(
  product: Pick<Product, "id" | "accountId" | "mlItemId">,
  enabled: boolean,
): Promise<{ isFlex: boolean; logisticType: string | null; skippedAlready?: boolean }> {
  if (!product.mlItemId) {
    throw new ProductFlexError("Produto sem mlItemId (não ML)", "INVALID_STATUS");
  }

  const path = flexSelfServicePath(product.mlItemId);
  try {
    if (enabled) {
      await ml.post(product.accountId, path);
    } else {
      await ml.delete(product.accountId, path);
    }
  } catch (err) {
    if (isAlreadyInFlexStateError(err)) {
      const refreshed = await refreshProductFlexFromMl(product);
      return { ...refreshed, skippedAlready: true };
    }
    throw mapMlFlexError(err);
  }

  return refreshProductFlexFromMl(product);
}

/** Mesma lógica de PATCH /products/:id/flex — usada na tela Produtos. */
export async function changeProductFlex(
  userId: string,
  productId: string,
  enabled: boolean,
): Promise<{ productId: string; isFlex: boolean; logisticType: string | null }> {
  const db = getDb();
  const accountIds = await getUserAccountIds(userId);
  if (accountIds.length === 0) {
    throw new ProductFlexError("Product not found", "NOT_FOUND");
  }

  const [product] = await db
    .select()
    .from(productsTable)
    .where(and(eq(productsTable.id, productId), inArray(productsTable.accountId, accountIds)));

  if (!product) {
    throw new ProductFlexError("Product not found", "NOT_FOUND");
  }

  if (!product.mlItemId) {
    throw new ProductFlexError("Produto sem mlItemId (não ML)", "INVALID_STATUS");
  }

  if (enabled) {
    if (product.status !== "active") {
      throw new ProductFlexError(
        "Só é possível ativar Flex em anúncios ativos",
        "INVALID_STATUS",
      );
    }
  } else if (product.status !== "active" && product.status !== "paused") {
    throw new ProductFlexError(
      "Só é possível desativar Flex em anúncios ativos ou pausados",
      "INVALID_STATUS",
    );
  }

  if (productOffersFlex(product) === enabled) {
    return {
      productId: product.id,
      isFlex: enabled,
      logisticType: product.logisticType,
    };
  }

  try {
    const result = await setProductFlex(product, enabled);
    return {
      productId: product.id,
      isFlex: result.isFlex,
      logisticType: result.logisticType,
    };
  } catch (err) {
    if (err instanceof ProductFlexError) throw err;
    throw mapMlFlexError(err);
  }
}

/** Ativa ou desativa Flex em vários anúncios; erros individuais não abortam o lote. */
export async function bulkChangeProductFlex(
  userId: string,
  productIds: string[],
  enabled: boolean,
): Promise<{
  enabled: boolean;
  results: BulkProductFlexResult[];
  summary: BulkProductFlexSummary;
}> {
  const uniqueIds = [...new Set(productIds)];
  const results: BulkProductFlexResult[] = [];

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
      enabled,
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
    if (!product.mlItemId) {
      results.push({
        productId: id,
        mlItemId: null,
        ok: false,
        skipped: true,
        error: "Produto sem mlItemId (não ML)",
      });
      continue;
    }
    if (enabled) {
      if (product.status !== "active") {
        results.push({
          productId: id,
          mlItemId: product.mlItemId,
          ok: false,
          skipped: true,
          error: "Só é possível ativar Flex em anúncios ativos",
        });
        continue;
      }
    } else if (product.status !== "active" && product.status !== "paused") {
      results.push({
        productId: id,
        mlItemId: product.mlItemId,
        ok: false,
        skipped: true,
        error: "Só é possível desativar Flex em anúncios ativos ou pausados",
      });
      continue;
    }
    if (productOffersFlex(product) === enabled) {
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
      chunk.map(async (product): Promise<BulkProductFlexResult> => {
        try {
          const result = await setProductFlex(product, enabled);
          return {
            productId: product.id,
            mlItemId: product.mlItemId,
            ok: true,
            skipped: result.skippedAlready || undefined,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Erro desconhecido";
          return { productId: product.id, mlItemId: product.mlItemId, ok: false, error: msg };
        }
      }),
    );
    results.push(...chunkResults);
  }

  const summary: BulkProductFlexSummary = {
    updated: results.filter((r) => r.ok && !r.skipped).length,
    skipped: results.filter((r) => r.skipped).length,
    failed: results.filter((r) => !r.ok && !r.skipped).length,
  };

  return { enabled, results, summary };
}
