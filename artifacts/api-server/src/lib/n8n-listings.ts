import crypto from "crypto";

const N8N_DISPATCH_TIMEOUT_MS = 30_000;

export type N8nListingAttribute = {
  id: string;
  value_name?: string;
  value_id?: string | null;
};

export type N8nListingPicture = {
  source: string;
};

export type N8nListingSaleTerm = {
  id: string;
  value_name?: string;
  value_id?: string | null;
};

export type N8nListingShipping = {
  local_pick_up?: boolean;
  mode?: string;
  free_shipping?: boolean;
  [key: string]: unknown;
};

export type N8nListingAttributeReview = {
  id: string;
  name: string;
  valor: { value_name?: string; value_id?: string | null };
};

export type IhubUiCampoDestino = "attributes" | "sale_terms" | "shipping" | "description";

export type IhubUiCampo = {
  id: string;
  label: string;
  obrigatorio?: boolean;
  destino_payload: IhubUiCampoDestino;
  valor?: unknown;
  value_name?: string | null;
  value_id?: string | null;
  tipo?: "string" | "number" | "boolean" | "select" | "textarea";
  opcoes?: Array<{ id: string; name: string }>;
  somente_leitura?: boolean;
  hint?: string;
  [key: string]: unknown;
};

export type IhubUiSecao = {
  id: string;
  titulo: string;
  status: "pendente" | "completo" | "somente_leitura";
  campos: IhubUiCampo[];
  [key: string]: unknown;
};

export type IhubUiMeta = {
  secoes?: IhubUiSecao[];
  campos_editaveis?: IhubUiCampo[];
  [key: string]: unknown;
};

export type N8nListingDraft = {
  payload: {
    category_id: string;
    price?: number;
    currency_id?: string;
    available_quantity: number;
    buying_mode?: string;
    listing_type_id: string;
    condition: "new" | "used";
    pictures: N8nListingPicture[];
    attributes: N8nListingAttribute[];
    family_name: string;
    sale_terms?: N8nListingSaleTerm[];
    shipping?: N8nListingShipping;
  };
  _description?: string;
  _attributes_ainda_pendentes?: Record<string, unknown>[];
  _attributes_preenchidos_inteligente?: N8nListingAttributeReview[];
  _attributes_ficticios?: N8nListingAttributeReview[];
  _asin?: string | null;
  _pronto_para_publicar?: boolean;
  _erros_validacao_ml?: Record<string, unknown>[];
  _ihub_ui?: IhubUiMeta;
};

/** Draft for Amazon SP-API Listings Items (when targetPlatform=amazon). */
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
  _scraped_attributes?: Array<{ key: string; value: string }>;
  _pronto_para_publicar?: boolean;
  _product_type_sugerido?: string;
  _bloqueios?: unknown[];
  _ihub_ui?: IhubUiMeta;
  [key: string]: unknown;
};

export type ListingTargetPlatform = "mercadolivre" | "amazon";

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

export class N8nListingError extends Error {
  constructor(
    message: string,
    readonly statusCode = 502,
  ) {
    super(message);
    this.name = "N8nListingError";
  }
}

function getPrepareWebhookUrl(targetPlatform: ListingTargetPlatform = "mercadolivre"): string {
  if (targetPlatform === "amazon") {
    const amazonUrl = process.env.N8N_AMAZON_PREPARE_WEBHOOK_URL?.trim();
    if (!amazonUrl) {
      throw new N8nListingError(
        "N8N_AMAZON_PREPARE_WEBHOOK_URL não configurada (workflow Amazon separado: /webhook/criar_anuncio_amazon)",
        500,
      );
    }
    return amazonUrl;
  }
  const url = process.env.N8N_PREPARE_WEBHOOK_URL?.trim();
  if (!url) {
    throw new N8nListingError("N8N_PREPARE_WEBHOOK_URL não configurada", 500);
  }
  return url;
}

