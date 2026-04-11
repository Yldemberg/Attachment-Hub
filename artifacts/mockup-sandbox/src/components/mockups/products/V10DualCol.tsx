import React, { useState } from "react";
import {
  Warehouse, Zap, Truck, Package, Tag, AlertTriangle, AlertCircle,
  Search, Pencil, ChevronLeft, ChevronRight, ExternalLink, X,
  TrendingUp, Eye, ShoppingCart, Filter,
} from "lucide-react";

/* ─── Palette tokens (matches actual app) ─── */
const C = {
  root:    "bg-[#080f1e]",
  panel:   "bg-[#0d1b2e]",
  input:   "bg-[#122040]",
  border:  "border-[#1a3055]/60",
  border2: "border-[#1a3055]/40",
};

/* ─── Seed data ─── */
const PRODUCTS = [
  { id:"1",  title:"Tênis Nike Air Max 270 Masculino Preto",       sku:"NK-AM270-BLK-42",  thumb:"https://picsum.photos/seed/shoe1/200/200",      logistic:"fulfillment",  qty:24, amount:479.90,  promo:null,    status:"active",  views:1240, sales:38 },
  { id:"2",  title:"Mochila Adidas Originals 30L Urban",           sku:"AD-MCH-30L-GRY",   thumb:"https://picsum.photos/seed/bag1/200/200",       logistic:"self_service", qty:3,  amount:189.90,  promo:249.90,  status:"active",  views:590,  sales:14 },
  { id:"3",  title:"Fone Bluetooth Sony WH-1000XM5",               sku:"SN-WH1000-BLK",    thumb:"https://picsum.photos/seed/headphone1/200/200", logistic:"cross_docking",qty:8,  amount:1299.00, promo:null,    status:"active",  views:2100, sales:22 },
  { id:"4",  title:"Smartwatch Samsung Galaxy Watch 6 44mm",       sku:"SM-GW6-44-BLK",    thumb:"https://picsum.photos/seed/watch1/200/200",     logistic:"fulfillment",  qty:0,  amount:1199.99, promo:1499.99, status:"paused",  views:880,  sales:5  },
  { id:"5",  title:"Câmera GoPro HERO12 Black + Acessórios",       sku:"GP-HERO12-KIT",    thumb:"https://picsum.photos/seed/camera1/200/200",    logistic:"self_service", qty:12, amount:2199.00, promo:2499.00, status:"active",  views:3420, sales:61 },
  { id:"6",  title:"Cadeira Gamer DXRacer Formula Preta/Vermelha", sku:"DX-FORM-BRD",      thumb:"https://picsum.photos/seed/chair1/200/200",     logistic:"cross_docking",qty:2,  amount:1799.90, promo:null,    status:"active",  views:740,  sales:8  },
  { id:"7",  title:"Teclado Mecânico Redragon Kumara K552 RGB",    sku:"RD-K552-RGB",      thumb:"https://picsum.photos/seed/keyboard1/200/200",  logistic:"fulfillment",  qty:31, amount:299.90,  promo:null,    status:"active",  views:980,  sales:44 },
  { id:"8",  title:"Monitor LG UltraWide 29\" IPS 75Hz",           sku:"LG-29WP500-B",     thumb:"https://picsum.photos/seed/monitor1/200/200",   logistic:"cross_docking",qty:5,  amount:1349.00, promo:1599.00, status:"active",  views:1560, sales:19 },
  { id:"9",  title:"Carregador Portátil Xiaomi 20000mAh USB-C",    sku:"XI-PB20K-BLK",     thumb:"https://picsum.photos/seed/charger1/200/200",   logistic:"self_service", qty:0,  amount:189.00,  promo:null,    status:"paused",  views:430,  sales:0  },
  { id:"10", title:"Controle DualSense PS5 Branco",                sku:"PS-DS5-WHT",       thumb:"https://picsum.photos/seed/control1/200/200",   logistic:"fulfillment",  qty:17, amount:449.90,  promo:null,    status:"active",  views:2890, sales:73 },
  { id:"11", title:"Headset Gamer HyperX Cloud II 7.1 Surround",   sku:"HX-CLOUD2-BLK",    thumb:"https://picsum.photos/seed/headset1/200/200",   logistic:"cross_docking",qty:6,  amount:529.00,  promo:649.00,  status:"active",  views:1120, sales:27 },
  { id:"12", title:"Mouse Logitech MX Master 3S Grafite",          sku:"LG-MXM3S-GRF",     thumb:"https://picsum.photos/seed/mouse1/200/200",     logistic:"self_service", qty:22, amount:599.90,  promo:null,    status:"active",  views:1780, sales:52 },
  { id:"13", title:"Webcam Logitech C920 HD Pro 1080p",            sku:"LG-C920-BLK",      thumb:"https://picsum.photos/seed/webcam1/200/200",    logistic:"fulfillment",  qty:9,  amount:399.00,  promo:499.00,  status:"active",  views:660,  sales:18 },
  { id:"14", title:"Impressora HP LaserJet Pro M404dn",            sku:"HP-LJM404-BLK",    thumb:"https://picsum.photos/seed/printer1/200/200",   logistic:"cross_docking",qty:4,  amount:1899.00, promo:null,    status:"active",  views:390,  sales:7  },
  { id:"15", title:"Roteador TP-Link Archer AX73 Wi-Fi 6",         sku:"TP-AX73-WHT",      thumb:"https://picsum.photos/seed/router1/200/200",    logistic:"self_service", qty:14, amount:749.90,  promo:899.00,  status:"active",  views:820,  sales:31 },
  { id:"16", title:"Caixa de Som JBL Charge 5 Bluetooth 40W",      sku:"JBL-CHG5-BLK",     thumb:"https://picsum.photos/seed/speaker1/200/200",   logistic:"fulfillment",  qty:0,  amount:999.00,  promo:1199.00, status:"paused",  views:1040, sales:0  },
];

