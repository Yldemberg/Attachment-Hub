import { getDb } from "./db";
import { accountsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const ML_BASE_URL = "https://api.mercadolibre.com";
const ML_AUTH_URL = "https://auth.mercadolivre.com.br";
const ML_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;

export function getMlAuthUrl(state: string): string {
  const clientId = process.env.ML_CLIENT_ID;
  const redirectUri = process.env.ML_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    throw new Error("ML_CLIENT_ID and ML_REDIRECT_URI must be set");
  }
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
  });
  return `${ML_AUTH_URL}/authorization?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user_id: number;
  token_type: string;
  scope: string;
}> {
  const clientId = process.env.ML_CLIENT_ID;
  const clientSecret = process.env.ML_CLIENT_SECRET;
  const redirectUri = process.env.ML_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("ML credentials not configured");
  }
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  });
  const res = await fetch(`${ML_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ML token exchange failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
    user_id: number;
    token_type: string;
    scope: string;
  }>;
}

async function refreshAccessToken(accountId: string): Promise<string> {
  const db = getDb();
  const [account] = await db
    .select()
    .from(accountsTable)
    .where(eq(accountsTable.id, accountId));

  if (!account?.refreshToken) {
    throw new Error("No refresh token available");
  }

  const clientId = process.env.ML_CLIENT_ID;
  const clientSecret = process.env.ML_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("ML credentials not configured");
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: account.refreshToken,
  });

  const res = await fetch(`${ML_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    logger.warn({ accountId, status: res.status }, "ML token refresh failed");
    await db
      .update(accountsTable)
      .set({ isActive: false })
      .where(eq(accountsTable.id, accountId));
    throw new Error(`ML token refresh failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  const expiresAt = new Date(Date.now() + data.expires_in * 1000);
  await db
    .update(accountsTable)
    .set({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      tokenExpiresAt: expiresAt,
    })
    .where(eq(accountsTable.id, accountId));

  return data.access_token;
}

async function getValidToken(accountId: string): Promise<string> {
  const db = getDb();
  const [account] = await db
    .select()
    .from(accountsTable)
    .where(eq(accountsTable.id, accountId));

  if (!account) throw new Error("Account not found");
  if (!account.isActive) throw new Error("Account is inactive");

  const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000);
  if (!account.tokenExpiresAt || account.tokenExpiresAt < fiveMinFromNow) {
    return refreshAccessToken(accountId);
  }

  return account.accessToken!;
}

async function mlFetch<T>(
  accountId: string,
  path: string,
  options: RequestInit = {},
  retries = MAX_RETRIES,
): Promise<T> {
  const token = await getValidToken(accountId);
  const url = path.startsWith("http") ? path : `${ML_BASE_URL}${path}`;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30000);
      await new Promise((r) => setTimeout(r, delay));
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ML_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(options.headers as Record<string, string>),
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (res.status === 429) {
        lastError = new Error("Rate limited by Mercado Livre");
        continue;
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`ML API ${res.status}: ${text}`);
      }

      return res.json() as Promise<T>;
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = err as Error;
      if ((err as Error).name === "AbortError") {
        lastError = new Error("ML API request timed out");
      }
      if (attempt === retries - 1) break;
    }
  }

  throw lastError ?? new Error("ML API request failed");
}

export const ml = {
  get: <T>(accountId: string, path: string) =>
    mlFetch<T>(accountId, path, { method: "GET" }),

  post: <T>(accountId: string, path: string, body: unknown) =>
    mlFetch<T>(accountId, path, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  put: <T>(accountId: string, path: string, body: unknown) =>
    mlFetch<T>(accountId, path, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
};

export type MlUser = {
  id: number;
  nickname: string;
  email: string;
};

export type MlItem = {
  id: string;
  title: string;
  price: number;
  available_quantity: number;
  sold_quantity: number;
  status: string;
  listing_type_id: string;
  shipping: { logistic_type: string };
  seller_custom_field?: string;
  thumbnail: string;
  permalink: string;
  category_id: string;
};

export type MlOrder = {
  id: number;
  status: string;
  total_amount: number;
  currency_id: string;
  buyer: { id: number; nickname: string };
  shipping: { id: number; status: string };
  date_created: string;
  date_closed: string;
  order_items: Array<{
    item: { id: string; title: string };
    quantity: number;
    unit_price: number;
  }>;
};

export type MlQuestion = {
  id: number;
  item_id: string;
  text: string;
  status: string;
  from: { id: number; nickname: string };
  answer?: { text: string; date_created: string };
  date_created: string;
};
