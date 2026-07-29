import type {
  IhubUiCampo,
  IhubUiSecao,
  N8nListingDraft,
  N8nListingSaleTerm,
} from "@workspace/api-client-react";
import { ATTR_LABELS } from "./listing-review-fields";

/** Apify sync no N8N pode levar até ~5 min; dá folga para validação ML + callback. */
export const PREPARE_JOB_TIMEOUT_MS = 6 * 60 * 1000;

export const N8N_CREATE_STEPS = [
  { id: 1, label: "Link do produto" },
  { id: 2, label: "Revisão e publicação" },
] as const;

/** Draft Amazon SP-API (quando a conta de destino é Amazon). */
export type N8nAmazonScrapedAttribute = {
  key: string;
  value: string;
};

export type N8nAmazonListingDraft = {
  platform: "amazon";
  payload: {
    sellerSku: string;
    productType: string;
    requirements?: string;
    attributes: Record<string, unknown>;
  };
  _marketplace_id?: string;
  _asin?: string | null;
  _description?: string;
  _bullet_points?: string[];
  _scraped_attributes?: N8nAmazonScrapedAttribute[];
  _pronto_para_publicar?: boolean;
  _product_type_sugerido?: string;
  _bloqueios?: unknown[];
  _ihub_ui?: N8nListingDraft["_ihub_ui"];
  [key: string]: unknown;
};

export type ListingPrepareDraft = N8nListingDraft | N8nAmazonListingDraft;

export function isAmazonListingDraft(draft: unknown): draft is N8nAmazonListingDraft {
  if (!draft || typeof draft !== "object") return false;
  const d = draft as Record<string, unknown>;
  if (d.platform === "amazon") return true;
  const payload = d.payload as Record<string, unknown> | undefined;
  return !!(
    payload &&
    typeof payload.sellerSku === "string" &&
    typeof payload.productType === "string" &&
    payload.attributes &&
    typeof payload.attributes === "object" &&
    !Array.isArray(payload.attributes)
  );
}

type AmazonLocaleValue = { value?: string; marketplace_id?: string };

function marketplaceIdOf(draft: N8nAmazonListingDraft): string {
  return draft._marketplace_id || "A2Q3Y263D00KWC";
}

export function getAmazonAttrText(
  draft: N8nAmazonListingDraft,
  key: string,
): string {
  const raw = draft.payload.attributes?.[key];
  if (!Array.isArray(raw) || raw.length === 0) return "";
  const first = raw[0] as AmazonLocaleValue;
  return typeof first?.value === "string" ? first.value : "";
}

export function getAmazonPrice(draft: N8nAmazonListingDraft): number {
  const offer = draft.payload.attributes?.purchasable_offer;
  if (!Array.isArray(offer) || !offer[0]) return 0;
  const ourPrice = (offer[0] as { our_price?: Array<{ schedule?: Array<{ value_with_tax?: number }> }> })
    .our_price;
  const scheduled = ourPrice?.[0]?.schedule?.[0]?.value_with_tax;
  return typeof scheduled === "number" ? scheduled : 0;
}

export function getAmazonQuantity(draft: N8nAmazonListingDraft): number {
  const avail = draft.payload.attributes?.fulfillment_availability;
  if (!Array.isArray(avail) || !avail[0]) return 0;
  const qty = (avail[0] as { quantity?: number }).quantity;
  return typeof qty === "number" ? qty : 0;
}

/** Capa + até 8 adicionais (SP-API other_product_image_locator_1..8). */
export const AMAZON_MAX_IMAGES = 9;

export function isValidAmazonMediaUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith("data:")) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function getAmazonImageUrls(draft: N8nAmazonListingDraft): string[] {
  const urls: string[] = [];
  const main = draft.payload.attributes?.main_product_image_locator;
  if (Array.isArray(main) && (main[0] as { media_location?: string })?.media_location) {
    urls.push(String((main[0] as { media_location: string }).media_location));
  }
  for (let i = 1; i <= 8; i++) {
    const other = draft.payload.attributes?.[`other_product_image_locator_${i}`];
    if (Array.isArray(other) && (other[0] as { media_location?: string })?.media_location) {
      urls.push(String((other[0] as { media_location: string }).media_location));
    }
  }
  return urls;
}

/** Define a galeria Amazon (1ª = capa). Até 9 fotos (main + other_1..8). */
export function setAmazonImageUrls(
  draft: N8nAmazonListingDraft,
  urls: string[],
): N8nAmazonListingDraft {
  const marketplaceId = marketplaceIdOf(draft);
  const next: N8nAmazonListingDraft = {
    ...draft,
    payload: {
      ...draft.payload,
      attributes: { ...draft.payload.attributes },
    },
  };

  delete next.payload.attributes.main_product_image_locator;
  for (let i = 1; i <= 8; i++) {
    delete next.payload.attributes[`other_product_image_locator_${i}`];
  }

  const cleaned = urls.map((u) => u.trim()).filter(Boolean).slice(0, AMAZON_MAX_IMAGES);
  if (cleaned[0]) {
    next.payload.attributes.main_product_image_locator = [
      { media_location: cleaned[0], marketplace_id: marketplaceId },
    ];
  }
  for (let i = 1; i < cleaned.length; i++) {
    next.payload.attributes[`other_product_image_locator_${i}`] = [
      { media_location: cleaned[i], marketplace_id: marketplaceId },
    ];
  }

  const reasons = getAmazonPublishBlockReasons(next);
  return { ...next, _pronto_para_publicar: reasons.length === 0 };
}

function withAmazonAttrText(
  draft: N8nAmazonListingDraft,
  key: string,
  value: string,
): N8nAmazonListingDraft {
  const marketplaceId = marketplaceIdOf(draft);
  return {
    ...draft,
    payload: {
      ...draft.payload,
      attributes: {
        ...draft.payload.attributes,
        [key]: [{ value, marketplace_id: marketplaceId }],
      },
    },
  };
}

export function updateAmazonDraftBasics(
  draft: N8nAmazonListingDraft,
  patch: {
    sellerSku?: string;
    productType?: string;
    title?: string;
    brand?: string;
    description?: string;
    price?: number;
    availableQuantity?: number;
  },
): N8nAmazonListingDraft {
  const marketplaceId = marketplaceIdOf(draft);
  let next: N8nAmazonListingDraft = {
    ...draft,
    payload: { ...draft.payload, attributes: { ...draft.payload.attributes } },
  };

  if (patch.sellerSku !== undefined) {
    next = {
      ...next,
      payload: { ...next.payload, sellerSku: patch.sellerSku },
    };
  }
  if (patch.productType !== undefined) {
    next = {
      ...next,
      payload: { ...next.payload, productType: patch.productType },
      _bloqueios:
        patch.productType.trim() && patch.productType !== "PRODUCT"
          ? []
          : next._bloqueios,
    };
    if (
      productTypeNeedsCompartment(patch.productType) &&
      !getAmazonCompartment(next).trim()
    ) {
      const title = getAmazonAttrText(next, "item_name");
      next = updateAmazonCompartment(
        next,
        suggestAmazonCompartment(patch.productType, title),
      );
    } else if (!productTypeNeedsCompartment(patch.productType)) {
      const attrs = { ...next.payload.attributes };
      delete attrs.compartment;
      next = { ...next, payload: { ...next.payload, attributes: attrs } };
    }
    if (productTypeNeedsNumberOfCompartments(patch.productType)) {
      if (getAmazonNumberOfCompartments(next) <= 0) {
        next = updateAmazonNumberOfCompartments(
          next,
          findScrapedNumberOfCompartments(next) || 1,
        );
      }
    } else {
      const attrs = { ...next.payload.attributes };
      delete attrs.number_of_compartments;
      next = { ...next, payload: { ...next.payload, attributes: attrs } };
    }
    const dims = getAmazonItemDimensions(next);
    if (dims) next = updateAmazonItemDimensions(next, dims);
    next = ensureAmazonBagSoftAttributes(next);
  }
  if (patch.title !== undefined) {
    next = withAmazonAttrText(next, "item_name", patch.title);
  }
  if (patch.brand !== undefined) {
    next = withAmazonAttrText(next, "brand", patch.brand);
  }
  if (patch.description !== undefined) {
    next = {
      ...withAmazonAttrText(next, "product_description", patch.description),
      _description: patch.description,
    };
  }
  if (patch.price !== undefined) {
    const amount = Number(Number(patch.price).toFixed(2));
    next = {
      ...next,
      payload: {
        ...next.payload,
        attributes: {
          ...next.payload.attributes,
          purchasable_offer: [
            {
              marketplace_id: marketplaceId,
              currency: "BRL",
              audience: "ALL",
              our_price: [{ schedule: [{ value_with_tax: amount }] }],
              list_price: [{ schedule: [{ value_with_tax: amount }] }],
            },
          ],
          list_price: [
            {
              currency: "BRL",
              marketplace_id: marketplaceId,
              value_with_tax: amount,
            },
          ],
        },
      },
    };
  }
  if (patch.availableQuantity !== undefined) {
    const quantity =
      typeof patch.availableQuantity === "number" &&
      Number.isFinite(patch.availableQuantity) &&
      patch.availableQuantity > 0
        ? Math.floor(patch.availableQuantity)
        : 1;
    next = {
      ...next,
      payload: {
        ...next.payload,
        attributes: {
          ...next.payload.attributes,
          fulfillment_availability: [
            {
              fulfillment_channel_code: "DEFAULT",
              quantity,
            },
          ],
        },
      },
    };
  }

  const reasons = getAmazonPublishBlockReasons(next);
  return { ...next, _pronto_para_publicar: reasons.length === 0 };
}

