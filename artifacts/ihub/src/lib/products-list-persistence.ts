/** Persistência da listagem Produtos (scroll + filtros) para voltar do detalhe do anúncio. */

export const PRODUCTS_LIST_UI_KEY = "ihub-products-list-ui";

export const ROWS_OPTIONS = [10, 20, 50] as const;
export type RowsOption = (typeof ROWS_OPTIONS)[number];

export type ProductsListFiltersPersisted = {
  v: 1;
  page: number;
  limit: RowsOption;
  search: string;
  listingFilter: string;
  accountId: string;
  scrollTop: number;
};

function normalizeLimit(n: unknown): RowsOption {
  return ROWS_OPTIONS.includes(n as RowsOption) ? (n as RowsOption) : 10;
}

/** Lê objeto salvo pelo últimoUnmount da tela Produtos (ou navegação equivalente). */
export function parseStoredProductsListUi(): Omit<ProductsListFiltersPersisted, "v"> | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(PRODUCTS_LIST_UI_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<ProductsListFiltersPersisted>;
    if (o.v !== 1) return null;
    const page = typeof o.page === "number" && o.page >= 1 ? Math.floor(o.page) : 1;
    return {
      page,
      limit: normalizeLimit(o.limit),
      search: typeof o.search === "string" ? o.search : "",
      listingFilter: typeof o.listingFilter === "string" ? o.listingFilter : "all",
      accountId: typeof o.accountId === "string" ? o.accountId : "all",
      scrollTop:
        typeof o.scrollTop === "number" && Number.isFinite(o.scrollTop) ? Math.max(0, o.scrollTop) : 0,
    };
  } catch {
    return null;
  }
}

export function writeStoredProductsListUi(
  data: Omit<ProductsListFiltersPersisted, "v">,
): void {
  try {
    if (typeof sessionStorage === "undefined") return;
    sessionStorage.setItem(PRODUCTS_LIST_UI_KEY, JSON.stringify({ v: 1 as const, ...data }));
  } catch {
    /* quota / modo privado */
  }
}

const Q_PAGE = "page";
const Q_LIMIT = "limit";
const Q_SEARCH = "q";
const Q_LISTING = "listing";
const Q_ACCOUNT = "account";

/** Query string atual (sem `?`) → fragmentos opcionais de estado. */
export function parseProductsListUrl(search: string): Partial<
  Omit<ProductsListFiltersPersisted, "v" | "scrollTop">
> {
  const trimmed = search.startsWith("?") ? search.slice(1) : search;
  const sp = new URLSearchParams(trimmed);
  const partial: Partial<Omit<ProductsListFiltersPersisted, "v" | "scrollTop">> = {};
  const p = sp.get(Q_PAGE);
  if (p) {
    const n = Number.parseInt(p, 10);
    if (!Number.isNaN(n) && n >= 1) partial.page = n;
  }
  const lim = sp.get(Q_LIMIT);
  if (lim != null && lim !== "") {
    const n = Number.parseInt(lim, 10);
    partial.limit = ROWS_OPTIONS.includes(n as RowsOption) ? (n as RowsOption) : 10;
  }
  const q = sp.get(Q_SEARCH);
  if (q !== null && q.trim() !== "") partial.search = q;
  const listing = sp.get(Q_LISTING);
  if (listing != null && listing !== "") partial.listingFilter = listing;
  const acc = sp.get(Q_ACCOUNT);
  if (acc != null && acc !== "") partial.accountId = acc;
  return partial;
}

export function serializeProductsListFilters(filters: Omit<ProductsListFiltersPersisted, "v" | "scrollTop">): string {
  const sp = new URLSearchParams();
  if (filters.page !== 1) sp.set(Q_PAGE, String(filters.page));
  if (filters.limit !== 10) sp.set(Q_LIMIT, String(filters.limit));
  const qTrim = filters.search.trim();
  if (qTrim) sp.set(Q_SEARCH, qTrim);
  if (filters.listingFilter !== "all") sp.set(Q_LISTING, filters.listingFilter);
  if (filters.accountId !== "all") sp.set(Q_ACCOUNT, filters.accountId);
  return sp.toString();
}

/** Ao voltar do detalhe: URL com filtros gravados ao sair da listagem (`account`=UUID da conta, ex.: GYBA_SHOP no rótulo). */
export function buildProductsListReturnPath(): string {
  const stored = parseStoredProductsListUi();
  if (!stored) return "/products";
  const qs = serializeProductsListFilters(stored);
  return qs !== "" ? `/products?${qs}` : "/products";
}

export function areProductListQueriesEquivalent(searchA: string, searchB: string): boolean {
  const normalize = (s: string) => (s.startsWith("?") ? s.slice(1) : s);
  const A = new URLSearchParams(normalize(searchA ?? ""));
  const B = new URLSearchParams(normalize(searchB ?? ""));
  const keys = new Set<string>([...A.keys(), ...B.keys()]);
  for (const k of keys) {
    if ((A.get(k) ?? "") !== (B.get(k) ?? "")) return false;
  }
  return true;
}

export type InitialProductsListBootstrap = {
  page: number;
  limit: RowsOption;
  search: string;
  listingFilter: string;
  accountId: string;
  /** null = não restaurar scroll (sem snapshot salvo). */
  pendingScrollRestore: number | null;
};

/** Primeiro render da página Produtos (query string atual + último estado em sessionStorage). */
export function getInitialProductsListState(): InitialProductsListBootstrap {
  if (typeof window === "undefined") {
    return {
      page: 1,
      limit: 10,
      search: "",
      listingFilter: "all",
      accountId: "all",
      pendingScrollRestore: null,
    };
  }
  const urlParts = parseProductsListUrl(window.location.search);
  const stored = parseStoredProductsListUi();

  const limit: RowsOption =
    urlParts.limit !== undefined ? normalizeLimit(urlParts.limit) : (stored?.limit ?? 10);

  return {
    page: urlParts.page ?? stored?.page ?? 1,
    limit,
    search: urlParts.search ?? stored?.search ?? "",
    listingFilter: urlParts.listingFilter ?? stored?.listingFilter ?? "all",
    accountId: urlParts.accountId ?? stored?.accountId ?? "all",
    pendingScrollRestore: stored !== null ? stored.scrollTop : null,
  };
}
