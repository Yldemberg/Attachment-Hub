import React, { useState } from "react";
import { 
  Warehouse, Zap, Truck, Tag, AlertTriangle, AlertCircle, 
  Search, Package, Pencil, ChevronLeft, ChevronRight, CheckCircle2, X, ExternalLink
} from "lucide-react";

const mockProducts = [
  {
    id: "1", title: "Tênis Nike Air Max 270 Masculino Preto",
    sku: "NK-AM270-BLK-42", thumbnail: "https://picsum.photos/seed/shoe1/200/200",
    isFull: true, isFlex: false, logisticType: "fulfillment",
    availableQuantity: 24, amount: 479.90, regularAmount: null, status: "active"
  },
  {
    id: "2", title: "Mochila Adidas Originals 30L Backpack Urban",
    sku: "AD-MCH-30L-GRY", thumbnail: "https://picsum.photos/seed/bag1/200/200",
    isFull: false, isFlex: true, logisticType: "self_service",
    availableQuantity: 3, amount: 189.90, regularAmount: 249.90, status: "active"
  },
  {
    id: "3", title: "Fone de Ouvido Bluetooth Sony WH-1000XM5",
    sku: "SN-WH1000-BLK", thumbnail: "https://picsum.photos/seed/headphone1/200/200",
    isFull: false, isFlex: false, logisticType: "cross_docking",
    availableQuantity: 8, amount: 1299.00, regularAmount: null, status: "active"
  },
  {
    id: "4", title: "Smartwatch Samsung Galaxy Watch 6 44mm",
    sku: "SM-GW6-44-BLK", thumbnail: "https://picsum.photos/seed/watch1/200/200",
    isFull: true, isFlex: false, logisticType: "fulfillment",
    availableQuantity: 0, amount: 1199.99, regularAmount: 1499.99, status: "paused"
  },
  {
    id: "5", title: "Câmera GoPro HERO12 Black + Acessórios",
    sku: "GP-HERO12-KIT", thumbnail: "https://picsum.photos/seed/camera1/200/200",
    isFull: false, isFlex: true, logisticType: "self_service",
    availableQuantity: 12, amount: 2199.00, regularAmount: 2499.00, status: "active"
  },
  {
    id: "6", title: "Cadeira Gamer DXRacer Formula Preta/Vermelha",
    sku: "DX-FORM-BRD", thumbnail: "https://picsum.photos/seed/chair1/200/200",
    isFull: false, isFlex: false, logisticType: "cross_docking",
    availableQuantity: 2, amount: 1799.90, regularAmount: null, status: "active"
  },
];

type Product = typeof mockProducts[0];

const formatCurrency = (v: number | null | undefined) => 
  v == null ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

function StockEditDialog({ product, onClose }: { product: Product; onClose: () => void }) {
  const [qty, setQty] = useState(String(product.availableQuantity));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-white">Editar Estoque</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex items-center gap-3 mb-5 p-3 bg-slate-800 rounded-xl border border-slate-700">
          <img src={product.thumbnail} alt={product.title} className="w-10 h-10 rounded-lg object-cover" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-white truncate">{product.title}</p>
            <p className="text-xs font-mono text-slate-500">{product.sku}</p>
          </div>
        </div>
        <label className="block text-xs text-slate-400 uppercase tracking-wider mb-2 font-medium">
          Nova quantidade disponível
        </label>
        <input
          type="number"
          min="0"
          value={qty}
          onChange={e => setQty(e.target.value)}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-lg font-semibold text-center text-white focus:outline-none focus:ring-2 focus:ring-blue-500 mb-5"
        />
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 border border-slate-700 rounded-lg py-2 text-sm text-slate-400 hover:bg-slate-800 hover:text-white transition-colors">
            Cancelar
          </button>
          <button onClick={onClose} className="flex-1 bg-blue-600 hover:bg-blue-700 rounded-lg py-2 text-sm text-white font-medium transition-colors">
            Salvar
          </button>
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
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex gap-4 mb-5">
          <img src={product.thumbnail} alt={product.title} className="w-20 h-20 rounded-xl object-cover bg-slate-800 border border-slate-700" />
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-white leading-snug mb-1">{product.title}</h3>
            <p className="text-xs font-mono text-slate-500 mb-2">{product.sku}</p>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${product.status === 'active' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              <span className="text-xs text-slate-400">{product.status === 'active' ? 'Ativo' : 'Pausado'}</span>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="bg-slate-800 rounded-xl p-3 border border-slate-700">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Preço</p>
            <p className="text-base font-bold text-white">{formatCurrency(product.amount)}</p>
            {product.regularAmount && <p className="text-xs text-slate-500 line-through">{formatCurrency(product.regularAmount)}</p>}
          </div>
          <div className="bg-slate-800 rounded-xl p-3 border border-slate-700">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Estoque</p>
            <p className={`text-base font-bold ${product.availableQuantity < 3 ? 'text-red-400' : product.availableQuantity <= 7 ? 'text-amber-400' : 'text-emerald-400'}`}>
              {product.availableQuantity} un.
            </p>
          </div>
          <div className="bg-slate-800 rounded-xl p-3 border border-slate-700 col-span-2">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Logística</p>
            <p className="text-sm font-medium text-white">
              {product.isFull ? 'Full (Mercado Envios Full)' : product.isFlex ? 'Flex' : 'Cross-docking'}
            </p>
          </div>
        </div>
        <button onClick={onClose} className="w-full border border-slate-700 rounded-xl py-2.5 text-sm text-slate-300 font-medium hover:bg-slate-800 hover:text-white transition-colors flex items-center justify-center gap-2">
          <ExternalLink className="w-4 h-4" />
          Ver no Mercado Livre
        </button>
      </div>
    </div>
  );
}

