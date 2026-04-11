import React, { useState } from "react";
import {
  Warehouse, Zap, Truck, Tag, AlertTriangle, AlertCircle,
  Search, Package, Pencil, ChevronLeft, ChevronRight, ExternalLink, X,
  TrendingUp, Eye, ShoppingCart, SlidersHorizontal,
} from "lucide-react";

/* ─── Palette (matches actual app) ─── */
const ROOT   = "bg-[#080f1e]";
const PANEL  = "bg-[#0d1b2e]";
const INPUT  = "bg-[#122040]";
const BORDER = "border-[#1a3055]/60";

const ALL_PRODUCTS = [
  { id:"1",  title:"Tênis Nike Air Max 270 Masculino Preto",        sku:"NK-AM270-BLK-42",  thumb:"https://picsum.photos/seed/shoe1/200/200",       logistic:"fulfillment",   qty:24, amount:479.90,   promo:null,    status:"active",  views:1240, sales:38 },
  { id:"2",  title:"Mochila Adidas Originals 30L Urban",            sku:"AD-MCH-30L-GRY",   thumb:"https://picsum.photos/seed/bag1/200/200",        logistic:"self_service",  qty:3,  amount:189.90,   promo:249.90,  status:"active",  views:590,  sales:14 },
  { id:"3",  title:"Fone Bluetooth Sony WH-1000XM5",                sku:"SN-WH1000-BLK",    thumb:"https://picsum.photos/seed/headphone1/200/200",  logistic:"cross_docking", qty:8,  amount:1299.00,  promo:null,    status:"active",  views:2100, sales:22 },
  { id:"4",  title:"Smartwatch Samsung Galaxy Watch 6 44mm",        sku:"SM-GW6-44-BLK",    thumb:"https://picsum.photos/seed/watch1/200/200",      logistic:"fulfillment",   qty:0,  amount:1199.99,  promo:1499.99, status:"paused",  views:880,  sales:5  },
  { id:"5",  title:"Câmera GoPro HERO12 Black + Acessórios",        sku:"GP-HERO12-KIT",    thumb:"https://picsum.photos/seed/camera1/200/200",     logistic:"self_service",  qty:12, amount:2199.00,  promo:2499.00, status:"active",  views:3420, sales:61 },
  { id:"6",  title:"Cadeira Gamer DXRacer Formula Preta/Vermelha",  sku:"DX-FORM-BRD",      thumb:"https://picsum.photos/seed/chair1/200/200",      logistic:"cross_docking", qty:2,  amount:1799.90,  promo:null,    status:"active",  views:740,  sales:8  },
  { id:"7",  title:"Teclado Mecânico Redragon Kumara K552 RGB",     sku:"RD-K552-RGB",      thumb:"https://picsum.photos/seed/keyboard1/200/200",   logistic:"fulfillment",   qty:31, amount:299.90,   promo:null,    status:"active",  views:980,  sales:44 },
  { id:"8",  title:"Monitor LG UltraWide 29\" IPS 75Hz",            sku:"LG-29WP500-B",     thumb:"https://picsum.photos/seed/monitor1/200/200",    logistic:"cross_docking", qty:5,  amount:1349.00,  promo:1599.00, status:"active",  views:1560, sales:19 },
  { id:"9",  title:"Carregador Portátil Xiaomi 20000mAh USB-C",     sku:"XI-PB20K-BLK",     thumb:"https://picsum.photos/seed/charger1/200/200",    logistic:"self_service",  qty:0,  amount:189.00,   promo:null,    status:"paused",  views:430,  sales:0  },
  { id:"10", title:"Controle DualSense PS5 Branco",                 sku:"PS-DS5-WHT",       thumb:"https://picsum.photos/seed/control1/200/200",    logistic:"fulfillment",   qty:17, amount:449.90,   promo:null,    status:"active",  views:2890, sales:73 },
  { id:"11", title:"Headset Gamer HyperX Cloud II 7.1 Surround",    sku:"HX-CLOUD2-BLK",    thumb:"https://picsum.photos/seed/headset1/200/200",    logistic:"cross_docking", qty:6,  amount:529.00,   promo:649.00,  status:"active",  views:1120, sales:27 },
  { id:"12", title:"Mouse Logitech MX Master 3S Grafite",           sku:"LG-MXM3S-GRF",     thumb:"https://picsum.photos/seed/mouse1/200/200",      logistic:"self_service",  qty:22, amount:599.90,   promo:null,    status:"active",  views:1780, sales:52 },
  { id:"13", title:"Webcam Logitech C920 HD Pro 1080p",             sku:"LG-C920-BLK",      thumb:"https://picsum.photos/seed/webcam1/200/200",     logistic:"fulfillment",   qty:9,  amount:399.00,   promo:499.00,  status:"active",  views:660,  sales:18 },
  { id:"14", title:"Impressora HP LaserJet Pro M404dn",             sku:"HP-LJM404-BLK",    thumb:"https://picsum.photos/seed/printer1/200/200",    logistic:"cross_docking", qty:4,  amount:1899.00,  promo:null,    status:"active",  views:390,  sales:7  },
  { id:"15", title:"Roteador TP-Link Archer AX73 Wi-Fi 6",          sku:"TP-AX73-WHT",      thumb:"https://picsum.photos/seed/router1/200/200",     logistic:"self_service",  qty:14, amount:749.90,   promo:899.00,  status:"active",  views:820,  sales:31 },
  { id:"16", title:"Caixa de Som JBL Charge 5 Bluetooth 40W",       sku:"JBL-CHG5-BLK",     thumb:"https://picsum.photos/seed/speaker1/200/200",    logistic:"fulfillment",   qty:0,  amount:999.00,   promo:1199.00, status:"paused",  views:1040, sales:0  },
  { id:"17", title:"Notebook Dell Inspiron 15 Core i5 8GB",         sku:"DL-INS15-I5-8",    thumb:"https://picsum.photos/seed/laptop1/200/200",     logistic:"cross_docking", qty:3,  amount:3299.00,  promo:null,    status:"active",  views:1880, sales:9  },
  { id:"18", title:"Tablet Samsung Galaxy Tab A8 10.5\"",           sku:"SM-TABA8-GRY",     thumb:"https://picsum.photos/seed/tablet1/200/200",     logistic:"fulfillment",   qty:11, amount:1099.00,  promo:1299.00, status:"active",  views:970,  sales:24 },
  { id:"19", title:"Pendrive Kingston 128GB USB 3.2 Gen 1",         sku:"KS-DT100-128",     thumb:"https://picsum.photos/seed/usb1/200/200",        logistic:"self_service",  qty:47, amount:69.90,    promo:null,    status:"active",  views:2200, sales:88 },
  { id:"20", title:"HD Externo Seagate Expansion 2TB USB 3.0",      sku:"SG-EXP2T-BLK",     thumb:"https://picsum.photos/seed/hdd1/200/200",        logistic:"cross_docking", qty:8,  amount:449.00,   promo:499.00,  status:"active",  views:750,  sales:15 },
];