const TOTAL = 124;
type P = typeof PRODUCTS[0];
const fmt = (v: number | null) =>
  v == null ? "—" : new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(v);

/* ─── Logistic chip config ─── */
function logConfig(p: P) {
  if (p.logistic === "fulfillment")  return { bg:"bg-blue-600",   border:"border-blue-700",   Icon:Warehouse, label:"Full" };
  if (p.logistic === "self_service") return { bg:"bg-orange-500", border:"border-orange-600", Icon:Zap,       label:"Flex" };
  return                                    { bg:"bg-amber-500",  border:"border-amber-600",  Icon:Truck,     label:"Cross" };
}

/* ─── Stock helpers ─── */
function stockColor(qty: number) {
  if (qty === 0)   return "text-blue-400/50";
  if (qty < 3)     return "text-red-400";
  if (qty <= 7)    return "text-amber-400";
  return "text-emerald-400";
}
function stockBarColor(qty: number) {
  if (qty === 0)  return "bg-blue-400/30";
  if (qty < 3)    return "bg-red-500";
  if (qty <= 7)   return "bg-amber-500";
  return "bg-emerald-500";
}
const MAX_QTY = 50;

/* ─── Edit Dialog ─── */
function EditDialog({ p, onClose }: { p: P; onClose: () => void }) {
  const [qty, setQty] = useState(String(p.qty));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className={`${C.panel} border ${C.border} rounded-2xl shadow-2xl w-full max-w-sm p-6`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold text-white">Editar Estoque</h2>
          <button onClick={onClose} className="text-blue-400/60 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <div className={`flex items-center gap-3 mb-5 p-3 ${C.input} rounded-xl border ${C.border}`}>
          <img src={p.thumb} alt={p.title} className="w-10 h-10 rounded-lg object-cover" />
          <div className="min-w-0">
            <p className="text-xs font-medium text-white truncate">{p.title}</p>
            <p className="text-[10px] font-mono text-blue-400/60">{p.sku}</p>
          </div>
        </div>
        <label className="block text-[10px] text-blue-400/70 uppercase tracking-wider mb-2">Nova quantidade disponível</label>
        <input type="number" min="0" value={qty} onChange={e => setQty(e.target.value)}
          className={`w-full ${C.input} border ${C.border} rounded-lg px-3 py-2 text-lg font-semibold text-center text-white focus:outline-none focus:ring-2 focus:ring-blue-500 mb-5`} />
        <div className="flex gap-3">
          <button onClick={onClose} className={`flex-1 border ${C.border} rounded-lg py-2 text-xs text-blue-300 hover:${C.input}`}>Cancelar</button>
          <button onClick={onClose} className="flex-1 bg-blue-600 hover:bg-blue-700 rounded-lg py-2 text-xs text-white font-medium">Salvar</button>
        </div>
      </div>
    </div>
  );
}

