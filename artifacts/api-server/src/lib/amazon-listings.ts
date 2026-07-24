import { getDb } from "./db";
import { accountsTable, productsTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import {
  amazon,
  extractListingPrice,
  extractListingQuantity,
  extractListingSummary,
  formatAmazonListingsIssues,
  getCatalogProductTypeForAsin,
  getListingsItem,
  listingsItemPath,
  resolveAmazonSellerId,
  type AmazonListingsItem,
  type AmazonListingsSubmissionResponse,
} from "./amazon";
import { logger } from "./logger";

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
};

function attrLocaleValue(value: string | number, marketplaceId: string) {
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
  if (type.includes("BAG") || /bolsa|bag|carteira/.test(titleL)) return "handbags";
  return "unisex";
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

  // Precificação SP-API (BR): our_price + list_price com value_with_tax
  normalizeAmazonPricingAttributes(attrs, marketplaceId, opts.price);

  // Produto novo: sempre isento de GTIN/EAN (Amazon mostra "não possui GTIN/EAN")
  if (opts.createNewCatalogProduct) {
    delete attrs.externally_assigned_product_identifier;
    attrs.supplier_declared_has_product_identifier_exemption = [
      { value: true, marketplace_id: marketplaceId },
    ];
  }

  // model_name: limite prático no iHub (schema Amazon costuma aceitar bem mais que 12)
  truncateAmazonLocaleAttr(attrs, "model_name", 120);

  // item_length_width_height estruturado
  if (!isStructuredAmazonDimension(attrs.item_length_width_height)) {
    const sources = [
      ...collectDimensionSourceTexts(attrs),
      ...(opts.scrapedTexts || []),
    ];
    let parsed: ReturnType<typeof parseAmazonItemDimensions> = null;
    for (const text of sources) {
      parsed = parseAmazonItemDimensions(text);
      if (parsed) break;
    }
    if (parsed) {
      attrs.item_length_width_height = [
        {
          length: { value: parsed.length, unit: parsed.unit },
          width: { value: parsed.width, unit: parsed.unit },
          height: { value: parsed.height, unit: parsed.unit },
          marketplace_id: marketplaceId,
        },
      ];
    }
  }

  // Remove atributos de dimensão em texto livre que confundem a SP-API
  for (const key of Object.keys(attrs)) {
    if (key === "item_length_width_height" || key === "item_package_dimensions") continue;
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
  const attrs: Record<string, unknown> = {
    merchant_suggested_asin: [{ value: asin, marketplace_id: marketplaceId }],
    condition_type: attrLocaleValue(condition, marketplaceId),
    fulfillment_availability: [
      {
        fulfillment_channel_code: "DEFAULT",
        quantity: input.availableQuantity,
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

function buildCreateAttributes(
  input: CreateAmazonListingInput,
  marketplaceId: string,
): Record<string, unknown> {
  const condition = input.condition ?? "new_new";
  const fromDraft = input.attributes ? { ...input.attributes } : {};

  // Base offer/product facts — draft attrs can fill gaps, but we keep critical offer fields.
  const attrs: Record<string, unknown> = {
    ...fromDraft,
    item_name: fromDraft.item_name ?? attrLocalizedText(input.title, marketplaceId),
    condition_type:
      fromDraft.condition_type ?? attrLocaleValue(condition, marketplaceId),
    fulfillment_availability: fromDraft.fulfillment_availability ?? [
      {
        fulfillment_channel_code: "DEFAULT",
        quantity: input.availableQuantity,
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
    throw new AmazonListingError(
      brandGateHint ||
        (issuesText
          ? `Amazon rejeitou o anúncio: ${issuesText}`
          : "Amazon rejeitou o anúncio (status INVALID). Verifique product type e atributos obrigatórios."),
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
  if (typeof input.availableQuantity !== "number" || input.availableQuantity < 0) {
    throw new AmazonListingError("Quantidade inválida", "VALIDATION_ERROR");
  }

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
  // Mesmo sem vincular, o ASIN fonte ajuda a descobrir o product type correto.
  if (asin) {
    const catalogType = await getCatalogProductTypeForAsin(accountId, asin, marketplaceId);
    if (catalogType) {
      if (catalogType !== productType) {
        logger.info(
          { asin, fromDraft: productType, catalogType, matchCatalog },
          "Using catalog productType for Amazon listing",
        );
      }
      productType = catalogType;
    }
  }

  const attributesRaw =
    matchCatalog && requirements === "LISTING_OFFER_ONLY" && asin
      ? buildOfferAttributes(input, marketplaceId, asin)
      : buildCreateAttributes(input, marketplaceId);

  let attributes =
    matchCatalog && requirements === "LISTING_OFFER_ONLY"
      ? attributesRaw
      : ensureRequiredAmazonListingAttributes(attributesRaw, {
          marketplaceId,
          productType,
          title: input.title,
          price: input.price,
          createNewCatalogProduct: !matchCatalog,
        });

  if (!matchCatalog) {
    delete attributes.merchant_suggested_asin;
  }

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
      hasMerchantSuggestedAsin: !!attributes.merchant_suggested_asin,
    },
    "Amazon putListingsItem request",
  );

  let submission: AmazonListingsSubmissionResponse | undefined;
  try {
    submission = await amazon.put<AmazonListingsSubmissionResponse>(
      accountId,
      listingsItemPath(sellerId, sellerSku, marketplaceId),
      body,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ accountId, sellerSku, message, requirements }, "Amazon putListingsItem failed");
    throw new AmazonListingError(message, "AMAZON_API_ERROR");
  }

  assertSubmissionAccepted(submission, sellerSku);

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
  } catch (err) {
    if (err instanceof AmazonListingError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new AmazonListingError(message, "AMAZON_API_ERROR");
  }

  return getListingsItem(accountId, sellerId, sellerSku, marketplaceId);
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