const TOTAL = 124;
type P = typeof ALL_PRODUCTS[0];
const ROWS_OPTIONS = [10, 20, 50] as const;
type RowsOption = typeof ROWS_OPTIONS[number];

const fmt = (v: number | null | undefined) =>
  v == null ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

function logConfig(p: P) {
  if (p.logistic === "fulfillment")  return { bg: "bg-blue-600",   border: "border-blue-700",   Icon: Warehouse, label: "Full"  };
  if (p.logistic === "self_service") return { bg: "bg-orange-500", border: "border-orange-600", Icon: Zap,       label: "Flex"  };
  return                                    { bg: "bg-amber-500",  border: "border-amber-600",  Icon: Truck,     label: "Cross" };
}

function stockColor(qty: number) {
  if (qty === 0)   return "text-blue-400/50";
  if (qty < 3)     return "text-red-400";
  if (qty <= 7)    return "text-amber-400";
  return "text-emerald-400";
}

/* ─── Edit Dialog ─── */
function EditDialog({ p, onClose }: { p: P; onClose: () => void }) {
  const [qty, setQty] = useState(String(p.qty));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className={`${PANEL} ${BORDER} border rounded-2xl shadow-2xl w-full max-w-sm p-6`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold text-white">Editar Estoque</h2>
          <button onClick={onClose} className="text-blue-400/60 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <div className={`flex items-center gap-3 mb-5 p-3 ${INPUT} rounded-xl border ${BORDER}`}>
          <img src={p.thumb} alt={p.title} className="w-10 h-10 rounded-lg object-cover" />
          <div className="min-w-0">
            <p className="text-xs font-medium text-white truncate">{p.title}</p>
            <p className="text-[10px] font-mono text-blue-400/60">{p.sku}</p>
          </div>
        </div>
        <label className="block text-[10px] text-blue-400/70 uppercase tracking-wider mb-2">Nova quantidade disponível</label>
        <input type="number" min="0" value={qty} onChange={e => setQty(e.target.value)}
          className={`w-full ${INPUT} border ${BORDER} rounded-lg px-3 py-2 text-lg font-semibold text-center text-white focus:outline-none focus:ring-2 focus:ring-blue-500 mb-5`} />
        <div className="flex gap-3">
          <button onClick={onClose} className={`flex-1 border ${BORDER} rounded-lg py-2 text-xs text-blue-300 hover:bg-[#122040]`}>Cancelar</button>
          <button onClick={onClose} className="flex-1 bg-blue-600 hover:bg-blue-700 rounded-lg py-2 text-xs text-white font-medium">Salvar</button>
        </div>
      </div>
    </div>
  );
}

