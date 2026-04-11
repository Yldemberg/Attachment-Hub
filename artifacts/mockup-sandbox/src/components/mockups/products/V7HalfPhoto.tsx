import React, { useState } from "react";
import {
  Warehouse, Zap, Truck, Tag, AlertTriangle, AlertCircle,
  Search, Package, Pencil, ChevronLeft, ChevronRight, X, ExternalLink
} from "lucide-react";

const mockProducts = [
  { id: "1", title: "Tênis Nike Air Max 270 Masculino Preto", sku: "NK-AM270-BLK-42", thumbnail: "https://picsum.photos/seed/shoe1/200/200", isFull: true, isFlex: false, logisticType: "fulfillment", availableQuantity: 24, amount: 479.90, regularAmount: null, status: "active" },
  { id: "2", title: "Mochila Adidas Originals 30L Backpack Urban", sku: "AD-MCH-30L-GRY", thumbnail: "https://picsum.photos/seed/bag1/200/200", isFull: false, isFlex: true, logisticType: "self_service", availableQuantity: 3, amount: 189.90, regularAmount: 249.90, status: "active" },
  { id: "3", title: "Fone Bluetooth Sony WH-1000XM5", sku: "SN-WH1000-BLK", thumbnail: "https://picsum.photos/seed/headphone1/200/200", isFull: false, isFlex: false, logisticType: "cross_docking", availableQuantity: 8, amount: 1299.00, regularAmount: null, status: "active" },
  { id: "4", title: "Smartwatch Samsung Galaxy Watch 6 44mm", sku: "SM-GW6-44-BLK", thumbnail: "https://picsum.photos/seed/watch1/200/200", isFull: true, isFlex: false, logisticType: "fulfillment", availableQuantity: 0, amount: 1199.99, regularAmount: 1499.99, status: "paused" },
  { id: "5", title: "Câmera GoPro HERO12 Black + Acessórios", sku: "GP-HERO12-KIT", thumbnail: "https://picsum.photos/seed/camera1/200/200", isFull: false, isFlex: true, logisticType: "self_service", availableQuantity: 12, amount: 2199.00, regularAmount: 2499.00, status: "active" },
  { id: "6", title: "Cadeira Gamer DXRacer Formula Preta/Vermelha", sku: "DX-FORM-BRD", thumbnail: "https://picsum.photos/seed/chair1/200/200", isFull: false, isFlex: false, logisticType: "cross_docking", availableQuantity: 2, amount: 1799.90, regularAmount: null, status: "active" },
];

type Product = typeof mockProducts[0];
const fmt = (v: number | null | undefined) => v == null ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

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

