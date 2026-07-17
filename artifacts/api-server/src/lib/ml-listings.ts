import { getDb } from "./db";
import { productsTable, accountsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import {
  ml,
  getMlAccessToken,
  MlItem,
  buildMlItemProductRowSnapshot,
  enrichMlItem,
  fetchMlItemPricesBatch,
  getMlEffectiveLogisticType,
  getMlOriginalListPrice,
} from "./mercadolivre";
import { logger } from "./logger";

const ML_BASE_URL = "https://api.mercadolibre.com";
const MLB_SITE_ID = "MLB";

export type MlCategoryPrediction = {
  categoryId: string;
  categoryName: string;
  domainId?: string;
  domainName?: string;
};

export type MlCategoryAttribute = {
  id: string;
  name: string;
  valueType: string;
  tags?: {
    required?: boolean;
    catalog_required?: boolean;
    fixed?: boolean;
    read_only?: boolean;
    inferred?: boolean;
    hidden?: boolean;
  };
  values?: Array<{ id: string; name: string }>;
  allowedUnits?: Array<{ id: string; name: string }>;
  defaultUnit?: string;
  hint?: string;
};

export type MlListingAttributeInput = {
  id: string;
  value_name: string;
  value_id?: string;
};

export type MlListingVariationInput = {
  attribute_combinations: Array<{ id: string; value_name: string; value_id?: string }>;
  price: number;
  available_quantity: number;
  picture_ids?: string[];
};

export type MlSaleTermInput = {
  id: string;
  value_name?: string;
  value_id?: string;
};

export type CreateMlListingShippingInput = {
  local_pick_up?: boolean;
  mode?: string;
  free_shipping?: boolean;
  [key: string]: unknown;
};

export type CreateMlListingInput = {
  title: string;
  /** Required for User Products sellers (tag user_product_seller). Falls back to title. */
  familyName?: string;
  categoryId: string;
  price: number;
  availableQuantity: number;
  condition: "new" | "used";
  listingTypeId: string;
  pictures: string[];
  /** Public image URLs — used when replicating across accounts (POST pictures with source). */
  pictureSources?: string[];
  attributes: MlListingAttributeInput[];
  description?: string;
  saleTerms?: MlSaleTermInput[];
  shipping?: CreateMlListingShippingInput;
  variations?: MlListingVariationInput[];
  /** Mercado Livre Clips / legacy video id from GET /items → video_id. */
  videoId?: string | null;
};

type MlItemForDuplicate = MlItem & {
  condition?: string;
  family_name?: string;
  pictures?: Array<{ id?: string; secure_url?: string; url?: string }>;
  sale_terms?: Array<{ id: string; value_name?: string | null; value_id?: string | null }>;
};

export type UpdateMlListingInput = {
  title?: string;
  familyName?: string;
  price?: number;
  availableQuantity?: number;
  pictures?: string[];
  attributes?: MlListingAttributeInput[];
  description?: string;
};

export class MlListingError extends Error {
  constructor(
    message: string,
    public readonly code: string = "ML_LISTING_ERROR",
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = "MlListingError";
  }
}

function parseMlApiError(err: unknown): MlListingError {
  const raw = err instanceof Error ? err.message : String(err);
  if (!raw.startsWith("ML API")) {
    return new MlListingError("Erro ao comunicar com o Mercado Livre", "ML_API_ERROR", 502);
  }

  let body: { message?: string; error?: string; cause?: Array<{ code?: string; message?: string }> } = {};
  try {
    const jsonStart = raw.indexOf("{");
    if (jsonStart >= 0) body = JSON.parse(raw.slice(jsonStart)) as typeof body;
  } catch {
    /* ignore */
  }

  const causes = body.cause ?? [];
  const firstCause = causes[0];
  const code = firstCause?.code ?? body.error ?? "ML_API_ERROR";
  const ptMessages: Record<string, string> = {
    "item.title.invalid": "Título inválido. Verifique o tamanho e caracteres permitidos.",
    "item.price.invalid": "Preço inválido para esta categoria.",
    "item.available_quantity.invalid": "Quantidade em estoque inválida.",
    "item.category_id.invalid": "Categoria inválida ou não permitida.",
    "item.pictures.invalid": "Imagens inválidas. Envie ao menos uma foto.",
    "item.attributes.missing": "Preencha todos os atributos obrigatórios da categoria.",
    "item.listing_type_id.invalid": "Tipo de anúncio inválido para esta conta.",
    "body.invalid": "Dados inválidos. Verifique os campos obrigatórios, incluindo nome da família do produto.",
    forbidden: "Sem permissão para esta operação no Mercado Livre.",
    not_found: "Anúncio não encontrado no Mercado Livre.",
  };

  let message =
    ptMessages[code] ??
    firstCause?.message ??
    body.message ??
    "O Mercado Livre rejeitou a operação. Verifique os dados e tente novamente.";

  // Prefer explicit attribute/sale_term rejection messages when present.
  const ignoredMsgs = causes
    .map((c) => c.message)
    .filter((m): m is string => !!m && /ignored|not (allowed|modifiable)|not modifiable/i.test(m));
  if (ignoredMsgs.length) {
    message = ignoredMsgs.join(" · ");
  }

  if (/family_name/i.test(message) || /\[family_name\]/i.test(raw)) {
    message =
      "Informe o nome da família do produto. Contas no modelo User Products do Mercado Livre exigem esse campo em vez do título.";
  }

  const statusMatch = raw.match(/ML API (\d+)/);
  const status = statusMatch ? parseInt(statusMatch[1]!, 10) : 502;
  return new MlListingError(message, code, status >= 400 && status < 600 ? status : 502);
}

export async function predictCategory(accountId: string, title: string): Promise<MlCategoryPrediction[]> {
  const q = encodeURIComponent(title.trim());
  if (!q) return [];
  const results = await ml.get<
    Array<{
      category_id: string;
      category_name: string;
      domain_id?: string;
      domain_name?: string;
    }>
  >(accountId, `/sites/${MLB_SITE_ID}/domain_discovery/search?limit=8&q=${q}`);

  return (results ?? []).map((r) => ({
    categoryId: r.category_id,
    categoryName: r.category_name,
    domainId: r.domain_id,
    domainName: r.domain_name,
  }));
}

export async function getCategoryAttributes(
  accountId: string,
  categoryId: string,
): Promise<MlCategoryAttribute[]> {
  const attrs = await ml.get<
    Array<{
      id: string;
      name: string;
      value_type: string;
      tags?: MlCategoryAttribute["tags"];
      values?: Array<{ id: string; name: string }>;
      allowed_units?: Array<{ id: string; name: string }>;
      default_unit?: string;
      hint?: string;
    }>
  >(accountId, `/categories/${encodeURIComponent(categoryId)}/attributes`);

  return (attrs ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    valueType: a.value_type,
    tags: a.tags,
    values: a.values,
    allowedUnits: a.allowed_units,
    defaultUnit: a.default_unit,
    hint: a.hint,
  }));
}