export function V5BentoSignal() {
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);

  return (
    <div className="min-h-screen bg-slate-950 p-4 md:p-8 font-sans text-slate-200">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Header / Filter Bar */}
        <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-slate-900/50 p-4 rounded-2xl border border-slate-800">
          <div className="relative w-full md:w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input 
              type="text" 
              placeholder="Buscar título ou SKU..." 
              className="w-full bg-slate-950 border border-slate-800 text-sm rounded-lg pl-9 pr-4 py-2 text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
            />
          </div>
          <div className="flex w-full md:w-auto gap-2 overflow-x-auto pb-1 md:pb-0 hide-scrollbar">
            <select className="bg-slate-950 border border-slate-800 text-sm rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option>Status: Todos</option>
              <option>Ativo</option>
              <option>Pausado</option>
              <option>Encerrado</option>
            </select>
            <select className="bg-slate-950 border border-slate-800 text-sm rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option>Logística: Todos</option>
              <option>Full</option>
              <option>Flex</option>
              <option>Cross-docking</option>
            </select>
          </div>
        </div>

        {/* Product Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {mockProducts.map(product => {
            const isPromo = product.regularAmount != null && product.regularAmount > product.amount;
            
            // Determine colors and icons based on logistic type
            let headerColor = "bg-slate-700";
            let Icon = Package;
            let logText = "Normal";

            if (product.logisticType === "fulfillment" || product.isFull) {
              headerColor = "bg-blue-600";
              Icon = Warehouse;
              logText = "Full";
            } else if (product.logisticType === "self_service" || product.isFlex) {
              headerColor = "bg-orange-500";
              Icon = Zap;
              logText = "Flex";
            } else if (product.logisticType === "cross_docking") {
              headerColor = "bg-amber-500";
              Icon = Truck;
              logText = "Cross";
            }

            // Determine stock color
            let stockColor = "text-emerald-400";
            if (product.availableQuantity === 0) stockColor = "text-slate-500";
            else if (product.availableQuantity < 3) stockColor = "text-red-500";
            else if (product.availableQuantity <= 7) stockColor = "text-amber-400";

            return (
              <div 
                key={product.id} 
                className="relative bg-slate-800 rounded-xl overflow-hidden shadow-lg border border-slate-700/50 group hover:scale-[1.02] hover:brightness-110 transition-all duration-300 ease-out flex flex-col h-[230px]"
              >
                {/* Out of stock overlay */}
                {product.availableQuantity === 0 && (
                  <div className="absolute inset-0 z-10 bg-slate-950/60 backdrop-blur-[1px] flex items-center justify-center pointer-events-none">
                    <div className="bg-red-500/90 text-white font-bold text-sm tracking-widest py-1.5 px-4 rounded-full border border-red-400 shadow-xl backdrop-blur-md transform rotate-[-12deg]">
                      SEM ESTOQUE
                    </div>
                  </div>
                )}

                {/* Header Strip */}
                <div className={`h-10 w-full flex items-center justify-between px-3 ${headerColor}`}>
                  <div className="flex items-center gap-1.5">
                    <Icon className="w-4 h-4 text-white" />
                    <span className="text-xs font-bold text-white uppercase tracking-wider">{logText}</span>
                  </div>
                  {isPromo && (
                    <div className="flex items-center gap-1 bg-white/20 px-2 py-0.5 rounded text-[10px] font-bold text-white backdrop-blur-sm">
                      <Tag className="w-3 h-3" />
                      PROMO
                    </div>
                  )}
                </div>

                {/* Body */}
                <div className="p-3 flex-1 flex flex-col justify-between z-0">
                  
                  {/* Row 1: Image & Title */}
                  <div className="flex gap-3 h-[40px]">
                    <button
                      onClick={() => setDetailProduct(product)}
                      className={`w-[40px] h-[40px] rounded-lg overflow-hidden bg-slate-700 hover:ring-2 hover:ring-white/30 transition-all flex-shrink-0 focus:outline-none ${product.availableQuantity === 0 ? 'grayscale' : ''}`}
                      title="Ver detalhes"
                    >
                      <img 
                        src={product.thumbnail} 
                        alt={product.title} 
                        className="w-full h-full object-cover"
                      />
                    </button>
                    <div className="flex-1 overflow-hidden">
                      <button
                        onClick={() => setDetailProduct(product)}
                        className="text-xs font-semibold text-white hover:text-blue-300 transition-colors leading-tight line-clamp-2 text-left w-full"
                        title={product.title}
                      >
                        {product.title}
                      </button>
                      <p className="text-[10px] text-slate-400 truncate mt-0.5">{product.sku}</p>
                    </div>
                  </div>

                  {/* Row 2: Giant Stock Number */}
                  <div className="flex flex-col items-center justify-center mt-2 flex-1">
                    <div className={`text-4xl font-black tracking-tight leading-none ${stockColor} flex items-center gap-2`}>
                      {product.availableQuantity === 0 ? '-' : product.availableQuantity}
                      {product.availableQuantity > 0 && product.availableQuantity < 3 && <AlertTriangle className="w-5 h-5 text-red-500" />}
                      {product.availableQuantity >= 3 && product.availableQuantity <= 7 && <AlertCircle className="w-5 h-5 text-amber-400" />}
                    </div>
                    <span className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold mt-1">
                      Unidades
                    </span>
                  </div>

                  {/* Row 3: Price */}
                  <div className="flex flex-col items-center justify-center mt-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-bold text-slate-200">
                        {formatCurrency(product.amount)}
                      </span>
                      {isPromo && (
                        <span className="text-[10px] text-slate-500 line-through">
                          {formatCurrency(product.regularAmount)}
                        </span>
                      )}
                    </div>
                  </div>

                </div>

                {/* Footer */}
                <div className="h-10 mt-auto border-t border-slate-700/60 flex items-center justify-between px-3 bg-slate-800/80">
                  <div className="flex items-center">
                    {product.status === 'active' ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full border border-emerald-400/20">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                        Ativo
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full border border-amber-400/20">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                        Pausado
                      </span>
                    )}
                  </div>
                  
                  <button
                    onClick={() => setEditingProduct(product)}
                    className="w-7 h-7 flex items-center justify-center rounded-md text-slate-400 hover:text-white hover:bg-slate-700 transition-colors z-20"
                    title="Editar estoque"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between pt-6 border-t border-slate-800/50">
          <p className="text-xs text-slate-500">
            Mostrando <span className="text-slate-300 font-medium">1-6</span> de <span className="text-slate-300 font-medium">124</span> produtos
          </p>
          <div className="flex items-center gap-2">
            <button className="flex items-center justify-center w-8 h-8 rounded-lg border border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed" disabled>
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-1">
              <button className="w-8 h-8 rounded-lg bg-blue-600 text-white text-xs font-medium">1</button>
              <button className="w-8 h-8 rounded-lg border border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white text-xs font-medium transition-colors">2</button>
              <button className="w-8 h-8 rounded-lg border border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white text-xs font-medium transition-colors">3</button>
              <span className="text-slate-600 px-1">...</span>
              <button className="w-8 h-8 rounded-lg border border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white text-xs font-medium transition-colors">21</button>
            </div>
            <button className="flex items-center justify-center w-8 h-8 rounded-lg border border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

      </div>
      
      {/* Required for Tailwind dynamic injection in Replit preview sometimes */}
      <style dangerouslySetInnerHTML={{__html: `
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}} />

      {editingProduct && (
        <StockEditDialog product={editingProduct} onClose={() => setEditingProduct(null)} />
      )}
      {detailProduct && (
        <DetailDialog product={detailProduct} onClose={() => setDetailProduct(null)} />
      )}
    </div>
  );
}
