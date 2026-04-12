import React, { useState } from "react";
import {
  Warehouse, Zap, Truck, Tag, AlertTriangle, AlertCircle,
  Search, Package, Pencil, ChevronLeft, ChevronRight, ExternalLink, X,
  TrendingUp, Eye, ShoppingCart, SlidersHorizontal,
} from "lucide-react";

/*
  Palette — azul mais claro, branco, verde
  Root:    #0d1f3c  (navy médio, mais claro que o anterior)
  Cards:   #132d50  (azul médio)
  Input:   #1a3a60  (azul médio-claro)
  Border:  #2a5080/50
  Text:    white  →  sky-200  →  sky-300  →  sky-400
  Accent:  emerald-400 / emerald-500
*/
const ROOT   = "#050c18";
const PANEL  = "#0f2642";
const INPUT  = "#1a3a60";
const BDR    = "rgba(42,80,128,0.65)";

const ALL_PRODUCTS = [
  { id:"1",  title:"Tênis Nike Air Max 270 Masculino Preto",        sku:"NK-AM270-BLK-42",  thumb:"https://picsum.photos/seed/shoe1/400/400",       logistic:"fulfillment",   qty:24, amount:479.90,   promo:null,    status:"active",  views:1240, sales:38 },
  { id:"2",  title:"Mochila Adidas Originals 30L Urban",            sku:"AD-MCH-30L-GRY",   thumb:"https://picsum.photos/seed/bag1/400/400",        logistic:"self_service",  qty:3,  amount:189.90,   promo:249.90,  status:"active",  views:590,  sales:14 },
  { id:"3",  title:"Fone Bluetooth Sony WH-1000XM5",                sku:"SN-WH1000-BLK",    thumb:"https://picsum.photos/seed/headphone1/400/400",  logistic:"cross_docking", qty:8,  amount:1299.00,  promo:null,    status:"active",  views:2100, sales:22 },
  { id:"4",  title:"Smartwatch Samsung Galaxy Watch 6 44mm",        sku:"SM-GW6-44-BLK",    thumb:"https://picsum.photos/seed/watch1/400/400",      logistic:"fulfillment",   qty:0,  amount:1199.99,  promo:1499.99, status:"paused",  views:880,  sales:5  },
  { id:"5",  title:"Câmera GoPro HERO12 Black + Acessórios Kit Completo", sku:"GP-HERO12-KIT", thumb:"https://picsum.photos/seed/camera1/400/400",  logistic:"self_service",  qty:12, amount:2199.00,  promo:2499.00, status:"active",  views:3420, sales:61 },
  { id:"6",  title:"Cadeira Gamer DXRacer Formula Preta/Vermelha",  sku:"DX-FORM-BRD",      thumb:"https://picsum.photos/seed/chair1/400/400",      logistic:"cross_docking", qty:2,  amount:1799.90,  promo:null,    status:"active",  views:740,  sales:8  },
  { id:"7",  title:"Teclado Mecânico Redragon Kumara K552 RGB",     sku:"RD-K552-RGB",      thumb:"https://picsum.photos/seed/keyboard1/400/400",   logistic:"fulfillment",   qty:31, amount:299.90,   promo:null,    status:"active",  views:980,  sales:44 },
  { id:"8",  title:"Monitor LG UltraWide 29\" IPS 75Hz",            sku:"LG-29WP500-B",     thumb:"https://picsum.photos/seed/monitor1/400/400",    logistic:"cross_docking", qty:5,  amount:1349.00,  promo:1599.00, status:"active",  views:1560, sales:19 },
  { id:"9",  title:"Carregador Portátil Xiaomi 20000mAh USB-C",     sku:"XI-PB20K-BLK",     thumb:"https://picsum.photos/seed/charger1/400/400",    logistic:"self_service",  qty:0,  amount:189.00,   promo:null,    status:"paused",  views:430,  sales:0  },
  { id:"10", title:"Controle DualSense PS5 Branco",                 sku:"PS-DS5-WHT",       thumb:"https://picsum.photos/seed/control1/400/400",    logistic:"fulfillment",   qty:17, amount:449.90,   promo:null,    status:"active",  views:2890, sales:73 },
];

