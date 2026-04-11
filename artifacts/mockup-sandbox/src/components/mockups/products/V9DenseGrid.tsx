import React, { useState } from "react";
import {
  Warehouse, Zap, Truck, Tag, AlertTriangle, AlertCircle,
  Search, Package, Pencil, ChevronLeft, ChevronRight, X, ExternalLink,
  SlidersHorizontal, LayoutGrid, List
} from "lucide-react";

const ALL_PRODUCTS = [
  { id: "1",  title: "Tênis Nike Air Max 270 Masculino Preto",        sku: "NK-AM270-BLK-42",  thumbnail: "https://picsum.photos/seed/shoe1/200/200",       isFull: true,  isFlex: false, logisticType: "fulfillment",   availableQuantity: 24, amount: 479.90,   regularAmount: null,    status: "active"  },
  { id: "2",  title: "Mochila Adidas Originals 30L Urban",            sku: "AD-MCH-30L-GRY",   thumbnail: "https://picsum.photos/seed/bag1/200/200",        isFull: false, isFlex: true,  logisticType: "self_service",  availableQuantity: 3,  amount: 189.90,   regularAmount: 249.90,  status: "active"  },
  { id: "3",  title: "Fone Bluetooth Sony WH-1000XM5",                sku: "SN-WH1000-BLK",    thumbnail: "https://picsum.photos/seed/headphone1/200/200",  isFull: false, isFlex: false, logisticType: "cross_docking", availableQuantity: 8,  amount: 1299.00,  regularAmount: null,    status: "active"  },
  { id: "4",  title: "Smartwatch Samsung Galaxy Watch 6 44mm",        sku: "SM-GW6-44-BLK",    thumbnail: "https://picsum.photos/seed/watch1/200/200",      isFull: true,  isFlex: false, logisticType: "fulfillment",   availableQuantity: 0,  amount: 1199.99,  regularAmount: 1499.99, status: "paused"  },
  { id: "5",  title: "Câmera GoPro HERO12 Black + Acessórios",        sku: "GP-HERO12-KIT",    thumbnail: "https://picsum.photos/seed/camera1/200/200",     isFull: false, isFlex: true,  logisticType: "self_service",  availableQuantity: 12, amount: 2199.00,  regularAmount: 2499.00, status: "active"  },
  { id: "6",  title: "Cadeira Gamer DXRacer Formula Preta/Vermelha",  sku: "DX-FORM-BRD",      thumbnail: "https://picsum.photos/seed/chair1/200/200",      isFull: false, isFlex: false, logisticType: "cross_docking", availableQuantity: 2,  amount: 1799.90,  regularAmount: null,    status: "active"  },
  { id: "7",  title: "Teclado Mecânico Redragon Kumara K552 RGB",     sku: "RD-K552-RGB",      thumbnail: "https://picsum.photos/seed/keyboard1/200/200",   isFull: true,  isFlex: false, logisticType: "fulfillment",   availableQuantity: 31, amount: 299.90,   regularAmount: null,    status: "active"  },
  { id: "8",  title: "Monitor LG UltraWide 29\" IPS 75Hz",            sku: "LG-29WP500-B",     thumbnail: "https://picsum.photos/seed/monitor1/200/200",    isFull: false, isFlex: false, logisticType: "cross_docking", availableQuantity: 5,  amount: 1349.00,  regularAmount: 1599.00, status: "active"  },
  { id: "9",  title: "Carregador Portátil Xiaomi 20000mAh USB-C",     sku: "XI-PB20K-BLK",     thumbnail: "https://picsum.photos/seed/charger1/200/200",    isFull: false, isFlex: true,  logisticType: "self_service",  availableQuantity: 0,  amount: 189.00,   regularAmount: null,    status: "paused"  },
  { id: "10", title: "Controle DualSense PS5 Branco",                 sku: "PS-DS5-WHT",       thumbnail: "https://picsum.photos/seed/control1/200/200",    isFull: true,  isFlex: false, logisticType: "fulfillment",   availableQuantity: 17, amount: 449.90,   regularAmount: null,    status: "active"  },
  { id: "11", title: "Headset Gamer HyperX Cloud II 7.1 Surround",    sku: "HX-CLOUD2-BLK",    thumbnail: "https://picsum.photos/seed/headset1/200/200",    isFull: false, isFlex: false, logisticType: "cross_docking", availableQuantity: 6,  amount: 529.00,   regularAmount: 649.00,  status: "active"  },
  { id: "12", title: "Mouse Logitech MX Master 3S Grafite",           sku: "LG-MXM3S-GRF",     thumbnail: "https://picsum.photos/seed/mouse1/200/200",      isFull: false, isFlex: true,  logisticType: "self_service",  availableQuantity: 22, amount: 599.90,   regularAmount: null,    status: "active"  },
  { id: "13", title: "Webcam Logitech C920 HD Pro 1080p",             sku: "LG-C920-BLK",      thumbnail: "https://picsum.photos/seed/webcam1/200/200",     isFull: true,  isFlex: false, logisticType: "fulfillment",   availableQuantity: 9,  amount: 399.00,   regularAmount: 499.00,  status: "active"  },
  { id: "14", title: "Impressora HP LaserJet Pro M404dn",             sku: "HP-LJM404-BLK",    thumbnail: "https://picsum.photos/seed/printer1/200/200",    isFull: false, isFlex: false, logisticType: "cross_docking", availableQuantity: 4,  amount: 1899.00,  regularAmount: null,    status: "active"  },
  { id: "15", title: "Roteador TP-Link Archer AX73 Wi-Fi 6",          sku: "TP-AX73-WHT",      thumbnail: "https://picsum.photos/seed/router1/200/200",     isFull: false, isFlex: true,  logisticType: "self_service",  availableQuantity: 14, amount: 749.90,   regularAmount: 899.00,  status: "active"  },
  { id: "16", title: "Caixa de Som JBL Charge 5 Bluetooth 40W",       sku: "JBL-CHG5-BLK",     thumbnail: "https://picsum.photos/seed/speaker1/200/200",    isFull: true,  isFlex: false, logisticType: "fulfillment",   availableQuantity: 0,  amount: 999.00,   regularAmount: 1199.00, status: "paused"  },
  { id: "17", title: "Notebook Dell Inspiron 15 Core i5 8GB",         sku: "DL-INS15-I5-8",    thumbnail: "https://picsum.photos/seed/laptop1/200/200",     isFull: false, isFlex: false, logisticType: "cross_docking", availableQuantity: 3,  amount: 3299.00,  regularAmount: null,    status: "active"  },
  { id: "18", title: "Tablet Samsung Galaxy Tab A8 10.5\"",           sku: "SM-TABA8-GRY",     thumbnail: "https://picsum.photos/seed/tablet1/200/200",     isFull: true,  isFlex: false, logisticType: "fulfillment",   availableQuantity: 11, amount: 1099.00,  regularAmount: 1299.00, status: "active"  },
  { id: "19", title: "Pendrive Kingston 128GB USB 3.2 Gen 1",         sku: "KS-DT100-128",     thumbnail: "https://picsum.photos/seed/usb1/200/200",        isFull: false, isFlex: true,  logisticType: "self_service",  availableQuantity: 47, amount: 69.90,    regularAmount: null,    status: "active"  },
  { id: "20", title: "HD Externo Seagate Expansion 2TB USB 3.0",      sku: "SG-EXP2T-BLK",     thumbnail: "https://picsum.photos/seed/hdd1/200/200",        isFull: false, isFlex: false, logisticType: "cross_docking", availableQuantity: 8,  amount: 449.00,   regularAmount: 499.00,  status: "active"  },
];

