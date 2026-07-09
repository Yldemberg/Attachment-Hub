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

const DEFAULT_PREPARE_JOB_TIMEOUT_MS = 60 * 1000;

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

export function buildListingPreparedCallbackUrl(req: {
  headers: Record<string, string | string[] | undefined>;
  protocol: string;
  get: (name: string) => string | undefined;
}): string {
  const configured = process.env.IHUB_PUBLIC_URL?.trim();
  if (configured) {
    return `${configured.replace(/\/$/, "")}/api/webhooks/n8n/listing-prepared`;
  }
  const proto =
    (typeof req.headers["x-forwarded-proto"] === "string"
      ? req.headers["x-forwarded-proto"]
      : req.protocol) || "https";
  const host =
    (typeof req.headers["x-forwarded-host"] === "string"
      ? req.headers["x-forwarded-host"]
      : req.get("host")) ?? "localhost";
  return `${proto}://${host}/api/webhooks/n8n/listing-prepared`;
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
  if (job.status === "completed" || job.status === "needs_review" || job.status === "failed") {
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

  const draft = parseN8nDraftResponse(input.draft ?? input);
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

function hasBlockingPendingIhubUiFields(draft: N8nListingDraft): boolean {
  const secoes = draft._ihub_ui?.secoes ?? [];
  return secoes.some(
    (secao) =>
      secao.status === "pendente" &&
      (secao.campos ?? []).some((campo) => campo.obrigatorio === true),
  );
}

export function assertDraftReadyToPublish(draft: N8nListingDraft): void {
  if (draft._pronto_para_publicar === false) {
    throw new N8nListingError(
      "O rascunho ainda não está pronto para publicar. Complete os campos pendentes.",
      400,
    );
  }
  if ((draft._erros_validacao_ml?.length ?? 0) > 0) {
    throw new N8nListingError(
      "Existem erros de validação do Mercado Livre. Corrija-os antes de publicar.",
      400,
    );
  }
  if (hasBlockingPendingIhubUiFields(draft)) {
    throw new N8nListingError(
      "Há seções pendentes com campos obrigatórios. Complete a revisão antes de publicar.",
      400,
    );
  }
}

export function n8nDraftToCreateInput(draft: N8nListingDraft): CreateMlListingInput {
  const payload = draft.payload;
  const pictureSources = payload.pictures.map((p) => p.source).filter(Boolean);
  const attributes = payload.attributes.map((attr) => ({
    id: attr.id,
    value_name: attr.value_name ?? "",
    ...(attr.value_id ? { value_id: attr.value_id } : {}),
  }));
  const saleTerms = payload.sale_terms?.map((term) => ({
    id: term.id,
    ...(term.value_name ? { value_name: term.value_name } : {}),
    ...(term.value_id ? { value_id: term.value_id } : {}),
  }));

  return {
    title: payload.family_name,
    familyName: payload.family_name,
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