export function V7HalfPhoto() {
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);

  return (
    <div className="min-h-screen bg-[#0a0a12] p-4 md:p-8 font-sans text-slate-200">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Filter Bar */}
        <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-slate-900/60 p-4 rounded-2xl border border-slate-800/80">
          <div className="relative w-full md:w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input type="text" placeholder="Buscar título ou SKU..."
              className="w-full bg-[#0a0a12] border border-slate-800 text-sm rounded-xl pl-9 pr-4 py-2 text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500" />
          </div>
          <div className="flex w-full md:w-auto gap-2 overflow-x-auto pb-1 md:pb-0 hide-scrollbar">
            <select className="bg-[#0a0a12] border border-slate-800 text-sm rounded-xl px-3 py-2 text-slate-200 focus:outline-none">
              <option>Status: Todos</option><option>Ativo</option><option>Pausado</option>
            </select>
            <select className="bg-[#0a0a12] border border-slate-800 text-sm rounded-xl px-3 py-2 text-slate-200 focus:outline-none">
              <option>Logística: Todos</option><option>Full</option><option>Flex</option><option>Cross</option>
            </select>
          </div>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {mockProducts.map(product => {
            const isPromo = product.regularAmount != null && product.regularAmount > product.amount;
            let accentColor = "bg-slate-600", accentText = "text-slate-300", Icon = Package, logText = "Normal";
            if (product.isFull || product.logisticType === "fulfillment") { accentColor = "bg-blue-600"; accentText = "text-blue-300"; Icon = Warehouse; logText = "Full"; }
            else if (product.isFlex || product.logisticType === "self_service") { accentColor = "bg-orange-600"; accentText = "text-orange-300"; Icon = Zap; logText = "Flex"; }
            else if (product.logisticType === "cross_docking") { accentColor = "bg-amber-600"; accentText = "text-amber-300"; Icon = Truck; logText = "Cross"; }

            let stockColor = "text-emerald-400";
            if (product.availableQuantity === 0) stockColor = "text-slate-500";
            else if (product.availableQuantity < 3) stockColor = "text-red-500";
            else if (product.availableQuantity <= 7) stockColor = "text-amber-400";

            return (
              <div key={product.id} className="relative bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden group hover:border-slate-600 hover:shadow-lg hover:shadow-black/40 transition-all duration-300 flex flex-col">

                {/* Full-width photo — top 55% of the card */}
                <button
                  onClick={() => setDetailProduct(product)}
                  className="relative w-full h-36 overflow-hidden bg-slate-800 focus:outline-none flex-shrink-0"
                  title="Ver detalhes"
                >
                  <img
                    src={product.thumbnail}
                    alt={product.title}
                    className={`w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ${product.availableQuantity === 0 ? "grayscale" : ""}`}
                  />
                  {/* Gradient overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-900/90 via-transparent to-transparent" />

                  {/* Logistic badge — bottom-left of image */}
                  <div className={`absolute bottom-2 left-2 flex items-center gap-1 ${accentColor} px-2 py-0.5 rounded-md`}>
                    <Icon className="w-3 h-3 text-white" />
                    <span className="text-[9px] font-bold text-white uppercase tracking-wider">{logText}</span>
                  </div>

                  {/* Promo badge — bottom-right of image */}
                  {isPromo && (
                    <div className="absolute bottom-2 right-2 flex items-center gap-1 bg-pink-600/90 px-1.5 py-0.5 rounded-md">
                      <Tag className="w-2.5 h-2.5 text-white" />
                      <span className="text-[9px] font-bold text-white uppercase">Promo</span>
                    </div>
                  )}

                  {/* Out-of-stock overlay */}
                  {product.availableQuantity === 0 && (
                    <div className="absolute inset-0 flex items-center justify-center bg-slate-950/50">
                      <span className="bg-red-500/90 text-white font-bold text-xs tracking-widest py-1 px-3 rounded-full rotate-[-8deg] shadow-xl">SEM ESTOQUE</span>
                    </div>
                  )}
                </button>

                {/* Info panel */}
                <div className="flex flex-col flex-1 p-3 gap-2">
                  {/* Title + SKU */}
                  <div>
                    <button
                      onClick={() => setDetailProduct(product)}
                      className="text-[10px] font-semibold text-slate-200 hover:text-violet-300 transition-colors leading-snug line-clamp-2 text-left w-full"
                      title={product.title}
                    >
                      {product.title}
                    </button>
                    <p className="text-[9px] font-mono text-slate-600 mt-0.5 truncate">{product.sku}</p>
                  </div>

                  {/* Stock + Price row */}
                  <div className="flex items-end justify-between mt-auto pt-1">
                    <div className="flex items-baseline gap-1">
                      <span className={`text-2xl font-black leading-none ${stockColor}`}>{product.availableQuantity === 0 ? "—" : product.availableQuantity}</span>
                      <span className="text-[9px] text-slate-500 uppercase tracking-widest font-semibold">un.</span>
                      {product.availableQuantity > 0 && product.availableQuantity < 3 && <AlertTriangle className="w-3 h-3 text-red-500" />}
                      {product.availableQuantity >= 3 && product.availableQuantity <= 7 && <AlertCircle className="w-3 h-3 text-amber-400" />}
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-bold text-slate-200">{fmt(product.amount)}</p>
                      {isPromo && <p className="text-[9px] text-slate-600 line-through">{fmt(product.regularAmount)}</p>}
                    </div>
                  </div>
                </div>

                {/* Footer */}
                <div className="border-t border-slate-800 h-8 flex items-center justify-between px-3">
                  {product.status === "active" ? (
                    <span className="inline-flex items-center gap-1 text-[9px] font-medium text-emerald-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Ativo
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[9px] font-medium text-amber-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> Pausado
                    </span>
                  )}
                  <button
                    onClick={() => setEditingProduct(product)}
                    className="w-6 h-6 flex items-center justify-center rounded text-slate-500 hover:text-white hover:bg-slate-700 transition-colors"
                    title="Editar estoque"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between pt-6 border-t border-slate-800/50">
          <p className="text-xs text-slate-500">Mostrando <span className="text-slate-300 font-medium">1-6</span> de <span className="text-slate-300 font-medium">124</span> produtos</p>
          <div className="flex items-center gap-2">
            <button className="flex items-center justify-center w-8 h-8 rounded-lg border border-slate-700 text-slate-400 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed" disabled>
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-1">
              <button className="w-8 h-8 rounded-lg bg-violet-600 text-white text-xs font-medium">1</button>
              <button className="w-8 h-8 rounded-lg border border-slate-700 text-slate-400 hover:bg-slate-800 text-xs transition-colors">2</button>
              <button className="w-8 h-8 rounded-lg border border-slate-700 text-slate-400 hover:bg-slate-800 text-xs transition-colors">3</button>
              <span className="text-slate-600 px-1">...</span>
              <button className="w-8 h-8 rounded-lg border border-slate-700 text-slate-400 hover:bg-slate-800 text-xs transition-colors">21</button>
            </div>
            <button className="flex items-center justify-center w-8 h-8 rounded-lg border border-slate-700 text-slate-400 hover:bg-slate-800 transition-colors">
              <ChevronRight className="w-4 h-4" />
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