/** Atributos que o ML gerencia e costumam estourar HTTP 400 se reenviados no create. */
const ATTRIBUTE_IDS_NEVER_SEND_ON_CREATE = new Set([
  "ITEM_CONDITION",
  "IS_EMERGING_BRAND",
  "IS_HIGHLIGHT_BRAND",
  "IS_TOM_BRAND",
]);

/**
 * Atributos de regra de negócio (Pack/Unidad, peso, etc.).
 * A categoria costuma marcá-los como `inferred`, mas o ML ainda exige o valor
 * explícito no create — removê-los causa HTTP 400 (ex.: UNITS_PER_PACK → (null,1)).
 */
const BUSINESS_CONDITIONAL_ATTR_IDS = new Set([
  "SALE_FORMAT",
  "UNITS_PER_PACK",
  "UNITS_PER_PACKAGE",
  "NET_WEIGHT",
  "UNIT_VOLUME",
]);

function isWritableCategoryAttribute(attr: MlCategoryAttribute): boolean {
  const tags = attr.tags ?? {};
  if (tags.read_only || tags.fixed || tags.inferred) return false;
  return true;
}

function hasAttributeValue(attr: MlListingAttributeInput): boolean {
  return Boolean(attr.value_name?.trim() || attr.value_id);
}

function normalizeAttributeValueForCreate(attr: MlListingAttributeInput): MlListingAttributeInput | null {
  if (!attr.id || ATTRIBUTE_IDS_NEVER_SEND_ON_CREATE.has(attr.id)) return null;
  let valueName = attr.value_name?.trim() ?? "";
  // Templates Full/catálogo às vezes trazem vários GTINs separados por vírgula.
  if ((attr.id === "GTIN" || attr.id === "EAN" || attr.id === "UPC") && valueName.includes(",")) {
    valueName = valueName.split(",")[0]!.trim();
  }
  if (!valueName && !attr.value_id) return null;
  return {
    id: attr.id,
    value_name: valueName,
    ...(attr.value_id ? { value_id: attr.value_id } : {}),
  };
}