type P = typeof ALL_PRODUCTS[0];
const ROWS_OPTIONS = [10, 20, 50] as const;
type RowsOption = typeof ROWS_OPTIONS[number];
const TOTAL = 124;

const fmt = (v: number | null | undefined) =>
  v == null ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

function logConfig(p: P) {
  if (p.logistic === "fulfillment")  return { bg: "#2563eb", border: "#1d4ed8", Icon: Warehouse, label: "Full"  };
  if (p.logistic === "self_service") return { bg: "#f97316", border: "#ea6c10", Icon: Zap,       label: "Flex"  };
  return                                    { bg: "#d97706", border: "#c76c00", Icon: Truck,     label: "Cross" };
}

function stockColor(qty: number) {
  if (qty === 0)   return "#94a3b8";
  if (qty < 3)     return "#f87171";
  if (qty <= 7)    return "#fbbf24";
  return "#34d399";
}
function stockBarColor(qty: number) {
  if (qty === 0)  return "#334155";
  if (qty < 3)    return "#ef4444";
  if (qty <= 7)   return "#f59e0b";
  return "#10b981";
}

/* ─── Edit Dialog ─── */
function EditDialog({ p, onClose }: { p: P; onClose: () => void }) {
  const [qty, setQty] = useState(String(p.qty));
  return (
    <div
      style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        style={{ background: PANEL, border: `1px solid ${BDR}` }}
        className="rounded-2xl shadow-2xl w-full max-w-sm p-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold text-white">Editar Estoque</h2>
          <button onClick={onClose} className="text-sky-400 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <div style={{ background: INPUT, border: `1px solid ${BDR}` }} className="flex items-center gap-3 mb-5 p-3 rounded-xl">
          <img src={p.thumb} alt={p.title} className="w-10 h-10 rounded-lg object-cover" />
          <div className="min-w-0">
            <p className="text-xs font-medium text-white truncate">{p.title}</p>
            <p className="text-[10px] font-mono text-sky-400">{p.sku}</p>
          </div>
        </div>
        <label className="block text-[10px] text-sky-400 uppercase tracking-wider mb-2">Nova quantidade disponível</label>
        <input
          type="number" min="0" value={qty} onChange={e => setQty(e.target.value)}
          style={{ background: INPUT, border: `1px solid ${BDR}` }}
          className="w-full rounded-lg px-3 py-2 text-lg font-semibold text-center text-white focus:outline-none focus:ring-2 focus:ring-blue-400 mb-5"
        />
        <div className="flex gap-3">
          <button onClick={onClose} style={{ border: `1px solid ${BDR}` }} className="flex-1 rounded-lg py-2 text-xs text-sky-300 hover:bg-white/5">Cancelar</button>
          <button onClick={onClose} className="flex-1 bg-blue-500 hover:bg-blue-400 rounded-lg py-2 text-xs text-white font-semibold">Salvar</button>
        </div>
      </div>
    </div>
  );
}

