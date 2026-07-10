import { eq, and } from "drizzle-orm";
import { getDb } from "./db";
import { listingPrepareJobsTable, type ListingPrepareJob } from "@workspace/db/schema";
import {
  createMlItem,
  upsertProductFromMlItem,
  type CreateMlListingInput,
} from "./ml-listings";
import {
  dispatchPrepareToN8n,
  isSupportedProductUrl,
  N8nListingError,
  parseN8nDraftResponse,
  type N8nListingDraft,
} from "./n8n-listings";

export type ListingPrepareJobStatus = ListingPrepareJob["status"];

export type ListingPrepareJobView = {
  jobId: string;
  status: ListingPrepareJobStatus;
  data?: N8nListingDraft;
  errorMessage?: string | null;
};

/** Alinhado ao timeout do Apify no N8N (~5 min) + margem para validação/callback. */
const DEFAULT_PREPARE_JOB_TIMEOUT_MS = 6 * 60 * 1000;

function getPrepareJobTimeoutMs(): number {
  const raw = process.env.LISTING_PREPARE_JOB_TIMEOUT_MS;
  if (!raw) return DEFAULT_PREPARE_JOB_TIMEOUT_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PREPARE_JOB_TIMEOUT_MS;
}

function isPrepareJobStale(row: ListingPrepareJob): boolean {
  if (row.status !== "pending" && row.status !== "processing") return false;
  return Date.now() - row.createdAt.getTime() > getPrepareJobTimeoutMs();
}

async function expireStalePrepareJob(row: ListingPrepareJob): Promise<ListingPrepareJob> {
  if (!isPrepareJobStale(row)) return row;

  const errorMessage =
    "Tempo esgotado ao preparar o anúncio. O workflow N8N pode ter falhado — tente novamente.";
  const db = getDb();
  await db
    .update(listingPrepareJobsTable)
    .set({
      status: "failed",
      errorMessage,
      completedAt: new Date(),
    })
    .where(eq(listingPrepareJobsTable.id, row.id));

  return {
    ...row,
    status: "failed",
    errorMessage,
    completedAt: new Date(),
  };
}

function toJobView(row: ListingPrepareJob): ListingPrepareJobView {
  const view: ListingPrepareJobView = {
    jobId: row.id,
    status: row.status,
    errorMessage: row.errorMessage,
  };
  if ((row.status === "completed" || row.status === "needs_review") && row.draftJson) {
    view.data = row.draftJson as N8nListingDraft;
  }
  return view;
}

const LISTING_PREPARED_WEBHOOK_PATH = "/api/webhooks/n8n/listing-prepared";

/**
 * Resolve the public callback URL for N8N.
 * Accepts either the app origin (`https://app.example.com`) or the full webhook URL.
 * Avoids doubling the path when IHUB_PUBLIC_URL already includes it.
 */
export function resolveListingPreparedCallbackUrl(configured: string): string {
  const raw = configured.trim().replace(/\/$/, "");
  if (!raw) {
    throw new N8nListingError("IHUB_PUBLIC_URL vazia", 500);
  }

  try {
    const url = new URL(raw);
    return `${url.origin}${LISTING_PREPARED_WEBHOOK_PATH}`;
  } catch {
    return `${raw}${LISTING_PREPARED_WEBHOOK_PATH}`;
  }
}

export function buildListingPreparedCallbackUrl(req: {
  headers: Record<string, string | string[] | undefined>;
  protocol: string;
  get: (name: string) => string | undefined;
}): string {
  const configured = process.env.IHUB_PUBLIC_URL?.trim();
  if (configured) {
    return resolveListingPreparedCallbackUrl(configured);
  }
  const proto =
    (typeof req.headers["x-forwarded-proto"] === "string"
      ? req.headers["x-forwarded-proto"]
      : req.protocol) || "https";
  const host =
    (typeof req.headers["x-forwarded-host"] === "string"
      ? req.headers["x-forwarded-host"]
      : req.get("host")) ?? "localhost";
  return `${proto}://${host}${LISTING_PREPARED_WEBHOOK_PATH}`;
}

