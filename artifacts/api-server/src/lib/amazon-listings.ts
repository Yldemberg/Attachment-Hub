import { getDb } from "./db";
import { accountsTable, productsTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import {
  amazon,
  extractListingPrice,
  extractListingQuantity,
  extractListingSummary,
  formatAmazonListingsIssues,
  getAmazonRecommendedBrowseNodes,
  getCatalogProductTypeForAsin,
  getListingsItem,
  listingsItemPath,
  resolveAmazonSellerId,
  suggestAmazonBrowseNode,
  type AmazonListingsItem,
  type AmazonListingsIssue,
  type AmazonListingsSubmissionResponse,
} from "./amazon";
import { logger } from "./logger";
import { isValidAmazonMediaUrl } from "./listing-images";

export class AmazonListingError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "BAD_REQUEST"
      | "NOT_FOUND"
      | "AMAZON_API_ERROR"
      | "VALIDATION_ERROR" = "AMAZON_API_ERROR",
  ) {
    super(message);
    this.name = "AmazonListingError";
  }
}

/** Estoque mínimo para a oferta ficar ativa (0 gera "Oferta não encontrada"). */
export const AMAZON_MIN_QUANTITY = 1;

export function ensurePositiveAmazonQuantity(qty: unknown): number {
  if (typeof qty === "number" && Number.isFinite(qty) && qty > 0) {
    return Math.floor(qty);
  }
  if (typeof qty === "string" && qty.trim() && Number.isFinite(Number(qty))) {
    const n = Number(qty);
    if (n > 0) return Math.floor(n);
  }
  return AMAZON_MIN_QUANTITY;
}

function setFulfillmentQuantity(attrs: Record<string, unknown>, quantity: unknown): void {
  const qty = ensurePositiveAmazonQuantity(quantity);
  const existing = attrs.fulfillment_availability;
  if (Array.isArray(existing) && existing[0] && typeof existing[0] === "object") {
    attrs.fulfillment_availability = [
      {
        ...(existing[0] as object),
        fulfillment_channel_code:
          (existing[0] as { fulfillment_channel_code?: string }).fulfillment_channel_code ||
          "DEFAULT",
        quantity: qty,
      },
    ];
    return;
  }
  attrs.fulfillment_availability = [
    { fulfillment_channel_code: "DEFAULT", quantity: qty },
  ];
}

export type CreateAmazonListingInput = {
  sellerSku: string;
  productType: string;
  title: string;
  price: number;
  availableQuantity: number;
  condition?: string;
  externalProductId?: string;
  externalProductIdType?: string;
  imageUrls?: string[];
  brand?: string;
  description?: string;
  /** ASIN de referência (scrape). Só vincula ao catálogo se matchCatalogAsin=true. */
  asin?: string | null;
  /**
   * Se true, tenta oferta no ASIN existente (LISTING_OFFER_ONLY / merchant_suggested_asin).
   * Default false: cria produto/ASIN novo — necessário quando o ASIN fonte é genérico/restrito.
   */
  matchCatalogAsin?: boolean;
  /** LISTING | LISTING_OFFER_ONLY — se omitido, usa OFFER só quando matchCatalogAsin+asin. */
  requirements?: string;
  /** Extra SP-API attributes merged into the payload */
  attributes?: Record<string, unknown>;
  /** Atributos chave/valor do scrape Amazon — usados para mapear e preencher faltantes. */
  scrapedAttributes?: Array<{ key: string; value: string }>;
};

function normalizeAmazonScrapeKey(str: string): string {
  return String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Mapeamento scrape PT/EN → atributo SP-API de texto simples.
 * Expandido para cobrir categorias diversas sem hardcode por product type.
 */
const SCRAPE_KEY_TO_SPAPI_ATTR: Record<string, string> = {
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
  "age range description": "age_range_description",
  "descricao da faixa etaria": "age_range_description",
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
  assunto: "subject_character",
};

const ATTRS_NEVER_AUTO_FILL = new Set([
  "brand",
  "item_name",
  "purchasable_offer",
  "list_price",
  "fulfillment_availability",
  "main_product_image_locator",
  "merchant_suggested_asin",
  "externally_assigned_product_identifier",
  "recommended_browse_nodes",
]);

function scrapedAttributeMap(
  scraped: Array<{ key: string; value: string }> | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of scraped || []) {
    const key = normalizeAmazonScrapeKey(item.key);
    const value = String(item.value ?? "").trim();
    if (key && value) map.set(key, value);
  }
  return map;
}

function scrapedTextsFromAttributes(
  scraped: Array<{ key: string; value: string }> | undefined,
): string[] {
  const out: string[] = [];
  for (const item of scraped || []) {
    const key = String(item.key || "").trim();
    const value = String(item.value ?? "").trim();
    if (!value) continue;
    if (key) out.push(`${key}: ${value}`);
    out.push(value);
  }
  return out;
}

function findScrapedValue(
  scrapeMap: Map<string, string>,
  ...keys: string[]
): string {
  for (const key of keys) {
    const hit = scrapeMap.get(normalizeAmazonScrapeKey(key));
    if (hit) return hit;
  }
  for (const [k, v] of scrapeMap) {
    if (keys.some((want) => k.includes(normalizeAmazonScrapeKey(want)))) return v;
  }
  return "";
}

/** Espelha scrape → attributes SP-API sem sobrescrever o que o usuário já preencheu. */
export function applyScrapedAttributesToListingAttrs(
  attrs: Record<string, unknown>,
  scraped: Array<{ key: string; value: string }> | undefined,
  marketplaceId: string,
): Record<string, unknown> {
  const next = { ...attrs };
  const scrapeMap = scrapedAttributeMap(scraped);

  for (const [scrapeKey, spKey] of Object.entries(SCRAPE_KEY_TO_SPAPI_ATTR)) {
    if (next[spKey]) continue;
    const value = scrapeMap.get(scrapeKey);
    if (!value) continue;
    if (
      spKey === "brand" &&
      /^(gen[eé]rico|generic|sem\s*marca|unbranded)$/i.test(value)
    ) {
      continue;
    }
    if (spKey === "country_of_origin") {
      next[spKey] = attrLocaleValue(normalizeAmazonCountryOfOrigin(value), marketplaceId);
    } else if (spKey === "target_gender") {
      const g = value.toLowerCase();
      const mapped = /feminin|woman|women|girl/.test(g)
        ? "female"
        : /masculin|man|men|boy/.test(g)
          ? "male"
          : "unisex";
      next[spKey] = attrLocaleValue(mapped, marketplaceId);
    } else if (spKey === "water_resistance_level") {
      const w = value.toLowerCase();
      const mapped = /a prova|waterproof|imperme/.test(w)
        ? "waterproof"
        : /repel|resist/.test(w)
          ? "water_repellent"
          : "water_resistant";
      next[spKey] = attrLocaleValue(mapped, marketplaceId);
    } else {
      next[spKey] = attrLocalizedText(value.slice(0, 500), marketplaceId);
    }
  }

  // number_of_compartments a partir do scrape (quando ainda ausente)
  if (!next.number_of_compartments) {
    const count = extractNumberOfCompartmentsFromTexts(scrapedTextsFromAttributes(scraped));
    if (count > 0) {
      next.number_of_compartments = attrLocaleValue(count, marketplaceId);
    }
  }

  // unit_count / number_of_items
  if (!next.unit_count) {
    const unitRaw = findScrapedValue(
      scrapeMap,
      "quantidade de itens",
      "quantidade de unidades",
      "unit count",
      "number of items",
    );
    const n = unitRaw ? Number(String(unitRaw).replace(",", ".").match(/[\d.]+/)?.[0]) : NaN;
    if (Number.isFinite(n) && n > 0) {
      next.unit_count = [
        { value: Math.floor(n), type: { value: "unit", marketplace_id: marketplaceId }, marketplace_id: marketplaceId },
      ];
    }
  }

  // outer.material
  if (!extractNestedAttrValue(next.outer, "material")) {
    const outer = findScrapedValue(scrapeMap, "material externo", "outer material", "material");
    if (outer) next.outer = attrOuterMaterial(outer.split(",")[0]!.trim(), marketplaceId);
  }

  // closure.type
  if (!extractNestedAttrValue(next.closure, "type")) {
    const closure = findScrapedValue(scrapeMap, "tipo de fechamento", "closure", "closure type");
    if (closure) next.closure = attrClosureType(closure, marketplaceId);
  }

  // storage_volume
  const hasVolume =
    Array.isArray(next.storage_volume) &&
    next.storage_volume[0] &&
    typeof (next.storage_volume[0] as { value?: unknown }).value === "number";
  if (!hasVolume) {
    const liters = parseStorageVolumeLiters(scrapedTextsFromAttributes(scraped));
    if (liters) {
      next.storage_volume = [{ value: liters, unit: "liters", marketplace_id: marketplaceId }];
    }
  }

  return next;
}

function hasAttributeValue(attrs: Record<string, unknown>, key: string): boolean {
  const raw = attrs[key];
  if (raw == null) return false;
  if (!Array.isArray(raw) || !raw[0]) return false;
  const first = raw[0] as Record<string, unknown>;
  if (typeof first.value === "string") return first.value.trim().length > 0;
  if (typeof first.value === "number") return Number.isFinite(first.value);
  if (typeof first.value === "boolean") return true;
  // nested shapes (closure, outer, compartment, unit_count…)
  return Object.keys(first).some((k) => k !== "marketplace_id" && first[k] != null);
}

function collectMissingAttributeNames(
  issues: AmazonListingsIssue[] | undefined,
): string[] {
  const names = new Set<string>();
  for (const issue of issues || []) {
    const sev = (issue.severity || "ERROR").toUpperCase();
    if (sev !== "ERROR") continue;
    const categories = (issue.categories || []).map((c) => c.toUpperCase());
    const blob = `${issue.code || ""} ${issue.message || ""}`;
    const isMissing =
      categories.includes("MISSING_ATTRIBUTE") ||
      /90220|MISSING_ATTRIBUTE|obrigat[oó]rio|is required|n[aã]o foi inserido|not (provided|supplied)/i.test(
        blob,
      );
    if (!isMissing) continue;
    for (const name of issue.attributeNames || []) {
      if (name?.trim()) names.add(name.trim());
    }
  }
  return [...names];
}