const AMAZON_SYSTEM_ATTR_KEYS = new Set([
  "item_name",
  "condition_type",
  "fulfillment_availability",
  "purchasable_offer",
  "brand",
  "product_description",
  "main_product_image_locator",
  "merchant_suggested_asin",
  "externally_assigned_product_identifier",
  "supplier_declared_has_product_identifier_exemption",
  "bullet_point",
  "list_price",
  "item_length_width_height",
  "department",
  "country_of_origin",
  "supplier_declared_dg_hz_regulation",
  "model_name",
  "compartment",
  "recommended_browse_nodes",
  "number_of_compartments",
]);

function isAmazonImageLocatorKey(key: string): boolean {
  return (
    key === "main_product_image_locator" ||
    /^other_product_image_locator_\d+$/.test(key)
  );
}

/** Atributos SP-API de texto simples (locale) além dos campos básicos. */
export function listAmazonExtraTextAttributes(
  draft: N8nAmazonListingDraft,
): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = [];
  for (const [key, raw] of Object.entries(draft.payload.attributes || {})) {
    if (AMAZON_SYSTEM_ATTR_KEYS.has(key) || isAmazonImageLocatorKey(key)) continue;
    if (!Array.isArray(raw) || !raw[0] || typeof (raw[0] as { value?: unknown }).value !== "string") {
      continue;
    }
    out.push({ key, value: String((raw[0] as { value: string }).value) });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

export function getAmazonBulletPoints(draft: N8nAmazonListingDraft): string[] {
  if (Array.isArray(draft._bullet_points) && draft._bullet_points.length) {
    return draft._bullet_points.map(String);
  }
  const raw = draft.payload.attributes?.bullet_point;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => String((item as { value?: string })?.value || "").trim())
    .filter(Boolean);
}

export function getAmazonScrapedAttributes(
  draft: N8nAmazonListingDraft,
): N8nAmazonScrapedAttribute[] {
  if (Array.isArray(draft._scraped_attributes)) {
    return draft._scraped_attributes.map((a) => ({
      key: String(a.key || ""),
      value: String(a.value ?? ""),
    }));
  }
  return [];
}

export function updateAmazonBulletPoints(
  draft: N8nAmazonListingDraft,
  bullets: string[],
): N8nAmazonListingDraft {
  const marketplaceId = marketplaceIdOf(draft);
  const cleaned = bullets
    .map((b) => b.trim().slice(0, AMAZON_BULLET_POINT_MAX))
    .filter(Boolean)
    .slice(0, 10);
  const next: N8nAmazonListingDraft = {
    ...draft,
    _bullet_points: cleaned,
    payload: {
      ...draft.payload,
      attributes: { ...draft.payload.attributes },
    },
  };
  if (cleaned.length) {
    next.payload.attributes.bullet_point = cleaned.slice(0, 5).map((value) => ({
      value,
      language_tag: "pt_BR",
      marketplace_id: marketplaceId,
    }));
  } else {
    delete next.payload.attributes.bullet_point;
  }
  const reasons = getAmazonPublishBlockReasons(next);
  return { ...next, _pronto_para_publicar: reasons.length === 0 };
}

export function updateAmazonScrapedAttribute(
  draft: N8nAmazonListingDraft,
  index: number,
  patch: { key?: string; value?: string },
): N8nAmazonListingDraft {
  const list = getAmazonScrapedAttributes(draft).map((item) => ({ ...item }));
  if (!list[index]) return draft;
  if (patch.key !== undefined) list[index].key = patch.key;
  if (patch.value !== undefined) list[index].value = patch.value;

  let next: N8nAmazonListingDraft = {
    ...draft,
    _scraped_attributes: list,
    payload: {
      ...draft.payload,
      attributes: { ...draft.payload.attributes },
    },
  };

  // Espelha chaves conhecidas no payload SP-API
  const keyNorm = list[index].key
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const scrapeToSpApi: Record<string, string> = {
    marca: "brand",
    brand: "brand",
    fabricante: "manufacturer",
    manufacturer: "manufacturer",
    modelo: "model_name",
    model: "model_name",
    "nome do modelo": "model_name",
    "model name": "model_name",
    "numero do modelo": "model_number",
    "model number": "model_number",
    "numero da peca": "part_number",
    "part number": "part_number",
    cor: "color",
    color: "color",
    colour: "color",
    tamanho: "size",
    size: "size",
    material: "material",
    "tipo de material": "material",
    estilo: "style",
    style: "style",
    padrao: "pattern",
    pattern: "pattern",
    estampa: "pattern",
    "pais de origem": "country_of_origin",
    "country of origin": "country_of_origin",
    genero: "target_gender",
    "target gender": "target_gender",
    "faixa etaria": "age_range_description",
    "descricao da faixa etaria": "age_range_description",
    "age range description": "age_range_description",
    "tipo de alca": "strap_type",
    "strap type": "strap_type",
    "nivel de resistencia a agua": "water_resistance_level",
    "water resistance level": "water_resistance_level",
    "descricao do forro": "lining_description",
    "lining description": "lining_description",
    "instrucoes de cuidados com o produto": "care_instructions",
    "care instructions": "care_instructions",
    tema: "theme",
    theme: "theme",
    "tipo de esporte": "sport_type",
    "sport type": "sport_type",
  };
  const spKey = scrapeToSpApi[keyNorm];
  if (spKey && list[index].value.trim()) {
    const value = list[index].value.trim();
    // Não sobrescrever marca da loja com "Genérico" do scrape de terceiros
    if (
      spKey === "brand" &&
      /^(gen[eé]rico|generic|sem\s*marca|unbranded)$/i.test(value)
    ) {
      /* skip */
    } else {
      next = withAmazonAttrText(next, spKey, value);
      next = { ...next, _scraped_attributes: list };
    }
  } else if (
    (keyNorm === "numero de compartimentos" ||
      keyNorm === "number of compartments" ||
      keyNorm.includes("compartimentos")) &&
    list[index].value.trim()
  ) {
    const match = list[index].value.match(/(\d+)/);
    if (match) {
      next = updateAmazonNumberOfCompartments(next, Number(match[1]));
      next = { ...next, _scraped_attributes: list };
    }
  }

  const reasons = getAmazonPublishBlockReasons(next);
  return { ...next, _pronto_para_publicar: reasons.length === 0 };
}

export function updateAmazonExtraTextAttribute(
  draft: N8nAmazonListingDraft,
  key: string,
  value: string,
): N8nAmazonListingDraft {
  const normalized =
    key === "country_of_origin" ? normalizeAmazonCountryCode(value) : value;
  const next = withAmazonAttrText(draft, key, normalized);
  const reasons = getAmazonPublishBlockReasons(next);
  return { ...next, _pronto_para_publicar: reasons.length === 0 };
}

export function getAmazonGtin(draft: N8nAmazonListingDraft): string {
  const raw = draft.payload.attributes?.externally_assigned_product_identifier;
  if (!Array.isArray(raw) || !raw[0]) return "";
  return String((raw[0] as { value?: string }).value || "");
}

export function hasAmazonGtinExemption(draft: N8nAmazonListingDraft): boolean {
  const raw = draft.payload.attributes?.supplier_declared_has_product_identifier_exemption;
  if (!Array.isArray(raw) || !raw[0]) return false;
  return (raw[0] as { value?: boolean }).value === true;
}

/** Força isenção GTIN/EAN e remove identificador — produto novo sem código de barras. */
export function applyAmazonGtinExemption(draft: N8nAmazonListingDraft): N8nAmazonListingDraft {
  const marketplaceId = marketplaceIdOf(draft);
  const next: N8nAmazonListingDraft = {
    ...draft,
    payload: {
      ...draft.payload,
      attributes: { ...draft.payload.attributes },
    },
  };
  delete next.payload.attributes.externally_assigned_product_identifier;
  next.payload.attributes.supplier_declared_has_product_identifier_exemption = [
    { value: true, marketplace_id: marketplaceId },
  ];
  const reasons = getAmazonPublishBlockReasons(next);
  return { ...next, _pronto_para_publicar: reasons.length === 0 };
}