const TOTAL_SIMULATED = 124;

type Product = typeof ALL_PRODUCTS[0];
const ROWS_OPTIONS = [10, 20, 50] as const;
type RowsOption = typeof ROWS_OPTIONS[number];

const fmt = (v: number | null | undefined) =>
  v == null ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

function StockEditDialog({ product, onClose }: { product: Product; onClose: () => void }) {
  const [qty, setQty] = useState(String(product.availableQuantity));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-white">Editar Estoque</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex items-center gap-3 mb-5 p-3 bg-slate-800 rounded-xl border border-slate-700">
          <img src={product.thumbnail} alt={product.title} className="w-10 h-10 rounded-lg object-cover" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-white truncate">{product.title}</p>
            <p className="text-xs font-mono text-slate-500">{product.sku}</p>
          </div>
        </div>
        <label className="block text-xs text-slate-400 uppercase tracking-wider mb-2">Nova quantidade disponível</label>
        <input type="number" min="0" value={qty} onChange={e => setQty(e.target.value)}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-lg font-semibold text-center text-white focus:outline-none focus:ring-2 focus:ring-blue-500 mb-5" />
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 border border-slate-700 rounded-lg py-2 text-sm text-slate-400 hover:bg-slate-800">Cancelar</button>
          <button onClick={onClose} className="flex-1 bg-blue-600 hover:bg-blue-700 rounded-lg py-2 text-sm text-white font-medium">Salvar</button>
        </div>
      </div>
    </div>
  );
}