/**
 * Preenche atributo faltante com scrape/heurística segura.
 * Retorna true se preencheu algo novo.
 */
export function fillMissingAmazonAttribute(
  attrs: Record<string, unknown>,
  attrName: string,
  ctx: {
    marketplaceId: string;
    productType: string;
    title: string;
    brand?: string;
    scrapedAttributes?: Array<{ key: string; value: string }>;
  },
): boolean {
  if (ATTRS_NEVER_AUTO_FILL.has(attrName)) return false;
  if (hasAttributeValue(attrs, attrName)) return false;
  if (/^other_product_image_locator_/.test(attrName)) return false;

  const marketplaceId = ctx.marketplaceId;
  const scrapeMap = scrapedAttributeMap(ctx.scrapedAttributes);
  const scrapeTexts = scrapedTextsFromAttributes(ctx.scrapedAttributes);

  switch (attrName) {
    case "number_of_compartments": {
      const count = extractNumberOfCompartmentsFromTexts([...scrapeTexts, ctx.title]) || 1;
      attrs[attrName] = attrLocaleValue(count, marketplaceId);
      return true;
    }
    case "compartment": {
      if (!productTypeNeedsCompartment(ctx.productType)) return false;
      attrs[attrName] = attrCompartmentDescription(
        suggestAmazonCompartment(ctx.productType, ctx.title),
        marketplaceId,
      );
      return true;
    }
    case "country_of_origin": {
      const fromScrape = findScrapedValue(scrapeMap, "pais de origem", "country of origin");
      attrs[attrName] = attrLocaleValue(
        normalizeAmazonCountryOfOrigin(fromScrape || "BR"),
        marketplaceId,
      );
      return true;
    }
    case "supplier_declared_dg_hz_regulation":
      attrs[attrName] = attrLocaleValue("not_applicable", marketplaceId);
      return true;
    case "department":
      attrs[attrName] = attrLocaleValue(
        suggestAmazonDepartment(ctx.productType, ctx.title),
        marketplaceId,
      );
      return true;
    case "supplier_declared_has_product_identifier_exemption":
      applyGtinExemptionToAttributes(attrs, marketplaceId);
      return true;
    case "color": {
      const v = findScrapedValue(scrapeMap, "cor", "color", "colour") || "Multicolorido";
      attrs[attrName] = attrLocalizedText(v, marketplaceId);
      return true;
    }
    case "size": {
      const v = findScrapedValue(scrapeMap, "tamanho", "size") || "Único";
      attrs[attrName] = attrLocalizedText(v, marketplaceId);
      return true;
    }
    case "material": {
      const v = findScrapedValue(scrapeMap, "material", "tipo de material") || "Nylon";
      attrs[attrName] = attrLocalizedText(v.split(",")[0]!.trim(), marketplaceId);
      return true;
    }
    case "style": {
      const v = findScrapedValue(scrapeMap, "estilo", "style") || "Casual";
      attrs[attrName] = attrLocalizedText(v, marketplaceId);
      return true;
    }
    case "pattern": {
      const v = findScrapedValue(scrapeMap, "padrao", "pattern", "estampa") || "Liso";
      attrs[attrName] = attrLocalizedText(v, marketplaceId);
      return true;
    }
    case "model_name": {
      const v =
        findScrapedValue(scrapeMap, "nome do modelo", "modelo", "model name", "model") ||
        ctx.title.slice(0, 40);
      attrs[attrName] = attrLocalizedText(v.slice(0, 120), marketplaceId);
      return true;
    }
    case "model_number": {
      const v =
        findScrapedValue(scrapeMap, "numero do modelo", "model number", "numero da peca") ||
        "1";
      attrs[attrName] = attrLocalizedText(v.slice(0, 40), marketplaceId);
      return true;
    }
    case "manufacturer": {
      const v =
        findScrapedValue(scrapeMap, "fabricante", "manufacturer") ||
        ctx.brand ||
        "Importado";
      attrs[attrName] = attrLocalizedText(v, marketplaceId);
      return true;
    }
    case "target_gender":
      attrs[attrName] = attrLocaleValue("unisex", marketplaceId);
      return true;
    case "age_range_description": {
      const v =
        findScrapedValue(scrapeMap, "faixa etaria", "age range", "descricao da faixa etaria") ||
        "Adulto";
      attrs[attrName] = attrLocalizedText(v, marketplaceId);
      return true;
    }
    case "strap_type": {
      const v =
        findScrapedValue(scrapeMap, "tipo de alca", "strap type") ||
        (ctx.productType.toUpperCase().includes("BACKPACK") ? "Alças traseiras" : "Ajustável");
      attrs[attrName] = attrLocalizedText(v, marketplaceId);
      return true;
    }
    case "closure": {
      const v = findScrapedValue(scrapeMap, "tipo de fechamento", "closure") || "Zíper";
      attrs[attrName] = attrClosureType(v, marketplaceId);
      return true;
    }
    case "outer": {
      const v =
        findScrapedValue(scrapeMap, "material externo", "outer material", "material") || "Nylon";
      attrs[attrName] = attrOuterMaterial(v.split(",")[0]!.trim(), marketplaceId);
      return true;
    }
    case "lining_description": {
      const v =
        findScrapedValue(scrapeMap, "descricao do forro", "lining") || "Poliéster";
      attrs[attrName] = attrLocalizedText(v, marketplaceId);
      return true;
    }
    case "water_resistance_level":
      attrs[attrName] = attrLocaleValue("water_repellent", marketplaceId);
      return true;
    case "storage_volume": {
      const liters = parseStorageVolumeLiters([...scrapeTexts, ctx.title]) || 20;
      attrs[attrName] = [{ value: liters, unit: "liters", marketplace_id: marketplaceId }];
      return true;
    }
    case "unit_count":
      attrs[attrName] = [
        {
          value: 1,
          type: { value: "unit", marketplace_id: marketplaceId },
          marketplace_id: marketplaceId,
        },
      ];
      return true;
    case "number_of_items":
      attrs[attrName] = attrLocaleValue(1, marketplaceId);
      return true;
    case "care_instructions": {
      const v =
        findScrapedValue(scrapeMap, "instrucoes de cuidados", "care instructions") ||
        "Limpar com pano úmido";
      attrs[attrName] = attrLocalizedText(v, marketplaceId);
      return true;
    }
    case "included_components":
      attrs[attrName] = attrLocalizedText("1 produto", marketplaceId);
      return true;
    case "item_length_width_height":
    case "item_depth_width_height": {
      const dims = extractDimensionTriple(attrs, [...scrapeTexts, ctx.title]);
      if (!dims) return false;
      if (productTypeUsesDepthDimensions(ctx.productType) || attrName === "item_depth_width_height") {
        attrs.item_depth_width_height = [
          {
            depth: { value: dims.a, unit: "centimeters" },
            width: { value: dims.b, unit: "centimeters" },
            height: { value: dims.c, unit: "centimeters" },
            marketplace_id: marketplaceId,
          },
        ];
        delete attrs.item_length_width_height;
      } else {
        attrs.item_length_width_height = [
          {
            length: { value: dims.a, unit: dims.unit },
            width: { value: dims.b, unit: dims.unit },
            height: { value: dims.c, unit: dims.unit },
            marketplace_id: marketplaceId,
          },
        ];
        delete attrs.item_depth_width_height;
      }
      return true;
    }
    default: {
      // Tentativa genérica: se o scrape tem chave homônima, usa texto localizado
      const fromScrape = findScrapedValue(scrapeMap, attrName.replace(/_/g, " "), attrName);
      if (fromScrape) {
        attrs[attrName] = attrLocalizedText(fromScrape.slice(0, 500), marketplaceId);
        return true;
      }
      return false;
    }
  }
}

function fillMissingAttributesFromIssues(
  attrs: Record<string, unknown>,
  issues: AmazonListingsIssue[] | undefined,
  ctx: {
    marketplaceId: string;
    productType: string;
    title: string;
    brand?: string;
    scrapedAttributes?: Array<{ key: string; value: string }>;
  },
): string[] {
  const filled: string[] = [];
  for (const name of collectMissingAttributeNames(issues)) {
    if (fillMissingAmazonAttribute(attrs, name, ctx)) filled.push(name);
  }
  return filled;
}

function submissionIsRetryableInvalid(
  response: AmazonListingsSubmissionResponse | undefined,
): boolean {
  const status = response?.status?.toUpperCase();
  if (status !== "INVALID" && status) return false;
  return collectMissingAttributeNames(response?.issues).length > 0;
}

function attrLocaleValue(value: string | number | boolean, marketplaceId: string) {
  return [{ value, marketplace_id: marketplaceId }];
}

function attrLocalizedText(value: string | number, marketplaceId: string) {
  return [
    {
      value,
      language_tag: "pt_BR",
      marketplace_id: marketplaceId,
    },
  ];
}

/** Atributo SP-API: "Este produto não tem uma ID do produto" na Seller Central. */
function gtinExemptionAttribute(marketplaceId: string) {
  return [{ value: true, marketplace_id: marketplaceId }];
}

function applyGtinExemptionToAttributes(
  attrs: Record<string, unknown>,
  marketplaceId: string,
): void {
  delete attrs.externally_assigned_product_identifier;
  attrs.supplier_declared_has_product_identifier_exemption =
    gtinExemptionAttribute(marketplaceId);
}

