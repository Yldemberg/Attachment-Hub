import React, { useState } from "react";
import {
  Warehouse, Zap, Truck, Tag, AlertTriangle, AlertCircle,
  Search, Package, Pencil, ChevronLeft, ChevronRight, X, ExternalLink,
  SlidersHorizontal
} from "lucide-react";

const mockProducts = [
  { id: "1",  title: "Tênis Nike Air Max 270 Masculino Preto",        sku: "NK-AM270-BLK-42",  thumbnail: "https://picsum.photos/seed/shoe1/200/200",      isFull: true,  isFlex: false, logisticType: "fulfillment",   availableQuantity: 24, amount: 479.90,   regularAmount: null,    status: "active"  },
  { id: "2",  title: "Mochila Adidas Originals 30L Urban",            sku: "AD-MCH-30L-GRY",   thumbnail: "https://picsum.photos/seed/bag1/200/200",       isFull: false, isFlex: true,  logisticType: "self_service",  availableQuantity: 3,  amount: 189.90,   regularAmount: 249.90,  status: "active"  },
  { id: "3",  title: "Fone Bluetooth Sony WH-1000XM5",                sku: "SN-WH1000-BLK",    thumbnail: "https://picsum.photos/seed/headphone1/200/200", isFull: false, isFlex: false, logisticType: "cross_docking", availableQuantity: 8,  amount: 1299.00,  regularAmount: null,    status: "active"  },
  { id: "4",  title: "Smartwatch Samsung Galaxy Watch 6 44mm",        sku: "SM-GW6-44-BLK",    thumbnail: "https://picsum.photos/seed/watch1/200/200",     isFull: true,  isFlex: false, logisticType: "fulfillment",   availableQuantity: 0,  amount: 1199.99,  regularAmount: 1499.99, status: "paused"  },
  { id: "5",  title: "Câmera GoPro HERO12 Black + Acessórios",        sku: "GP-HERO12-KIT",    thumbnail: "https://picsum.photos/seed/camera1/200/200",    isFull: false, isFlex: true,  logisticType: "self_service",  availableQuantity: 12, amount: 2199.00,  regularAmount: 2499.00, status: "active"  },
  { id: "6",  title: "Cadeira Gamer DXRacer Formula Preta/Vermelha",  sku: "DX-FORM-BRD",      thumbnail: "https://picsum.photos/seed/chair1/200/200",     isFull: false, isFlex: false, logisticType: "cross_docking", availableQuantity: 2,  amount: 1799.90,  regularAmount: null,    status: "active"  },
  { id: "7",  title: "Teclado Mecânico Redragon Kumara K552",         sku: "RD-K552-RGB",      thumbnail: "https://picsum.photos/seed/keyboard1/200/200",  isFull: true,  isFlex: false, logisticType: "fulfillment",   availableQuantity: 31, amount: 299.90,   regularAmount: null,    status: "active"  },
  { id: "8",  title: "Monitor LG UltraWide 29\" IPS 75Hz",           sku: "LG-29WP500-B",     thumbnail: "https://picsum.photos/seed/monitor1/200/200",   isFull: false, isFlex: false, logisticType: "cross_docking", availableQuantity: 5,  amount: 1349.00,  regularAmount: 1599.00, status: "active"  },
  { id: "9",  title: "Carregador Portátil Xiaomi 20000mAh",           sku: "XI-PB20K-BLK",     thumbnail: "https://picsum.photos/seed/charger1/200/200",   isFull: false, isFlex: true,  logisticType: "self_service",  availableQuantity: 0,  amount: 189.00,   regularAmount: null,    status: "paused"  },
  { id: "10", title: "Controle DualSense PS5 Branco",                 sku: "PS-DS5-WHT",       thumbnail: "https://picsum.photos/seed/control1/200/200",   isFull: true,  isFlex: false, logisticType: "fulfillment",   availableQuantity: 17, amount: 449.90,   regularAmount: null,    status: "active"  },
  { id: "11", title: "Headset Gamer HyperX Cloud II 7.1",             sku: "HX-CLOUD2-BLK",    thumbnail: "https://picsum.photos/seed/headset1/200/200",   isFull: false, isFlex: false, logisticType: "cross_docking", availableQuantity: 6,  amount: 529.00,   regularAmount: 649.00,  status: "active"  },
  { id: "12", title: "Mouse Logitech MX Master 3S Grafite",           sku: "LG-MXM3S-GRF",     thumbnail: "https://picsum.photos/seed/mouse1/200/200",     isFull: false, isFlex: true,  logisticType: "self_service",  availableQuantity: 22, amount: 599.90,   regularAmount: null,    status: "active"  },
];