/* ─── Product Card ─── */
function ProductCard({ p, onEdit }: { p: P; onEdit: () => void }) {
  const [hovered, setHovered] = useState(false);
  const lc = logConfig(p);
  const sc = stockColor(p.qty);
  const sbc = stockBarColor(p.qty);
  const barW = Math.min(100, Math.round((p.qty / MAX_QTY) * 100));
  const isPromo = p.promo != null && p.promo > p.amount;

  return (
    <div
      className={`relative ${C.panel} border ${C.border} rounded-xl overflow-hidden group transition-all duration-200 hover:border-blue-600/40 hover:shadow-lg hover:shadow-black/40 flex flex-col`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* ── Thumbnail row ── */}
      <div className={`relative h-32 flex-shrink-0 ${C.input} overflow-hidden`}>
        <img
          src={p.thumb}
          alt={p.title}
          className={`w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 ${p.qty === 0 ? "grayscale opacity-40" : ""}`}
        />

        {/* Logistic badge — top left */}
        <div className={`absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded-full ${lc.bg} border ${lc.border}`}>
          <lc.Icon className="w-2.5 h-2.5 text-white" />
          <span className="text-[9px] font-bold text-white uppercase tracking-wide">{lc.label}</span>
        </div>

        {/* Status badge — top right */}
        <div className="absolute top-2 right-2">
          {p.status === "active" ? (
            <span className="flex items-center gap-1 text-[9px] font-semibold text-emerald-400 bg-emerald-400/15 border border-emerald-400/25 px-1.5 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />Ativo
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[9px] font-semibold text-amber-400 bg-amber-400/15 border border-amber-400/25 px-1.5 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />Pausado
            </span>
          )}
        </div>

        {/* Out of stock banner */}
        {p.qty === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="bg-red-600/90 text-white text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded rotate-[-6deg]">Esgotado</span>
          </div>
        )}

        {/* Promo ribbon */}
        {isPromo && (
          <div className="absolute bottom-2 left-2">
            <span className="flex items-center gap-1 text-[9px] font-semibold text-pink-400 bg-pink-400/15 border border-pink-400/25 px-1.5 py-0.5 rounded-full">
              <Tag className="w-2.5 h-2.5" />Promo
            </span>
          </div>
        )}
      </div>

      {/* ── Content ── */}
      <div className="flex flex-col gap-2 px-3 py-2.5 flex-1">

        {/* Title + SKU */}
        <div className="min-w-0">
          <p className="text-xs font-semibold text-white leading-snug line-clamp-2">{p.title}</p>
          <p className="text-[10px] font-mono text-blue-400/60 mt-0.5 truncate">{p.sku}</p>
        </div>

        {/* KPI row: views + sales */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 text-[10px] text-blue-300">
            <Eye className="w-3 h-3 text-blue-400/60" />
            <span>{p.views.toLocaleString("pt-BR")}</span>
          </div>
          <div className="flex items-center gap-1 text-[10px] text-blue-300">
            <ShoppingCart className="w-3 h-3 text-blue-400/60" />
            <span>{p.sales}</span>
          </div>
          {p.sales > 40 && (
            <div className="flex items-center gap-0.5 text-[9px] text-emerald-400 font-semibold ml-auto">
              <TrendingUp className="w-3 h-3" />Hot
            </div>
          )}
        </div>

        {/* Stock bar */}
        <div>
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-[9px] text-blue-400/60 uppercase tracking-widest font-bold">Estoque</span>
            <span className={`text-sm font-black leading-none ${sc} flex items-baseline gap-0.5`}>
              {p.qty}
              <span className="text-[9px] text-blue-400/60 font-bold">un</span>
              {p.qty > 0 && p.qty < 3 && <AlertTriangle className="w-3 h-3 text-red-400 ml-0.5" />}
              {p.qty >= 3 && p.qty <= 7 && <AlertCircle className="w-3 h-3 text-amber-400 ml-0.5" />}
            </span>
          </div>
          <div className={`h-1 rounded-full ${C.input} overflow-hidden`}>
            <div className={`h-full rounded-full ${sbc} transition-all duration-500`} style={{ width: `${barW}%` }} />
          </div>
        </div>

        {/* Price + edit button */}
        <div className="flex items-center justify-between mt-auto pt-1.5 border-t border-[#1a3055]/40">
          <div>
            <p className="text-xs font-bold text-white">{fmt(p.amount)}</p>
            {isPromo && <p className="text-[9px] text-blue-400/60 line-through leading-none">{fmt(p.promo)}</p>}
          </div>
          <div className="flex items-center gap-1.5">
            <a href="#" className={`w-6 h-6 flex items-center justify-center rounded-lg text-blue-400/60 hover:text-blue-300 hover:${C.input} border ${C.border} transition-colors`}>
              <ExternalLink className="w-3 h-3" />
            </a>
            <button onClick={onEdit} className={`w-6 h-6 flex items-center justify-center rounded-lg text-blue-400/60 hover:text-white hover:${C.input} border ${C.border} transition-colors`}>
              <Pencil className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Skeleton ─── */
function Skeleton() {
  return (
    <div className={`${C.panel} border ${C.border} rounded-xl overflow-hidden animate-pulse flex flex-col`}>
      <div className={`h-32 ${C.input}`} />
      <div className="p-3 flex flex-col gap-2">
        <div className={`h-3 ${C.input} rounded w-3/4`} />
        <div className={`h-2.5 ${C.input} rounded w-1/3`} />
        <div className={`h-1 ${C.input} rounded mt-1`} />
      </div>
    </div>
  );
}

/* ─── Main export ─── */
export function V10DualCol() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState<10|20|50>(10);
  const [editing, setEditing] = useState<P | null>(null);

  const filtered = PRODUCTS.filter(p =>
    search === "" ||
    p.title.toLowerCase().includes(search.toLowerCase()) ||
    p.sku.toLowerCase().includes(search.toLowerCase())
  );

  const totalPages = Math.ceil(TOTAL / limit);
  const startItem = (page - 1) * limit + 1;
  const endItem   = Math.min(page * limit, TOTAL);

  const pageData = filtered.slice(0, Math.min(limit, filtered.length));

  /* KPI strip counts */
  const kpi = {
    active:  PRODUCTS.filter(p => p.status === "active" && p.qty > 0).length,
    paused:  PRODUCTS.filter(p => p.status === "paused").length,
    empty:   PRODUCTS.filter(p => p.qty === 0).length,
    promo:   PRODUCTS.filter(p => p.promo != null).length,
  };

  return (
    <div className={`h-screen flex flex-col ${C.root} font-sans text-white overflow-hidden`}>

      {/* ── KPI strip ── */}
      <div className={`flex-shrink-0 ${C.panel} border-b ${C.border} px-4 py-1.5 flex items-center gap-3 overflow-x-auto`}>
        <span className="flex items-center gap-1.5 text-[10px] font-semibold whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-emerald-400">{kpi.active} ativos</span>
        </span>
        <span className="text-[#1a3055]">|</span>
        <span className="flex items-center gap-1.5 text-[10px] font-semibold whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
          <span className="text-amber-400">{kpi.paused} pausados</span>
        </span>
        <span className="text-[#1a3055]">|</span>
        <span className="flex items-center gap-1.5 text-[10px] font-semibold whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
          <span className="text-red-400">{kpi.empty} sem estoque</span>
        </span>
        <span className="text-[#1a3055]">|</span>
        <span className="flex items-center gap-1.5 text-[10px] font-semibold whitespace-nowrap">
          <Tag className="w-3 h-3 text-pink-400" />
          <span className="text-pink-400">{kpi.promo} em promoção</span>
        </span>
        <span className="ml-auto text-[10px] text-blue-400/60 whitespace-nowrap">
          <span className="text-white font-semibold">{TOTAL}</span> anúncios no total
        </span>
      </div>

      {/* ── Sticky filter header ── */}
      <div className={`flex-shrink-0 ${C.root} border-b ${C.border} px-4 py-2.5 z-10`}>
        <div className="flex gap-2 items-center flex-wrap">

          {/* Search */}
          <div className="relative flex-1 min-w-[160px] max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-blue-300" />
            <input
              type="text"
              placeholder="Buscar título ou SKU..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className={`w-full ${C.input} border ${C.border} text-xs rounded-lg pl-8 pr-3 py-1.5 text-blue-200 placeholder:text-blue-400/50 focus:outline-none focus:ring-1 focus:ring-blue-400`}
            />
          </div>

          {/* Status filter */}
          <select className={`${C.input} border ${C.border} text-xs rounded-lg px-2.5 py-1.5 text-blue-200 focus:outline-none focus:ring-1 focus:ring-blue-400`}>
            <option>Todos os status</option>
            <option>Ativo</option>
            <option>Pausado</option>
          </select>

          {/* Logistics filter */}
          <select className={`${C.input} border ${C.border} text-xs rounded-lg px-2.5 py-1.5 text-blue-200 focus:outline-none focus:ring-1 focus:ring-blue-400`}>
            <option>Toda logística</option>
            <option>Full</option>
            <option>Flex</option>
            <option>Cross</option>
          </select>

          {/* Right side: rows + count */}
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-[10px] text-blue-200 whitespace-nowrap hidden sm:block font-medium">Itens/pág.:</span>
            <div className={`flex items-center ${C.input} border ${C.border} rounded-lg overflow-hidden`}>
              {([10, 20, 50] as const).map(opt => (
                <button
                  key={opt}
                  onClick={() => { setLimit(opt); setPage(1); }}
                  className={`px-2.5 py-1.5 text-[10px] font-semibold transition-colors border-r border-[#1a3055]/60 last:border-r-0 ${
                    limit === opt ? "bg-blue-600 text-white" : "text-blue-300 hover:bg-[#0d1b2e] hover:text-white"
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>

            <button className={`flex items-center gap-1 ${C.input} hover:bg-[#0d1b2e] border ${C.border} text-xs rounded-lg px-2 py-1.5 text-blue-200 transition-colors`}>
              <Filter className="w-3 h-3" />
              Filtros
            </button>
          </div>
        </div>
      </div>

      {/* ── Scrollable body ── */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-4">

          {/* 2-column grid */}
          <div className="grid grid-cols-2 gap-3">
            {pageData.map(p => (
              <ProductCard key={p.id} p={p} onEdit={() => setEditing(p)} />
            ))}
            {/* Fill skeleton slots */}
            {Array.from({ length: Math.max(0, limit - pageData.length) }, (_, i) => (
              <Skeleton key={`sk-${i}`} />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className={`flex items-center justify-between mt-6 pt-4 border-t border-[#1a3055]/40`}>
              <p className="text-[10px] text-blue-200">
                Mostrando{" "}
                <span className="text-white font-medium">{startItem}–{endItem}</span>
                {" "}de{" "}
                <span className="text-white font-medium">{TOTAL}</span> anúncios
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className={`flex items-center justify-center w-7 h-7 rounded-lg border ${C.border} text-blue-300 hover:${C.input} disabled:opacity-40 disabled:cursor-not-allowed transition-colors`}
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map(n => (
                  <button
                    key={n}
                    onClick={() => setPage(n)}
                    className={`w-7 h-7 rounded-lg text-[10px] font-semibold transition-colors ${
                      page === n ? "bg-blue-600 text-white" : `border ${C.border} text-blue-300 hover:${C.input}`
                    }`}
                  >
                    {n}
                  </button>
                ))}
                {totalPages > 5 && (
                  <>
                    <span className="text-blue-400/50 text-xs px-0.5">…</span>
                    <button
                      onClick={() => setPage(totalPages)}
                      className={`w-7 h-7 rounded-lg text-[10px] font-semibold border ${C.border} text-blue-300 hover:${C.input} transition-colors`}
                    >
                      {totalPages}
                    </button>
                  </>
                )}
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className={`flex items-center justify-center w-7 h-7 rounded-lg border ${C.border} text-blue-300 hover:${C.input} disabled:opacity-40 disabled:cursor-not-allowed transition-colors`}
                >
                  <ChevronRight className="w-3.5 h-3.5" />
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