/** Resolve value_id de atributos list/boolean a partir da definição da categoria. */
function resolveListValueId(
  attr: MlListingAttributeInput,
  categoryAttr: MlCategoryAttribute | undefined,
): MlListingAttributeInput {
  if (attr.value_id || !attr.value_name?.trim() || !categoryAttr?.values?.length) {
    return attr;
  }
  const valueType = categoryAttr.valueType;
  if (valueType && valueType !== "list" && valueType !== "boolean") {
    return attr;
  }
  const needle = attr.value_name.trim().toLowerCase();
  const match = categoryAttr.values.find(
    (v) => v.name.toLowerCase() === needle || v.id.toLowerCase() === needle,
  );
  if (!match) return attr;
  return {
    id: attr.id,
    value_name: match.name,
    value_id: match.id,
  };
}

/**
 * Remove atributos que a categoria marca como read_only/fixed/inferred,
 * e qualquer ID que não exista na definição da categoria.
 * Mantém atributos de regra de negócio (SALE_FORMAT, UNITS_PER_PACK, …) quando
 * o usuário enviou valor, mesmo se a categoria marcar inferred.
 */
export async function sanitizeAttributesForCreate(
  accountId: string,
  categoryId: string,
  attributes: MlListingAttributeInput[],
): Promise<MlListingAttributeInput[]> {
  let categoryAttrs: MlCategoryAttribute[] = [];
  try {
    categoryAttrs = await getCategoryAttributes(accountId, categoryId);
  } catch (err) {
    logger.warn({ err, accountId, categoryId }, "Failed to load category attributes for create sanitize");
  }

  const categoryById = new Map(categoryAttrs.map((a) => [a.id, a]));
  const writableIds = new Set(
    categoryAttrs.filter(isWritableCategoryAttribute).map((a) => a.id),
  );
  const hasMeta = categoryAttrs.length > 0;

  const out: MlListingAttributeInput[] = [];
  for (const raw of attributes) {
    if (hasMeta) {
      const cat = categoryById.get(raw.id);
      if (!cat) continue;
      const writable = writableIds.has(raw.id);
      const forceKeep =
        BUSINESS_CONDITIONAL_ATTR_IDS.has(raw.id) && hasAttributeValue(raw);
      if (!writable && !forceKeep) continue;
    }
    const normalized = normalizeAttributeValueForCreate(raw);
    if (!normalized) continue;
    out.push(resolveListValueId(normalized, categoryById.get(raw.id)));
  }
  return out;
}

function isBusinessConditionalMlErrorMessage(msg: string): boolean {
  return /to be added|business_conditional|invalid_sale_units/i.test(msg);
}

function extractBlockedFieldIdsFromMlError(err: unknown): string[] {
  const raw = err instanceof Error ? err.message : String(err);
  const ids = new Set<string>();

  const patterns = [
    /Attribute\s*\[([^\]]+)\]\s*ignored/gi,
    /not allowed to modify sale term\s+([A-Z0-9_]+)/gi,
    /not allowed to modify attribute\s+\[?([A-Z0-9_]+)\]?/gi,
    /sale term\s+([A-Z0-9_]+)/gi,
  ];
  for (const re of patterns) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(raw)) !== null) {
      const id = match[1]?.trim();
      if (id) ids.add(id);
    }
  }

  try {
    const jsonStart = raw.indexOf("{");
    if (jsonStart >= 0) {
      const body = JSON.parse(raw.slice(jsonStart)) as {
        cause?: Array<{ message?: string; type?: string; code?: string }>;
        message?: string;
      };
      for (const cause of body.cause ?? []) {
        const msg = cause.message ?? "";
        // "Attribute [UNITS_PER_PACK] to be added…" means the attr is missing/required —
        // not that it should be stripped on retry.
        if (isBusinessConditionalMlErrorMessage(msg)) continue;
        if (/business_conditional/i.test(cause.type ?? "") || /business_conditional/i.test(cause.code ?? "")) {
          continue;
        }
        const bracket = /\[([A-Z0-9_]+)\]/.exec(msg);
        if (bracket?.[1]) ids.add(bracket[1]);
      }
      if (body.message && !isBusinessConditionalMlErrorMessage(body.message)) {
        const bracket = /\[([A-Z0-9_]+)\]/.exec(body.message);
        if (bracket?.[1]) ids.add(bracket[1]);
      }
    }
  } catch {
    /* ignore */
  }

  return [...ids];
}