function readGtinExemptionFromAttributes(
  attributes: Record<string, unknown> | undefined,
  marketplaceId: string,
): boolean {
  const raw = attributes?.supplier_declared_has_product_identifier_exemption;
  if (!Array.isArray(raw) || !raw[0]) return false;
  const entry = raw[0] as { value?: unknown; marketplace_id?: string };
  if (entry.marketplace_id && entry.marketplace_id !== marketplaceId) return false;
  const value = entry.value;
  return value === true || value === 1 || value === "true" || value === "1";
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function patchGtinExemptionOnListing(input: {
  accountId: string;
  sellerId: string;
  sellerSku: string;
  marketplaceId: string;
  productType: string;
  removeExternalProductId: boolean;
}): Promise<AmazonListingsSubmissionResponse | undefined> {
  const patches: Array<{ op: "add" | "delete"; path: string; value?: unknown }> = [
    {
      op: "add",
      path: "/attributes/supplier_declared_has_product_identifier_exemption",
      value: gtinExemptionAttribute(input.marketplaceId),
    },
  ];
  if (input.removeExternalProductId) {
    patches.push({
      op: "delete",
      path: "/attributes/externally_assigned_product_identifier",
    });
  }

  return amazon.patch<AmazonListingsSubmissionResponse>(
    input.accountId,
    listingsItemPath(input.sellerId, input.sellerSku, input.marketplaceId),
    {
      productType: input.productType,
      patches,
    },
  );
}

/**
 * A Seller Central nem sempre persiste a isenção só no putListingsItem inicial.
 * Verifica o listing e reaplica patch até a Amazon gravar o checkbox.
 */
async function ensureGtinExemptionPersistedOnListing(input: {
  accountId: string;
  sellerId: string;
  sellerSku: string;
  marketplaceId: string;
  productType: string;
}): Promise<void> {
  const retryDelaysMs = [0, 2000, 5000, 8000];
  let lastPatch: AmazonListingsSubmissionResponse | undefined;

  for (let attempt = 0; attempt < retryDelaysMs.length; attempt++) {
    if (retryDelaysMs[attempt]! > 0) {
      await sleepMs(retryDelaysMs[attempt]!);
    }

    let item: AmazonListingsItem | null = null;
    try {
      item = await getListingsItem(
        input.accountId,
        input.sellerId,
        input.sellerSku,
        input.marketplaceId,
      );
    } catch (err) {
      logger.debug(
        {
          sellerSku: input.sellerSku,
          attempt,
          err: err instanceof Error ? err.message : String(err),
        },
        "getListingsItem before GTIN exemption patch",
      );
    }

    const hasExemption = readGtinExemptionFromAttributes(item?.attributes, input.marketplaceId);
    const hasExternalId = Array.isArray(item?.attributes?.externally_assigned_product_identifier);
    if (hasExemption && !hasExternalId) {
      logger.info(
        { sellerSku: input.sellerSku, attempt },
        "Amazon GTIN exemption confirmed on listing",
      );
      return;
    }

    try {
      lastPatch = await patchGtinExemptionOnListing({
        ...input,
        removeExternalProductId: hasExternalId,
      });
      logger.info(
        {
          sellerSku: input.sellerSku,
          attempt,
          status: lastPatch?.status,
          issues: lastPatch?.issues,
        },
        "Amazon GTIN exemption patch submitted",
      );
    } catch (err) {
      logger.warn(
        {
          sellerSku: input.sellerSku,
          attempt,
          err: err instanceof Error ? err.message : String(err),
        },
        "Amazon GTIN exemption patch request failed",
      );
    }
  }

  try {
    const item = await getListingsItem(
      input.accountId,
      input.sellerId,
      input.sellerSku,
      input.marketplaceId,
    );
    if (readGtinExemptionFromAttributes(item?.attributes, input.marketplaceId)) {
      return;
    }
  } catch {
    /* ignore */
  }

  const issuesText = formatAmazonListingsIssues(lastPatch?.issues);
  logger.warn(
    {
      sellerSku: input.sellerSku,
      issuesText,
      issues: lastPatch?.issues,
    },
    "Amazon GTIN exemption not persisted after retries — Seller Central may show ID externa unchecked",
  );
}

function formatGtinExemptionHintFromIssues(issues: AmazonListingsIssue[] | undefined): string | null {
  const blob = formatAmazonListingsIssues(issues);
  if (
    !/externally_assigned_product_identifier|product id|product identifier|gtin|upc|ean|isbn|jan|id do produto|id externa/i.test(
      blob,
    )
  ) {
    return null;
  }
  return [
    "A Amazon não marcou a isenção de ID externa do produto.",
    "Confirme na Seller Central se a isenção GTIN/EAN está aprovada para a marca e categoria deste anúncio.",
    "Seller Central → Catálogo → Adicionar produtos → solicitar isenção de código de barras.",
  ].join(" ");
}

/**
 * Schema DUFFEL_BAG (BR): compartment NÃO é locale plano.
 * Formato exigido:
 * [{ description: [{ language_tag, value }], marketplace_id }]
 */
function attrCompartmentDescription(value: string, marketplaceId: string) {
  return [
    {
      description: [
        {
          language_tag: "pt_BR",
          value: value.trim(),
        },
      ],
      marketplace_id: marketplaceId,
    },
  ];
}

function extractCompartmentDescription(raw: unknown): string {
  if (!Array.isArray(raw) || !raw[0] || typeof raw[0] !== "object") return "";
  const first = raw[0] as {
    description?: Array<{ value?: unknown }>;
    value?: unknown;
  };
  // Formato correto (aninhado)
  if (Array.isArray(first.description) && first.description[0]) {
    const v = first.description[0].value;
    return typeof v === "string" ? v.trim() : "";
  }
  // Formato legado (plano) — ainda lê para migrar
  if (typeof first.value === "string") return first.value.trim();
  return "";
}

function buildPurchasableOffer(price: number, marketplaceId: string) {
  const amount = Number(Number(price).toFixed(2));
  return [
    {
      marketplace_id: marketplaceId,
      currency: "BRL",
      audience: "ALL",
      our_price: [{ schedule: [{ value_with_tax: amount }] }],
      // MSRP / preço sugerido com impostos (mapeamento oficial Amazon)
      list_price: [{ schedule: [{ value_with_tax: amount }] }],
    },
  ];
}

/** Top-level list_price no schema BR exige value_with_tax (não "value"). */
function buildTopLevelListPrice(price: number, marketplaceId: string) {
  const amount = Number(Number(price).toFixed(2));
  return [
    {
      currency: "BRL",
      marketplace_id: marketplaceId,
      value_with_tax: amount,
    },
  ];
}

function extractPriceFromAttrs(attrs: Record<string, unknown>, fallback: number): number {
  const offer = attrs.purchasable_offer;
  if (Array.isArray(offer) && offer[0]) {
    const our = (offer[0] as { our_price?: Array<{ schedule?: Array<{ value_with_tax?: number }> }> })
      .our_price;
    const v = our?.[0]?.schedule?.[0]?.value_with_tax;
    if (typeof v === "number" && v > 0) return v;
  }
  const list = attrs.list_price;
  if (Array.isArray(list) && list[0]) {
    const first = list[0] as {
      value_with_tax?: number;
      value?: number;
      schedule?: Array<{ value_with_tax?: number }>;
    };
    if (typeof first.value_with_tax === "number" && first.value_with_tax > 0) {
      return first.value_with_tax;
    }
    if (typeof first.value === "number" && first.value > 0) return first.value;
    const scheduled = first.schedule?.[0]?.value_with_tax;
    if (typeof scheduled === "number" && scheduled > 0) return scheduled;
  }
  return fallback > 0 ? fallback : 0;
}

function normalizeAmazonPricingAttributes(
  attrs: Record<string, unknown>,
  marketplaceId: string,
  priceFallback: number,
): void {
  const price = extractPriceFromAttrs(attrs, priceFallback);
  if (price <= 0) return;

  attrs.purchasable_offer = buildPurchasableOffer(price, marketplaceId);
  attrs.list_price = buildTopLevelListPrice(price, marketplaceId);
}

const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  br: "BR",
  brasil: "BR",
  brazil: "BR",
  cn: "CN",
  china: "CN",
  us: "US",
  usa: "US",
  eua: "US",
  "estados unidos": "US",
  "united states": "US",
  py: "PY",
  paraguay: "PY",
  paraguai: "PY",
  in: "IN",
  india: "IN",
  índia: "IN",
  vn: "VN",
  vietnam: "VN",
  vietna: "VN",
  id: "ID",
  indonesia: "ID",
  indonésia: "ID",
  mx: "MX",
  mexico: "MX",
  méxico: "MX",
};

export function normalizeAmazonCountryOfOrigin(raw: string): string {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "BR";
  if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase();
  const key = trimmed
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
  return COUNTRY_NAME_TO_CODE[key] || trimmed.toUpperCase().slice(0, 2);
}

export function suggestAmazonDepartment(productType: string, title = ""): string {
  const type = (productType || "").toUpperCase();
  const titleL = title.toLowerCase();
  if (type.includes("SHOE") || /t[eê]nis|sapato|bota/.test(titleL)) return "shoes";
  if (type.includes("SHIRT") || /camis|roupa|vestido/.test(titleL)) return "clothing";
  if (type.includes("LUGGAGE") || type.includes("BACKPACK") || /mala|mochila/.test(titleL)) {
    return "luggage";
  }
  if (
    type.includes("COSMETIC") ||
    type.includes("BEAUTY") ||
    /necessaire|maquiagem|cosmetic|toiletry/.test(titleL)
  ) {
    return "beauty";
  }
  if (
    type.includes("DUFFEL") ||
    type.includes("BAG") ||
    type.includes("HANDBAG") ||
    /bolsa|duffel|tote/.test(titleL)
  ) {
    return "handbags";
  }
  return "unisex";
}

/**
 * Só product types cujo schema BR realmente tem `compartment` (descrição).
 * NÃO usar /BAG/ genérico — casa com BACKPACK e a Amazon ignora/rejeita o atributo.
 */
export function productTypeNeedsCompartment(productType: string): boolean {
  const type = (productType || "").toUpperCase();
  return type === "DUFFEL_BAG" || type.includes("DUFFEL");
}