export async function startListingPrepareJob(input: {
  userId: string;
  accountId: string;
  productUrl: string;
  callbackUrl: string;
}): Promise<{ jobId: string; status: ListingPrepareJobStatus }> {
  const productUrl = input.productUrl.trim();
  if (!productUrl) {
    throw new N8nListingError("Informe o link do produto", 400);
  }
  if (!isSupportedProductUrl(productUrl)) {
    throw new N8nListingError("Link inválido. Use um produto da Amazon ou Shopee.", 400);
  }

  const db = getDb();
  const [job] = await db
    .insert(listingPrepareJobsTable)
    .values({
      userId: input.userId,
      accountId: input.accountId,
      productUrl,
      status: "pending",
    })
    .returning();

  try {
    await dispatchPrepareToN8n({
      jobId: job.id,
      productUrl,
      accountId: input.accountId,
      userId: input.userId,
      callbackUrl: input.callbackUrl,
    });
    await db
      .update(listingPrepareJobsTable)
      .set({ status: "processing" })
      .where(eq(listingPrepareJobsTable.id, job.id));
    return { jobId: job.id, status: "processing" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Falha ao iniciar preparação";
    await db
      .update(listingPrepareJobsTable)
      .set({
        status: "failed",
        errorMessage: message,
        completedAt: new Date(),
      })
      .where(eq(listingPrepareJobsTable.id, job.id));
    throw err;
  }
}

export async function getListingPrepareJobForUser(
  jobId: string,
  userId: string,
): Promise<ListingPrepareJobView | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(listingPrepareJobsTable)
    .where(and(eq(listingPrepareJobsTable.id, jobId), eq(listingPrepareJobsTable.userId, userId)))
    .limit(1);
  if (!row) return null;
  const current = await expireStalePrepareJob(row);
  return toJobView(current);
}

export async function completeListingPrepareJobFromWebhook(input: {
  jobId: string;
  status: "completed" | "needs_review" | "failed";
  draft?: unknown;
  error?: string | null;
}): Promise<void> {
  const db = getDb();
  const [job] = await db
    .select()
    .from(listingPrepareJobsTable)
    .where(eq(listingPrepareJobsTable.id, input.jobId))
    .limit(1);

  if (!job) {
    throw new N8nListingError("Job não encontrado", 404);
  }

  // Já finalizado com sucesso: idempotente.
  if (job.status === "completed" || job.status === "needs_review") {
    return;
  }

  // Se o iHub marcou timeout antes do N8N terminar, ainda aceita o callback tardio.
  const failedDueToTimeout =
    job.status === "failed" &&
    Boolean(job.errorMessage?.toLowerCase().includes("tempo esgotado"));
  if (job.status === "failed" && !failedDueToTimeout) {
    return;
  }

  if (input.status === "failed") {
    await db
      .update(listingPrepareJobsTable)
      .set({
        status: "failed",
        errorMessage: input.error?.trim() || "Falha ao preparar anúncio",
        completedAt: new Date(),
      })
      .where(eq(listingPrepareJobsTable.id, input.jobId));
    return;
  }

  let draft: N8nListingDraft;
  try {
    draft = parseN8nDraftResponse(input.draft ?? input);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "N8N retornou um formato de rascunho inválido";
    await db
      .update(listingPrepareJobsTable)
      .set({
        status: "failed",
        errorMessage: message,
        completedAt: new Date(),
      })
      .where(eq(listingPrepareJobsTable.id, input.jobId));
    throw err;
  }

  const jobStatus = input.status === "needs_review" ? "needs_review" : "completed";
  await db
    .update(listingPrepareJobsTable)
    .set({
      status: jobStatus,
      draftJson: draft,
      errorMessage: null,
      completedAt: new Date(),
    })
    .where(eq(listingPrepareJobsTable.id, input.jobId));
}

export function assertDraftReadyToPublish(draft: N8nListingDraft): void {
  const familyName =
    draft.payload.family_name?.trim() ||
    (draft.payload as { title?: string }).title?.trim() ||
    "";
  if (!familyName) {
    throw new N8nListingError("Informe o nome da família / título do produto.", 400);
  }
  if (!draft.payload.pictures.length) {
    throw new N8nListingError("Adicione ao menos uma foto.", 400);
  }
  if ((draft.payload.price ?? 0) <= 0) {
    throw new N8nListingError("Informe um preço válido.", 400);
  }

  const sku = draft.payload.attributes.find((a) => a.id === "SELLER_SKU");
  if (!(sku?.value_name?.trim() || sku?.value_id)) {
    throw new N8nListingError("Informe o SKU antes de publicar.", 400);
  }

  const blockingMl = getBlockingMlValidationErrors(draft);
  if (blockingMl.length > 0) {
    const first = blockingMl[0]?.message ?? "Erro de validação do Mercado Livre";
    throw new N8nListingError(
      `Existem erros de validação do Mercado Livre. ${first}`,
      400,
    );
  }
}

