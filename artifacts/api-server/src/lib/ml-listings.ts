import { getDb } from "./db";
import { productsTable } from "@workspace/db/schema";
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

export type CreateMlListingInput = {
  title: string;
  categoryId: string;
  price: number;
  availableQuantity: number;
  condition: "new" | "used";
  listingTypeId: string;
  pictures: string[];
  attributes: MlListingAttributeInput[];
  description?: string;
  variations?: MlListingVariationInput[];
};

export type UpdateMlListingInput = {
  title?: string;
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
    "body.invalid": "Dados do anúncio inválidos. Revise os campos e tente novamente.",
    forbidden: "Sem permissão para esta operação no Mercado Livre.",
    not_found: "Anúncio não encontrado no Mercado Livre.",
  };

  const message =
    ptMessages[code] ??
    firstCause?.message ??
    body.message ??
    "O Mercado Livre rejeitou a operação. Verifique os dados e tente novamente.";

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

function buildCreateItemPayload(input: CreateMlListingInput): Record<string, unknown> {
  const hasVariations = Array.isArray(input.variations) && input.variations.length > 0;
  const payload: Record<string, unknown> = {
    title: input.title.trim(),
    category_id: input.categoryId,
    currency_id: "BRL",
    buying_mode: "buy_it_now",
    condition: input.condition,
    listing_type_id: input.listingTypeId,
    pictures: input.pictures.map((id) => ({ id })),
    attributes: input.attributes,
  };

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
  if (!input.pictures.length) throw new MlListingError("Adicione ao menos uma foto.", "MISSING_PICTURES");
  if (!input.variations?.length && input.price <= 0) {
    throw new MlListingError("Informe um preço válido.", "INVALID_PRICE");
  }

  try {
    const payload = buildCreateItemPayload(input);
    const created = await ml.post<MlItem>(accountId, "/items", payload);
    if (input.description?.trim()) {
      await setMlItemDescription(accountId, created.id, input.description);
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
  if (input.title !== undefined) payload.title = input.title.trim();
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