/**
 * Product types que exigem `number_of_compartments` no BR (ex.: BACKPACK).
 * Independente de `compartment` (descrição) — BACKPACK exige o número, não a descrição.
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

/** BACKPACK (e similares) usam P×L×A (`item_depth_width_height`), não C×L×A. */
export function productTypeUsesDepthDimensions(productType: string): boolean {
  const type = (productType || "").toUpperCase();
  return type === "BACKPACK" || type.endsWith("_BACKPACK");
}

/** Product types de bolsa/mochila que pedem atributos soft extras no BR. */
export function productTypeNeedsBagSoftAttributes(productType: string): boolean {
  const type = (productType || "").toUpperCase();
  return (
    type === "BACKPACK" ||
    type === "DUFFEL_BAG" ||
    type === "HANDBAG" ||
    type === "TOTE_BAG" ||
    type === "BAG" ||
    type === "LUGGAGE" ||
    type === "SUITCASE" ||
    type === "COSMETIC_CASE"
  );
}

export const AMAZON_BULLET_POINT_MAX = 700;

/** Valor padrão de "Descrição do compartimento" quando o schema exige `compartment`. */
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

/** Extrai número de compartimentos de textos do scrape (ex.: "Número de compartimentos: 8"). */
export function extractNumberOfCompartmentsFromTexts(texts: string[]): number {
  for (const text of texts) {
    const raw = String(text || "");
    const labeled = raw.match(
      /n[uú]mero\s+de\s+compartimentos?\s*[:\-]?\s*(\d+)/i,
    );
    if (labeled?.[1]) {
      const n = Number(labeled[1]);
      if (Number.isFinite(n) && n > 0) return Math.floor(n);
    }
    const en = raw.match(/number\s+of\s+compartments?\s*[:\-]?\s*(\d+)/i);
    if (en?.[1]) {
      const n = Number(en[1]);
      if (Number.isFinite(n) && n > 0) return Math.floor(n);
    }
    // Valor puro "8" quando o texto vem só do valor do atributo scrape
    if (/^\d{1,2}$/.test(raw.trim())) {
      const n = Number(raw.trim());
      if (n > 0 && n <= 50) return n;
    }
  }
  return 0;
}

function hasAmazonLocaleTextValue(raw: unknown): string {
  if (!Array.isArray(raw) || !raw[0]) return "";
  const value = (raw[0] as { value?: unknown }).value;
  return typeof value === "string" ? value.trim() : "";
}

export function isGenericBrandName(brand: string): boolean {
  return /^(gen[eé]rico|generic|sem\s*marca|unbranded|n\/?a|nao\s*informado|não\s*informado)$/i.test(
    brand.trim(),
  );
}

function looksLikeAsin(value: string): boolean {
  return /^B0[A-Z0-9]{8}$/i.test(value.trim());
}

/** Evita usar o ASIN de terceiro como SKU (causa oferta bloqueada em ASIN genérico). */
export function ensureSellerSkuNotSourceAsin(sellerSku: string, sourceAsin: string | null): string {
  const sku = sellerSku.trim();
  if (
    !sku ||
    looksLikeAsin(sku) ||
    (sourceAsin && (sku === sourceAsin || sku === `SKU-AMZ-${sourceAsin}` || sku.endsWith(sourceAsin)))
  ) {
    return `IHUB-${Date.now().toString(36).toUpperCase()}`;
  }
  return sku;
}

function extractBrandFromAttrs(attrs: Record<string, unknown> | undefined): string | undefined {
  if (!attrs?.brand || !Array.isArray(attrs.brand) || !attrs.brand[0]) return undefined;
  const value = (attrs.brand[0] as { value?: string }).value;
  return typeof value === "string" ? value.trim() : undefined;
}

/** Parseia textos tipo "20C x 10L x 30A centímetros" ou "20 x 10 x 30 cm". */
export function parseAmazonItemDimensions(text: string): {
  length: number;
  width: number;
  height: number;
  unit: "centimeters" | "inches";
} | null {
  const raw = String(text || "");
  if (!raw.trim()) return null;
  const unit: "centimeters" | "inches" = /in(ch|ches)?\b|polegada/i.test(raw)
    ? "inches"
    : "centimeters";

  const labeled = raw.match(
    /(\d+[.,]?\d*)\s*[Cc]\s*[x×]\s*(\d+[.,]?\d*)\s*[Ll]\s*[x×]\s*(\d+[.,]?\d*)\s*[Aa]/i,
  );
  if (labeled) {
    return {
      length: Number(labeled[1].replace(",", ".")),
      width: Number(labeled[2].replace(",", ".")),
      height: Number(labeled[3].replace(",", ".")),
      unit,
    };
  }

  const plain = raw.match(
    /(\d+[.,]?\d*)\s*(?:cm|cent[ií]metros?)?\s*[x×]\s*(\d+[.,]?\d*)\s*(?:cm|cent[ií]metros?)?\s*[x×]\s*(\d+[.,]?\d*)/i,
  );
  if (plain) {
    return {
      length: Number(plain[1].replace(",", ".")),
      width: Number(plain[2].replace(",", ".")),
      height: Number(plain[3].replace(",", ".")),
      unit,
    };
  }
  return null;
}

function isStructuredAmazonDimension(raw: unknown): boolean {
  if (!Array.isArray(raw) || !raw[0] || typeof raw[0] !== "object") return false;
  const first = raw[0] as Record<string, unknown>;
  const length = first.length as { value?: unknown; unit?: unknown } | undefined;
  return typeof length?.value === "number" && typeof length?.unit === "string";
}

function isStructuredAmazonDepthDimension(raw: unknown): boolean {
  if (!Array.isArray(raw) || !raw[0] || typeof raw[0] !== "object") return false;
  const first = raw[0] as Record<string, unknown>;
  const depth = first.depth as { value?: unknown; unit?: unknown } | undefined;
  const width = first.width as { value?: unknown; unit?: unknown } | undefined;
  const height = first.height as { value?: unknown; unit?: unknown } | undefined;
  return (
    typeof depth?.value === "number" &&
    typeof width?.value === "number" &&
    typeof height?.value === "number"
  );
}

function attrClosureType(value: string, marketplaceId: string) {
  return [
    {
      type: [{ language_tag: "pt_BR", value }],
      marketplace_id: marketplaceId,
    },
  ];
}

function attrOuterMaterial(value: string, marketplaceId: string) {
  return [
    {
      material: [{ language_tag: "pt_BR", value }],
      marketplace_id: marketplaceId,
    },
  ];
}

function extractNestedAttrValue(raw: unknown, nestedKey: "type" | "material"): string {
  if (!Array.isArray(raw) || !raw[0] || typeof raw[0] !== "object") return "";
  const nested = (raw[0] as Record<string, unknown>)[nestedKey];
  if (!Array.isArray(nested) || !nested[0]) return "";
  const value = (nested[0] as { value?: unknown }).value;
  return typeof value === "string" ? value.trim() : "";
}

function suggestOuterMaterial(attrs: Record<string, unknown>, title = ""): string {
  const blob = [
    hasAmazonLocaleTextValue(attrs.material),
    hasAmazonLocaleTextValue(attrs.outer),
    extractNestedAttrValue(attrs.outer, "material"),
    title,
  ]
    .join(" ")
    .toLowerCase();
  if (/nylon/.test(blob)) return "Nylon";
  if (/poli[eé]ster|polyester/.test(blob)) return "Poliéster";
  if (/couro sintético|synthetic leather/.test(blob)) return "Couro sintético";
  if (/\bcouro\b|leather/.test(blob)) return "Couro";
  if (/neoprene/.test(blob)) return "Neoprene";
  if (/pvc|vinil|vinyl/.test(blob)) return "Cloreto de polivinilo (PVC)";
  if (/algod[aã]o|cotton/.test(blob)) return "Algodão";
  return "Nylon";
}

function suggestLiningDescription(attrs: Record<string, unknown>, title = ""): string {
  const blob = [
    hasAmazonLocaleTextValue(attrs.lining_description),
    hasAmazonLocaleTextValue(attrs.material),
    title,
  ]
    .join(" ")
    .toLowerCase();
  if (/poli[eé]ster|polyester/.test(blob)) return "Poliéster";
  if (/nylon/.test(blob)) return "Nylon";
  if (/algod[aã]o|cotton/.test(blob)) return "Algodão";
  return "Poliéster";
}

function parseStorageVolumeLiters(texts: string[]): number | null {
  for (const text of texts) {
    const m = String(text || "").match(/(\d+[.,]?\d*)\s*(?:l|litros?)\b/i);
    if (!m) continue;
    const n = Number(m[1].replace(",", "."));
    if (Number.isFinite(n) && n > 0 && n <= 11000) return n;
  }
  return null;
}

function extractDimensionTriple(
  attrs: Record<string, unknown>,
  scrapedTexts: string[] = [],
): { a: number; b: number; c: number; unit: "centimeters" | "inches" } | null {
  if (isStructuredAmazonDepthDimension(attrs.item_depth_width_height)) {
    const first = (attrs.item_depth_width_height as Array<Record<string, unknown>>)[0];
    const depth = first.depth as { value: number; unit?: string };
    const width = first.width as { value: number; unit?: string };
    const height = first.height as { value: number; unit?: string };
    return {
      a: depth.value,
      b: width.value,
      c: height.value,
      unit: depth.unit === "inches" ? "inches" : "centimeters",
    };
  }
  if (isStructuredAmazonDimension(attrs.item_length_width_height)) {
    const first = (attrs.item_length_width_height as Array<Record<string, unknown>>)[0];
    const length = first.length as { value: number; unit?: string };
    const width = first.width as { value: number; unit?: string };
    const height = first.height as { value: number; unit?: string };
    return {
      a: length.value,
      b: width.value,
      c: height.value,
      unit: length.unit === "inches" ? "inches" : "centimeters",
    };
  }
  const sources = [...collectDimensionSourceTexts(attrs), ...scrapedTexts];
  for (const text of sources) {
    const parsed = parseAmazonItemDimensions(text);
    if (parsed) {
      return {
        a: parsed.length,
        b: parsed.width,
        c: parsed.height,
        unit: parsed.unit,
      };
    }
  }
  return null;
}