export function isSupportedProductUrl(productUrl: string): boolean {
  try {
    const host = new URL(productUrl).hostname.toLowerCase();
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

export function parseN8nDraftResponse(body: unknown): N8nListingDraft {
  if (Array.isArray(body)) {
    if (body.length === 0) {
      throw new N8nListingError("N8N retornou uma resposta vazia");
    }
    const first = body[0];
    if (first && typeof first === "object" && "payload" in first) {
      if (isAmazonListingDraft(first)) {
        throw new N8nListingError("Draft Amazon recebido onde se esperava Mercado Livre");
      }
      return first as N8nListingDraft;
    }
    throw new N8nListingError("N8N retornou um formato de rascunho inválido");
  }

  if (body && typeof body === "object" && "payload" in body) {
    if (isAmazonListingDraft(body)) {
      throw new N8nListingError("Draft Amazon recebido onde se esperava Mercado Livre");
    }
    return body as N8nListingDraft;
  }

  if (body && typeof body === "object" && "draft" in body) {
    return parseN8nDraftResponse((body as { draft?: unknown }).draft);
  }

  if (body && typeof body === "object" && "data" in body) {
    return parseN8nDraftResponse((body as { data?: unknown }).data);
  }

  throw new N8nListingError("N8N retornou um formato de resposta inválido");
}

/** Accept ML or Amazon draft from webhook / job storage. */
export function parseListingPrepareDraft(
  body: unknown,
): N8nListingDraft | N8nAmazonListingDraft {
  const unwrap = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      if (value.length === 0) throw new N8nListingError("N8N retornou uma resposta vazia");
      return value[0];
    }
    if (value && typeof value === "object" && "draft" in value) {
      return (value as { draft?: unknown }).draft;
    }
    if (value && typeof value === "object" && "data" in value && !("payload" in value)) {
      return (value as { data?: unknown }).data;
    }
    return value;
  };

  const draft = unwrap(body);
  if (isAmazonListingDraft(draft)) {
    const p = draft.payload;
    if (!p.sellerSku?.trim() || !p.productType?.trim()) {
      throw new N8nListingError("Draft Amazon sem sellerSku ou productType");
    }
    if (!p.attributes || typeof p.attributes !== "object") {
      throw new N8nListingError("Draft Amazon sem attributes SP-API");
    }
    return draft;
  }

  return parseN8nDraftResponse(draft);
}

export function verifyN8nWebhookSecret(
  authHeader: string | undefined,
  secretHeader: string | undefined,
): boolean {
  const secret = process.env.N8N_WEBHOOK_SECRET?.trim();
  if (!secret) return true;

  const provided = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1] ?? secretHeader;
  if (!provided || provided.length !== secret.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
}

/** Fire-and-forget dispatch to N8N; N8N completes via callback webhook. */
export async function dispatchPrepareToN8n(input: {
  jobId: string;
  productUrl: string;
  accountId: string;
  userId: string;
  callbackUrl: string;
  targetPlatform: ListingTargetPlatform;
}): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), N8N_DISPATCH_TIMEOUT_MS);

  try {
    const res = await fetch(getPrepareWebhookUrl(input.targetPlatform), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId: input.jobId,
        productUrl: input.productUrl,
        accountId: input.accountId,
        userId: input.userId,
        callbackUrl: input.callbackUrl,
        targetPlatform: input.targetPlatform,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      let message = `N8N respondeu com status ${res.status}`;
      try {
        const parsed = JSON.parse(text) as { message?: string };
        if (parsed.message) message = parsed.message;
      } catch {
        if (text.trim()) message = text.slice(0, 200);
      }
      throw new N8nListingError(message);
    }
  } catch (err) {
    if (err instanceof N8nListingError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new N8nListingError("N8N não respondeu a tempo ao iniciar a preparação");
    }
    throw new N8nListingError(
      err instanceof Error ? err.message : "Falha ao comunicar com N8N",
    );
  } finally {
    clearTimeout(timer);
  }
}