export const AMAZON_MODEL_NAME_MAX = 120;
export const AMAZON_BULLET_POINT_MAX = 700;

function normalizeScrapeKey(key: string): string {
  return key
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findScrapedModelName(draft: N8nAmazonListingDraft): string {
  for (const attr of getAmazonScrapedAttributes(draft)) {
    const key = normalizeScrapeKey(attr.key);
    if (
      key === "modelo" ||
      key === "model" ||
      key === "nome do modelo" ||
      key === "model name" ||
      key.includes("modelo")
    ) {
      const value = attr.value?.trim();
      if (value) return value;
    }
  }
  return "";
}

function findScrapedNumberOfCompartments(draft: N8nAmazonListingDraft): number {
  for (const attr of getAmazonScrapedAttributes(draft)) {
    const key = normalizeScrapeKey(attr.key);
    if (
      key === "numero de compartimentos" ||
      key === "number of compartments" ||
      key === "contagem de compartimentos" ||
      key.includes("compartimentos")
    ) {
      const match = String(attr.value || "").match(/(\d+)/);
      if (match) {
        const n = Number(match[1]);
        if (Number.isFinite(n) && n > 0) return Math.floor(n);
      }
    }
  }
  return 0;
}

/** Espelha todos os atributos do scrape conhecidos no payload SP-API (sem sobrescrever). */
function mapAllScrapedAttributesIntoDraft(
  draft: N8nAmazonListingDraft,
): N8nAmazonListingDraft {
  const list = getAmazonScrapedAttributes(draft);
  if (!list.length) return draft;

  const marketplaceId = marketplaceIdOf(draft);
  let attrs: Record<string, unknown> = { ...draft.payload.attributes };
  let changed = false;

  const scrapeToSpApi: Record<string, string> = {
    fabricante: "manufacturer",
    manufacturer: "manufacturer",
    "numero do modelo": "model_number",
    "model number": "model_number",
    cor: "color",
    color: "color",
    colour: "color",
    tamanho: "size",
    size: "size",
    material: "material",
    "tipo de material": "material",
    estilo: "style",
    style: "style",
    padrao: "pattern",
    pattern: "pattern",
    estampa: "pattern",
    "tipo de alca": "strap_type",
    "strap type": "strap_type",
    "descricao do forro": "lining_description",
    "lining description": "lining_description",
    "faixa etaria": "age_range_description",
    "descricao da faixa etaria": "age_range_description",
    "instrucoes de cuidados com o produto": "care_instructions",
    tema: "theme",
    "tipo de esporte": "sport_type",
  };

  for (const item of list) {
    const keyNorm = normalizeScrapeKey(item.key);
    const value = item.value?.trim();
    if (!value) continue;

    const spKey = scrapeToSpApi[keyNorm];
    if (spKey) {
      const existing = attrs[spKey];
      const hasExisting =
        Array.isArray(existing) &&
        existing[0] &&
        typeof (existing[0] as { value?: unknown }).value === "string" &&
        String((existing[0] as { value: string }).value).trim();
      if (!hasExisting) {
        attrs[spKey] = [{ value, language_tag: "pt_BR", marketplace_id: marketplaceId }];
        changed = true;
      }
      continue;
    }

    if (
      (keyNorm === "numero de compartimentos" ||
        keyNorm === "number of compartments" ||
        (keyNorm.includes("compartimentos") && !keyNorm.includes("ziper"))) &&
      !attrs.number_of_compartments
    ) {
      const match = value.match(/(\d+)/);
      if (match) {
        attrs.number_of_compartments = [
          { value: Math.floor(Number(match[1])), marketplace_id: marketplaceId },
        ];
        changed = true;
      }
    }
  }

  if (!changed) return draft;
  return {
    ...draft,
    payload: { ...draft.payload, attributes: attrs },
  };
}

/**
 * Normaliza draft Amazon ao abrir a revisão: isenção GTIN, model_name ≤ 120,
 * estoque > 0 e product_type heurístico quando ainda for PRODUCT/vazio.
 */
export function normalizeAmazonDraftForReview(
  draft: N8nAmazonListingDraft,
): N8nAmazonListingDraft {
  let next = applyAmazonGtinExemption(draft);
  next = mapAllScrapedAttributesIntoDraft(next);

  let model = getAmazonModelName(next).trim();
  if (!model || model.length > AMAZON_MODEL_NAME_MAX) {
    const fromScrape = findScrapedModelName(next);
    if (fromScrape) model = fromScrape;
  }
  if (model) {
    next = updateAmazonModelName(next, model);
  }

  const qty = getAmazonQuantity(next);
  if (qty <= 0) {
    next = updateAmazonDraftBasics(next, { availableQuantity: 1 });
  }

  const productType = (next.payload.productType || "").trim().toUpperCase();
  if (!productType || productType === "PRODUCT") {
    const fromDraft =
      typeof next._product_type_sugerido === "string"
        ? next._product_type_sugerido.trim()
        : "";
    const suggested =
      (fromDraft && fromDraft.toUpperCase() !== "PRODUCT" ? fromDraft : null) ||
      suggestAmazonProductType(getAmazonAttrText(next, "item_name"));
    if (suggested) {
      next = updateAmazonDraftBasics(next, {
        productType: suggested.toUpperCase(),
      });
    }
  }

  const resolvedType = (next.payload.productType || "").trim();
  if (productTypeNeedsCompartment(resolvedType) && !getAmazonCompartment(next).trim()) {
    next = updateAmazonCompartment(
      next,
      suggestAmazonCompartment(resolvedType, getAmazonAttrText(next, "item_name")),
    );
  } else if (!productTypeNeedsCompartment(resolvedType)) {
    const attrs = { ...next.payload.attributes };
    if (attrs.compartment) {
      delete attrs.compartment;
      next = {
        ...next,
        payload: { ...next.payload, attributes: attrs },
      };
    }
  }

  if (productTypeNeedsNumberOfCompartments(resolvedType)) {
    if (getAmazonNumberOfCompartments(next) <= 0) {
      next = updateAmazonNumberOfCompartments(
        next,
        findScrapedNumberOfCompartments(next) || 1,
      );
    }
  } else {
    const attrs = { ...next.payload.attributes };
    if (attrs.number_of_compartments) {
      delete attrs.number_of_compartments;
      next = {
        ...next,
        payload: { ...next.payload, attributes: attrs },
      };
    }
  }

  // Truncar bullets > 700 (limite schema BR)
  const bullets = getAmazonBulletPoints(next);
  if (bullets.some((b) => b.length > AMAZON_BULLET_POINT_MAX)) {
    next = updateAmazonBulletPoints(next, bullets);
  }

  // Regrava dimensões no atributo certo (depth vs length) conforme product type
  const dims = getAmazonItemDimensions(next);
  if (dims) {
    next = updateAmazonItemDimensions(next, dims);
  }

  next = ensureAmazonBagSoftAttributes(next);

  const reasons = getAmazonPublishBlockReasons(next);
  return { ...next, _pronto_para_publicar: reasons.length === 0 };
}

function attrLocalizedTextDraft(
  value: string,
  marketplaceId: string,
): Array<{ value: string; language_tag: string; marketplace_id: string }> {
  return [{ value, language_tag: "pt_BR", marketplace_id: marketplaceId }];
}

/** Preenche atributos soft ausentes para BACKPACK/bolsas (evita 502 na publicação). */
export function ensureAmazonBagSoftAttributes(
  draft: N8nAmazonListingDraft,
): N8nAmazonListingDraft {
  const type = (draft.payload.productType || "").toUpperCase();
  const isBackpack = type === "BACKPACK";
  const isDuffel = type.includes("DUFFEL");
  const isHandbagFamily = type === "HANDBAG" || type === "TOTE_BAG";
  const isBag = type === "BAG";
  const isSuitcase = type === "SUITCASE";
  const isCosmetic = type === "COSMETIC_CASE";
  const isLuggage = type === "LUGGAGE";
  if (
    !isBackpack &&
    !isDuffel &&
    !isHandbagFamily &&
    !isBag &&
    !isSuitcase &&
    !isCosmetic &&
    !isLuggage
  ) {
    return draft;
  }

  const marketplaceId = marketplaceIdOf(draft);
  const attrs: Record<string, unknown> = { ...draft.payload.attributes };
  const title = getAmazonAttrText(draft, "item_name");
  let changed = false;

  const localeVal = (raw: unknown) => {
    if (!Array.isArray(raw) || !raw[0]) return "";
    const v = (raw[0] as { value?: unknown }).value;
    return typeof v === "string" ? v.trim() : "";
  };
  const nestedVal = (raw: unknown, key: "type" | "material") => {
    if (!Array.isArray(raw) || !raw[0] || typeof raw[0] !== "object") return "";
    const nested = (raw[0] as Record<string, unknown>)[key];
    if (!Array.isArray(nested) || !nested[0]) return "";
    const v = (nested[0] as { value?: unknown }).value;
    return typeof v === "string" ? v.trim() : "";
  };

  if (!localeVal(attrs.strap_type) && (isBackpack || isDuffel || isHandbagFamily)) {
    attrs.strap_type = attrLocalizedTextDraft(
      isBackpack ? "Alças traseiras" : "Ajustável",
      marketplaceId,
    );
    changed = true;
  }
  if (
    !nestedVal(attrs.closure, "type") &&
    (isBackpack || isDuffel || isHandbagFamily || isBag || isCosmetic || isLuggage)
  ) {
    attrs.closure = [
      {
        type: [{ language_tag: "pt_BR", value: "Zíper" }],
        marketplace_id: marketplaceId,
      },
    ];
    changed = true;
  }
  if (
    !localeVal(attrs.target_gender) &&
    (isBackpack || isBag || isHandbagFamily || isCosmetic)
  ) {
    attrs.target_gender = [{ value: "unisex", marketplace_id: marketplaceId }];
    changed = true;
  }
  const hasVolume =
    Array.isArray(attrs.storage_volume) &&
    attrs.storage_volume[0] &&
    typeof (attrs.storage_volume[0] as { value?: unknown }).value === "number";
  if (!hasVolume && (isBackpack || isSuitcase || isLuggage)) {
    const litersMatch = `${title} ${getAmazonScrapedAttributes(draft)
      .map((a) => a.value)
      .join(" ")}`.match(/(\d+[.,]?\d*)\s*(?:l|litros?)\b/i);
    const liters = litersMatch ? Number(litersMatch[1].replace(",", ".")) : 20;
    attrs.storage_volume = [
      {
        value: Number.isFinite(liters) && liters > 0 ? liters : 20,
        unit: "liters",
        marketplace_id: marketplaceId,
      },
    ];
    changed = true;
  }
  if (
    !localeVal(attrs.water_resistance_level) &&
    (isBackpack ||
      isDuffel ||
      isHandbagFamily ||
      isBag ||
      isSuitcase ||
      isCosmetic ||
      isLuggage)
  ) {
    attrs.water_resistance_level = [
      { value: "water_repellent", marketplace_id: marketplaceId },
    ];
    changed = true;
  }
  if (
    !nestedVal(attrs.outer, "material") &&
    (isBackpack ||
      isDuffel ||
      isHandbagFamily ||
      isBag ||
      isSuitcase ||
      isCosmetic ||
      isLuggage)
  ) {
    const blob = `${localeVal(attrs.material)} ${title}`.toLowerCase();
    let material = "Nylon";
    if (/poli[eé]ster|polyester/.test(blob)) material = "Poliéster";
    else if (/nylon/.test(blob)) material = "Nylon";
    else if (/couro/.test(blob)) material = "Couro";
    attrs.outer = [
      {
        material: [{ language_tag: "pt_BR", value: material }],
        marketplace_id: marketplaceId,
      },
    ];
    changed = true;
  }
  if (
    !localeVal(attrs.lining_description) &&
    (isBackpack || isBag || isHandbagFamily)
  ) {
    attrs.lining_description = attrLocalizedTextDraft("Poliéster", marketplaceId);
    changed = true;
  }
  if (
    !localeVal(attrs.age_range_description) &&
    (isBackpack || isBag || isHandbagFamily)
  ) {
    attrs.age_range_description = attrLocalizedTextDraft("Adulto", marketplaceId);
    changed = true;
  }

  if (!changed) return draft;
  const next: N8nAmazonListingDraft = {
    ...draft,
    payload: { ...draft.payload, attributes: attrs },
  };
  const reasons = getAmazonPublishBlockReasons(next);
  return { ...next, _pronto_para_publicar: reasons.length === 0 };
}

export function getAmazonModelName(draft: N8nAmazonListingDraft): string {
  return getAmazonAttrText(draft, "model_name");
}

export function updateAmazonModelName(
  draft: N8nAmazonListingDraft,
  value: string,
): N8nAmazonListingDraft {
  const truncated = value.slice(0, AMAZON_MODEL_NAME_MAX);
  const next = withAmazonAttrText(draft, "model_name", truncated);
  const reasons = getAmazonPublishBlockReasons(next);
  return { ...next, _pronto_para_publicar: reasons.length === 0 };
}

export function updateAmazonGtin(
  draft: N8nAmazonListingDraft,
  gtin: string,
): N8nAmazonListingDraft {
  // Fluxo produto novo: não enviar GTIN — sempre isento.
  if (!gtin.trim()) {
    return applyAmazonGtinExemption(draft);
  }
  const marketplaceId = marketplaceIdOf(draft);
  const next: N8nAmazonListingDraft = {
    ...draft,
    payload: {
      ...draft.payload,
      attributes: { ...draft.payload.attributes },
    },
  };
  next.payload.attributes.externally_assigned_product_identifier = [
    { type: "ean", value: gtin.trim(), marketplace_id: marketplaceId },
  ];
  delete next.payload.attributes.supplier_declared_has_product_identifier_exemption;
  const reasons = getAmazonPublishBlockReasons(next);
  return { ...next, _pronto_para_publicar: reasons.length === 0 };
}

export function getAmazonCondition(draft: N8nAmazonListingDraft): string {
  return getAmazonAttrText(draft, "condition_type") || "new_new";
}

export function updateAmazonCondition(
  draft: N8nAmazonListingDraft,
  condition: string,
): N8nAmazonListingDraft {
  const next = withAmazonAttrText(draft, "condition_type", condition);
  const reasons = getAmazonPublishBlockReasons(next);
  return { ...next, _pronto_para_publicar: reasons.length === 0 };
}

export type AmazonItemDimensions = {
  length: number;
  width: number;
  height: number;
  unit: "centimeters" | "inches";
};

export function getAmazonListPrice(draft: N8nAmazonListingDraft): number {
  const raw = draft.payload.attributes?.list_price;
  if (Array.isArray(raw) && raw[0]) {
    const first = raw[0] as {
      value_with_tax?: number;
      value?: number;
      schedule?: Array<{ value_with_tax?: number }>;
    };
    if (typeof first.value_with_tax === "number") return first.value_with_tax;
    if (typeof first.value === "number") return first.value;
    const scheduled = first.schedule?.[0]?.value_with_tax;
    if (typeof scheduled === "number") return scheduled;
  }
  // Fallback: MSRP aninhado no purchasable_offer
  const offer = draft.payload.attributes?.purchasable_offer;
  if (Array.isArray(offer) && offer[0]) {
    const nested = (
      offer[0] as { list_price?: Array<{ schedule?: Array<{ value_with_tax?: number }> }> }
    ).list_price?.[0]?.schedule?.[0]?.value_with_tax;
    if (typeof nested === "number") return nested;
  }
  return getAmazonPrice(draft);
}

export function updateAmazonListPrice(
  draft: N8nAmazonListingDraft,
  price: number,
): N8nAmazonListingDraft {
  const marketplaceId = marketplaceIdOf(draft);
  const amount = Number(Number(price).toFixed(2));
  const prevOffer = Array.isArray(draft.payload.attributes?.purchasable_offer)
    ? (draft.payload.attributes.purchasable_offer[0] as Record<string, unknown>)
    : {};

  const offer: Record<string, unknown> = {
    ...prevOffer,
    marketplace_id: marketplaceId,
    currency: "BRL",
    audience: "ALL",
  };

  if (amount > 0) {
    offer.our_price = [{ schedule: [{ value_with_tax: amount }] }];
    offer.list_price = [{ schedule: [{ value_with_tax: amount }] }];
  }

  const nextAttrs: Record<string, unknown> = {
    ...draft.payload.attributes,
    purchasable_offer: [offer],
  };

  if (amount > 0) {
    nextAttrs.list_price = [
      {
        currency: "BRL",
        marketplace_id: marketplaceId,
        value_with_tax: amount,
      },
    ];
  } else {
    delete nextAttrs.list_price;
    delete offer.list_price;
  }

  const next: N8nAmazonListingDraft = {
    ...draft,
    payload: {
      ...draft.payload,
      attributes: nextAttrs,
    },
  };
  const reasons = getAmazonPublishBlockReasons(next);
  return { ...next, _pronto_para_publicar: reasons.length === 0 };
}

export function getAmazonItemDimensions(draft: N8nAmazonListingDraft): AmazonItemDimensions | null {
  const depthRaw = draft.payload.attributes?.item_depth_width_height;
  if (Array.isArray(depthRaw) && depthRaw[0] && typeof depthRaw[0] === "object") {
    const first = depthRaw[0] as {
      depth?: { value?: number; unit?: string };
      width?: { value?: number; unit?: string };
      height?: { value?: number; unit?: string };
    };
    if (
      typeof first.depth?.value === "number" &&
      typeof first.width?.value === "number" &&
      typeof first.height?.value === "number"
    ) {
      return {
        length: first.depth.value,
        width: first.width.value,
        height: first.height.value,
        unit: first.depth.unit === "inches" ? "inches" : "centimeters",
      };
    }
  }

  const raw = draft.payload.attributes?.item_length_width_height;
  if (!Array.isArray(raw) || !raw[0] || typeof raw[0] !== "object") return null;
  const first = raw[0] as {
    length?: { value?: number; unit?: string };
    width?: { value?: number; unit?: string };
    height?: { value?: number; unit?: string };
  };
  if (
    typeof first.length?.value !== "number" ||
    typeof first.width?.value !== "number" ||
    typeof first.height?.value !== "number"
  ) {
    return null;
  }
  return {
    length: first.length.value,
    width: first.width.value,
    height: first.height.value,
    unit: first.length.unit === "inches" ? "inches" : "centimeters",
  };
}

export function updateAmazonItemDimensions(
  draft: N8nAmazonListingDraft,
  dims: AmazonItemDimensions,
): N8nAmazonListingDraft {
  const marketplaceId = marketplaceIdOf(draft);
  const useDepth = productTypeUsesDepthDimensions(draft.payload.productType || "");
  const unit = useDepth ? "centimeters" : dims.unit;
  const nextAttrs: Record<string, unknown> = {
    ...draft.payload.attributes,
  };
  if (useDepth) {
    nextAttrs.item_depth_width_height = [
      {
        depth: { value: dims.length, unit },
        width: { value: dims.width, unit },
        height: { value: dims.height, unit },
        marketplace_id: marketplaceId,
      },
    ];
    delete nextAttrs.item_length_width_height;
  } else {
    nextAttrs.item_length_width_height = [
      {
        length: { value: dims.length, unit: dims.unit },
        width: { value: dims.width, unit: dims.unit },
        height: { value: dims.height, unit: dims.unit },
        marketplace_id: marketplaceId,
      },
    ];
    delete nextAttrs.item_depth_width_height;
  }
  const next: N8nAmazonListingDraft = {
    ...draft,
    payload: {
      ...draft.payload,
      attributes: nextAttrs,
    },
  };
  const reasons = getAmazonPublishBlockReasons(next);
  return { ...next, _pronto_para_publicar: reasons.length === 0 };
}

export function normalizeAmazonCountryCode(raw: string): string {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "BR";
  if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase();
  const key = trimmed
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
  const map: Record<string, string> = {
    br: "BR",
    brasil: "BR",
    brazil: "BR",
    cn: "CN",
    china: "CN",
    us: "US",
    usa: "US",
    eua: "US",
  };
  return map[key] || trimmed.toUpperCase().slice(0, 2);
}

/** Heurística local para sugerir product type a partir do título. */
export function suggestAmazonProductType(title: string): string | null {
  const titleL = title.toLowerCase();
  if (/t[eê]nis|sapato|bota|chinelo|sand[aá]lia|sneaker|shoe/.test(titleL)) return "SHOES";
  if (/camis|camiseta|cal[cç]a|vestido|jaqueta|roupa|shorts|bermuda/.test(titleL)) return "SHIRT";
  if (
    /necessaire|cosmetic|maquiagem|toiletry|makeup|estojo|organizador de bolsa|organizador interno/.test(
      titleL,
    )
  ) {
    return "COSMETIC_CASE";
  }
  if (/mochila|backpack/.test(titleL)) return "BACKPACK";
  if (/\bmala\b|luggage|suitcase|bagagem/.test(titleL)) return "LUGGAGE";
  if (/duffel|academia|esportiva|weekender/.test(titleL)) return "DUFFEL_BAG";
  if (/bolsa|bag|carteira|wallet|pochete|shoulder bag/.test(titleL)) return "BAG";
  return null;
}

/**
 * Só product types cujo schema BR realmente tem `compartment` (descrição).
 * NÃO usar /BAG/ genérico — casa com BACKPACK e a Amazon ignora o atributo.
 */
export function productTypeNeedsCompartment(productType: string): boolean {
  const type = (productType || "").toUpperCase();
  return type === "DUFFEL_BAG" || type.includes("DUFFEL");
}

/**
 * BACKPACK (e DUFFEL) exigem `number_of_compartments` na Amazon BR.
 * Independente da descrição `compartment`.
 */
export function productTypeNeedsNumberOfCompartments(productType: string): boolean {
  const type = (productType || "").toUpperCase();
  return (
    type === "BACKPACK" ||
    type.endsWith("_BACKPACK") ||
    type === "DUFFEL_BAG" ||
    type.includes("DUFFEL")
  );
}

/** BACKPACK usa P×L×A (`item_depth_width_height`), não C×L×A. */
export function productTypeUsesDepthDimensions(productType: string): boolean {
  const type = (productType || "").toUpperCase();
  return type === "BACKPACK" || type.endsWith("_BACKPACK");
}

export function suggestAmazonCompartment(productType: string, title = ""): string {
  const type = (productType || "").toUpperCase();
  const titleL = title.toLowerCase();
  if (type.includes("COSMETIC") || /necessaire|maquiagem|cosmetic|estojo/.test(titleL)) {
    return "Compartimento principal para maquiagem e acessórios";
  }
  if (type.includes("BACKPACK") || /mochila/.test(titleL)) {
    return "Compartimento principal amplo";
  }
  if (type.includes("LUGGAGE") || /mala|bordo|bagagem/.test(titleL)) {
    return "Compartimento principal";
  }
  if (type.includes("DUFFEL") || /academia|viagem|duffel|esport/.test(titleL)) {
    return "Compartimento principal amplo";
  }
  return "Compartimento principal";
}

export function getAmazonBrowseNodeId(draft: N8nAmazonListingDraft): string {
  const raw = draft.payload.attributes?.recommended_browse_nodes;
  if (!Array.isArray(raw) || !raw[0]) return "";
  const value = (raw[0] as { value?: unknown }).value;
  return typeof value === "string" ? value.trim() : "";
}

export function updateAmazonBrowseNode(
  draft: N8nAmazonListingDraft,
  browseNodeId: string,
): N8nAmazonListingDraft {
  const marketplaceId = marketplaceIdOf(draft);
  const next: N8nAmazonListingDraft = {
    ...draft,
    payload: {
      ...draft.payload,
      attributes: { ...draft.payload.attributes },
    },
  };
  const id = browseNodeId.trim();
  if (!id) {
    delete next.payload.attributes.recommended_browse_nodes;
  } else {
    next.payload.attributes.recommended_browse_nodes = [
      { value: id, marketplace_id: marketplaceId },
    ];
  }
  const reasons = getAmazonPublishBlockReasons(next);
  return { ...next, _pronto_para_publicar: reasons.length === 0 };
}

export function getAmazonCompartment(draft: N8nAmazonListingDraft): string {
  const raw = draft.payload.attributes?.compartment;
  if (!Array.isArray(raw) || !raw[0] || typeof raw[0] !== "object") return "";
  const first = raw[0] as {
    description?: Array<{ value?: unknown }>;
    value?: unknown;
  };
  // Schema DUFFEL_BAG: compartment[].description[].value
  if (Array.isArray(first.description) && first.description[0]) {
    const v = first.description[0].value;
    return typeof v === "string" ? v.trim() : "";
  }
  // Legado (formato plano incorreto)
  if (typeof first.value === "string") return first.value.trim();
  return "";
}

export function updateAmazonCompartment(
  draft: N8nAmazonListingDraft,
  value: string,
): N8nAmazonListingDraft {
  const marketplaceId = marketplaceIdOf(draft);
  const next: N8nAmazonListingDraft = {
    ...draft,
    payload: {
      ...draft.payload,
      attributes: {
        ...draft.payload.attributes,
      },
    },
  };
  const trimmed = value.trim();
  if (!trimmed) {
    delete next.payload.attributes.compartment;
  } else {
    // Formato exigido pelo schema SP-API (DUFFEL_BAG):
    // [{ description: [{ language_tag, value }], marketplace_id }]
    next.payload.attributes.compartment = [
      {
        description: [
          {
            language_tag: "pt_BR",
            value: trimmed,
          },
        ],
        marketplace_id: marketplaceId,
      },
    ];
  }
  const reasons = getAmazonPublishBlockReasons(next);
  return { ...next, _pronto_para_publicar: reasons.length === 0 };
}

export function getAmazonNumberOfCompartments(draft: N8nAmazonListingDraft): number {
  const raw = draft.payload.attributes?.number_of_compartments;
  if (!Array.isArray(raw) || !raw[0]) return 0;
  const value = (raw[0] as { value?: unknown }).value;
  if (typeof value === "number" && value > 0) return Math.floor(value);
  if (typeof value === "string" && Number(value) > 0) return Math.floor(Number(value));
  return 0;
}

export function updateAmazonNumberOfCompartments(
  draft: N8nAmazonListingDraft,
  count: number,
): N8nAmazonListingDraft {
  const marketplaceId = marketplaceIdOf(draft);
  const next: N8nAmazonListingDraft = {
    ...draft,
    payload: {
      ...draft.payload,
      attributes: { ...draft.payload.attributes },
    },
  };
  const value =
    typeof count === "number" && Number.isFinite(count) && count > 0
      ? Math.floor(count)
      : 0;
  if (value <= 0) {
    delete next.payload.attributes.number_of_compartments;
  } else {
    next.payload.attributes.number_of_compartments = [
      { value, marketplace_id: marketplaceId },
    ];
  }
  const reasons = getAmazonPublishBlockReasons(next);
  return { ...next, _pronto_para_publicar: reasons.length === 0 };
}

export function getAmazonPublishBlockReasons(draft: N8nAmazonListingDraft): string[] {
  const reasons: string[] = [];
  if (!draft.payload.sellerSku?.trim()) reasons.push("Informe o Seller SKU.");
  if (!draft.payload.productType?.trim() || draft.payload.productType === "PRODUCT") {
    const suggested = suggestAmazonProductType(getAmazonAttrText(draft, "item_name"));
    reasons.push(
      suggested
        ? `Confirme o product type Amazon (sugestão: ${suggested}).`
        : "Confirme o product type Amazon (ex.: COSMETIC_CASE, BAG, SHOES).",
    );
  }
  if (!getAmazonAttrText(draft, "item_name").trim()) {
    reasons.push("Informe o título do produto.");
  }
  if (getAmazonPrice(draft) <= 0) reasons.push("Informe um preço válido.");
  if (getAmazonQuantity(draft) <= 0) {
    reasons.push("Informe estoque maior que zero (mínimo 1).");
  }
  if (getAmazonImageUrls(draft).length === 0) reasons.push("É necessário ao menos uma foto.");
  const invalidImage = getAmazonImageUrls(draft).find((url) => !isValidAmazonMediaUrl(url));
  if (invalidImage) {
    reasons.push(
      "As fotos precisam ser URLs públicas (https://). Remova imagens em base64 e envie novamente pelo upload.",
    );
  }

  if (!getAmazonAttrText(draft, "department").trim()) {
    reasons.push("Informe o department (ex.: beauty, handbags).");
  }
  if (
    productTypeNeedsCompartment(draft.payload.productType || "") &&
    !getAmazonCompartment(draft).trim()
  ) {
    reasons.push("Informe a descrição do compartimento (compartment).");
  }
  if (
    productTypeNeedsNumberOfCompartments(draft.payload.productType || "") &&
    getAmazonNumberOfCompartments(draft) <= 0
  ) {
    reasons.push("Informe o número de compartimentos (number_of_compartments).");
  }
  const country = getAmazonAttrText(draft, "country_of_origin").trim();
  if (!country) {
    reasons.push("Informe o country_of_origin (código ISO, ex.: BR).");
  } else if (country.length !== 2) {
    reasons.push(`country_of_origin inválido ("${country}"). Use código ISO (ex.: BR, CN).`);
  }
  if (!getAmazonAttrText(draft, "supplier_declared_dg_hz_regulation").trim()) {
    reasons.push("Informe a regulamentação de produto perigoso (ex.: not_applicable).");
  }
  const dims = getAmazonItemDimensions(draft);
  const productType = (draft.payload.productType || "").toUpperCase();
  const dimsOptional =
    productType.includes("SHOE") ||
    productType === "SHIRT" ||
    productType.includes("APPAREL") ||
    productType.includes("CLOTHING");
  if (
    !dimsOptional &&
    (!dims || dims.length <= 0 || dims.width <= 0 || dims.height <= 0)
  ) {
    const dimLabel = productTypeUsesDepthDimensions(draft.payload.productType || "")
      ? "P × L × A"
      : "C × L × A";
    reasons.push(`Informe as dimensões do item (${dimLabel}) com unidade.`);
  }
  const longBullet = getAmazonBulletPoints(draft).find((b) => b.length > AMAZON_BULLET_POINT_MAX);
  if (longBullet) {
    reasons.push(
      `Cada bullet point deve ter no máximo ${AMAZON_BULLET_POINT_MAX} caracteres.`,
    );
  }
  if (getAmazonListPrice(draft) <= 0) {
    reasons.push("Informe o list_price (preço sugerido com impostos).");
  }

  const brand = getAmazonAttrText(draft, "brand").trim();
  if (brand && /^(gen[eé]rico|generic|sem\s*marca|unbranded)$/i.test(brand)) {
    reasons.push(
      `Troque a marca "${brand}" pela marca da sua loja. A Amazon bloqueia marcas/ASINs genéricos.`,
    );
  }

  const sku = draft.payload.sellerSku?.trim() || "";
  if (/^B0[A-Z0-9]{8}$/i.test(sku)) {
    reasons.push("Seller SKU não pode ser um ASIN. Use um SKU próprio (ex.: IHUB-…).");
  }

  const modelName = getAmazonAttrText(draft, "model_name");
  if (modelName.length > AMAZON_MODEL_NAME_MAX) {
    reasons.push(`model_name deve ter no máximo ${AMAZON_MODEL_NAME_MAX} caracteres.`);
  }

  if (getAmazonGtin(draft)) {
    reasons.push("Remova o GTIN/EAN ou marque o produto como isento (este fluxo não envia código de barras).");
  }
  if (!hasAmazonGtinExemption(draft)) {
    reasons.push(
      'Marque "ID externa de produto" (produto sem GTIN/EAN) antes de publicar na Amazon.',
    );
  }
  if (Array.isArray(draft._bloqueios) && draft.payload.productType === "PRODUCT") {
    for (const b of draft._bloqueios) {
      if (typeof b === "string" && b.trim() && !reasons.includes(b.trim())) {
        reasons.push(b.trim());
      }
    }
  }
  return reasons;
}

export function isSupportedProductUrl(productUrl: string): boolean {
  try {
    const host = new URL(productUrl.trim()).hostname.toLowerCase();
    return (
      host.includes("amazon.") ||
      host === "amzn.to" ||
      host.includes("amzn.") ||
      host.includes("shopee.") ||
      host === "shope.ee"
    );
  } catch {
    return false;
  }
}

function upsertAttribute(
  attributes: N8nListingDraft["payload"]["attributes"],
  attributeId: string,
  value: { value_name?: string; value_id?: string | null },
) {
  const exists = attributes.some((attr) => attr.id === attributeId);
  if (!exists) {
    return [
      ...attributes,
      {
        id: attributeId,
        ...(value.value_name !== undefined ? { value_name: value.value_name } : {}),
        ...(value.value_id !== undefined ? { value_id: value.value_id } : {}),
      },
    ];
  }

  return attributes.map((attr) =>
    attr.id === attributeId
      ? {
          ...attr,
          ...(value.value_name !== undefined ? { value_name: value.value_name } : {}),
          ...(value.value_id !== undefined ? { value_id: value.value_id } : {}),
        }
      : attr,
  );
}

function upsertSaleTerm(
  saleTerms: N8nListingSaleTerm[] | undefined,
  termId: string,
  value: { value_name?: string; value_id?: string | null },
): N8nListingSaleTerm[] {
  const current = saleTerms ?? [];
  const exists = current.some((term) => term.id === termId);
  if (!exists) {
    return [
      ...current,
      {
        id: termId,
        ...(value.value_name !== undefined ? { value_name: value.value_name } : {}),
        ...(value.value_id !== undefined ? { value_id: value.value_id } : {}),
      },
    ];
  }

  return current.map((term) =>
    term.id === termId
      ? {
          ...term,
          ...(value.value_name !== undefined ? { value_name: value.value_name } : {}),
          ...(value.value_id !== undefined ? { value_id: value.value_id } : {}),
        }
      : term,
  );
}

function syncCampoValue(campo: IhubUiCampo, value: { value_name?: string; value_id?: string | null }): IhubUiCampo {
  const nextValor =
    value.value_name !== undefined
      ? value.value_name
      : value.value_id !== undefined
        ? value.value_id
        : campo.valor;

  return {
    ...campo,
    ...(value.value_name !== undefined ? { value_name: value.value_name } : {}),
    ...(value.value_id !== undefined ? { value_id: value.value_id } : {}),
    valor: nextValor,
  };
}

export function isCampoFilled(campo: IhubUiCampo, draft: N8nListingDraft): boolean {
  if (!campo?.id) return false;

  const row = campo as IhubUiCampo & {
    preenchido?: boolean;
    valor_atual?: unknown;
    sugestao?: string;
  };
  if (row.preenchido === true) return true;

  if (campo.destino_payload === "description") {
    return Boolean(draft._description?.trim());
  }

  if (campo.destino_payload === "shipping") {
    const shipping = draft.payload.shipping ?? {};
    const key = campo.id.includes(".") ? campo.id.split(".").pop()! : campo.id;
    const raw = shipping[key];
    if (typeof raw === "boolean") return true;
    if (raw == null) return false;
    return String(raw).trim().length > 0;
  }

  if (campo.destino_payload === "sale_terms") {
    const term = draft.payload.sale_terms?.find((item) => item.id === campo.id);
    return Boolean(term?.value_name?.trim() || term?.value_id);
  }

  // Default / attributes (also when destino_payload is missing from N8N)
  const attr = draft.payload.attributes.find((item) => item.id === campo.id);
  if (attr?.value_name?.trim() || attr?.value_id) return true;
  if (campo.value_name?.trim() || campo.value_id) return true;
  if (campo.valor != null && String(campo.valor).trim().length > 0) return true;
  if (row.valor_atual != null) {
    if (typeof row.valor_atual === "object") {
      const v = row.valor_atual as { value_name?: string; value_id?: string | null };
      if (v.value_name?.trim() || v.value_id) return true;
    } else if (String(row.valor_atual).trim()) {
      return true;
    }
  }
  if (row.sugestao?.trim()) return true;
  return false;
}

function refreshIhubUi(draft: N8nListingDraft, touchedFieldId?: string, touchedValue?: { value_name?: string; value_id?: string | null }): N8nListingDraft["_ihub_ui"] {
  if (!draft._ihub_ui) return draft._ihub_ui;

  const mapCampos = (campos: IhubUiCampo[] | undefined) =>
    (campos ?? []).map((campo) => {
      if (!touchedFieldId || !touchedValue) return campo;
      const matchesId = campo.id === touchedFieldId;
      const matchesDescription =
        touchedFieldId === "description" && campo.destino_payload === "description";
      return matchesId || matchesDescription ? syncCampoValue(campo, touchedValue) : campo;
    });

  const secoes = draft._ihub_ui.secoes?.map((secao) => {
    const campos = mapCampos(Array.isArray(secao.campos) ? secao.campos : undefined);
    const statusRaw = String(secao.status ?? "");
    if (statusRaw === "somente_leitura") {
      return { ...secao, campos };
    }
    const hasPendingRequired = campos.some(
      (campo) =>
        Boolean(campo?.obrigatorio) &&
        !campo?.somente_leitura &&
        Boolean(campo?.destino_payload) &&
        !isCampoFilled(campo, draft),
    );
    return {
      ...secao,
      campos,
      status: hasPendingRequired ? ("pendente" as const) : ("completo" as const),
    };
  });

  return {
    ...draft._ihub_ui,
    secoes,
    campos_editaveis: mapCampos(
      Array.isArray(draft._ihub_ui.campos_editaveis) ? draft._ihub_ui.campos_editaveis : undefined,
    ),
  };
}

export type MlValidationItem = {
  type?: string;
  code?: string;
  message?: string;
  cause_id?: number;
  department?: string;
  references?: string[];
  raw?: unknown;
};

/** N8N may send objects or stringified JSON / "Validation error" wrappers. */
export function normalizeMlValidationItems(
  items: N8nListingDraft["_erros_validacao_ml"] | undefined,
): MlValidationItem[] {
  if (!items?.length) return [];

  const out: MlValidationItem[] = [];
  for (const item of items) {
    const unknownItem: unknown = item;
    if (typeof unknownItem === "string") {
      const trimmed = unknownItem.trim();
      if (!trimmed || /^validation error$/i.test(trimmed)) continue;
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        if (parsed && typeof parsed === "object") {
          out.push({
            type: typeof parsed.type === "string" ? parsed.type : undefined,
            code: typeof parsed.code === "string" ? parsed.code : undefined,
            message: typeof parsed.message === "string" ? parsed.message : trimmed,
            cause_id: typeof parsed.cause_id === "number" ? parsed.cause_id : undefined,
            department: typeof parsed.department === "string" ? parsed.department : undefined,
            references: Array.isArray(parsed.references)
              ? parsed.references.filter((r): r is string => typeof r === "string")
              : undefined,
            raw: parsed,
          });
          continue;
        }
      } catch {
        /* plain string */
      }
      out.push({ type: "error", message: trimmed, raw: unknownItem });
      continue;
    }

    if (unknownItem && typeof unknownItem === "object") {
      const row = unknownItem as Record<string, unknown>;
      // Nested string payload: { message: "{...json...}" }
      if (typeof row.message === "string" && row.message.trim().startsWith("{")) {
        try {
          const nested = JSON.parse(row.message) as Record<string, unknown>;
          out.push({
            type:
              typeof nested.type === "string"
                ? nested.type
                : typeof row.type === "string"
                  ? row.type
                  : undefined,
            code: typeof nested.code === "string" ? nested.code : undefined,
            message: typeof nested.message === "string" ? nested.message : row.message,
            cause_id: typeof nested.cause_id === "number" ? nested.cause_id : undefined,
            department: typeof nested.department === "string" ? nested.department : undefined,
            references: Array.isArray(nested.references)
              ? nested.references.filter((r): r is string => typeof r === "string")
              : undefined,
            raw: nested,
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
        cause_id: typeof row.cause_id === "number" ? row.cause_id : undefined,
        department: typeof row.department === "string" ? row.department : undefined,
        references: Array.isArray(row.references)
          ? row.references.filter((r): r is string => typeof r === "string")
          : undefined,
        raw: unknownItem,
      });
    }
  }
  return out;
}

export function isBlockingMlValidation(item: MlValidationItem): boolean {
  const type = (item.type ?? "").toLowerCase();
  if (type === "warning" || type === "info") return false;
  if (type === "error") return true;
  // Unknown type: treat as blocking only if it looks like a hard validation failure
  if (item.code?.includes("invalid") || item.code?.includes("required")) return true;
  if (item.message && /preencha|obrigat|invalid|required/i.test(item.message)) return true;
  return type === "" && Boolean(item.message);
}

function isMlErrorResolvedByDraft(item: MlValidationItem, draft: N8nListingDraft): boolean {
  const blob = `${item.code ?? ""} ${item.message ?? ""} ${JSON.stringify(item.raw ?? {})}`;
  if (/UNITS_PER_PACK|unidades por kit|invalid_sale_units/i.test(blob)) {
    const units = draft.payload.attributes.find((a) => a.id === "UNITS_PER_PACK");
    return Boolean(units?.value_name?.trim() || units?.value_id);
  }

  // "The attributes [GENDER] are required..." — resolved when all cited attrs are filled
  const requiredIds = extractAttributeIdsFromMlText(blob);
  if (requiredIds.length > 0 && /are required|são obrigat|is required/i.test(blob)) {
    return requiredIds.every((id) => {
      const attr = draft.payload.attributes.find((a) => a.id === id);
      return Boolean(attr?.value_name?.trim() || attr?.value_id);
    });
  }

  return false;
}

/** Extrai IDs de atributos citados pelo ML: Attribute [X] / attributes [X, Y] */
export function extractAttributeIdsFromMlText(text: string): string[] {
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

export function getBlockingMlValidationErrors(
  draft: N8nListingDraft,
): MlValidationItem[] {
  return normalizeMlValidationItems(draft._erros_validacao_ml).filter(
    (item) => isBlockingMlValidation(item) && !isMlErrorResolvedByDraft(item, draft),
  );
}

export function getMlValidationWarnings(draft: N8nListingDraft): MlValidationItem[] {
  return normalizeMlValidationItems(draft._erros_validacao_ml).filter(
    (item) => !isBlockingMlValidation(item),
  );
}

export function formatMlValidationMessage(item: MlValidationItem): string {
  return item.message?.trim() || item.code || "Erro de validação do Mercado Livre";
}

/** Attribute IDs mentioned in blocking ML errors (e.g. GENDER, UNITS_PER_PACK). */
export function getRequiredAttributeIdsFromMlErrors(draft: N8nListingDraft): string[] {
  const ids = new Set<string>();
  for (const err of getBlockingMlValidationErrors(draft)) {
    const blob = `${err.code ?? ""} ${err.message ?? ""} ${JSON.stringify(err.raw ?? {})}`;
    if (/ignored because it is not modifiable/i.test(blob)) continue;

    if (/UNITS_PER_PACK|unidades por kit|invalid_sale_units/i.test(blob)) {
      ids.add("UNITS_PER_PACK");
    }
    for (const id of extractAttributeIdsFromMlText(blob)) {
      ids.add(id);
    }
  }

  return [...ids];
}

export function revalidateDraftReadiness(draft: N8nListingDraft): N8nListingDraft {
  const withUi = draft._ihub_ui
    ? { ...draft, _ihub_ui: refreshIhubUi(draft) }
    : draft;

  const blockingUi = hasBlockingPendingIhubUi(withUi);
  const blockingMl = getBlockingMlValidationErrors(withUi).length > 0;
  return {
    ...withUi,
    _pronto_para_publicar: !blockingUi && !blockingMl,
  };
}

export function updateDraftPayload(
  draft: N8nListingDraft,
  patch: Partial<N8nListingDraft["payload"]>,
): N8nListingDraft {
  return revalidateDraftReadiness({
    ...draft,
    payload: {
      ...draft.payload,
      ...patch,
    },
  });
}

export function updateDraftDescription(draft: N8nListingDraft, description: string): N8nListingDraft {
  const next = { ...draft, _description: description };
  return revalidateDraftReadiness({
    ...next,
    _ihub_ui: refreshIhubUi(next, "description", { value_name: description }),
  });
}

export function removeDraftPicture(draft: N8nListingDraft, index: number): N8nListingDraft {
  return updateDraftPayload(draft, {
    pictures: draft.payload.pictures.filter((_, i) => i !== index),
  });
}

export function updateDraftAttributeValue(
  draft: N8nListingDraft,
  attributeId: string,
  value: { value_name?: string; value_id?: string },
): N8nListingDraft {
  const attributes = upsertAttribute(draft.payload.attributes, attributeId, value);

  const syncReviewList = (items: N8nListingDraft["_attributes_ficticios"]) =>
    items?.map((item) =>
      item.id === attributeId
        ? {
            ...item,
            valor: {
              ...item.valor,
              ...(value.value_name !== undefined ? { value_name: value.value_name } : {}),
              ...(value.value_id !== undefined ? { value_id: value.value_id } : {}),
            },
          }
        : item,
    );

  const next: N8nListingDraft = {
    ...draft,
    payload: { ...draft.payload, attributes },
    _attributes_ficticios: syncReviewList(draft._attributes_ficticios),
    _attributes_preenchidos_inteligente: syncReviewList(draft._attributes_preenchidos_inteligente),
  };

  return revalidateDraftReadiness({
    ...next,
    _ihub_ui: refreshIhubUi(next, attributeId, value),
  });
}

export function updateDraftSaleTerm(
  draft: N8nListingDraft,
  termId: string,
  value: { value_name?: string; value_id?: string | null },
): N8nListingDraft {
  const next: N8nListingDraft = {
    ...draft,
    payload: {
      ...draft.payload,
      sale_terms: upsertSaleTerm(draft.payload.sale_terms, termId, value),
    },
  };
  return revalidateDraftReadiness({
    ...next,
    _ihub_ui: refreshIhubUi(next, termId, value),
  });
}

export function updateDraftIhubUiCampo(
  draft: N8nListingDraft,
  campo: IhubUiCampo,
  value: { value_name?: string; value_id?: string | null },
): N8nListingDraft {
  // Campos sugeridos como somente_leitura pelo N8N ainda podem ser editados no iHub.
  if (campo.destino_payload === "description") {
    return updateDraftDescription(draft, value.value_name ?? "");
  }

  if (campo.destino_payload === "shipping") {
    const shippingValue =
      campo.tipo === "boolean"
        ? value.value_name === "true" || value.value_id === "true"
        : campo.tipo === "number"
          ? Number(value.value_name)
          : (value.value_name ?? value.value_id ?? "");

    const next: N8nListingDraft = {
      ...draft,
      payload: {
        ...draft.payload,
        shipping: {
          ...(draft.payload.shipping ?? {}),
          [campo.id]: shippingValue,
        },
      },
    };
    return revalidateDraftReadiness({
      ...next,
      _ihub_ui: refreshIhubUi(next, campo.id, value),
    });
  }

  if (campo.destino_payload === "sale_terms") {
    return updateDraftSaleTerm(draft, campo.id, value);
  }

  return updateDraftAttributeValue(draft, campo.id, {
    ...(value.value_name !== undefined ? { value_name: value.value_name } : {}),
    ...(value.value_id !== undefined && value.value_id !== null ? { value_id: value.value_id } : {}),
  });
}

export function getIhubUiSecoes(draft: N8nListingDraft): IhubUiSecao[] {
  return draft._ihub_ui?.secoes ?? [];
}

export function getPendingRequiredIhubUiCampos(draft: N8nListingDraft): IhubUiCampo[] {
  const hidden = new Set([
    "HAZMAT_TRANSPORTABILITY",
    "EXCLUDED_PLATFORMS",
    "IS_FLAMMABLE",
    "WITH_POSITIVE_IMPACT",
    "HAS_COMPATIBILITIES",
    "IS_NEW_OFFER",
    "IS_SUITABLE_FOR_SHIPMENT",
    "WITH_EXPIRATION_DATE",
    "EXPIRATION_DATE",
    "ITEM_CONDITION",
  ]);

  return getIhubUiSecoes(draft).flatMap((secao) => {
    // N8N pode enviar "ok" / "completo" / "pendente" / "somente_leitura"
    const status = String(secao.status || "");
    if (status !== "pendente") return [];
    return (secao.campos ?? []).filter(
      (campo) =>
        campo.obrigatorio &&
        !hidden.has(campo.id) &&
        !isCampoFilled(campo, draft),
    );
  });
}

export function hasBlockingPendingIhubUi(draft: N8nListingDraft): boolean {
  return getPendingRequiredIhubUiCampos(draft).length > 0;
}

/** Motivos que impedem publicar — usados no botão e no alerta. */
export function getPublishBlockReasons(draft: ListingPrepareDraft): string[] {
  if (isAmazonListingDraft(draft)) {
    return getAmazonPublishBlockReasons(draft);
  }

  const reasons: string[] = [];
  const familyName = (draft.payload.family_name || (draft.payload as { title?: string }).title || "").trim();
  if (!familyName) reasons.push("Informe o nome da família / título do produto.");
  if (!draft.payload.pictures.length) reasons.push("Adicione ao menos uma foto.");
  if ((draft.payload.price ?? 0) <= 0) reasons.push("Informe um preço válido.");
  if (draft.payload.available_quantity < 0) reasons.push("Informe o estoque.");

  const blockingMl = getBlockingMlValidationErrors(draft);
  for (const err of blockingMl.slice(0, 3)) {
    reasons.push(formatMlValidationMessage(err));
  }

  const missingRequired = getRequiredAttributeIdsFromMlErrors(draft).filter((id) => {
    const current = draft.payload.attributes.find((a) => a.id === id);
    return !(current?.value_name?.trim() || current?.value_id);
  });
  for (const id of missingRequired) {
    const label = ATTR_LABELS[id] ?? id;
    reasons.push(`Preencha o campo obrigatório: ${label}.`);
  }

  const sku = draft.payload.attributes.find((a) => a.id === "SELLER_SKU");
  if (!(sku?.value_name?.trim() || sku?.value_id)) {
    reasons.push("Informe o SKU.");
  }

  const warrantyType = draft.payload.sale_terms?.find((t) => t.id === "WARRANTY_TYPE");
  if (!(warrantyType?.value_name?.trim() || warrantyType?.value_id)) {
    reasons.push("Selecione o tipo de garantia.");
  } else {
    const isNoWarranty =
      warrantyType.value_id === "6150835" ||
      /sem garantia/i.test(warrantyType.value_name || "");
    if (!isNoWarranty) {
      const warrantyTime = draft.payload.sale_terms?.find((t) => t.id === "WARRANTY_TIME");
      if (!(warrantyTime?.value_name?.trim() || warrantyTime?.value_id)) {
        reasons.push("Informe o tempo de garantia (ex.: 3 meses).");
      }
    }
  }

  return reasons;
}

export function canPublishDraft(draft: ListingPrepareDraft): boolean {
  return getPublishBlockReasons(draft).length === 0;
}

export function getCampoDisplayValue(campo: IhubUiCampo, draft: N8nListingDraft): string {
  if (campo.destino_payload === "description") {
    return draft._description ?? "";
  }

  if (campo.destino_payload === "shipping") {
    const raw = draft.payload.shipping?.[campo.id];
    if (typeof raw === "boolean") return raw ? "true" : "false";
    if (raw == null) return campo.value_name ?? (campo.valor == null ? "" : String(campo.valor));
    return String(raw);
  }

  if (campo.destino_payload === "sale_terms") {
    const term = draft.payload.sale_terms?.find((item) => item.id === campo.id);
    return (
      term?.value_name ??
      term?.value_id ??
      campo.value_name ??
      (campo.valor == null ? "" : String(campo.valor))
    );
  }

  const attr = draft.payload.attributes.find((item) => item.id === campo.id);
  return (
    attr?.value_name ??
    attr?.value_id ??
    campo.value_name ??
    (campo.valor == null ? "" : String(campo.valor))
  );
}