function truncateAmazonLocaleAttr(
  attrs: Record<string, unknown>,
  key: string,
  maxLen: number,
): void {
  const raw = attrs[key];
  if (!Array.isArray(raw) || !raw[0] || typeof raw[0] !== "object") return;
  const first = raw[0] as { value?: unknown };
  if (typeof first.value !== "string") return;
  const trimmed = first.value.trim();
  if (trimmed.length <= maxLen) {
    first.value = trimmed;
    return;
  }
  first.value = trimmed.slice(0, maxLen);
}

function collectDimensionSourceTexts(attrs: Record<string, unknown>): string[] {
  const texts: string[] = [];
  for (const [key, raw] of Object.entries(attrs)) {
    if (!/dimens|length|width|height|medida|tamanho do produto/i.test(key)) continue;
    if (Array.isArray(raw) && raw[0] && typeof (raw[0] as { value?: unknown }).value === "string") {
      texts.push(String((raw[0] as { value: string }).value));
    } else if (typeof raw === "string") {
      texts.push(raw);
    }
  }
  return texts;
}

/**
 * Garante atributos que a Amazon costuma exigir em LISTING e corrige formatos inválidos
 * (ex.: country_of_origin "Brasil", dimensões em texto livre).
 */
export function ensureRequiredAmazonListingAttributes(
  attrsInput: Record<string, unknown>,
  opts: {
    marketplaceId: string;
    productType: string;
    title?: string;
    price: number;
    scrapedTexts?: string[];
    /** Quando true, não vincula ASIN de terceiros e garante isenção GTIN se necessário. */
    createNewCatalogProduct?: boolean;
  },
): Record<string, unknown> {
  const marketplaceId = opts.marketplaceId;
  const attrs: Record<string, unknown> = { ...attrsInput };

  if (opts.createNewCatalogProduct) {
    delete attrs.merchant_suggested_asin;
  }

  // country_of_origin → código ISO
  const countryRaw = attrs.country_of_origin;
  let countryValue = "BR";
  if (Array.isArray(countryRaw) && countryRaw[0] && typeof (countryRaw[0] as { value?: unknown }).value === "string") {
    countryValue = normalizeAmazonCountryOfOrigin(String((countryRaw[0] as { value: string }).value));
  }
  attrs.country_of_origin = attrLocaleValue(countryValue, marketplaceId);

  // supplier_declared_dg_hz_regulation
  const dgRaw = attrs.supplier_declared_dg_hz_regulation;
  const hasDg =
    Array.isArray(dgRaw) &&
    dgRaw[0] &&
    typeof (dgRaw[0] as { value?: unknown }).value === "string" &&
    String((dgRaw[0] as { value: string }).value).trim();
  if (!hasDg) {
    attrs.supplier_declared_dg_hz_regulation = attrLocaleValue("not_applicable", marketplaceId);
  }

  // department
  const deptRaw = attrs.department;
  const hasDept =
    Array.isArray(deptRaw) &&
    deptRaw[0] &&
    typeof (deptRaw[0] as { value?: unknown }).value === "string" &&
    String((deptRaw[0] as { value: string }).value).trim();
  if (!hasDept) {
    attrs.department = attrLocaleValue(
      suggestAmazonDepartment(opts.productType, opts.title || ""),
      marketplaceId,
    );
  }

  // compartment (descrição) — só DUFFEL_BAG. Em BACKPACK a Amazon rejeita esse atributo.
  if (productTypeNeedsCompartment(opts.productType)) {
    const existing = extractCompartmentDescription(attrs.compartment);
    attrs.compartment = attrCompartmentDescription(
      existing || suggestAmazonCompartment(opts.productType, opts.title || ""),
      marketplaceId,
    );
  } else {
    delete attrs.compartment;
  }

  // number_of_compartments — BACKPACK exige (erro 90220 se ausente); DUFFEL também.
  if (productTypeNeedsNumberOfCompartments(opts.productType)) {
    const rawCount = attrs.number_of_compartments;
    let count = 0;
    if (Array.isArray(rawCount) && rawCount[0]) {
      const v = (rawCount[0] as { value?: unknown }).value;
      if (typeof v === "number" && v > 0) count = Math.floor(v);
      else if (typeof v === "string" && Number(v) > 0) count = Math.floor(Number(v));
    }
    if (count <= 0) {
      count = extractNumberOfCompartmentsFromTexts([
        ...(opts.scrapedTexts || []),
        opts.title || "",
      ]);
    }
    attrs.number_of_compartments = attrLocaleValue(count > 0 ? count : 1, marketplaceId);
  } else {
    delete attrs.number_of_compartments;
  }

  // bullet_point: language_tag + maxLength 700 (schema BR)
  if (Array.isArray(attrs.bullet_point)) {
    attrs.bullet_point = (attrs.bullet_point as Array<Record<string, unknown>>)
      .map((item) => {
        const value = item?.value;
        if (typeof value !== "string" || !value.trim()) return null;
        const trimmed = value.trim().slice(0, AMAZON_BULLET_POINT_MAX);
        return {
          value: trimmed,
          language_tag: typeof item.language_tag === "string" ? item.language_tag : "pt_BR",
          marketplace_id:
            typeof item.marketplace_id === "string" ? item.marketplace_id : marketplaceId,
        };
      })
      .filter(Boolean);
  }

  // Atributos soft exigidos em BACKPACK / bolsas (schema BR)
  if (productTypeNeedsBagSoftAttributes(opts.productType)) {
    const title = opts.title || "";
    const type = (opts.productType || "").toUpperCase();
    const isBackpack = type === "BACKPACK";
    const isDuffel = type.includes("DUFFEL");
    const isHandbagFamily = type === "HANDBAG" || type === "TOTE_BAG";
    const isBag = type === "BAG";
    const isSuitcase = type === "SUITCASE";
    const isCosmetic = type === "COSMETIC_CASE";
    const isLuggage = type === "LUGGAGE";

    if (
      !hasAmazonLocaleTextValue(attrs.strap_type) &&
      (isBackpack || isDuffel || isHandbagFamily)
    ) {
      attrs.strap_type = attrLocalizedText(
        isBackpack ? "Alças traseiras" : "Ajustável",
        marketplaceId,
      );
    }

    if (
      !extractNestedAttrValue(attrs.closure, "type") &&
      (isBackpack || isDuffel || isHandbagFamily || isBag || isCosmetic || isLuggage)
    ) {
      attrs.closure = attrClosureType("Zíper", marketplaceId);
    }

    if (
      !hasAmazonLocaleTextValue(attrs.target_gender) &&
      (isBackpack || isBag || isHandbagFamily || isCosmetic)
    ) {
      attrs.target_gender = attrLocaleValue("unisex", marketplaceId);
    }

    const hasVolume =
      Array.isArray(attrs.storage_volume) &&
      attrs.storage_volume[0] &&
      typeof (attrs.storage_volume[0] as { value?: unknown }).value === "number" &&
      typeof (attrs.storage_volume[0] as { unit?: unknown }).unit === "string";
    if (!hasVolume && (isBackpack || isSuitcase || isLuggage)) {
      const liters =
        parseStorageVolumeLiters([
          title,
          ...(opts.scrapedTexts || []),
          ...collectDimensionSourceTexts(attrs),
        ]) || 20;
      attrs.storage_volume = [
        { value: liters, unit: "liters", marketplace_id: marketplaceId },
      ];
    }

    if (
      !hasAmazonLocaleTextValue(attrs.water_resistance_level) &&
      (isBackpack ||
        isDuffel ||
        isHandbagFamily ||
        isBag ||
        isSuitcase ||
        isCosmetic ||
        isLuggage)
    ) {
      attrs.water_resistance_level = attrLocaleValue("water_repellent", marketplaceId);
    }

    if (
      !extractNestedAttrValue(attrs.outer, "material") &&
      (isBackpack ||
        isDuffel ||
        isHandbagFamily ||
        isBag ||
        isSuitcase ||
        isCosmetic ||
        isLuggage)
    ) {
      attrs.outer = attrOuterMaterial(suggestOuterMaterial(attrs, title), marketplaceId);
    }

    if (
      !hasAmazonLocaleTextValue(attrs.lining_description) &&
      (isBackpack || isBag || isHandbagFamily)
    ) {
      attrs.lining_description = attrLocalizedText(
        suggestLiningDescription(attrs, title),
        marketplaceId,
      );
    }

    if (
      !hasAmazonLocaleTextValue(attrs.age_range_description) &&
      (isBackpack || isBag || isHandbagFamily)
    ) {
      attrs.age_range_description = attrLocalizedText("Adulto", marketplaceId);
    }
  }

  // Precificação SP-API (BR): our_price + list_price com value_with_tax
  normalizeAmazonPricingAttributes(attrs, marketplaceId, opts.price);

  // Oferta ativa exige estoque > 0 (Seller Central: "Oferta não encontrada" se qty=0)
  {
    const rawQty =
      Array.isArray(attrs.fulfillment_availability) &&
      (attrs.fulfillment_availability[0] as { quantity?: unknown } | undefined)?.quantity;
    setFulfillmentQuantity(attrs, rawQty);
  }

  // Produto novo: sempre isento de GTIN/EAN (Amazon mostra "não possui GTIN/EAN")
  if (opts.createNewCatalogProduct) {
    applyGtinExemptionToAttributes(attrs, marketplaceId);
  }

  // model_name: limite prático no iHub (schema Amazon costuma aceitar bem mais que 12)
  truncateAmazonLocaleAttr(attrs, "model_name", 120);

  // Dimensões: BACKPACK → item_depth_width_height; demais bolsas → item_length_width_height
  const dims = extractDimensionTriple(attrs, opts.scrapedTexts || []);
  if (dims) {
    const unit = productTypeUsesDepthDimensions(opts.productType)
      ? "centimeters"
      : dims.unit;
    if (productTypeUsesDepthDimensions(opts.productType)) {
      attrs.item_depth_width_height = [
        {
          depth: { value: dims.a, unit },
          width: { value: dims.b, unit },
          height: { value: dims.c, unit },
          marketplace_id: marketplaceId,
        },
      ];
      delete attrs.item_length_width_height;
    } else {
      attrs.item_length_width_height = [
        {
          length: { value: dims.a, unit: dims.unit },
          width: { value: dims.b, unit: dims.unit },
          height: { value: dims.c, unit: dims.unit },
          marketplace_id: marketplaceId,
        },
      ];
      delete attrs.item_depth_width_height;
    }
  }

  // Remove atributos de dimensão em texto livre que confundem a SP-API
  for (const key of Object.keys(attrs)) {
    if (
      key === "item_length_width_height" ||
      key === "item_depth_width_height" ||
      key === "item_package_dimensions"
    ) {
      continue;
    }
    if (!/dimens|length_width|medida/i.test(key)) continue;
    const raw = attrs[key];
    if (Array.isArray(raw) && raw[0] && typeof (raw[0] as { value?: unknown }).value === "string") {
      delete attrs[key];
    }
  }

  return attrs;
}

