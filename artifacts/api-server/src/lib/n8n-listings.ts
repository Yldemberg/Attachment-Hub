const PREPARE_TIMEOUT_MS = 120_000;
const PUBLISH_TIMEOUT_MS = 60_000;

export type N8nListingAttribute = {
  id: string;
  value_name?: string;
  value_id?: string | null;
};

export type N8nListingPicture = {
  source: string;
};

export type N8nListingAttributeReview = {
  id: string;
  name: string;
  valor: { value_name?: string; value_id?: string | null };
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
  };
  _description?: string;
  _attributes_ainda_pendentes?: Record<string, unknown>[];
  _attributes_preenchidos_inteligente?: N8nListingAttributeReview[];
  _attributes_ficticios?: N8nListingAttributeReview[];
  _asin?: string | null;
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

function getPublishWebhookUrl(): string {
  const url = process.env.N8N_PUBLISH_WEBHOOK_URL?.trim();
  if (!url) {
    throw new N8nListingError("N8N_PUBLISH_WEBHOOK_URL não configurada", 500);
  }
  return url;
}

function isSupportedProductUrl(productUrl: string): boolean {
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

function parseN8nDraftResponse(body: unknown): N8nListingDraft {
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

  if (body && typeof body === "object" && "data" in body) {
    const data = (body as { data?: unknown }).data;
    return parseN8nDraftResponse(data);
  }

  throw new N8nListingError("N8N retornou um formato de resposta inválido");
}

async function callN8nWebhook(
  url: string,
  payload: Record<string, unknown>,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const text = await res.text();
    let body: unknown = null;
    if (text.trim()) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = text;
      }
    }

    if (!res.ok) {
      const message =
        typeof body === "object" &&
        body !== null &&
        "message" in body &&
        typeof (body as { message?: unknown }).message === "string"
          ? (body as { message: string }).message
          : `N8N respondeu com status ${res.status}`;
      throw new N8nListingError(message);
    }

    return body;
  } catch (err) {
    if (err instanceof N8nListingError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new N8nListingError("Tempo esgotado ao aguardar resposta do N8N");
    }
    throw new N8nListingError(
      err instanceof Error ? err.message : "Falha ao comunicar com N8N",
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function prepareListingFromLink(input: {
  accountId: string;
  productUrl: string;
  userId: string;
}): Promise<N8nListingDraft> {
  const productUrl = input.productUrl.trim();
  if (!productUrl) {
    throw new N8nListingError("Informe o link do produto", 400);
  }
  if (!isSupportedProductUrl(productUrl)) {
    throw new N8nListingError("Link inválido. Use um produto da Amazon ou Shopee.", 400);
  }

  const body = await callN8nWebhook(
    getPrepareWebhookUrl(),
    {
      productUrl,
      accountId: input.accountId,
      userId: input.userId,
    },
    PREPARE_TIMEOUT_MS,
  );

  return parseN8nDraftResponse(body);
}

export async function publishListingDraft(input: {
  accountId: string;
  draft: N8nListingDraft;
  userId: string;
}): Promise<{ ok: true; message?: string }> {
  if (!input.draft?.payload) {
    throw new N8nListingError("Rascunho inválido", 400);
  }

  const body = await callN8nWebhook(
    getPublishWebhookUrl(),
    {
      accountId: input.accountId,
      userId: input.userId,
      draft: input.draft,
    },
    PUBLISH_TIMEOUT_MS,
  );

  if (body && typeof body === "object" && "ok" in body) {
    const ok = Boolean((body as { ok?: unknown }).ok);
    const message =
      "message" in body && typeof (body as { message?: unknown }).message === "string"
        ? (body as { message: string }).message
        : undefined;
    if (!ok) {
      throw new N8nListingError(message ?? "N8N não confirmou a publicação");
    }
    return { ok: true, message };
  }

  return { ok: true };
}
