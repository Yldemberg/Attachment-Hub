import { eq, and } from "drizzle-orm";
import { getDb } from "./db";
import {
  listingPrepareJobsTable,
  accountsTable,
  type ListingPrepareJob,
} from "@workspace/db/schema";
import {
  createMlItem,
  upsertProductFromMlItem,
  type CreateMlListingInput,
} from "./ml-listings";
import {
  dispatchPrepareToN8n,
  isSupportedProductUrl,
  isAmazonListingDraft,
  N8nListingError,
  parseN8nDraftResponse,
  parseListingPrepareDraft,
  type ListingTargetPlatform,
  type N8nListingDraft,
  type N8nAmazonListingDraft,
} from "./n8n-listings";
import {
  createAmazonListing,
  ensurePositiveAmazonQuantity,
  extractNumberOfCompartmentsFromTexts,
  productTypeNeedsCompartment,
  productTypeNeedsNumberOfCompartments,
  AMAZON_MIN_QUANTITY,
} from "./amazon-listings";
import { isValidAmazonMediaUrl } from "./listing-images";

export type ListingPrepareJobStatus = ListingPrepareJob["status"];

export type ListingPrepareJobView = {
  jobId: string;
  status: ListingPrepareJobStatus;
  data?: N8nListingDraft | N8nAmazonListingDraft;
  targetPlatform?: ListingTargetPlatform;
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
    const draft = row.draftJson as N8nListingDraft | N8nAmazonListingDraft;
    view.data = draft;
    view.targetPlatform = isAmazonListingDraft(draft) ? "amazon" : "mercadolivre";
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
  const [account] = await db
    .select({ platform: accountsTable.platform })
    .from(accountsTable)
    .where(and(eq(accountsTable.id, input.accountId), eq(accountsTable.userId, input.userId)));

  if (!account) {
    throw new N8nListingError("Conta inválida", 400);
  }

  const targetPlatform: ListingTargetPlatform =
    account.platform === "amazon" ? "amazon" : "mercadolivre";

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
      targetPlatform,
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

  let draft: N8nListingDraft | N8nAmazonListingDraft;
  try {
    draft = parseListingPrepareDraft(input.draft ?? input);
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

/** Extrai IDs de atributos citados pelo ML: Attribute [X] / attributes [X, Y] */
function extractAttributeIdsFromMlText(text: string): string[] {
  const ids = new Set<string>();
  const bracketRe = /attributes?\s*\[([^\]]+)\]/gi;
  let match: RegExpExecArray | null;
  while ((match = bracketRe.exec(text)) !== null) {
    for (const part of match[1].split(/[,;\s]+/)) {
      const id = part.trim().toUpperCase();
      if (/^[A-Z][A-Z0-9_]*$/.test(id)) ids.add(id);
    }
  }
  return [...ids];
}

function isAttributeFilled(
  draft: N8nListingDraft,
  attributeId: string,
): boolean {
  const attr = draft.payload.attributes.find((a) => a.id === attributeId);
  return Boolean(attr?.value_name?.trim() || attr?.value_id);
}

/** Erros do N8N/ML que o usuário já corrigiu no rascunho deixam de bloquear a publicação. */
function isMlErrorResolvedByDraft(
  item: { type?: string; code?: string; message?: string },
  draft: N8nListingDraft,
): boolean {
  const blob = `${item.code ?? ""} ${item.message ?? ""}`;
  if (/UNITS_PER_PACK|unidades por kit|invalid_sale_units/i.test(blob)) {
    return isAttributeFilled(draft, "UNITS_PER_PACK");
  }

  const requiredIds = extractAttributeIdsFromMlText(blob);
  if (requiredIds.length > 0 && /are required|são obrigat|is required/i.test(blob)) {
    return requiredIds.every((id) => isAttributeFilled(draft, id));
  }

  return false;
}

function getBlockingMlValidationErrors(draft: N8nListingDraft) {
  return normalizeMlValidationItems(draft._erros_validacao_ml).filter((item) => {
    const type = (item.type ?? "").toLowerCase();
    if (type === "warning" || type === "info") return false;
    if (isMlErrorResolvedByDraft(item, draft)) return false;

    if (type === "error") return true;
    if (item.code?.includes("invalid") || item.code?.includes("required")) return true;
    if (item.message && /preencha|obrigat|invalid|required/i.test(item.message)) return true;
    return type === "" && Boolean(item.message);
  });
}

const MLB_GENDER_BY_NAME: Record<string, string> = {
  feminino: "339665",
  masculino: "339666",
  "sem gênero": "110461",
  "sem genero": "110461",
  meninas: "339668",
  meninos: "339667",
  "sem gênero infantil": "19159491",
  "sem genero infantil": "19159491",
};

function normalizeAttributeForMl(attr: {
  id: string;
  value_name?: string;
  value_id?: string | null;
}): { id: string; value_name: string; value_id?: string } {
  let valueName = attr.value_name?.trim() ?? "";
  let valueId = attr.value_id?.trim() || undefined;

  if (attr.id === "GENDER" && valueName) {
    const mapped = MLB_GENDER_BY_NAME[valueName.toLowerCase()];
    if (mapped) valueId = mapped;
  }

  return {
    id: attr.id,
    value_name: valueName,
    ...(valueId ? { value_id: valueId } : {}),
  };
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
    .map((attr) => normalizeAttributeForMl(attr));
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
  if (isAmazonListingDraft(draft)) {
    throw new N8nListingError("Rascunho Amazon não pode ser publicado no Mercado Livre", 400);
  }
  assertDraftReadyToPublish(draft);
  const input = n8nDraftToCreateInput(draft);
  const created = await createMlItem(accountId, input);
  const productId = await upsertProductFromMlItem(accountId, created);
  return { productId, mlItemId: created.id };
}

export async function publishDraftOnAmazon(
  accountId: string,
  draft: N8nAmazonListingDraft,
): Promise<{ productId: string; sku: string }> {
  if (!isAmazonListingDraft(draft)) {
    throw new N8nListingError("Rascunho inválido para Amazon", 400);
  }
  const p = draft.payload;
  if (!p.sellerSku?.trim()) {
    throw new N8nListingError("Informe o sellerSku antes de publicar na Amazon.", 400);
  }
  if (!p.productType?.trim()) {
    throw new N8nListingError("Informe o productType Amazon antes de publicar.", 400);
  }

  const attrs = p.attributes || {};
  const itemName = Array.isArray(attrs.item_name)
    ? String((attrs.item_name as Array<{ value?: string }>)[0]?.value || "")
    : "";
  const brand = Array.isArray(attrs.brand)
    ? String((attrs.brand as Array<{ value?: string }>)[0]?.value || "")
    : undefined;
  const description = Array.isArray(attrs.product_description)
    ? String((attrs.product_description as Array<{ value?: string }>)[0]?.value || "")
    : draft._description;
  const qty = ensurePositiveAmazonQuantity(
    Array.isArray(attrs.fulfillment_availability) &&
      typeof (attrs.fulfillment_availability as Array<{ quantity?: number }>)[0]?.quantity ===
        "number"
      ? (attrs.fulfillment_availability as Array<{ quantity: number }>)[0].quantity
      : AMAZON_MIN_QUANTITY,
  );
  let price = 0;
  const offer = Array.isArray(attrs.purchasable_offer)
    ? (attrs.purchasable_offer as Array<{
        our_price?: Array<{ schedule?: Array<{ value_with_tax?: number }> }>;
      }>)[0]
    : undefined;
  const scheduled = offer?.our_price?.[0]?.schedule?.[0]?.value_with_tax;
  if (typeof scheduled === "number") price = scheduled;

  const imageUrls: string[] = [];
  const main = attrs.main_product_image_locator as Array<{ media_location?: string }> | undefined;
  if (Array.isArray(main) && main[0]?.media_location) imageUrls.push(main[0].media_location);
  for (let i = 1; i <= 8; i++) {
    const other = attrs[`other_product_image_locator_${i}`] as
      | Array<{ media_location?: string }>
      | undefined;
    if (Array.isArray(other) && other[0]?.media_location) {
      imageUrls.push(other[0].media_location);
    }
  }
  const invalidImage = imageUrls.find((url) => !isValidAmazonMediaUrl(url));
  if (invalidImage) {
    throw new N8nListingError(
      "URL de imagem inválida para Amazon. Reenvie as fotos pelo upload (URLs https:// públicas).",
      400,
    );
  }

  const asin =
    typeof draft._asin === "string" && draft._asin.trim() ? draft._asin.trim() : null;

  // Scrape de Amazon de terceiros → criar ASIN novo (não vincular ao ASIN fonte genérico/restrito).
  const matchCatalogAsin = false;
  const requirements = "LISTING";

  // Remove vínculo acidental ao ASIN raspado, GTIN e normaliza SKU.
  const attrsClean = { ...attrs };
  delete attrsClean.merchant_suggested_asin;
  delete attrsClean.externally_assigned_product_identifier;
  attrsClean.supplier_declared_has_product_identifier_exemption = [
    {
      value: true,
      marketplace_id:
        (typeof draft._marketplace_id === "string" && draft._marketplace_id) ||
        "A2Q3Y263D00KWC",
    },
  ];
  // model_name ≤ 120
  const modelRaw = attrsClean.model_name;
  if (Array.isArray(modelRaw) && modelRaw[0] && typeof (modelRaw[0] as { value?: unknown }).value === "string") {
    const v = String((modelRaw[0] as { value: string }).value).trim().slice(0, 120);
    attrsClean.model_name = [
      {
        ...(modelRaw[0] as object),
        value: v,
      },
    ];
  }

  // Força estoque > 0 no payload enviado à Amazon
  attrsClean.fulfillment_availability = [
    {
      fulfillment_channel_code: "DEFAULT",
      quantity: qty,
    },
  ];

  // compartment (descrição) só DUFFEL; number_of_compartments também em BACKPACK (obrigatório na Amazon BR).
  {
    const marketplaceId =
      (typeof draft._marketplace_id === "string" && draft._marketplace_id) ||
      "A2Q3Y263D00KWC";
    if (productTypeNeedsCompartment(p.productType || "")) {
      const first =
        Array.isArray(attrsClean.compartment) && attrsClean.compartment[0]
          ? (attrsClean.compartment[0] as {
              description?: Array<{ value?: unknown }>;
              value?: unknown;
            })
          : null;
      let existing = "";
      if (first && Array.isArray(first.description) && first.description[0]) {
        const v = first.description[0].value;
        if (typeof v === "string") existing = v.trim();
      } else if (first && typeof first.value === "string") {
        existing = first.value.trim();
      }
      attrsClean.compartment = [
        {
          description: [
            {
              language_tag: "pt_BR",
              value: existing || "Compartimento principal",
            },
          ],
          marketplace_id: marketplaceId,
        },
      ];
    } else {
      delete attrsClean.compartment;
    }

    if (productTypeNeedsNumberOfCompartments(p.productType || "")) {
      let count = 0;
      const raw = attrsClean.number_of_compartments;
      if (Array.isArray(raw) && raw[0]) {
        const v = (raw[0] as { value?: unknown }).value;
        if (typeof v === "number" && v > 0) count = Math.floor(v);
        else if (typeof v === "string" && Number(v) > 0) count = Math.floor(Number(v));
      }
      if (count <= 0 && Array.isArray(draft._scraped_attributes)) {
        const scrapeTexts = draft._scraped_attributes.flatMap((a) => {
          const key = String(a.key || "");
          const value = String(a.value ?? "");
          return [`${key}: ${value}`, value];
        });
        count = extractNumberOfCompartmentsFromTexts(scrapeTexts);
      }
      attrsClean.number_of_compartments = [
        { value: count > 0 ? count : 1, marketplace_id: marketplaceId },
      ];
    } else {
      delete attrsClean.number_of_compartments;
    }
  }

  let sellerSku = p.sellerSku?.trim() || "";
  if (
    !sellerSku ||
    /^B0[A-Z0-9]{8}$/i.test(sellerSku) ||
    (asin && (sellerSku === asin || sellerSku === `SKU-AMZ-${asin}`))
  ) {
    sellerSku = `IHUB-${Date.now().toString(36).toUpperCase()}`;
  }

  const { productId, sku } = await createAmazonListing(accountId, {
    sellerSku,
    productType: p.productType,
    title: itemName || sellerSku,
    price: price > 0 ? price : 1,
    availableQuantity: qty,
    brand,
    description: typeof description === "string" ? description : undefined,
    imageUrls,
    asin,
    matchCatalogAsin,
    requirements,
    attributes: attrsClean,
    scrapedAttributes: Array.isArray(draft._scraped_attributes)
      ? draft._scraped_attributes.map((a) => ({
          key: String(a.key || ""),
          value: String(a.value ?? ""),
        }))
      : undefined,
  });
  return { productId, sku };
}

/** Publish prepare draft to the destination platform of the account. */
export async function publishListingPrepareDraft(
  accountId: string,
  draft: N8nListingDraft | N8nAmazonListingDraft,
): Promise<{ productId: string }> {
  if (isAmazonListingDraft(draft)) {
    const r = await publishDraftOnAmazon(accountId, draft);
    return { productId: r.productId };
  }
  const r = await publishDraftOnMercadoLivre(accountId, draft);
  return { productId: r.productId };
}