function buildOfferAttributes(
  input: CreateAmazonListingInput,
  marketplaceId: string,
  asin: string,
): Record<string, unknown> {
  const condition = input.condition ?? "new_new";
  const quantity = ensurePositiveAmazonQuantity(input.availableQuantity);
  const attrs: Record<string, unknown> = {
    merchant_suggested_asin: [{ value: asin, marketplace_id: marketplaceId }],
    condition_type: attrLocaleValue(condition, marketplaceId),
    fulfillment_availability: [
      {
        fulfillment_channel_code: "DEFAULT",
        quantity,
      },
    ],
    purchasable_offer: buildPurchasableOffer(input.price, marketplaceId),
  };

  if (input.imageUrls?.[0]) {
    attrs.main_product_image_locator = [
      { media_location: input.imageUrls[0], marketplace_id: marketplaceId },
    ];
  }

  return attrs;
}

function assertValidAmazonImageUrls(urls: string[] | undefined): void {
  if (!urls?.length) return;
  for (const url of urls) {
    if (!isValidAmazonMediaUrl(url)) {
      throw new AmazonListingError(
        "URL de imagem inválida para Amazon. Use URLs https:// públicas (não envie base64/data URI).",
        "VALIDATION_ERROR",
      );
    }
  }
}

function buildCreateAttributes(
  input: CreateAmazonListingInput,
  marketplaceId: string,
): Record<string, unknown> {
  const condition = input.condition ?? "new_new";
  const fromDraft = input.attributes ? { ...input.attributes } : {};
  const quantity = ensurePositiveAmazonQuantity(input.availableQuantity);

  // Base offer/product facts — draft attrs can fill gaps, but we keep critical offer fields.
  const attrs: Record<string, unknown> = {
    ...fromDraft,
    item_name: fromDraft.item_name ?? attrLocalizedText(input.title, marketplaceId),
    condition_type:
      fromDraft.condition_type ?? attrLocaleValue(condition, marketplaceId),
    // Sempre sobrescreve estoque do draft (qty 0 gera oferta ausente na Seller Central)
    fulfillment_availability: [
      {
        fulfillment_channel_code: "DEFAULT",
        quantity,
      },
    ],
    purchasable_offer: buildPurchasableOffer(input.price, marketplaceId),
  };

  if (input.brand && !attrs.brand) {
    attrs.brand = attrLocalizedText(input.brand, marketplaceId);
  }
  if (input.description && !attrs.product_description) {
    attrs.product_description = attrLocalizedText(input.description, marketplaceId);
  }

  if (input.imageUrls?.length) {
    if (!attrs.main_product_image_locator) {
      attrs.main_product_image_locator = [
        { media_location: input.imageUrls[0], marketplace_id: marketplaceId },
      ];
    }
    for (let i = 1; i < Math.min(input.imageUrls.length, 9); i++) {
      const key = `other_product_image_locator_${i}`;
      if (!attrs[key]) {
        attrs[key] = [
          { media_location: input.imageUrls[i], marketplace_id: marketplaceId },
        ];
      }
    }
  }

  if (input.externalProductId && !attrs.externally_assigned_product_identifier) {
    attrs.externally_assigned_product_identifier = [
      {
        type: (input.externalProductIdType ?? "EAN").toLowerCase(),
        value: input.externalProductId,
        marketplace_id: marketplaceId,
      },
    ];
  }

  // NÃO vincular ao ASIN raspado: ASINs genéricos/de terceiros são restritos na Amazon BR.
  // _asin no draft fica só como referência; listing cria ASIN novo.
  delete attrs.merchant_suggested_asin;

  const titleFromAttr =
    Array.isArray(attrs.item_name) && attrs.item_name[0]
      ? String((attrs.item_name[0] as { value?: string }).value || input.title)
      : input.title;

  return ensureRequiredAmazonListingAttributes(attrs, {
    marketplaceId,
    productType: input.productType,
    title: titleFromAttr,
    price: input.price,
    createNewCatalogProduct: true,
  });
}

function assertSubmissionAccepted(
  response: AmazonListingsSubmissionResponse | undefined,
  sellerSku: string,
): void {
  const status = response?.status?.toUpperCase();
  const issues = response?.issues ?? [];
  const errorIssues = issues.filter((i) => (i.severity || "").toUpperCase() === "ERROR");
  const issuesText = formatAmazonListingsIssues(issues);

  logger.info(
    {
      sellerSku,
      status: response?.status,
      submissionId: response?.submissionId,
      issueCount: issues.length,
      issues,
    },
    "Amazon putListingsItem response",
  );

  const brandGateHint = formatAmazonBrandGateHint(issuesText || issues.map((i) => i.message || "").join(" "));

  // HTTP 200 + INVALID = rejeitado (antes tratávamos como sucesso e só gravávamos no iHub).
  if (status === "INVALID" || (!status && errorIssues.length > 0)) {
    const missing = collectMissingAttributeNames(issues);
    const missingHint =
      missing.length > 0
        ? ` Atributos faltando: ${missing.join(", ")}. Complete na revisão ou ajuste o product type.`
        : "";
    throw new AmazonListingError(
      brandGateHint ||
        (issuesText
          ? `Amazon rejeitou o anúncio: ${issuesText}${missingHint}`
          : `Amazon rejeitou o anúncio (status INVALID). Verifique product type e atributos obrigatórios.${missingHint}`),
      "AMAZON_API_ERROR",
    );
  }

  if (status && status !== "ACCEPTED" && status !== "VALID") {
    throw new AmazonListingError(
      brandGateHint ||
        (issuesText
          ? `Amazon não aceitou o anúncio (${status}): ${issuesText}`
          : `Amazon não aceitou o anúncio (status: ${status}).`),
      "AMAZON_API_ERROR",
    );
  }

  if (errorIssues.length > 0) {
    logger.warn(
      { sellerSku, errorIssues },
      "Amazon putListingsItem ACCEPTED with ERROR issues — listing may stay incomplete",
    );
  }
}

/** Mensagem amigável para bloqueio de marca / criação de ASIN na Amazon. */
export function formatAmazonBrandGateHint(blob: string): string | null {
  const text = String(blob || "");
  if (
    !/create_asin|novos ASINs|novo ASIN|approvalrequest|restrictionScope=CONTRIBUTION|marca .+não|brandName|brand gate|ungating|aprovação de venda/i.test(
      text,
    )
  ) {
    // Também detecta o texto típico da Seller Central colado/retornado
    if (!/Você não pode criar novos ASINs para a marca/i.test(text)) return null;
  }

  const brandMatch =
    text.match(/ASINs para a marca\s+([^.]+)\./i) ||
    text.match(/brandName=([^&\s]+)/i) ||
    text.match(/marca\s+([A-Z0-9][A-Z0-9 &\-]{1,40})/i);
  const brand = brandMatch?.[1]?.trim().replace(/\+/g, " ");

  return [
    brand
      ? `A Amazon não permite criar ASIN novo para a marca "${brand}" nesta conta.`
      : "A Amazon não permite criar ASIN novo para esta marca nesta conta.",
    "Solicite aprovação em Seller Central → Catálogo → Solicitar aprovação (create_asin / CONTRIBUTION).",
    brand
      ? `Link direto (troque a marca se necessário): https://sellercentral.amazon.com.br/hz/approvalrequest?restrictionScope=CONTRIBUTION&brandName=${encodeURIComponent(brand)}&operationFilter=create_asin`
      : "https://sellercentral.amazon.com.br/hz/approvalrequest?restrictionScope=CONTRIBUTION&operationFilter=create_asin",
    "Enquanto isso, use uma marca já aprovada na sua conta ou venda um ASIN existente que você possa ofertar.",
  ].join(" ");
}

async function loadAmazonAccount(accountId: string) {
  const db = getDb();
  const [account] = await db
    .select()
    .from(accountsTable)
    .where(and(eq(accountsTable.id, accountId), eq(accountsTable.platform, "amazon")));
  if (!account) {
    throw new AmazonListingError("Conta Amazon não encontrada", "NOT_FOUND");
  }
  return account;
}

