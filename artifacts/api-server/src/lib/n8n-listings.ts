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

export class N8nListingError extends Error {
  constructor(
    message: string,
    readonly statusCode = 502,
  ) {
    super(message);
    this.name = "N8nListingError";
  }
}

function getPrepareWebhookUrl(): string {
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
      return first as N8nListingDraft;
    }
    throw new N8nListingError("N8N retornou um formato de rascunho inválido");
  }

  if (body && typeof body === "object" && "payload" in body) {
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
}): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), N8N_DISPATCH_TIMEOUT_MS);

  try {
    const res = await fetch(getPrepareWebhookUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId: input.jobId,
        productUrl: input.productUrl,
        accountId: input.accountId,
        userId: input.userId,
        callbackUrl: input.callbackUrl,
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