function pictureExtensionForMime(mimeType: string): string {
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("gif")) return "gif";
  return "jpg";
}

export async function uploadPicture(
  accountId: string,
  imageBase64: string,
  mimeType = "image/jpeg",
): Promise<{ id: string; url: string }> {
  const token = await getMlAccessToken(accountId);
  const buffer = Buffer.from(imageBase64, "base64");
  if (buffer.length > 10 * 1024 * 1024) {
    throw new MlListingError("Imagem muito grande. Máximo 10 MB.", "FILE_TOO_LARGE", 400);
  }

  const ext = pictureExtensionForMime(mimeType);
  const filename = `picture.${ext}`;
  const form = new FormData();
  const blob = new Blob([buffer], { type: mimeType });
  form.append("file", blob, filename);

  const res = await fetch(`${ML_BASE_URL}/pictures/items/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw parseMlApiError(new Error(`ML API ${res.status}: ${text}`));
  }

  const data = (await res.json()) as {
    id: string;
    secure_url?: string;
    url?: string;
    variations?: Array<{ secure_url?: string; url?: string }>;
  };
  const firstVariation = data.variations?.[0];
  const url =
    data.secure_url ??
    data.url ??
    firstVariation?.secure_url ??
    firstVariation?.url ??
    "";
  return { id: data.id, url };
}

export async function getMlItemDescription(accountId: string, itemId: string): Promise<string> {
  try {
    const data = await ml.get<{ plain_text?: string }>(
      accountId,
      `/items/${encodeURIComponent(itemId)}/description`,
    );
    return data.plain_text ?? "";
  } catch {
    return "";
  }
}

async function setMlItemDescription(accountId: string, itemId: string, description: string): Promise<void> {
  if (!description.trim()) return;
  await ml.put(accountId, `/items/${encodeURIComponent(itemId)}/description`, {
    plain_text: description.trim(),
  });
}

export type MlListingDetail = {
  item: MlItem;
  description: string;
  pictures: Array<{ id: string; url: string }>;
  attributes: Array<{ id: string; name?: string; value_name?: string | null; value_id?: string | null }>;
};

export async function getMlListingDetail(accountId: string, itemId: string): Promise<MlListingDetail> {
  const item = await ml.get<
    MlItem & {
      pictures?: Array<{ id?: string; url?: string; secure_url?: string }>;
      attributes?: Array<{ id: string; name?: string; value_name?: string | null; value_id?: string | null }>;
    }
  >(accountId, `/items/${encodeURIComponent(itemId)}`);

  const description = await getMlItemDescription(accountId, itemId);
  const pictures = (item.pictures ?? []).map((p) => ({
    id: p.id ?? "",
    url: p.secure_url ?? p.url ?? "",
  }));

  return {
    item,
    description,
    pictures,
    attributes: item.attributes ?? [],
  };
}

/** Sellers migrated to Mercado Livre User Products must send family_name and omit title. */
export async function isUserProductSeller(accountId: string): Promise<boolean> {
  const db = getDb();
  const [account] = await db
    .select({ mlUserId: accountsTable.mlUserId })
    .from(accountsTable)
    .where(eq(accountsTable.id, accountId))
    .limit(1);
  if (!account?.mlUserId) return false;
  try {
    const user = await ml.get<{ tags?: string[] }>(
      accountId,
      `/users/${encodeURIComponent(account.mlUserId)}`,
    );
    return Array.isArray(user.tags) && user.tags.includes("user_product_seller");
  } catch (err) {
    logger.warn({ err, accountId }, "Failed to check user_product_seller tag");
    return false;
  }
}

function buildCreateItemPayload(
  input: CreateMlListingInput,
  isUpSeller: boolean,
): Record<string, unknown> {
  const hasVariations = Array.isArray(input.variations) && input.variations.length > 0;
  const payload: Record<string, unknown> = {
    category_id: input.categoryId,
    currency_id: "BRL",
    buying_mode: "buy_it_now",
    condition: input.condition,
    listing_type_id: input.listingTypeId,
    attributes: input.attributes,
  };

  if (input.pictureSources?.length) {
    payload.pictures = input.pictureSources.map((source) => ({ source }));
  } else if (input.pictures.length) {
    payload.pictures = input.pictures.map((id) => ({ id }));
  }

  if (input.saleTerms?.length) {
    // Alguns sale_terms vêm no GET do anúncio, mas o ML rejeita no POST/PUT
    // (ex.: PURCHASE_MAX_QUANTITY com tag read_only na categoria).
    const ALLOWED_ON_CREATE = new Set([
      "WARRANTY_TYPE",
      "WARRANTY_TIME",
      "MANUFACTURING_TIME",
    ]);
    const saleTerms = input.saleTerms.filter((term) => ALLOWED_ON_CREATE.has(term.id));
    if (saleTerms.length) {
      payload.sale_terms = saleTerms.map((term) => {
        const row: Record<string, string> = { id: term.id };
        if (term.value_id) row.value_id = term.value_id;
        if (term.value_name) row.value_name = term.value_name;
        return row;
      });
    }
  }

  if (input.shipping && Object.keys(input.shipping).length > 0) {
    payload.shipping = input.shipping;
  }

  const videoId = input.videoId?.trim();
  if (videoId) {
    payload.video_id = videoId;
  }

  if (isUpSeller) {
    const familyName = (input.familyName ?? input.title).trim();
    payload.family_name = familyName;
  } else {
    payload.title = input.title.trim();
  }

  if (hasVariations) {
    payload.variations = input.variations!.map((v) => ({
      attribute_combinations: v.attribute_combinations,
      price: v.price,
      available_quantity: v.available_quantity,
      picture_ids: v.picture_ids,
    }));
  } else {
    payload.price = input.price;
    payload.available_quantity = input.availableQuantity;
  }

  return payload;
}

export async function createMlItem(accountId: string, input: CreateMlListingInput): Promise<MlItem> {
  if (!input.title.trim()) throw new MlListingError("Informe o título do anúncio.", "MISSING_TITLE");
  if (!input.categoryId) throw new MlListingError("Selecione uma categoria.", "MISSING_CATEGORY");
  if (!input.pictures.length && !input.pictureSources?.length) {
    throw new MlListingError("Adicione ao menos uma foto.", "MISSING_PICTURES");
  }
  if (!input.variations?.length && input.price <= 0) {
    throw new MlListingError("Informe um preço válido.", "INVALID_PRICE");
  }

  try {
    const isUpSeller = await isUserProductSeller(accountId);
    if (isUpSeller && !(input.familyName ?? input.title).trim()) {
      throw new MlListingError(
        "Informe o nome da família do produto (obrigatório no modelo User Products do Mercado Livre).",
        "MISSING_FAMILY_NAME",
      );
    }

    const sanitizedAttributes = await sanitizeAttributesForCreate(
      accountId,
      input.categoryId,
      input.attributes ?? [],
    );
    let workingInput: CreateMlListingInput = {
      ...input,
      attributes: sanitizedAttributes,
    };

    const postItem = async (data: CreateMlListingInput) => {
      const payload = buildCreateItemPayload(data, isUpSeller);
      return ml.post<MlItem>(accountId, "/items", payload);
    };

    let created: MlItem;
    try {
      created = await postItem(workingInput);
    } catch (firstErr) {
      const blockedIds = extractBlockedFieldIdsFromMlError(firstErr);
      if (blockedIds.length === 0) throw firstErr;

      const blocked = new Set(blockedIds);
      logger.warn(
        { accountId, blockedIds, categoryId: input.categoryId },
        "ML rejected create due to non-modifiable fields; retrying without them",
      );
      workingInput = {
        ...workingInput,
        attributes: workingInput.attributes.filter((a) => !blocked.has(a.id)),
        saleTerms: workingInput.saleTerms?.filter((t) => !blocked.has(t.id)),
      };
      created = await postItem(workingInput);
    }

    if (input.description?.trim()) {
      await setMlItemDescription(accountId, created.id, input.description);
    }
    const videoId = input.videoId?.trim();
    if (videoId && !created.video_id) {
      try {
        await ml.put(accountId, `/items/${encodeURIComponent(created.id)}`, { video_id: videoId });
      } catch (err) {
        logger.warn(
          { err, accountId, itemId: created.id, videoId },
          "Item created but video_id/clip could not be attached",
        );
      }
    }
    return created;
  } catch (err) {
    if (err instanceof MlListingError) throw err;
    throw parseMlApiError(err);
  }
}

export async function updateMlItem(
  accountId: string,
  itemId: string,
  input: UpdateMlListingInput,
  options?: { isFull?: boolean; soldQuantity?: number },
): Promise<MlItem> {
  const payload: Record<string, unknown> = {};
  if (input.familyName !== undefined) {
    payload.family_name = input.familyName.trim();
  } else if (input.title !== undefined) {
    payload.title = input.title.trim();
  }
  if (input.price !== undefined) payload.price = input.price;
  if (input.availableQuantity !== undefined && !options?.isFull) {
    payload.available_quantity = input.availableQuantity;
  }
  if (input.pictures !== undefined) {
    payload.pictures = input.pictures.map((id) => ({ id }));
  }
  if (input.attributes !== undefined) payload.attributes = input.attributes;

  try {
    let updated: MlItem;
    if (Object.keys(payload).length > 0) {
      updated = await ml.put<MlItem>(accountId, `/items/${encodeURIComponent(itemId)}`, payload);
    } else {
      updated = await ml.get<MlItem>(accountId, `/items/${encodeURIComponent(itemId)}`);
    }
    if (input.description !== undefined) {
      await setMlItemDescription(accountId, itemId, input.description);
    }
    return updated;
  } catch (err) {
    if (err instanceof MlListingError) throw err;
    throw parseMlApiError(err);
  }
}

function mapItemAttributesForCreate(
  attributes:
    | Array<{ id?: string; value_name?: string | null; value_id?: string | null }>
    | null
    | undefined,
): MlListingAttributeInput[] {
  return (attributes ?? [])
    .filter((a) => a.id && a.id !== "ITEM_CONDITION" && a.value_name?.trim())
    .map((a) => ({
      id: a.id!,
      value_name: a.value_name!.trim(),
      ...(a.value_id ? { value_id: a.value_id } : {}),
    }));
}

function mapItemSaleTermsForCreate(
  saleTerms: MlItemForDuplicate["sale_terms"],
): MlSaleTermInput[] {
  return (saleTerms ?? [])
    .filter((t) => t.value_name?.trim() || t.value_id)
    .map((t) => ({
      id: t.id,
      ...(t.value_name?.trim() ? { value_name: t.value_name.trim() } : {}),
      ...(t.value_id ? { value_id: t.value_id } : {}),
    }));
}

function extractPictureSources(item: MlItemForDuplicate): string[] {
  return (item.pictures ?? [])
    .map((p) => p.secure_url ?? p.url ?? "")
    .filter((url) => url.length > 0);
}

export async function buildCreateInputFromMlItem(
  accountId: string,
  mlItemId: string,
): Promise<CreateMlListingInput> {
  const item = await ml.get<MlItemForDuplicate>(
    accountId,
    `/items/${encodeURIComponent(mlItemId)}`,
  );

  if (item.shipping?.logistic_type === "fulfillment") {
    throw new MlListingError(
      "Anúncios Full (Fulfillment) não podem ser replicados pelo iHub.",
      "FULL_ITEM",
    );
  }
  if (item.catalog_listing === true) {
    throw new MlListingError(
      "Anúncios de catálogo compartilhado não podem ser replicados. Crie um anúncio tradicional.",
      "CATALOG_LISTING",
    );
  }

  const hasVariations = Array.isArray(item.variations) && item.variations.length > 0;
  if (hasVariations) {
    throw new MlListingError(
      "Anúncios com variações ainda não podem ser replicados automaticamente.",
      "VARIATIONS_NOT_SUPPORTED",
    );
  }

  const pictureSources = extractPictureSources(item);
  if (!pictureSources.length) {
    throw new MlListingError("O anúncio de origem não possui fotos para replicar.", "MISSING_PICTURES");
  }

  const description = await getMlItemDescription(accountId, mlItemId);
  const condition = item.condition === "used" ? "used" : "new";

  return {
    title: item.title?.trim() || mlItemId,
    familyName: item.family_name?.trim() || item.title?.trim() || mlItemId,
    categoryId: item.category_id,
    price: item.price,
    availableQuantity: item.available_quantity,
    condition,
    listingTypeId: item.listing_type_id,
    pictures: [],
    pictureSources,
    attributes: mapItemAttributesForCreate(item.attributes),
    description: description.trim() || undefined,
    saleTerms: mapItemSaleTermsForCreate(item.sale_terms),
    videoId: item.video_id ?? null,
  };
}

export async function duplicateMlListing(
  sourceAccountId: string,
  mlItemId: string,
  targetAccountId: string,
): Promise<{ item: MlItem; productId: string }> {
  const input = await buildCreateInputFromMlItem(sourceAccountId, mlItemId);
  const created = await createMlItem(targetAccountId, input);
  const productId = await upsertProductFromMlItem(targetAccountId, created);
  return { item: created, productId };
}

export async function closeMlItem(accountId: string, itemId: string): Promise<MlItem> {
  try {
    return await ml.put<MlItem>(accountId, `/items/${encodeURIComponent(itemId)}`, { status: "closed" });
  } catch (err) {
    if (err instanceof MlListingError) throw err;
    throw parseMlApiError(err);
  }
}

export async function upsertProductFromMlItem(accountId: string, item: MlItem): Promise<string> {
  const db = getDb();
  const isFull = item.shipping?.logistic_type === "fulfillment";
  const isFlex = Array.isArray(item.shipping?.tags) && item.shipping.tags!.includes("self_service_in");
  const logisticType = getMlEffectiveLogisticType(item);

  const mlItemForDb = await enrichMlItem(accountId, item);
  const { sku, variationsJson } = await buildMlItemProductRowSnapshot(accountId, item);
  const originalPrice = getMlOriginalListPrice(item);
  const pricesMap = await fetchMlItemPricesBatch(accountId, [item.id]);
  const itemPrices = pricesMap.get(item.id) ?? { amount: null, regularAmount: null };

  const values = {
    accountId,
    mlItemId: item.id,
    title: item.title,
    sku,
    price: item.price.toString(),
    originalPrice,
    amount: itemPrices.amount,
    regularAmount: itemPrices.regularAmount,
    availableQuantity: item.available_quantity,
    soldQuantity: item.sold_quantity,
    status: item.status,
    listingType: item.listing_type_id,
    logisticType,
    isFull,
    isFlex,
    catalogListing: !!mlItemForDb.catalog_listing,
    thumbnail: item.thumbnail,
    permalink: item.permalink,
    mlCategoryId: item.category_id,
    variationsJson,
    lastSyncedAt: new Date(),
  };

  const [row] = await db
    .insert(productsTable)
    .values(values)
    .onConflictDoUpdate({
      target: [productsTable.accountId, productsTable.mlItemId],
      set: {
        title: values.title,
        sku: values.sku,
        price: values.price,
        originalPrice: values.originalPrice,
        amount: itemPrices.amount,
        regularAmount: itemPrices.regularAmount,
        availableQuantity: values.availableQuantity,
        soldQuantity: values.soldQuantity,
        status: values.status,
        listingType: values.listingType,
        logisticType: values.logisticType,
        isFull: values.isFull,
        isFlex: values.isFlex,
        catalogListing: values.catalogListing,
        thumbnail: values.thumbnail,
        permalink: values.permalink,
        mlCategoryId: values.mlCategoryId,
        variationsJson: values.variationsJson,
        lastSyncedAt: values.lastSyncedAt,
        updatedAt: new Date(),
      },
    })
    .returning({ id: productsTable.id });

  if (!row) {
    logger.error({ accountId, mlItemId: item.id }, "upsertProductFromMlItem returned no row");
    throw new MlListingError("Falha ao salvar anúncio no banco.", "DB_ERROR", 500);
  }

  return row.id;
}

export const MLB_LISTING_TYPES = [
  { id: "gold_special", label: "Clássico" },
  { id: "gold_pro", label: "Premium" },
  { id: "gold_premium", label: "Diamante" },
] as const;
