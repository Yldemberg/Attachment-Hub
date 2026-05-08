import {
  DEMO_ACCOUNT,
  DEMO_ME,
  DEMO_DASHBOARD_SUMMARY,
  DEMO_SALES_CHART_7D,
  DEMO_SALES_CHART_30D,
  DEMO_SALES_CHART_90D,
  DEMO_PRODUCTS,
  DEMO_LOW_STOCK_PRODUCTS,
  DEMO_ORDERS,
  DEMO_QUESTIONS,
  DEMO_NOTIFICATIONS,
} from "./mock-data";

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function productListingForMlItem(mlItemId: string | undefined | null): {
  listingThumbnailUrl: string | null;
  listingPermalink: string | null;
} {
  if (!mlItemId) return { listingThumbnailUrl: null, listingPermalink: null };
  const p = DEMO_PRODUCTS.find((pr) => pr.mlItemId === mlItemId);
  return {
    listingThumbnailUrl: (p?.thumbnail as string | undefined) ?? null,
    listingPermalink: (p as { permalink?: string | null } | undefined)?.permalink ?? null,
  };
}

function paginate<T>(items: T[], page: number, limit: number) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.max(1, Math.min(page, totalPages));
  const start = (safePage - 1) * limit;
  const data = items.slice(start, start + limit);
  return { data, pagination: { page: safePage, limit, total, totalPages } };
}

function parseSearch(url: string): URLSearchParams {
  const idx = url.indexOf("?");
  return new URLSearchParams(idx >= 0 ? url.slice(idx + 1) : "");
}

function getNum(params: URLSearchParams, key: string, def: number): number {
  const v = params.get(key);
  return v !== null && !isNaN(Number(v)) ? Number(v) : def;
}

function pathAfterApi(url: string): string {
  const match = url.match(/\/api(\/.*?)(\?|$)/);
  return match ? match[1] : "";
}

type DemoQuestion = (typeof DEMO_QUESTIONS)[number] & { answerText: string | null };
type DemoNotification = (typeof DEMO_NOTIFICATIONS)[number];
type DemoProduct = (typeof DEMO_PRODUCTS)[number];

let _mockQuestions: DemoQuestion[] = DEMO_QUESTIONS.map((q) => ({ ...q }));
let _mockNotifications: DemoNotification[] = DEMO_NOTIFICATIONS.map((n) => ({ ...n }));
let _mockProducts: DemoProduct[] = DEMO_PRODUCTS.map((p) => ({ ...p }));
/** Estoque mandatário demo por SKU */
let _mockMandateQty: Record<string, number> = {};
/** Imposto / preço de compra demo por SKU */
let _mockSkuFinancials: Record<string, { taxPercent: number | null; purchasePrice: number | null }> = {};

const _originalFetch = globalThis.fetch;

