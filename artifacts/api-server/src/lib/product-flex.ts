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

type MlFlexItemStatus = {
  has_flex?: boolean;
};

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

/** Current ML Flex item API (v2). Legacy: `/sites/{site}/shipping/selfservice/items/{id}`. */
function flexItemPath(mlItemId: string): string {
  const siteId = mlSiteIdFromItemId(mlItemId);
  return `/flex/sites/${siteId}/items/${encodeURIComponent(mlItemId)}/v2`;
}

function mlErrorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function parseMlErrorPayload(err: unknown): { status: number | null; message: string } {
  const raw = mlErrorText(err);
  const statusMatch = raw.match(/ML API (\d+)/);
  const status = statusMatch ? parseInt(statusMatch[1]!, 10) : null;
  let message = raw;
  const jsonStart = raw.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const body = JSON.parse(raw.slice(jsonStart)) as {
        message?: unknown;
        error?: unknown;
        cause?: Array<{ message?: string }>;
      };
      const causeMsg = body.cause?.find((c) => c.message)?.message;
      if (typeof causeMsg === "string" && causeMsg.trim()) {
        message = causeMsg;
      } else if (typeof body.message === "string" && body.message.trim()) {
        message = body.message;
      } else if (typeof body.error === "string" && body.error.trim()) {
        message = body.error;
      }
    } catch {
      /* keep raw */
    }
  }
  return { status, message };
}

function isAlreadyInDesiredFlexStateError(err: unknown, enabled: boolean): boolean {
  const { message } = parseMlErrorPayload(err);
  const lower = `${message} ${mlErrorText(err)}`.toLowerCase();
  if (lower.includes("item is already in flex")) return true;
  if (enabled) return false;
  return (
    lower.includes("item down") ||
    lower.includes("item is not in flex") ||
    lower.includes("not in flex")
  );
}

function mapMlFlexError(err: unknown, enabled: boolean): ProductFlexError {
  if (err instanceof ProductFlexError) return err;

  const { status, message } = parseMlErrorPayload(err);
  const lower = `${message} ${mlErrorText(err)}`.toLowerCase();

  if (lower.includes("item down")) {
    return new ProductFlexError(
      enabled
        ? "Este anúncio não pode oferecer Flex"
        : "Este anúncio não oferece Flex no Mercado Livre",
      "INVALID_STATUS",
    );
  }
  if (status === 409 || lower.includes("can't activate item") || lower.includes("conflict")) {
    return new ProductFlexError(
      "O Mercado Livre está processando outra alteração neste anúncio. Tente novamente em instantes.",
      "ML_API_ERROR",
    );
  }
  if (status === 403 || mlErrorText(err).includes("ML API 403")) {
    return new ProductFlexError("Conta sem Flex ativo no Mercado Livre", "ML_API_ERROR");
  }
  if (status === 404 || mlErrorText(err).includes("ML API 404")) {
    return new ProductFlexError(
      "Flex não está disponível para este anúncio ou país",
      "ML_API_ERROR",
    );
  }
  if (mlErrorText(err).startsWith("ML API")) {
    const readable = message && message !== mlErrorText(err) ? message : mlErrorText(err);
    return new ProductFlexError(readable, "ML_API_ERROR");
  }
  return new ProductFlexError(mlErrorText(err) || "Erro desconhecido", "ML_API_ERROR");
}

function itemIsFlex(item: MlItem): boolean {
  return Array.isArray(item.shipping?.tags) && item.shipping.tags!.includes("self_service_in");
}

function logisticTypeWithoutFlex(logisticType: string | null): string | null {
  if (!logisticType) return null;
  const parts = logisticType
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t && t !== "self_service" && t !== "self_service_in");
  return parts.length > 0 ? parts.join(",") : null;
}

async function readFlexStatusFromMl(
  accountId: string,
  mlItemId: string,
): Promise<boolean | null> {
  try {
    const status = await ml.get<MlFlexItemStatus>(accountId, flexItemPath(mlItemId));
    return typeof status?.has_flex === "boolean" ? status.has_flex : null;
  } catch {
    return null;
  }
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
  const taggedFlex = itemIsFlex(item);
  const apiFlex = await readFlexStatusFromMl(product.accountId, product.mlItemId);
  const isFlex = apiFlex ?? taggedFlex;
  let logisticType = getMlEffectiveLogisticType(item);
  if (!isFlex) {
    logisticType = logisticTypeWithoutFlex(logisticType);
  }
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

  const path = flexItemPath(product.mlItemId);
  try {
    if (enabled) {
      await ml.post(product.accountId, path);
    } else {
      await ml.delete(product.accountId, path);
    }
  } catch (err) {
    if (isAlreadyInDesiredFlexStateError(err, enabled)) {
      const refreshed = await refreshProductFlexFromMl(product);
      if (refreshed.isFlex === enabled) {
        return { ...refreshed, skippedAlready: true };
      }
      const logisticType = enabled
        ? refreshed.logisticType
        : logisticTypeWithoutFlex(refreshed.logisticType);
      const db = getDb();
      await db
        .update(productsTable)
        .set({ isFlex: enabled, logisticType, updatedAt: new Date() })
        .where(eq(productsTable.id, product.id));
      return { isFlex: enabled, logisticType, skippedAlready: true };
    }
    throw mapMlFlexError(err, enabled);
  }

  const refreshed = await refreshProductFlexFromMl(product);
  if (refreshed.isFlex === enabled) return refreshed;

  // GET /items can lag behind a successful Flex v2 204. Persist the requested state.
  const logisticType = enabled
    ? refreshed.logisticType
    : logisticTypeWithoutFlex(refreshed.logisticType);
  const db = getDb();
  await db
    .update(productsTable)
    .set({ isFlex: enabled, logisticType, updatedAt: new Date() })
    .where(eq(productsTable.id, product.id));
  return { isFlex: enabled, logisticType };
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
    throw mapMlFlexError(err, enabled);
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
          const mapped = err instanceof ProductFlexError ? err : mapMlFlexError(err, enabled);
          return { productId: product.id, mlItemId: product.mlItemId, ok: false, error: mapped.message };
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