function normalizeMlValidationItems(
  items: N8nListingDraft["_erros_validacao_ml"] | undefined,
): Array<{ type?: string; code?: string; message?: string }> {
  if (!items?.length) return [];
  const out: Array<{ type?: string; code?: string; message?: string }> = [];
  for (const item of items) {
    const unknownItem: unknown = item;
    if (typeof unknownItem === "string") {
      const trimmed = unknownItem.trim();
      if (!trimmed || /^validation error$/i.test(trimmed)) continue;
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        out.push({
          type: typeof parsed.type === "string" ? parsed.type : undefined,
          code: typeof parsed.code === "string" ? parsed.code : undefined,
          message: typeof parsed.message === "string" ? parsed.message : trimmed,
        });
      } catch {
        out.push({ type: "error", message: trimmed });
      }
      continue;
    }
    if (unknownItem && typeof unknownItem === "object") {
      const row = unknownItem as Record<string, unknown>;
      if (typeof row.message === "string" && row.message.trim().startsWith("{")) {
        try {
          const nested = JSON.parse(row.message) as Record<string, unknown>;
          out.push({
            type: typeof nested.type === "string" ? nested.type : typeof row.type === "string" ? row.type : undefined,
            code: typeof nested.code === "string" ? nested.code : undefined,
            message: typeof nested.message === "string" ? nested.message : row.message,
          });
          continue;
        } catch {
          /* fall through */
        }
      }
      out.push({
        type: typeof row.type === "string" ? row.type : undefined,
        code: typeof row.code === "string" ? row.code : undefined,
        message: typeof row.message === "string" ? row.message : undefined,
      });
    }
  }
  return out;
}

function getBlockingMlValidationErrors(draft: N8nListingDraft) {
  return normalizeMlValidationItems(draft._erros_validacao_ml).filter((item) => {
    const type = (item.type ?? "").toLowerCase();
    if (type === "warning" || type === "info") return false;

    const blob = `${item.code ?? ""} ${item.message ?? ""}`;
    if (/UNITS_PER_PACK|unidades por kit|invalid_sale_units/i.test(blob)) {
      const units = draft.payload.attributes.find((a) => a.id === "UNITS_PER_PACK");
      if (units?.value_name?.trim() || units?.value_id) return false;
    }

    if (type === "error") return true;
    if (item.code?.includes("invalid") || item.code?.includes("required")) return true;
    if (item.message && /preencha|obrigat|invalid|required/i.test(item.message)) return true;
    return type === "" && Boolean(item.message);
  });
}

export function n8nDraftToCreateInput(draft: N8nListingDraft): CreateMlListingInput {
  const payload = draft.payload;
  const pictureSources = payload.pictures.map((p) => p.source).filter(Boolean);
  const hiddenAttributeIds = new Set([
    "HAZMAT_TRANSPORTABILITY",
    "EXCLUDED_PLATFORMS",
    "IS_FLAMMABLE",
    "WITH_POSITIVE_IMPACT",
    "HAS_COMPATIBILITIES",
    "IS_NEW_OFFER",
    "IS_SUITABLE_FOR_SHIPMENT",
    "WITH_EXPIRATION_DATE",
    "EXPIRATION_DATE",
  ]);
  const attributes = payload.attributes
    .filter((attr) => !hiddenAttributeIds.has(attr.id))
    .filter((attr) => Boolean(attr.value_name?.trim() || attr.value_id))
    .map((attr) => ({
      id: attr.id,
      value_name: attr.value_name ?? "",
      ...(attr.value_id ? { value_id: attr.value_id } : {}),
    }));
  const saleTerms = payload.sale_terms
    ?.filter((term) => Boolean(term.value_name?.trim() || term.value_id))
    .map((term) => ({
      id: term.id,
      ...(term.value_name ? { value_name: term.value_name } : {}),
      ...(term.value_id ? { value_id: term.value_id } : {}),
    }));

  return {
    title: payload.family_name || (payload as { title?: string }).title || "",
    familyName: payload.family_name || (payload as { title?: string }).title,
    categoryId: payload.category_id,
    price: payload.price ?? 0,
    availableQuantity: payload.available_quantity,
    condition: payload.condition,
    listingTypeId: payload.listing_type_id,
    pictures: [],
    pictureSources,
    attributes,
    description: draft._description,
    saleTerms,
    shipping: payload.shipping,
  };
}

export async function publishDraftOnMercadoLivre(
  accountId: string,
  draft: N8nListingDraft,
): Promise<{ productId: string; mlItemId: string }> {
  if (!draft?.payload) {
    throw new N8nListingError("Rascunho inválido", 400);
  }
  assertDraftReadyToPublish(draft);
  const input = n8nDraftToCreateInput(draft);
  const created = await createMlItem(accountId, input);
  const productId = await upsertProductFromMlItem(accountId, created);
  return { productId, mlItemId: created.id };
}