/* ─── Product Card — horizontal, 1 per row (like V9) ─── */
function ProductCard({ p, onEdit }: { p: P; onEdit: () => void }) {
  const lc = logConfig(p);
  const sc = stockColor(p.qty);
  const isPromo = p.promo != null && p.promo > p.amount;
  const MAX_QTY = 50;
  const barPct = Math.min(100, Math.round((p.qty / MAX_QTY) * 100));
  const barColor = p.qty === 0 ? "bg-blue-400/30" : p.qty < 3 ? "bg-red-500" : p.qty <= 7 ? "bg-amber-500" : "bg-emerald-500";

  return (
    <div className={`relative ${PANEL} border ${BORDER} rounded-xl overflow-hidden group hover:border-blue-600/40 hover:shadow-lg hover:shadow-black/40 transition-all duration-200 flex`}>

      {/* ── Left: thumbnail ── */}
      <div className={`relative w-28 flex-shrink-0 overflow-hidden ${INPUT}`}>
        {p.thumb ? (
          <img
            src={p.thumb}
            alt={p.title}
            className={`w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 ${p.qty === 0 ? "grayscale opacity-40" : ""}`}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Package className="w-8 h-8 text-blue-400/30" />
          </div>
        )}

        {/* Logistic chip — bottom strip */}
        <div className={`absolute bottom-0 left-0 right-0 flex items-center justify-center gap-1 py-1 ${lc.bg} border-t ${lc.border}`}>
          <lc.Icon className="w-3 h-3 text-white" />
          <span className="text-[9px] font-bold text-white uppercase tracking-wide">{lc.label}</span>
        </div>

        {/* Out of stock badge */}
        {p.qty === 0 && (
          <div className="absolute inset-x-0 top-[32%] flex justify-center">
            <span className="bg-red-600/90 text-white text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded rotate-[-8deg]">Esgot.</span>
          </div>
        )}
      </div>

      {/* ── Right: content ── */}
      <div className="flex-1 flex flex-col px-3 py-2.5 gap-1.5 min-w-0">

        {/* Title + SKU */}
        <div className="min-w-0">
          <p className="text-xs font-semibold text-white hover:text-blue-300 transition-colors leading-snug line-clamp-2">{p.title}</p>
          <p className="text-[10px] font-mono text-blue-400/60 truncate mt-0.5">{p.sku}</p>
        </div>

        {/* Status + promo badges */}
        <div className="flex items-center gap-2 flex-wrap">
          {p.status === "active" ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Ativo
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-400">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> Pausado
            </span>
          )}
          {isPromo && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-pink-400 bg-pink-400/10 border border-pink-400/20 px-1.5 py-0.5 rounded-full">
              <Tag className="w-2.5 h-2.5" /> Promo
            </span>
          )}
        </div>

        {/* KPI row: views + sales */}
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-[10px] text-blue-300">
            <Eye className="w-3 h-3 text-blue-400/50" />{p.views.toLocaleString("pt-BR")}
          </span>
          <span className="flex items-center gap-1 text-[10px] text-blue-300">
            <ShoppingCart className="w-3 h-3 text-blue-400/50" />{p.sales}
          </span>
          {p.sales > 40 && (
            <span className="flex items-center gap-0.5 text-[9px] text-emerald-400 font-bold ml-1">
              <TrendingUp className="w-3 h-3" />Hot
            </span>
          )}
        </div>

        {/* Bottom row: stock bar + price + edit */}
        <div className="flex items-end justify-between mt-auto gap-2">

          {/* Stock */}
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-1 mb-1">
              <span className={`text-xl font-black leading-none ${sc}`}>{p.qty}</span>
              <span className="text-[9px] text-blue-400/60 uppercase tracking-widest font-bold">un</span>
              {p.qty > 0 && p.qty < 3 && <AlertTriangle className="w-3 h-3 text-red-400 ml-0.5" />}
              {p.qty >= 3 && p.qty <= 7 && <AlertCircle className="w-3 h-3 text-amber-400 ml-0.5" />}
            </div>
            <div className={`h-1 rounded-full ${INPUT} overflow-hidden w-20`}>
              <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${barPct}%` }} />
            </div>
          </div>

          {/* Price + actions */}
          <div className="flex items-center gap-1.5">
            <div className="text-right">
              <p className="text-xs font-bold text-white">{fmt(p.amount)}</p>
              {isPromo && <p className="text-[9px] text-blue-400/60 line-through leading-none">{fmt(p.promo)}</p>}
            </div>
            <a href="#" className={`w-7 h-7 flex items-center justify-center rounded-lg text-blue-400/60 hover:text-blue-300 hover:bg-[#122040] border ${BORDER} transition-colors flex-shrink-0`}>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
            <button onClick={onEdit} className={`w-7 h-7 flex items-center justify-center rounded-lg text-blue-400/60 hover:text-white hover:bg-[#122040] border ${BORDER} transition-colors flex-shrink-0`}>
              <Pencil className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

/* ─── Skeleton card ─── */
function SkeletonCard() {
  return (
    <div className={`${PANEL} border ${BORDER} rounded-xl overflow-hidden flex h-24 animate-pulse`}>
      <div className={`w-28 flex-shrink-0 ${INPUT}`} />
      <div className="flex-1 px-3 py-2.5 flex flex-col gap-2">
        <div className={`h-3 ${INPUT} rounded w-3/4`} />
        <div className={`h-2.5 ${INPUT} rounded w-1/4`} />
        <div className={`h-1 ${INPUT} rounded w-1/3 mt-auto`} />
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

  const filtered   = ALL_PRODUCTS.filter(p =>
    search === "" ||
    p.title.toLowerCase().includes(search.toLowerCase()) ||
    p.sku.toLowerCase().includes(search.toLowerCase())
  );
  const pageData   = filtered.slice(0, Math.min(limit, filtered.length));
  const totalPages = Math.ceil(TOTAL / limit);
  const startItem  = (page - 1) * limit + 1;
  const endItem    = Math.min(page * limit, TOTAL);

  /* KPI strip */
  const kpi = {
    active: ALL_PRODUCTS.filter(p => p.status === "active" && p.qty > 0).length,
    paused: ALL_PRODUCTS.filter(p => p.status === "paused").length,
    empty:  ALL_PRODUCTS.filter(p => p.qty === 0).length,
    promo:  ALL_PRODUCTS.filter(p => p.promo != null).length,
  };

  const selectCls = `${INPUT} border ${BORDER} text-xs rounded-lg px-2.5 py-1.5 text-blue-200 focus:outline-none focus:ring-1 focus:ring-blue-400`;

  return (
    <div className={`h-screen flex flex-col ${ROOT} font-sans text-white overflow-hidden`}>

      {/* ── KPI strip ── */}
      <div className={`flex-shrink-0 ${PANEL} border-b ${BORDER} px-4 py-1.5 flex items-center gap-3 overflow-x-auto`}>
        <span className="flex items-center gap-1.5 text-[10px] font-semibold whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-emerald-400">{kpi.active} ativos</span>
        </span>
        <span className="text-[#1a3055]">·</span>
        <span className="flex items-center gap-1.5 text-[10px] font-semibold whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
          <span className="text-amber-400">{kpi.paused} pausados</span>
        </span>
        <span className="text-[#1a3055]">·</span>
        <span className="flex items-center gap-1.5 text-[10px] font-semibold whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
          <span className="text-red-400">{kpi.empty} sem estoque</span>
        </span>
        <span className="text-[#1a3055]">·</span>
        <span className="flex items-center gap-1.5 text-[10px] font-semibold whitespace-nowrap">
          <Tag className="w-3 h-3 text-pink-400" />
          <span className="text-pink-400">{kpi.promo} em promoção</span>
        </span>
        <span className="ml-auto text-[10px] text-blue-400/60 whitespace-nowrap">
          <span className="text-white font-semibold">{TOTAL}</span> anúncios
        </span>
      </div>

      {/* ── Sticky filter header ── */}
      <div className={`flex-shrink-0 ${ROOT} border-b ${BORDER} px-4 py-2.5 z-10`}>
        <div className="flex gap-2 items-center flex-wrap">

          <div className="relative flex-1 min-w-[160px] max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-blue-300" />
            <input
              type="text"
              placeholder="Buscar título ou SKU..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className={`w-full ${INPUT} border ${BORDER} text-xs rounded-lg pl-8 pr-3 py-1.5 text-blue-200 placeholder:text-blue-400/50 focus:outline-none focus:ring-1 focus:ring-blue-400`}
            />
          </div>

          <select className={selectCls}>
            <option>Todos os status</option>
            <option>Ativo</option>
            <option>Pausado</option>
          </select>

          <select className={selectCls}>
            <option>Toda logística</option>
            <option>Full</option>
            <option>Flex</option>
            <option>Cross</option>
          </select>

          <div className="flex items-center gap-2 ml-auto">
            <span className="text-[10px] text-blue-200 whitespace-nowrap font-medium hidden sm:block">Itens/pág.:</span>
            <div className={`flex items-center ${INPUT} border ${BORDER} rounded-lg overflow-hidden`}>
              {ROWS_OPTIONS.map(opt => (
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

            <button className={`flex items-center gap-1 ${INPUT} hover:bg-[#0d1b2e] border ${BORDER} text-xs rounded-lg px-2 py-1.5 text-blue-200 transition-colors`}>
              <SlidersHorizontal className="w-3 h-3" />Filtros
            </button>

            <span className="text-[10px] text-blue-200 whitespace-nowrap hidden sm:block">
              <span className="text-white font-semibold">{TOTAL}</span> anúncios
            </span>
          </div>
        </div>
      </div>

      {/* ── Scrollable body ── */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-4">

          {/* Single-column list */}
          <div className="flex flex-col gap-2.5">
            {pageData.map(p => (
              <ProductCard key={p.id} p={p} onEdit={() => setEditing(p)} />
            ))}
            {Array.from({ length: Math.max(0, Math.min(4, limit - pageData.length)) }, (_, i) => (
              <SkeletonCard key={`sk-${i}`} />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-[#1a3055]/40">
              <p className="text-[10px] text-blue-200">
                Mostrando <span className="text-white font-medium">{startItem}–{endItem}</span> de{" "}
                <span className="text-white font-medium">{TOTAL}</span> anúncios
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className={`flex items-center justify-center w-7 h-7 rounded-lg border ${BORDER} text-blue-300 hover:bg-[#122040] disabled:opacity-40 disabled:cursor-not-allowed transition-colors`}
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map(n => (
                  <button
                    key={n}
                    onClick={() => setPage(n)}
                    className={`w-7 h-7 rounded-lg text-[10px] font-semibold transition-colors ${
                      page === n ? "bg-blue-600 text-white" : `border ${BORDER} text-blue-300 hover:bg-[#122040]`
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
                      className={`w-7 h-7 rounded-lg text-[10px] font-semibold border ${BORDER} text-blue-300 hover:bg-[#122040] transition-colors`}
                    >
                      {totalPages}
                    </button>
                  </>
                )}
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className={`flex items-center justify-center w-7 h-7 rounded-lg border ${BORDER} text-blue-300 hover:bg-[#122040] disabled:opacity-40 disabled:cursor-not-allowed transition-colors`}
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