/* ─── Product Card ─── */
function ProductCard({ p, onEdit }: { p: P; onEdit: () => void }) {
  const lc      = logConfig(p);
  const sc      = stockColor(p.qty);
  const sbc     = stockBarColor(p.qty);
  const isPromo = p.promo != null && p.promo > p.amount;
  const barPct  = Math.min(100, Math.round((p.qty / 50) * 100));

  return (
    <div
      style={{ background: PANEL, border: `1px solid ${BDR}` }}
      className="relative rounded-2xl overflow-hidden group transition-all duration-200 hover:shadow-xl hover:shadow-black/50 flex"
      onMouseEnter={e => (e.currentTarget.style.borderColor = "rgba(96,165,250,0.5)")}
      onMouseLeave={e => (e.currentTarget.style.borderColor = BDR)}
    >
      {/* ── Thumbnail — wider ── */}
      <div style={{ background: INPUT }} className="relative w-40 flex-shrink-0 overflow-hidden">
        {p.thumb ? (
          <img
            src={p.thumb}
            alt={p.title}
            className={`w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 ${p.qty === 0 ? "grayscale opacity-50" : ""}`}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Package className="w-10 h-10 text-sky-600" />
          </div>
        )}

        {/* Logistic chip */}
        <div
          style={{ background: lc.bg, borderTop: `1px solid ${lc.border}` }}
          className="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-1 py-1.5"
        >
          <lc.Icon className="w-3.5 h-3.5 text-white" />
          <span className="text-[10px] font-bold text-white uppercase tracking-wide">{lc.label}</span>
        </div>

        {/* Esgotado */}
        {p.qty === 0 && (
          <div className="absolute inset-x-0 top-[35%] flex justify-center">
            <span className="bg-red-600/90 text-white text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded rotate-[-8deg]">Esgotado</span>
          </div>
        )}
      </div>

      {/* ── Content ── */}
      <div className="flex-1 flex flex-col px-4 py-3 gap-2 min-w-0">

        {/* Title + SKU */}
        <div className="min-w-0">
          <p className="text-sm font-bold text-white leading-snug line-clamp-2 group-hover:text-sky-200 transition-colors">
            {p.title}
          </p>
          <p className="text-xs font-mono text-sky-400 truncate mt-0.5">{p.sku}</p>
        </div>

        {/* Status + promo */}
        <div className="flex items-center gap-2 flex-wrap">
          {p.status === "active" ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />Ativo
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-400">
              <span className="w-2 h-2 rounded-full bg-amber-400" />Pausado
            </span>
          )}
          {isPromo && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-pink-300 bg-pink-500/15 border border-pink-400/25 px-2 py-0.5 rounded-full">
              <Tag className="w-3 h-3" />Promo
            </span>
          )}
        </div>

        {/* KPI: views + sales */}
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5 text-xs text-sky-200">
            <Eye className="w-3.5 h-3.5 text-sky-400" />{p.views.toLocaleString("pt-BR")}
          </span>
          <span className="flex items-center gap-1.5 text-xs text-sky-200">
            <ShoppingCart className="w-3.5 h-3.5 text-sky-400" />{p.sales}
          </span>
          {p.sales > 40 && (
            <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-400">
              <TrendingUp className="w-3.5 h-3.5" />Hot
            </span>
          )}
        </div>

        {/* Bottom: stock + price + actions */}
        <div className="flex items-end justify-between mt-auto pt-2 gap-3" style={{ borderTop: `1px solid ${BDR}` }}>

          {/* Stock */}
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-1.5 mb-1.5">
              <span style={{ color: sc }} className="text-3xl font-black leading-none">{p.qty}</span>
              <span className="text-xs text-sky-400 uppercase tracking-widest font-bold">un</span>
              {p.qty > 0 && p.qty < 3  && <AlertTriangle className="w-4 h-4 text-red-400 ml-1" />}
              {p.qty >= 3 && p.qty <= 7 && <AlertCircle   className="w-4 h-4 text-amber-400 ml-1" />}
            </div>
            <div style={{ background: INPUT }} className="h-1.5 rounded-full overflow-hidden w-28">
              <div style={{ width: `${barPct}%`, background: sbc }} className="h-full rounded-full transition-all" />
            </div>
          </div>

          {/* Price + actions */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="text-right">
              <p className="text-base font-black text-white">{fmt(p.amount)}</p>
              {isPromo && <p className="text-xs text-sky-400 line-through leading-none">{fmt(p.promo)}</p>}
            </div>
            <div className="flex items-center gap-1.5">
              <a
                href="#"
                style={{ background: INPUT, border: `1px solid ${BDR}` }}
                className="w-8 h-8 flex items-center justify-center rounded-xl text-sky-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
              <button
                onClick={onEdit}
                style={{ background: INPUT, border: `1px solid ${BDR}` }}
                className="w-8 h-8 flex items-center justify-center rounded-xl text-sky-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                <Pencil className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

/* ─── Skeleton ─── */
function SkeletonCard() {
  return (
    <div style={{ background: PANEL, border: `1px solid ${BDR}` }} className="rounded-2xl overflow-hidden flex h-36 animate-pulse">
      <div style={{ background: INPUT }} className="w-40 flex-shrink-0" />
      <div className="flex-1 px-4 py-3 flex flex-col gap-2.5">
        <div style={{ background: INPUT }} className="h-4 rounded w-3/4" />
        <div style={{ background: INPUT }} className="h-3 rounded w-1/3" />
        <div style={{ background: INPUT }} className="h-3 rounded w-1/4 mt-auto" />
      </div>
    </div>
  );
}

/* ─── Main ─── */
export function V10DualCol() {
  const [search, setSearch]   = useState("");
  const [page, setPage]       = useState(1);
  const [limit, setLimit]     = useState<RowsOption>(10);
  const [editing, setEditing] = useState<P | null>(null);

  const filtered  = ALL_PRODUCTS.filter(p =>
    search === "" ||
    p.title.toLowerCase().includes(search.toLowerCase()) ||
    p.sku.toLowerCase().includes(search.toLowerCase())
  );
  const pageData   = filtered.slice(0, Math.min(limit, filtered.length));
  const totalPages = Math.ceil(TOTAL / limit);
  const startItem  = (page - 1) * limit + 1;
  const endItem    = Math.min(page * limit, TOTAL);

  const kpi = {
    active: ALL_PRODUCTS.filter(p => p.status === "active" && p.qty > 0).length,
    paused: ALL_PRODUCTS.filter(p => p.status === "paused").length,
    empty:  ALL_PRODUCTS.filter(p => p.qty === 0).length,
    promo:  ALL_PRODUCTS.filter(p => p.promo != null).length,
  };

  return (
    <div style={{ background: ROOT }} className="h-screen flex flex-col font-sans text-white overflow-hidden">

      {/* ── KPI Strip ── */}
      <div style={{ background: PANEL, borderBottom: `1px solid ${BDR}` }} className="flex-shrink-0 px-5 py-2 flex items-center gap-4 overflow-x-auto">
        <span className="flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-emerald-400">{kpi.active} ativos</span>
        </span>
        <span className="text-sky-700">·</span>
        <span className="flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap">
          <span className="w-2 h-2 rounded-full bg-amber-400" />
          <span className="text-amber-400">{kpi.paused} pausados</span>
        </span>
        <span className="text-sky-700">·</span>
        <span className="flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap">
          <span className="w-2 h-2 rounded-full bg-red-400" />
          <span className="text-red-400">{kpi.empty} sem estoque</span>
        </span>
        <span className="text-sky-700">·</span>
        <span className="flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap">
          <Tag className="w-3.5 h-3.5 text-pink-400" />
          <span className="text-pink-300">{kpi.promo} em promoção</span>
        </span>
        <span className="ml-auto text-xs text-sky-300 whitespace-nowrap">
          <span className="text-white font-bold">{TOTAL}</span> anúncios
        </span>
      </div>

      {/* ── Header filters ── */}
      <div style={{ background: ROOT, borderBottom: `1px solid ${BDR}` }} className="flex-shrink-0 px-5 py-3 z-10">
        <div className="flex gap-2 items-center flex-wrap">

          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-sky-400" />
            <input
              type="text"
              placeholder="Buscar título ou SKU..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              style={{ background: INPUT, border: `1px solid ${BDR}` }}
              className="w-full text-sm rounded-xl pl-9 pr-3 py-2 text-white placeholder:text-sky-500 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>

          <select style={{ background: INPUT, border: `1px solid ${BDR}` }} className="text-sm rounded-xl px-3 py-2 text-sky-200 focus:outline-none focus:ring-2 focus:ring-blue-400">
            <option>Todos os status</option>
            <option>Ativo</option>
            <option>Pausado</option>
          </select>

          <select style={{ background: INPUT, border: `1px solid ${BDR}` }} className="text-sm rounded-xl px-3 py-2 text-sky-200 focus:outline-none focus:ring-2 focus:ring-blue-400">
            <option>Toda logística</option>
            <option>Full</option>
            <option>Flex</option>
            <option>Cross</option>
          </select>

          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs text-sky-300 whitespace-nowrap font-medium">Itens/pág.:</span>
            <div style={{ background: INPUT, border: `1px solid ${BDR}` }} className="flex rounded-xl overflow-hidden">
              {ROWS_OPTIONS.map(opt => (
                <button
                  key={opt}
                  onClick={() => { setLimit(opt); setPage(1); }}
                  style={limit === opt ? { background: "#3b82f6" } : {}}
                  className={`px-3 py-2 text-xs font-semibold transition-colors ${limit === opt ? "text-white" : "text-sky-300 hover:text-white hover:bg-white/10"}`}
                >
                  {opt}
                </button>
              ))}
            </div>
            <button style={{ background: INPUT, border: `1px solid ${BDR}` }} className="flex items-center gap-1.5 text-sm rounded-xl px-3 py-2 text-sky-200 hover:bg-white/10 transition-colors">
              <SlidersHorizontal className="w-3.5 h-3.5" />Filtros
            </button>
            <span className="text-xs text-sky-300 whitespace-nowrap">
              <span className="text-white font-bold">{TOTAL}</span> anúncios
            </span>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-5 py-4">
          <div className="flex flex-col gap-3">
            {pageData.map(p => (
              <ProductCard key={p.id} p={p} onEdit={() => setEditing(p)} />
            ))}
            {Array.from({ length: Math.max(0, Math.min(3, limit - pageData.length)) }, (_, i) => (
              <SkeletonCard key={`sk-${i}`} />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ borderTop: `1px solid ${BDR}` }} className="flex items-center justify-between mt-6 pt-4">
              <p className="text-xs text-sky-300">
                Mostrando <span className="text-white font-semibold">{startItem}–{endItem}</span> de{" "}
                <span className="text-white font-semibold">{TOTAL}</span> anúncios
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  style={{ background: INPUT, border: `1px solid ${BDR}` }}
                  className="w-8 h-8 flex items-center justify-center rounded-xl text-sky-300 hover:text-white hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map(n => (
                  <button
                    key={n}
                    onClick={() => setPage(n)}
                    style={page === n ? { background: "#3b82f6" } : { background: INPUT, border: `1px solid ${BDR}` }}
                    className={`w-8 h-8 rounded-xl text-xs font-semibold transition-colors ${page === n ? "text-white" : "text-sky-300 hover:text-white hover:bg-white/10"}`}
                  >
                    {n}
                  </button>
                ))}
                {totalPages > 5 && (
                  <>
                    <span className="text-sky-500 text-xs px-1">…</span>
                    <button
                      onClick={() => setPage(totalPages)}
                      style={{ background: INPUT, border: `1px solid ${BDR}` }}
                      className="w-8 h-8 rounded-xl text-xs font-semibold text-sky-300 hover:text-white hover:bg-white/10 transition-colors"
                    >
                      {totalPages}
                    </button>
                  </>
                )}
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  style={{ background: INPUT, border: `1px solid ${BDR}` }}
                  className="w-8 h-8 flex items-center justify-center rounded-xl text-sky-300 hover:text-white hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {editing && <EditDialog p={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