function DetailDialog({ product, onClose }: { product: Product; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-white">Detalhes do Produto</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex gap-4 mb-5">
          <img src={product.thumbnail} alt={product.title} className="w-20 h-20 rounded-xl object-cover bg-slate-800 border border-slate-700" />
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-white leading-snug mb-1">{product.title}</h3>
            <p className="text-xs font-mono text-slate-500 mb-2">{product.sku}</p>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${product.status === "active" ? "bg-emerald-500" : "bg-amber-500"}`} />
              <span className="text-xs text-slate-400">{product.status === "active" ? "Ativo" : "Pausado"}</span>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="bg-slate-800 rounded-xl p-3 border border-slate-700">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Preço</p>
            <p className="text-base font-bold text-white">{fmt(product.amount)}</p>
            {product.regularAmount && <p className="text-xs text-slate-500 line-through">{fmt(product.regularAmount)}</p>}
          </div>
          <div className="bg-slate-800 rounded-xl p-3 border border-slate-700">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Estoque</p>
            <p className={`text-base font-bold ${product.availableQuantity < 3 ? "text-red-400" : product.availableQuantity <= 7 ? "text-amber-400" : "text-emerald-400"}`}>
              {product.availableQuantity} un.
            </p>
          </div>
          <div className="bg-slate-800 rounded-xl p-3 border border-slate-700 col-span-2">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Logística</p>
            <p className="text-sm font-medium text-white">{product.isFull ? "Full (Mercado Envios Full)" : product.isFlex ? "Flex" : "Cross-docking"}</p>
          </div>
        </div>
        <button onClick={onClose} className="w-full border border-slate-700 rounded-xl py-2.5 text-sm text-slate-300 font-medium hover:bg-slate-800 flex items-center justify-center gap-2">
          <ExternalLink className="w-4 h-4" /> Ver no Mercado Livre
        </button>
      </div>
    </div>
  );
}

function ProductCard({ product, onEdit, onDetail }: { product: Product; onEdit: () => void; onDetail: () => void }) {
  const isPromo = product.regularAmount != null && product.regularAmount > product.amount;

  let accentBg = "bg-slate-600", accentBorder = "border-slate-500", Icon = Package, logText = "Normal";
  if (product.isFull || product.logisticType === "fulfillment")       { accentBg = "bg-blue-600";   accentBorder = "border-blue-700";   Icon = Warehouse; logText = "Full";  }
  else if (product.isFlex || product.logisticType === "self_service") { accentBg = "bg-orange-500"; accentBorder = "border-orange-600"; Icon = Zap;       logText = "Flex";  }
  else if (product.logisticType === "cross_docking")                  { accentBg = "bg-amber-500";  accentBorder = "border-amber-600";  Icon = Truck;     logText = "Cross"; }

  let stockColor = "text-emerald-400";
  if (product.availableQuantity === 0)     stockColor = "text-slate-500";
  else if (product.availableQuantity < 3)  stockColor = "text-red-500";
  else if (product.availableQuantity <= 7) stockColor = "text-amber-400";

  return (
    <div className="relative bg-slate-900 border border-slate-800 rounded-xl overflow-hidden group hover:border-slate-600 hover:shadow-md hover:shadow-black/30 transition-all duration-200 flex">
      {/* Left: thumbnail */}
      <button
        onClick={onDetail}
        className="relative w-16 flex-shrink-0 overflow-hidden bg-slate-800 focus:outline-none"
        title="Ver detalhes"
      >
        <img
          src={product.thumbnail}
          alt={product.title}
          className={`w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 ${product.availableQuantity === 0 ? "grayscale opacity-50" : ""}`}
        />
        <div className={`absolute bottom-0 left-0 right-0 flex items-center justify-center gap-0.5 py-[3px] ${accentBg} border-t ${accentBorder}`}>
          <Icon className="w-2.5 h-2.5 text-white" />
          <span className="text-[8px] font-bold text-white uppercase tracking-wide">{logText}</span>
        </div>
        {product.availableQuantity === 0 && (
          <div className="absolute inset-x-0 top-[35%] flex justify-center">
            <span className="bg-red-600/90 text-white text-[7px] font-black uppercase tracking-widest px-1 py-0.5 rounded rotate-[-8deg]">Esgot.</span>
          </div>
        )}
      </button>

      {/* Right: content */}
      <div className="flex-1 flex flex-col p-2 gap-1 min-w-0">
        <div className="min-w-0">
          <button
            onClick={onDetail}
            className="text-[10px] font-semibold text-slate-200 hover:text-blue-300 transition-colors leading-snug line-clamp-2 text-left w-full"
            title={product.title}
          >
            {product.title}
          </button>
          <p className="text-[9px] font-mono text-slate-600 truncate mt-0.5">{product.sku}</p>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {product.status === "active" ? (
            <span className="inline-flex items-center gap-0.5 text-[8px] font-semibold text-emerald-400">
              <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" /> Ativo
            </span>
          ) : (
            <span className="inline-flex items-center gap-0.5 text-[8px] font-semibold text-amber-400">
              <span className="w-1 h-1 rounded-full bg-amber-400" /> Pausado
            </span>
          )}
          {isPromo && (
            <span className="inline-flex items-center gap-0.5 text-[8px] font-semibold text-pink-400">
              <Tag className="w-2 h-2" /> Promo
            </span>
          )}
        </div>

        <div className="flex items-center justify-between mt-auto">
          <div className="flex items-baseline gap-0.5">
            <span className={`text-xl font-black leading-none ${stockColor}`}>{product.availableQuantity}</span>
            <span className="text-[8px] text-slate-600 ml-0.5 uppercase tracking-widest font-semibold">un</span>
            {product.availableQuantity > 0 && product.availableQuantity < 3 && <AlertTriangle className="w-2.5 h-2.5 text-red-500 ml-0.5" />}
            {product.availableQuantity >= 3 && product.availableQuantity <= 7 && <AlertCircle className="w-2.5 h-2.5 text-amber-400 ml-0.5" />}
          </div>
          <button
            onClick={onEdit}
            className="w-5 h-5 flex items-center justify-center rounded text-slate-600 hover:text-white hover:bg-slate-700 transition-colors"
            title="Editar estoque"
          >
            <Pencil className="w-2.5 h-2.5" />
          </button>
        </div>

        <div className="flex items-baseline gap-1">
          <span className="text-[10px] font-bold text-slate-300">{fmt(product.amount)}</span>
          {isPromo && <span className="text-[8px] text-slate-600 line-through">{fmt(product.regularAmount)}</span>}
        </div>
      </div>
    </div>
  );
}

export function V9DenseGrid() {
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
  const [rowsPerPage, setRowsPerPage] = useState<RowsOption>(10);
  const [currentPage, setCurrentPage] = useState(1);

  // 2 cards per row, so items per page = rows × 2
  const itemsPerPage = rowsPerPage * 2;
  const totalPages = Math.ceil(TOTAL_SIMULATED / itemsPerPage);

  // Slice mock data to simulate the current page
  const pageProducts = ALL_PRODUCTS.slice(0, Math.min(itemsPerPage, ALL_PRODUCTS.length));

  const startItem = (currentPage - 1) * itemsPerPage + 1;
  const endItem = Math.min(currentPage * itemsPerPage, TOTAL_SIMULATED);

  return (
    <div className="h-screen flex flex-col bg-slate-950 font-sans text-slate-200 overflow-hidden">

      {/* ── Sticky header ── */}
      <div className="flex-shrink-0 bg-slate-950/95 backdrop-blur-sm border-b border-slate-800 px-4 py-2.5 z-10">
        <div className="flex gap-2 items-center flex-wrap">

          {/* Search */}
          <div className="relative flex-1 min-w-[160px] max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <input
              type="text"
              placeholder="Buscar título ou SKU..."
              className="w-full bg-slate-900 border border-slate-800 text-xs rounded-lg pl-8 pr-3 py-1.5 text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Status filter */}
          <select className="bg-slate-900 border border-slate-800 text-xs rounded-lg px-2.5 py-1.5 text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-500">
            <option>Todos os status</option>
            <option>Ativo</option>
            <option>Pausado</option>
          </select>

          {/* Logistics filter */}
          <select className="bg-slate-900 border border-slate-800 text-xs rounded-lg px-2.5 py-1.5 text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-500">
            <option>Toda logística</option>
            <option>Full</option>
            <option>Flex</option>
            <option>Cross</option>
          </select>

          {/* Right side controls */}
          <div className="flex items-center gap-2 ml-auto">

            {/* Rows per page selector */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-slate-500 whitespace-nowrap">Linhas por pág.:</span>
              <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
                {ROWS_OPTIONS.map(opt => (
                  <button
                    key={opt}
                    onClick={() => { setRowsPerPage(opt); setCurrentPage(1); }}
                    className={`px-2.5 py-1.5 text-[10px] font-semibold transition-colors border-r border-slate-800 last:border-r-0 ${
                      rowsPerPage === opt
                        ? "bg-blue-600 text-white"
                        : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>

            {/* Layout toggle */}
            <div className="flex items-center gap-0.5 bg-slate-900 border border-slate-800 rounded-lg p-0.5">
              <button className="w-6 h-6 flex items-center justify-center rounded-md bg-slate-700 text-white">
                <LayoutGrid className="w-3 h-3" />
              </button>
              <button className="w-6 h-6 flex items-center justify-center rounded-md text-slate-500 hover:text-slate-300 transition-colors">
                <List className="w-3 h-3" />
              </button>
            </div>

            <button className="flex items-center gap-1 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs rounded-lg px-2 py-1.5 text-slate-400 transition-colors">
              <SlidersHorizontal className="w-3 h-3" />
              Filtros
            </button>

            <span className="text-[10px] text-slate-500 whitespace-nowrap hidden sm:block">
              <span className="text-slate-300 font-semibold">{TOTAL_SIMULATED}</span> anúncios
            </span>
          </div>
        </div>
      </div>

      {/* ── Scrollable body ── */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-4">

          {/* 2-column grid */}
          <div className="grid grid-cols-2 gap-2.5">
            {pageProducts.map(product => (
              <ProductCard
                key={product.id}
                product={product}
                onEdit={() => setEditingProduct(product)}
                onDetail={() => setDetailProduct(product)}
              />
            ))}
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-800/50">
            <p className="text-[10px] text-slate-500">
              Mostrando <span className="text-slate-300 font-medium">{startItem}–{endItem}</span> de{" "}
              <span className="text-slate-300 font-medium">{TOTAL_SIMULATED}</span> anúncios
              &nbsp;·&nbsp;
              <span className="text-slate-400">{rowsPerPage} linhas/pág. · {itemsPerPage} cards/pág.</span>
            </p>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="flex items-center justify-center w-7 h-7 rounded-lg border border-slate-700 text-slate-400 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>

              <div className="flex items-center gap-1">
                {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map(n => (
                  <button
                    key={n}
                    onClick={() => setCurrentPage(n)}
                    className={`w-7 h-7 rounded-lg text-[10px] font-semibold transition-colors ${
                      currentPage === n ? "bg-blue-600 text-white" : "border border-slate-700 text-slate-400 hover:bg-slate-800"
                    }`}
                  >
                    {n}
                  </button>
                ))}
                {totalPages > 5 && (
                  <>
                    <span className="text-slate-600 text-xs px-0.5">…</span>
                    <button
                      onClick={() => setCurrentPage(totalPages)}
                      className={`w-7 h-7 rounded-lg text-[10px] font-semibold transition-colors ${
                        currentPage === totalPages ? "bg-blue-600 text-white" : "border border-slate-700 text-slate-400 hover:bg-slate-800"
                      }`}
                    >
                      {totalPages}
                    </button>
                  </>
                )}
              </div>

              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="flex items-center justify-center w-7 h-7 rounded-lg border border-slate-700 text-slate-400 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

        </div>
      </div>

      {editingProduct && <StockEditDialog product={editingProduct} onClose={() => setEditingProduct(null)} />}
      {detailProduct && <DetailDialog product={detailProduct} onClose={() => setDetailProduct(null)} />}
    </div>
  );
}