export function installMockFetch(): void {
  globalThis.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const path = pathAfterApi(rawUrl);
    const params = parseSearch(rawUrl);

    const page = getNum(params, "page", 1);
    const limit = getNum(params, "limit", 20);

    if (path === "/auth/me") {
      return jsonResponse(DEMO_ME);
    }

    if (path === "/accounts") {
      return jsonResponse({ data: [DEMO_ACCOUNT] });
    }

    if (path.match(/^\/accounts\/[^/]+$/) && method === "GET") {
      return jsonResponse(DEMO_ACCOUNT);
    }

    if (path.match(/^\/accounts\/[^/]+\/sync$/) && method === "POST") {
      return jsonResponse({ message: "Sync iniciada com sucesso (modo demo)" });
    }

    if (path === "/accounts/connect/url") {
      return jsonResponse({ url: "#demo" });
    }

    if (path === "/dashboard/summary") {
      const criticalCount = _mockProducts.filter((p) => (p.availableQuantity ?? 0) < 5).length;
      const unansweredCount = _mockQuestions.filter((q) => q.status === "unanswered").length;
      return jsonResponse({ ...DEMO_DASHBOARD_SUMMARY, criticalStockCount: criticalCount, unansweredQuestions: unansweredCount });
    }

    if (path === "/dashboard/sales-chart") {
      const period = params.get("period") ?? "30d";
      if (period === "7d") return jsonResponse(DEMO_SALES_CHART_7D);
      if (period === "90d") return jsonResponse(DEMO_SALES_CHART_90D);
      return jsonResponse(DEMO_SALES_CHART_30D);
    }

    if (path === "/dashboard/sales-report") {
      const dateFrom = params.get("date_from") ?? "";
      const dateTo = params.get("date_to") ?? "";
      const format = (params.get("format") ?? "json").toLowerCase();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
        return jsonResponse(
          { error: { code: "BAD_REQUEST", message: "date_from e date_to são obrigatórios (YYYY-MM-DD)" } },
          400,
        );
      }
      const paid = DEMO_ORDERS.filter((o) => o.status === "paid" || o.status === "confirmed");
      const rows = paid
        .map((o) => {
          const created = typeof o.createdAt === "string" ? o.createdAt : String(o.createdAt);
          const ref = created.slice(0, 10);
          return { ref, o };
        })
        .filter((x) => x.ref >= dateFrom && x.ref <= dateTo)
        .map((x) => ({
          referenceDate: x.ref,
          mlOrderId: Number(x.o.mlOrderId),
          accountNickname: x.o.account?.mlNickname ?? null,
          totalAmount: x.o.totalAmount as number,
          currencyId: x.o.currencyId ?? "BRL",
          buyerNickname: null as string | null,
          status: x.o.status,
        }));
      const summary = {
        orderCount: rows.length,
        revenue: rows.reduce((s, r) => s + (r.totalAmount ?? 0), 0),
      };
      if (format === "json") {
        return jsonResponse({
          period: { dateFrom, dateTo },
          summary,
          rows,
        });
      }
      if (format === "csv") {
        const header = "Data,Pedido ML,Conta,Valor,Moeda,Comprador,Status";
        const lines = rows.map(
          (r) =>
            `${r.referenceDate},${r.mlOrderId},"${(r.accountNickname ?? "").replace(/"/g, '""')}",${r.totalAmount ?? ""},${r.currencyId ?? ""},,"${r.status ?? ""}"`,
        );
        const body = "\uFEFF" + [header, ...lines].join("\n");
        return new Response(body, {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="relatorio-vendas_${dateFrom}_${dateTo}.csv"`,
          },
        });
      }
      return _originalFetch(input, init);
    }

    if (path === "/products/low-stock") {
      const lowStock = _mockProducts.filter((p) => (p.availableQuantity ?? 0) < 5);
      return jsonResponse({ data: lowStock });
    }

    if (path === "/products") {
      let filtered = [..._mockProducts];
      const search = params.get("search");
      if (search && search.trim()) {
        const tokens = search
          .trim()
          .split(/\s+/)
          .map((t) => t.trim().toLowerCase())
          .filter((t) => t.length > 0);
        filtered = filtered.filter((p) => {
          const hay = [
            p.title ?? "",
            p.sku ?? "",
            p.mlItemId ?? "",
            JSON.stringify((p as Record<string, unknown>).variationsJson ?? ""),
          ]
            .join(" ")
            .toLowerCase();
          return tokens.every((t) => hay.includes(t));
        });
      }
      const listingFilter = params.get("listing_filter") ?? params.get("status");
      if (listingFilter === "active" || listingFilter === "paused" || listingFilter === "closed" || listingFilter === "under_review") {
        filtered = filtered.filter((p) => p.status === listingFilter);
      } else if (listingFilter === "flex") {
        filtered = filtered.filter(
          (p) => p.logisticType === "self_service" || p.isFlex === true,
        );
      } else if (listingFilter === "full") {
        filtered = filtered.filter(
          (p) => p.logisticType === "fulfillment" || p.isFull === true,
        );
      } else if (listingFilter === "catalog") {
        filtered = filtered.filter((p) => p.catalogListing === true);
      } else if (listingFilter === "promo") {
        filtered = filtered.filter((p) => {
          const ra = p.regularAmount;
          const am = p.amount;
          const op = (p as { originalPrice?: number | null }).originalPrice;
          const pr = p.price;
          const byMlPrices =
            ra != null && am != null && Number(ra) > Number(am);
          const byDb =
            op != null && pr != null && Number(op) > Number(pr);
          return byMlPrices || byDb;
        });
      }
      filtered.sort((a, b) => {
        const sa = (a.sku ?? "").trim();
        const sb = (b.sku ?? "").trim();
        const aNoSku = sa.length === 0;
        const bNoSku = sb.length === 0;
        if (aNoSku !== bNoSku) return aNoSku ? 1 : -1;
        const bySku = sa.localeCompare(sb, undefined, { numeric: true, sensitivity: "base" });
        if (bySku !== 0) return bySku;
        return (a.mlItemId ?? "").localeCompare(b.mlItemId ?? "", undefined, { numeric: true, sensitivity: "base" });
      });
      return jsonResponse(paginate(filtered, page, limit));
    }

    if (path.match(/^\/products\/([^/]+)\/status$/) && method === "PATCH") {
      const id = path.split("/")[2];
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse((init?.body as string) ?? "{}");
      } catch {
        /* ignore */
      }
      const st = body.status === "active" || body.status === "paused" ? body.status : null;
      if (!st) {
        return jsonResponse({ error: { message: "status inválido" } }, 400);
      }
      const prod = _mockProducts.find((p) => p.id === id);
      if (!prod) {
        return jsonResponse({ error: { message: "not found" } }, 404);
      }
      if (prod.status !== "active" && prod.status !== "paused") {
        return jsonResponse({ error: { message: "status não permitido" } }, 400);
      }
      _mockProducts = _mockProducts.map((p) => (p.id === id ? { ...p, status: st } : p));
      return jsonResponse({ success: true, productId: id, status: st });
    }

    if (path.match(/^\/products\/sku\/([^/]+)\/stock$/) && method === "PUT") {
      const sku = path.split("/")[3];
      let body: Record<string, unknown> = {};
      try { body = JSON.parse(init?.body as string ?? "{}"); } catch { /* ignore */ }
      const qty = typeof body.quantity === "number" ? body.quantity : null;
      let updated = 0;
      if (qty !== null) {
        _mockProducts = _mockProducts.map((p) => {
          if (p.sku === sku && !p.isFull) {
            updated++;
            return { ...p, availableQuantity: qty };
          }
          return p;
        });
      }
      return jsonResponse({ updated, skipped: 0 });
    }

    if (path.match(/^\/products\/([^/]+)\/stock$/) && method === "PUT") {
      const id = path.split("/")[2];
      let body: Record<string, unknown> = {};
      try { body = JSON.parse(init?.body as string ?? "{}"); } catch { /* ignore */ }
      const qty = typeof body.quantity === "number" ? body.quantity : null;
      if (qty !== null) {
        _mockProducts = _mockProducts.map((p) => p.id === id ? { ...p, availableQuantity: qty } : p);
      }
      return jsonResponse({ success: true });
    }

    if (path.match(/^\/products\/[^/]+$/) && method === "GET") {
      const id = path.split("/")[2];
      const product = _mockProducts.find((p) => p.id === id) ?? _mockProducts[0];
      return jsonResponse(product);
    }

    if (path === "/orders") {
      let filtered = [...DEMO_ORDERS];
      const status = params.get("status");
      if (status) {
        filtered = filtered.filter((o) => o.status === status);
      }
      return jsonResponse(paginate(filtered, page, limit));
    }

    if (path.match(/^\/orders\/[^/]+$/) && method === "GET") {
      const id = path.split("/")[2];
      const order = DEMO_ORDERS.find((o) => o.id === id) ?? DEMO_ORDERS[0];
      return jsonResponse(order);
    }

    if (path === "/questions") {
      let filtered = [..._mockQuestions];
      const status = params.get("status");
      if (status) {
        filtered = filtered.filter((q) => q.status === status);
      }
      const enriched = filtered.map((q) => ({
        ...q,
        ...productListingForMlItem(q.mlItemId),
      }));
      return jsonResponse(paginate(enriched, page, limit));
    }

    if (path.match(/^\/questions\/([^/]+)\/answer$/) && method === "POST") {
      const id = path.split("/")[2];
      let body: Record<string, unknown> = {};
      try { body = JSON.parse(init?.body as string ?? "{}"); } catch { /* ignore */ }
      const text = typeof body.text === "string" ? body.text : "";
      _mockQuestions = _mockQuestions.map((q) =>
        q.id === id ? { ...q, status: "answered", answerText: text } : q
      );
      return jsonResponse({ success: true });
    }

    if (path.match(/^\/questions\/[^/]+$/) && method === "GET") {
      const id = path.split("/")[2];
      const question = _mockQuestions.find((q) => q.id === id) ?? _mockQuestions[0];
      return jsonResponse({
        ...question,
        ...productListingForMlItem(question.mlItemId),
      });
    }

    if (path === "/notifications") {
      let filtered = [..._mockNotifications];
      const isRead = params.get("is_read");
      if (isRead === "false") {
        filtered = filtered.filter((n) => !n.isRead);
      } else if (isRead === "true") {
        filtered = filtered.filter((n) => n.isRead);
      }
      return jsonResponse(paginate(filtered, page, limit));
    }

    if (path.match(/^\/notifications\/([^/]+)\/read$/) && method === "PUT") {
      const id = path.split("/")[2];
      _mockNotifications = _mockNotifications.map((n) =>
        n.id === id ? { ...n, isRead: true } : n
      );
      return jsonResponse({ success: true });
    }

    if (path === "/notifications/read-all" && method === "PUT") {
      const count = _mockNotifications.filter((n) => !n.isRead).length;
      _mockNotifications = _mockNotifications.map((n) => ({ ...n, isRead: true }));
      return jsonResponse({ updated: count });
    }

    if (path === "/inventory/search" && method === "GET") {
      const q = params.get("query")?.trim() ?? "";
      if (!q) {
        return jsonResponse({ error: { code: "BAD_REQUEST", message: "Parâmetro query é obrigatório" } }, 400);
      }
      const tokens = q
        .toLowerCase()
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      let filtered = _mockProducts.filter((p) => !p.isFull && !!p.sku);
      filtered = filtered.filter((p) => {
        const hay = [
          p.title ?? "",
          p.sku ?? "",
          p.mlItemId ?? "",
          JSON.stringify((p as Record<string, unknown>).variationsJson ?? ""),
        ]
          .join(" ")
          .toLowerCase();
        return tokens.every((t) => hay.includes(t));
      });
      const bySku = new Map<string, DemoProduct[]>();
      for (const p of filtered) {
        const sku = p.sku as string;
        const list = bySku.get(sku) ?? [];
        list.push(p);
        bySku.set(sku, list);
      }
      const skus = [...bySku.keys()].sort((a, b) => a.localeCompare(b, "pt-BR"));
      const data = skus.map((sku) => {
        const list = bySku.get(sku)!;
        const rep = list[0];
        const title = (rep.title ?? "").trim();
        const titleShort = title.length <= 72 ? title : `${title.slice(0, 71)}…`;
        return {
          sku,
          mandateQuantity: _mockMandateQty[sku] ?? null,
          taxPercent: _mockSkuFinancials[sku]?.taxPercent ?? null,
          purchasePrice: _mockSkuFinancials[sku]?.purchasePrice ?? null,
          thumbnail: rep.thumbnail ?? null,
          titleShort,
          variationLabel: null as string | null,
          currentStock: rep.availableQuantity ?? 0,
          representativeProductId: rep.id,
          listingCount: list.length,
        };
      });
      return jsonResponse({ data });
    }

    if (path === "/inventory/mandate-adjust" && method === "POST") {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse((init?.body as string) ?? "{}");
      } catch {
        /* ignore */
      }
      const sku = typeof body.sku === "string" ? body.sku.trim() : "";
      const operation = body.operation;
      const amount = typeof body.amount === "number" ? body.amount : -1;
      if (!sku) {
        return jsonResponse({ error: { code: "BAD_REQUEST", message: "sku é obrigatório" } }, 400);
      }
      if (operation !== "add" && operation !== "subtract" && operation !== "set") {
        return jsonResponse({ error: { code: "BAD_REQUEST", message: "operation inválida" } }, 400);
      }
      if (!Number.isInteger(amount) || amount < 0) {
        return jsonResponse({ error: { code: "BAD_REQUEST", message: "amount inválido" } }, 400);
      }
      if ((operation === "add" || operation === "subtract") && amount === 0) {
        return jsonResponse({ error: { code: "BAD_REQUEST", message: "amount deve ser > 0" } }, 400);
      }
      const targets = _mockProducts.filter((p) => p.sku === sku && !p.isFull);
      if (targets.length === 0) {
        return jsonResponse({ error: { code: "NOT_FOUND", message: "SKU não encontrado" } }, 404);
      }
      const baseline =
        _mockMandateQty[sku] !== undefined
          ? _mockMandateQty[sku]
          : Math.min(...targets.map((p) => p.availableQuantity ?? 0));
      let mandateQty: number;
      if (operation === "set") mandateQty = amount;
      else if (operation === "add") mandateQty = baseline + amount;
      else mandateQty = Math.max(0, baseline - amount);
      _mockMandateQty[sku] = mandateQty;
      const results: Array<{ productId: string; mlItemId: string; success: boolean; reason: string | null }> = [];
      let updated = 0;
      let failed = 0;
      _mockProducts = _mockProducts.map((p) => {
        if (p.sku !== sku || p.isFull) return p;
        updated++;
        results.push({ productId: p.id, mlItemId: p.mlItemId, success: true, reason: null });
        return { ...p, availableQuantity: mandateQty };
      });
      return jsonResponse({ sku, mandateQuantity: mandateQty, updated, failed, results });
    }

    if (path.match(/^\/inventory\/sku\/([^/]+)\/financials$/) && method === "PATCH") {
      const skuEnc = path.split("/")[3];
      let sku = skuEnc;
      try {
        sku = decodeURIComponent(skuEnc);
      } catch {
        sku = skuEnc;
      }
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse((init?.body as string) ?? "{}");
      } catch {
        /* ignore */
      }
      const prev = _mockSkuFinancials[sku] ?? { taxPercent: null as number | null, purchasePrice: null as number | null };
      let taxPercent = prev.taxPercent;
      let purchasePrice = prev.purchasePrice;
      if ("taxPercent" in body) {
        taxPercent = body.taxPercent === null ? null : typeof body.taxPercent === "number" ? body.taxPercent : taxPercent;
      }
      if ("purchasePrice" in body) {
        purchasePrice =
          body.purchasePrice === null
            ? null
            : typeof body.purchasePrice === "number"
              ? body.purchasePrice
              : purchasePrice;
      }
      _mockSkuFinancials[sku] = { taxPercent, purchasePrice };
      return jsonResponse({ sku, taxPercent, purchasePrice });
    }

    if (path === "/healthz") {
      return jsonResponse({ status: "ok" });
    }

    return _originalFetch(input, init);
  };
}