export async function upsertProductFromAmazonListing(
  accountId: string,
  item: AmazonListingsItem,
): Promise<string> {
  const db = getDb();
  const summary = extractListingSummary(item);
  const sku = item.sku;
  const price = extractListingPrice(item);
  const qty = extractListingQuantity(item);
  const status = summary?.status?.[0] ?? "UNKNOWN";
  const asin = summary?.asin ?? null;
  const title = summary?.itemName ?? sku;
  const thumbnail = summary?.mainImage?.link ?? null;
  const productType = summary?.productType ?? null;
  const permalink = asin ? `https://www.amazon.com.br/dp/${asin}` : null;

  const [existing] = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(and(eq(productsTable.accountId, accountId), eq(productsTable.amazonSku, sku)));

  if (existing) {
    await db
      .update(productsTable)
      .set({
        amazonAsin: asin,
        amazonProductType: productType,
        title,
        sku,
        price: price != null ? String(price) : null,
        amount: price != null ? String(price) : null,
        availableQuantity: qty,
        status,
        thumbnail,
        permalink,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(productsTable.id, existing.id));
    return existing.id;
  }

  const [inserted] = await db
    .insert(productsTable)
    .values({
      accountId,
      mlItemId: null,
      amazonSku: sku,
      amazonAsin: asin,
      amazonProductType: productType,
      title,
      sku,
      price: price != null ? String(price) : null,
      amount: price != null ? String(price) : null,
      availableQuantity: qty,
      soldQuantity: 0,
      status,
      thumbnail,
      permalink,
      lastSyncedAt: new Date(),
    })
    .returning({ id: productsTable.id });

  return inserted.id;
}

export async function createAmazonListing(
  accountId: string,
  input: CreateAmazonListingInput,
): Promise<{ sku: string; productId: string; submissionId?: string }> {
  let sellerSku = input.sellerSku?.trim();
  if (!sellerSku) {
    throw new AmazonListingError("Informe sellerSku", "VALIDATION_ERROR");
  }
  if (!input.productType?.trim() || input.productType.trim().toUpperCase() === "PRODUCT") {
    throw new AmazonListingError(
      "Informe um productType válido do catálogo Amazon (não use PRODUCT).",
      "VALIDATION_ERROR",
    );
  }
  if (!input.title?.trim()) {
    throw new AmazonListingError("Informe o título", "VALIDATION_ERROR");
  }
  if (typeof input.price !== "number" || input.price <= 0) {
    throw new AmazonListingError("Preço inválido", "VALIDATION_ERROR");
  }

  assertValidAmazonImageUrls(input.imageUrls);
  if (input.attributes) {
    const imageUrlsFromAttrs: string[] = [];
    const attrs = input.attributes as Record<string, unknown>;
    const main = attrs.main_product_image_locator as Array<{ media_location?: string }> | undefined;
    if (Array.isArray(main) && main[0]?.media_location) {
      imageUrlsFromAttrs.push(main[0].media_location);
    }
    for (let i = 1; i <= 8; i++) {
      const other = attrs[`other_product_image_locator_${i}`] as
        | Array<{ media_location?: string }>
        | undefined;
      if (Array.isArray(other) && other[0]?.media_location) {
        imageUrlsFromAttrs.push(other[0].media_location);
      }
    }
    assertValidAmazonImageUrls(imageUrlsFromAttrs);
  }

  // Estoque 0 deixa a oferta inativa ("Oferta não encontrada") — força mínimo 1
  const availableQuantity = ensurePositiveAmazonQuantity(input.availableQuantity);
  input = { ...input, availableQuantity };

  const brand = input.brand?.trim() || extractBrandFromAttrs(input.attributes);
  if (brand && isGenericBrandName(brand)) {
    throw new AmazonListingError(
      `A marca "${brand}" é tratada como genérica pela Amazon e costuma ser bloqueada. Use a marca da sua loja (ex.: Original Tênis).`,
      "VALIDATION_ERROR",
    );
  }

  const account = await loadAmazonAccount(accountId);
  const sellerId = resolveAmazonSellerId(account);
  const marketplaceId =
    account.amazonMarketplaceId || process.env.AMAZON_MARKETPLACE_ID || "A2Q3Y263D00KWC";

  const asin = input.asin?.trim() || null;
  const matchCatalog = input.matchCatalogAsin === true && !!asin;

  // SKU não pode ser o ASIN de terceiro (gera oferta bloqueada em ASIN genérico).
  sellerSku = ensureSellerSkuNotSourceAsin(sellerSku, asin);

  // Default: criar ASIN/produto novo. Só oferta no ASIN existente se matchCatalogAsin=true.
  const requirements = matchCatalog
    ? input.requirements?.trim() || "LISTING_OFFER_ONLY"
    : input.requirements?.trim() || "LISTING";

  let productType = input.productType.trim();
  // ASIN fonte só sugere product type quando o draft ainda está genérico (PRODUCT/vazio).
  // Não sobrescrever a escolha do usuário (ex.: DUFFEL_BAG) — isso gerava schema/attrs desalinhados.
  const draftTypeUpper = productType.toUpperCase();
  if (asin && (!draftTypeUpper || draftTypeUpper === "PRODUCT")) {
    const catalogType = await getCatalogProductTypeForAsin(accountId, asin, marketplaceId);
    if (catalogType) {
      logger.info(
        { asin, catalogType },
        "Using catalog productType because draft productType was empty/PRODUCT",
      );
      productType = catalogType;
    }
  } else if (asin) {
    const catalogType = await getCatalogProductTypeForAsin(accountId, asin, marketplaceId);
    if (catalogType && catalogType !== productType) {
      logger.info(
        { asin, fromDraft: productType, catalogType, matchCatalog },
        "Keeping draft productType (not overriding with catalog)",
      );
    }
  }

  const attributesRaw =
    matchCatalog && requirements === "LISTING_OFFER_ONLY" && asin
      ? buildOfferAttributes(input, marketplaceId, asin)
      : buildCreateAttributes(
          {
            ...input,
            attributes: applyScrapedAttributesToListingAttrs(
              input.attributes || {},
              input.scrapedAttributes,
              marketplaceId,
            ),
          },
          marketplaceId,
        );

  const scrapedTexts = scrapedTextsFromAttributes(input.scrapedAttributes);

  let attributes =
    matchCatalog && requirements === "LISTING_OFFER_ONLY"
      ? attributesRaw
      : ensureRequiredAmazonListingAttributes(attributesRaw, {
          marketplaceId,
          productType,
          title: input.title,
          price: input.price,
          scrapedTexts,
          createNewCatalogProduct: !matchCatalog,
        });

  if (!matchCatalog) {
    delete attributes.merchant_suggested_asin;
  }

  // Garantia final: descrição compartment só DUFFEL; número de compartimentos também em BACKPACK
  if (productTypeNeedsCompartment(productType)) {
    const existing = extractCompartmentDescription(attributes.compartment);
    attributes.compartment = attrCompartmentDescription(
      existing || suggestAmazonCompartment(productType, input.title),
      marketplaceId,
    );
  } else {
    delete attributes.compartment;
  }
  if (productTypeNeedsNumberOfCompartments(productType)) {
    if (!Array.isArray(attributes.number_of_compartments) || !attributes.number_of_compartments[0]) {
      const count =
        extractNumberOfCompartmentsFromTexts([...scrapedTexts, input.title]) || 1;
      attributes.number_of_compartments = attrLocaleValue(count, marketplaceId);
    }
  } else {
    delete attributes.number_of_compartments;
  }

  // Produto novo: isenção GTIN/EAN (Seller Central: "Este produto não tem uma ID do produto")
  if (!matchCatalog) {
    applyGtinExemptionToAttributes(attributes, marketplaceId);
  }

  // Caminhos de Navegação (recommended_browse_nodes) — enum do schema do product type
  {
    const existingBrowse =
      Array.isArray(attributes.recommended_browse_nodes) &&
      attributes.recommended_browse_nodes[0] &&
      typeof (attributes.recommended_browse_nodes[0] as { value?: unknown }).value === "string"
        ? String((attributes.recommended_browse_nodes[0] as { value: string }).value).trim()
        : "";
    if (!existingBrowse) {
      try {
        const nodes = await getAmazonRecommendedBrowseNodes(accountId, productType, marketplaceId);
        const suggested = suggestAmazonBrowseNode(nodes, {
          title: input.title,
          productType,
        });
        if (suggested) {
          attributes.recommended_browse_nodes = [
            { value: suggested.id, marketplace_id: marketplaceId },
          ];
          logger.info(
            { sellerSku, productType, browseNodeId: suggested.id, browseNodeName: suggested.name },
            "Auto-selected Amazon recommended_browse_nodes",
          );
        }
      } catch (err) {
        logger.warn(
          {
            sellerSku,
            productType,
            err: err instanceof Error ? err.message : String(err),
          },
          "Failed to auto-select recommended_browse_nodes",
        );
      }
    }
  }

  const fillCtx = {
    marketplaceId,
    productType,
    title: input.title,
    brand: brand || undefined,
    scrapedAttributes: input.scrapedAttributes,
  };

  let submission: AmazonListingsSubmissionResponse | undefined;
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const body = {
      productType,
      requirements,
      attributes,
    };

    logger.info(
      {
        accountId,
        sellerSku,
        productType,
        requirements,
        matchCatalog,
        sourceAsin: asin,
        attempt,
        hasMerchantSuggestedAsin: !!attributes.merchant_suggested_asin,
        hasCompartment: !!extractCompartmentDescription(attributes.compartment),
        hasNumberOfCompartments: Array.isArray(attributes.number_of_compartments),
        hasGtinExemption:
          Array.isArray(attributes.supplier_declared_has_product_identifier_exemption) &&
          (attributes.supplier_declared_has_product_identifier_exemption[0] as { value?: boolean })
            ?.value === true,
        hasExternalProductId: Array.isArray(attributes.externally_assigned_product_identifier),
        attributeKeys: Object.keys(attributes).sort(),
      },
      "Amazon putListingsItem request",
    );

    try {
      submission = await amazon.put<AmazonListingsSubmissionResponse>(
        accountId,
        listingsItemPath(sellerId, sellerSku, marketplaceId),
        body,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(
        { accountId, sellerSku, message, requirements, attempt },
        "Amazon putListingsItem failed",
      );
      throw new AmazonListingError(message, "AMAZON_API_ERROR");
    }

    if (!submissionIsRetryableInvalid(submission) || attempt === maxAttempts) {
      break;
    }

    const filled = fillMissingAttributesFromIssues(attributes, submission.issues, fillCtx);
    if (filled.length === 0) {
      logger.warn(
        {
          sellerSku,
          attempt,
          missing: collectMissingAttributeNames(submission.issues),
          issues: submission.issues,
        },
        "Amazon INVALID with missing attrs but none could be auto-filled",
      );
      break;
    }

    logger.info(
      { sellerSku, attempt, filled, remainingIssues: submission.issues },
      "Auto-filled missing Amazon attributes; retrying putListingsItem",
    );
  }

  assertSubmissionAccepted(submission, sellerSku);

  // Reforça isenção GTIN após o put — Seller Central só marca o checkbox quando o atributo persiste.
  if (!matchCatalog) {
    await ensureGtinExemptionPersistedOnListing({
      accountId,
      sellerId,
      sellerSku,
      marketplaceId,
      productType,
    });

    try {
      const verified = await getListingsItem(accountId, sellerId, sellerSku, marketplaceId);
      if (!readGtinExemptionFromAttributes(verified.attributes, marketplaceId)) {
        logger.warn(
          {
            sellerSku,
            hint:
              formatGtinExemptionHintFromIssues(submission?.issues) ??
              'Isenção de ID externa não persistiu na Amazon — marque manualmente "Este produto não tem uma ID do produto" ou confirme isenção GTIN/EAN aprovada.',
          },
          "Amazon GTIN exemption missing after create retries",
        );
      }
    } catch (err) {
      if (err instanceof AmazonListingError) throw err;
      logger.warn(
        {
          sellerSku,
          err: err instanceof Error ? err.message : String(err),
        },
        "Could not verify GTIN exemption after create",
      );
    }
  }

  let item: AmazonListingsItem | null = null;
  try {
    item = await getListingsItem(accountId, sellerId, sellerSku, marketplaceId);
  } catch (err) {
    logger.warn(
      { accountId, sellerSku, err: err instanceof Error ? err.message : String(err) },
      "Amazon getListingsItem after put failed; listing may still be processing",
    );
  }

  if (!item) {
    // Não inventar BUYABLE: grava como submetido para o vendedor ver no iHub com status realista.
    item = {
      sku: sellerSku,
      summaries: [
        {
          marketplaceId,
          asin: asin ?? undefined,
          productType,
          itemName: input.title,
          status: ["SUBMITTED"],
          mainImage: input.imageUrls?.[0] ? { link: input.imageUrls[0] } : undefined,
        },
      ],
      offers: [
        {
          marketplaceId,
          price: { currencyCode: "BRL", amount: input.price },
        },
      ],
      fulfillmentAvailability: [
        { fulfillmentChannelCode: "DEFAULT", quantity: input.availableQuantity },
      ],
    };
  }

  const productId = await upsertProductFromAmazonListing(accountId, item);
  return { sku: sellerSku, productId, submissionId: submission?.submissionId };
}

export async function patchAmazonListingQuantity(
  accountId: string,
  sellerSku: string,
  quantity: number,
  productType?: string | null,
): Promise<AmazonListingsItem> {
  if (typeof quantity !== "number" || quantity < 0) {
    throw new AmazonListingError("Quantidade inválida", "VALIDATION_ERROR");
  }

  const account = await loadAmazonAccount(accountId);
  const sellerId = resolveAmazonSellerId(account);
  const marketplaceId =
    account.amazonMarketplaceId || process.env.AMAZON_MARKETPLACE_ID || "A2Q3Y263D00KWC";

  let resolvedType = productType?.trim() || "";
  if (!resolvedType) {
    const current = await getListingsItem(accountId, sellerId, sellerSku, marketplaceId);
    resolvedType = extractListingSummary(current)?.productType ?? "";
  }
  if (!resolvedType) {
    throw new AmazonListingError(
      "productType desconhecido para o anúncio; sincronize a conta ou informe amazonProductType",
      "VALIDATION_ERROR",
    );
  }

  const body = {
    productType: resolvedType,
    patches: [
      {
        op: "replace",
        path: "/attributes/fulfillment_availability",
        value: [
          {
            fulfillment_channel_code: "DEFAULT",
            quantity,
          },
        ],
      },
    ],
  };

  try {
    const submission = await amazon.patch<AmazonListingsSubmissionResponse>(
      accountId,
      listingsItemPath(sellerId, sellerSku, marketplaceId),
      body,
    );
    assertSubmissionAccepted(submission, sellerSku);
  } catch (firstErr) {
    const usedCachedType = !!productType?.trim();
    if (!usedCachedType) {
      if (firstErr instanceof AmazonListingError) throw firstErr;
      throw new AmazonListingError(
        firstErr instanceof Error ? firstErr.message : String(firstErr),
        "AMAZON_API_ERROR",
      );
    }

    // productType do banco pode estar desatualizado — tenta o tipo ao vivo uma vez.
    let liveType = "";
    try {
      const current = await getListingsItem(accountId, sellerId, sellerSku, marketplaceId);
      liveType = extractListingSummary(current)?.productType?.trim() || "";
    } catch {
      /* keep empty */
    }
    if (!liveType || liveType === resolvedType) {
      if (firstErr instanceof AmazonListingError) throw firstErr;
      throw new AmazonListingError(
        firstErr instanceof Error ? firstErr.message : String(firstErr),
        "AMAZON_API_ERROR",
      );
    }

    logger.info(
      { sellerSku, accountId, cachedType: resolvedType, liveType },
      "Amazon quantity patch retry with live productType",
    );
    try {
      const submission = await amazon.patch<AmazonListingsSubmissionResponse>(
        accountId,
        listingsItemPath(sellerId, sellerSku, marketplaceId),
        { productType: liveType, patches: body.patches },
      );
      assertSubmissionAccepted(submission, sellerSku);
    } catch (retryErr) {
      if (retryErr instanceof AmazonListingError) throw retryErr;
      throw new AmazonListingError(
        retryErr instanceof Error ? retryErr.message : String(retryErr),
        "AMAZON_API_ERROR",
      );
    }
  }

  // GET após PATCH costuma vir com quantidade antiga (consistência eventual).
  // Sobrescreve com a quantidade aceita para o iHub espelhar corretamente.
  try {
    const fresh = await getListingsItem(accountId, sellerId, sellerSku, marketplaceId);
    const channels = [...(fresh.fulfillmentAvailability ?? [])];
    let replaced = false;
    for (let i = 0; i < channels.length; i++) {
      const ch = channels[i]!;
      if (ch.fulfillmentChannelCode === "DEFAULT" || ch.quantity != null) {
        channels[i] = { ...ch, quantity };
        replaced = true;
      }
    }
    if (!replaced) {
      channels.push({ fulfillmentChannelCode: "DEFAULT", quantity });
    }
    return { ...fresh, sku: sellerSku, fulfillmentAvailability: channels };
  } catch (err) {
    logger.warn(
      { sellerSku, accountId, err: err instanceof Error ? err.message : String(err) },
      "Amazon getListingsItem after quantity patch failed — using requested quantity",
    );
    return {
      sku: sellerSku,
      fulfillmentAvailability: [{ fulfillmentChannelCode: "DEFAULT", quantity }],
    };
  }
}

export async function patchAmazonListingPrice(
  accountId: string,
  sellerSku: string,
  price: number,
  productType?: string | null,
): Promise<AmazonListingsItem> {
  if (typeof price !== "number" || price <= 0) {
    throw new AmazonListingError("Preço inválido", "VALIDATION_ERROR");
  }

  const account = await loadAmazonAccount(accountId);
  const sellerId = resolveAmazonSellerId(account);
  const marketplaceId =
    account.amazonMarketplaceId || process.env.AMAZON_MARKETPLACE_ID || "A2Q3Y263D00KWC";

  let resolvedType = productType?.trim() || "";
  if (!resolvedType) {
    const current = await getListingsItem(accountId, sellerId, sellerSku, marketplaceId);
    resolvedType = extractListingSummary(current)?.productType ?? "";
  }
  if (!resolvedType) {
    throw new AmazonListingError("productType desconhecido para o anúncio", "VALIDATION_ERROR");
  }

  const body = {
    productType: resolvedType,
    patches: [
      {
        op: "replace",
        path: "/attributes/purchasable_offer",
        value: buildPurchasableOffer(price, marketplaceId),
      },
    ],
  };

  try {
    const submission = await amazon.patch<AmazonListingsSubmissionResponse>(
      accountId,
      listingsItemPath(sellerId, sellerSku, marketplaceId),
      body,
    );
    assertSubmissionAccepted(submission, sellerSku);
  } catch (err) {
    if (err instanceof AmazonListingError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new AmazonListingError(message, "AMAZON_API_ERROR");
  }

  return getListingsItem(accountId, sellerId, sellerSku, marketplaceId);
}

export async function updateAmazonListing(
  accountId: string,
  sellerSku: string,
  updates: { price?: number; availableQuantity?: number; productType?: string | null },
): Promise<AmazonListingsItem> {
  let last: AmazonListingsItem | null = null;
  if (typeof updates.availableQuantity === "number") {
    last = await patchAmazonListingQuantity(
      accountId,
      sellerSku,
      updates.availableQuantity,
      updates.productType,
    );
  }
  if (typeof updates.price === "number") {
    last = await patchAmazonListingPrice(accountId, sellerSku, updates.price, updates.productType);
  }
  if (!last) {
    const account = await loadAmazonAccount(accountId);
    const sellerId = resolveAmazonSellerId(account);
    const marketplaceId =
      account.amazonMarketplaceId || process.env.AMAZON_MARKETPLACE_ID || "A2Q3Y263D00KWC";
    last = await getListingsItem(accountId, sellerId, sellerSku, marketplaceId);
  }
  await upsertProductFromAmazonListing(accountId, last);
  return last;
}