type Product = typeof mockProducts[0];
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

export function V9DenseGrid() {
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);

  return (
    <div className="min-h-screen bg-slate-950 p-4 md:p-6 font-sans text-slate-200">
      <div className="max-w-7xl mx-auto space-y-4">

        {/* Compact Filter Bar */}
        <div className="flex gap-2 items-center bg-slate-900/60 px-3 py-2.5 rounded-xl border border-slate-800">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <input
              type="text"
              placeholder="Buscar título ou SKU..."
              className="w-full bg-slate-950 border border-slate-800 text-xs rounded-lg pl-8 pr-3 py-1.5 text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <select className="bg-slate-950 border border-slate-800 text-xs rounded-lg px-2.5 py-1.5 text-slate-300 focus:outline-none">
            <option>Todos os status</option>
            <option>Ativo</option>
            <option>Pausado</option>
          </select>
          <select className="bg-slate-950 border border-slate-800 text-xs rounded-lg px-2.5 py-1.5 text-slate-300 focus:outline-none">
            <option>Toda logística</option>
            <option>Full</option>
            <option>Flex</option>
            <option>Cross</option>
          </select>
          <button className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs rounded-lg px-2.5 py-1.5 text-slate-300 transition-colors ml-auto">
            <SlidersHorizontal className="w-3 h-3" />
            Filtros
          </button>
          <span className="text-[10px] text-slate-500 whitespace-nowrap">
            <span className="text-slate-300 font-medium">124</span> produtos
          </span>
        </div>

        {/* Dense card grid — 2 col mobile, 3 col md, 4 col lg */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
          {mockProducts.map(product => {
            const isPromo = product.regularAmount != null && product.regularAmount > product.amount;

            let accentBg = "bg-slate-600", accentBorder = "border-slate-500", Icon = Package, logText = "Normal";
            if (product.isFull || product.logisticType === "fulfillment")  { accentBg = "bg-blue-600";   accentBorder = "border-blue-700";   Icon = Warehouse; logText = "Full";  }
            else if (product.isFlex || product.logisticType === "self_service") { accentBg = "bg-orange-500"; accentBorder = "border-orange-600"; Icon = Zap;       logText = "Flex";  }
            else if (product.logisticType === "cross_docking")              { accentBg = "bg-amber-500";  accentBorder = "border-amber-600";  Icon = Truck;     logText = "Cross"; }

            let stockColor = "text-emerald-400";
            if (product.availableQuantity === 0)       stockColor = "text-slate-500";
            else if (product.availableQuantity < 3)    stockColor = "text-red-500";
            else if (product.availableQuantity <= 7)   stockColor = "text-amber-400";

            return (
              <div
                key={product.id}
                className="relative bg-slate-900 border border-slate-800 rounded-xl overflow-hidden group hover:border-slate-600 hover:shadow-md hover:shadow-black/30 transition-all duration-200 flex"
              >
                {/* Left: thumbnail (fixed width, full card height) */}
                <button
                  onClick={() => setDetailProduct(product)}
                  className="relative w-16 flex-shrink-0 overflow-hidden bg-slate-800 focus:outline-none"
                  title="Ver detalhes"
                >
                  <img
                    src={product.thumbnail}
                    alt={product.title}
                    className={`w-full h-full object-cover group-hover:scale-105 transition-transform duration-400 ${product.availableQuantity === 0 ? "grayscale opacity-50" : ""}`}
                  />
                  {/* Logistic chip at bottom of image */}
                  <div className={`absolute bottom-0 left-0 right-0 flex items-center justify-center gap-0.5 py-0.5 ${accentBg} border-t ${accentBorder}`}>
                    <Icon className="w-2.5 h-2.5 text-white" />
                    <span className="text-[8px] font-bold text-white uppercase tracking-wide">{logText}</span>
                  </div>
                  {/* Esgotado badge */}
                  {product.availableQuantity === 0 && (
                    <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-center">
                      <span className="bg-red-600/90 text-white text-[7px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded rotate-[-8deg]">Esgot.</span>
                    </div>
                  )}
                </button>

                {/* Right: content */}
                <div className="flex-1 flex flex-col p-2 gap-1 min-w-0">

                  {/* Title + SKU */}
                  <div className="min-w-0">
                    <button
                      onClick={() => setDetailProduct(product)}
                      className="text-[10px] font-semibold text-slate-200 hover:text-blue-300 transition-colors leading-snug line-clamp-2 text-left w-full"
                      title={product.title}
                    >
                      {product.title}
                    </button>
                    <p className="text-[9px] font-mono text-slate-600 truncate mt-0.5">{product.sku}</p>
                  </div>

                  {/* Status badge */}
                  <div className="flex items-center gap-1">
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
                      <span className="inline-flex items-center gap-0.5 text-[8px] font-semibold text-pink-400 ml-1">
                        <Tag className="w-2 h-2" /> Promo
                      </span>
                    )}
                  </div>

                  {/* Stock + edit button */}
                  <div className="flex items-center justify-between mt-auto">
                    <div className="flex items-baseline gap-0.5">
                      <span className={`text-xl font-black leading-none ${stockColor}`}>
                        {product.availableQuantity}
                      </span>
                      <span className="text-[8px] text-slate-600 ml-0.5 uppercase tracking-widest font-semibold">un</span>
                      {product.availableQuantity > 0 && product.availableQuantity < 3 && <AlertTriangle className="w-2.5 h-2.5 text-red-500 ml-0.5" />}
                      {product.availableQuantity >= 3 && product.availableQuantity <= 7 && <AlertCircle className="w-2.5 h-2.5 text-amber-400 ml-0.5" />}
                    </div>
                    <button
                      onClick={() => setEditingProduct(product)}
                      className="w-5 h-5 flex items-center justify-center rounded text-slate-600 hover:text-white hover:bg-slate-700 transition-colors"
                      title="Editar estoque"
                    >
                      <Pencil className="w-2.5 h-2.5" />
                    </button>
                  </div>

                  {/* Price */}
                  <div className="flex items-baseline gap-1">
                    <span className="text-[10px] font-bold text-slate-300">{fmt(product.amount)}</span>
                    {isPromo && <span className="text-[8px] text-slate-600 line-through">{fmt(product.regularAmount)}</span>}
                  </div>

                </div>
              </div>
            );
          })}
        </div>

        {/* Compact Pagination */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-800/50">
          <p className="text-[10px] text-slate-500">
            Pág. <span className="text-slate-300 font-medium">1</span> de <span className="text-slate-300 font-medium">11</span>
            &nbsp;·&nbsp; <span className="text-slate-300 font-medium">124</span> anúncios
          </p>
          <div className="flex items-center gap-1.5">
            <button className="flex items-center justify-center w-7 h-7 rounded-lg border border-slate-700 text-slate-400 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors" disabled>
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <div className="flex items-center gap-1">
              {[1, 2, 3].map(n => (
                <button key={n} className={`w-7 h-7 rounded-lg text-[10px] font-semibold transition-colors ${n === 1 ? "bg-blue-600 text-white" : "border border-slate-700 text-slate-400 hover:bg-slate-800"}`}>{n}</button>
              ))}
              <span className="text-slate-600 text-xs px-0.5">…</span>
              <button className="w-7 h-7 rounded-lg border border-slate-700 text-slate-400 hover:bg-slate-800 text-[10px] font-semibold transition-colors">11</button>
            </div>
            <button className="flex items-center justify-center w-7 h-7 rounded-lg border border-slate-700 text-slate-400 hover:bg-slate-800 transition-colors">
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

      </div>

      <style dangerouslySetInnerHTML={{ __html: `.hide-scrollbar::-webkit-scrollbar{display:none}.hide-scrollbar{-ms-overflow-style:none;scrollbar-width:none}` }} />
      {editingProduct && <StockEditDialog product={editingProduct} onClose={() => setEditingProduct(null)} />}
      {detailProduct && <DetailDialog product={detailProduct} onClose={() => setDetailProduct(null)} />}
    </div>
  );
}
