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

    if (path === "/products/low-stock") {
      const lowStock = _mockProducts.filter((p) => (p.availableQuantity ?? 0) < 5);
      return jsonResponse({ data: lowStock });
    }

    if (path === "/products") {
      let filtered = [..._mockProducts];
      const search = params.get("search");
      if (search) {
        const q = search.toLowerCase();
        filtered = filtered.filter(
          (p) => p.title.toLowerCase().includes(q) || (p.sku ?? "").toLowerCase().includes(q)
        );
      }
      const status = params.get("status");
      if (status) {
        filtered = filtered.filter((p) => p.status === status);
      }
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
      return jsonResponse(paginate(filtered, page, limit));
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
      return jsonResponse(question);
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

    if (path === "/healthz") {
      return jsonResponse({ status: "ok" });
    }

    return _originalFetch(input, init);
  };
}
