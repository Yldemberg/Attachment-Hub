import React, { useState } from "react";
import { 
  Warehouse, 
  Zap, 
  Truck, 
  Tag, 
  AlertTriangle, 
  AlertCircle,
  Search,
  Package,
  ChevronLeft,
  ChevronRight,
  Edit2,
  X,
  ExternalLink
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
      <div className="bg-[#111118] border border-[#2a2a3a] rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-white">Editar Estoque</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex items-center gap-3 mb-5 p-3 bg-[#1a1a24] rounded-xl border border-[#2a2a3a]">
          <img src={product.thumbnail} alt={product.title} className="w-10 h-10 rounded-lg object-cover" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-white truncate">{product.title}</p>
            <p className="text-xs font-mono text-slate-500">{product.sku}</p>
          </div>
        </div>
        <label className="block text-xs text-slate-400 uppercase tracking-wider mb-2 font-medium">
          Nova quantidade disponível
        </label>
        <Input
          type="number"
          min="0"
          value={qty}
          onChange={e => setQty(e.target.value)}
          className="bg-[#1a1a24] border-[#2a2a3a] text-white text-lg font-semibold text-center mb-5 focus-visible:ring-blue-500"
        />
        <div className="flex gap-3">
          <Button variant="ghost" onClick={onClose} className="flex-1 text-slate-400 hover:text-white border border-[#2a2a3a] hover:bg-[#1a1a24]">
            Cancelar
          </Button>
          <Button onClick={onClose} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white">
            Salvar
          </Button>
        </div>
      </div>
    </div>
  );
}

function DetailDialog({ product, onClose }: { product: Product; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-[#111118] border border-[#2a2a3a] rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-white">Detalhes do Produto</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex gap-4 mb-5">
          <img src={product.thumbnail} alt={product.title} className="w-20 h-20 rounded-xl object-cover bg-[#1a1a24] border border-[#2a2a3a]" />
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
          <div className="bg-[#1a1a24] rounded-xl p-3 border border-[#2a2a3a]">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Preço</p>
            <p className="text-base font-bold text-white">{formatCurrency(product.amount)}</p>
            {product.regularAmount && <p className="text-xs text-slate-500 line-through">{formatCurrency(product.regularAmount)}</p>}
          </div>
          <div className="bg-[#1a1a24] rounded-xl p-3 border border-[#2a2a3a]">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Estoque</p>
            <p className={`text-base font-bold ${product.availableQuantity < 3 ? 'text-red-400' : product.availableQuantity <= 7 ? 'text-amber-400' : 'text-emerald-400'}`}>
              {product.availableQuantity} un.
            </p>
          </div>
          <div className="bg-[#1a1a24] rounded-xl p-3 border border-[#2a2a3a] col-span-2">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Logística</p>
            <p className="text-sm font-medium text-white">
              {product.isFull ? 'Full (Mercado Envios Full)' : product.isFlex ? 'Flex' : 'Cross-docking'}
            </p>
          </div>
        </div>
        <Button onClick={onClose} className="w-full border-[#2a2a3a] bg-[#1a1a24] text-slate-200 hover:bg-[#2a2a3a]" variant="outline">
          <ExternalLink className="w-4 h-4 mr-2" />
          Ver no Mercado Livre
        </Button>
      </div>
    </div>
  );
}

function LogisticBadge({ product }: { product: Product }) {
  if (product.isFull) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/10 border border-green-500/20 px-2.5 py-1 text-xs font-medium text-green-400">
        <Warehouse className="h-3.5 w-3.5" />
        Full
      </span>
    );
  }
  if (product.isFlex) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-500/10 border border-orange-500/20 px-2.5 py-1 text-xs font-medium text-orange-400">
        <Zap className="h-3.5 w-3.5" />
        Flex
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-yellow-500/10 border border-yellow-500/20 px-2.5 py-1 text-xs font-medium text-yellow-400">
      <Truck className="h-3.5 w-3.5" />
      Cross
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'active') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 text-xs font-medium text-emerald-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        Ativo
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 text-xs font-medium text-amber-400">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
      Pausado
    </span>
  );
}

function StockDisplay({ qty }: { qty: number }) {
  if (qty === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-400">
        <AlertTriangle className="h-3.5 w-3.5" />
        Sem estoque
      </span>
    );
  }
  if (qty < 3) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-400">
        <AlertTriangle className="h-3.5 w-3.5" />
        {qty} unidades
      </span>
    );
  }
  if (qty <= 7) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400">
        <AlertCircle className="h-3.5 w-3.5" />
        {qty} unidades
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400">
      <Package className="h-3.5 w-3.5" />
      {qty} unidades
    </span>
  );
}

export function V4FocusList() {
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-slate-200 p-6 md:p-8 font-sans">
      <div className="max-w-5xl mx-auto space-y-6">
        
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Produtos</h1>
          <p className="text-slate-400 mt-1">{mockProducts.length} itens encontrados</p>
        </div>

        {/* Filter Bar */}
        <div className="flex flex-col md:flex-row gap-4 bg-[#111118] border border-[#1e1e2a] rounded-2xl p-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
            <Input 
              placeholder="Buscar título ou SKU..." 
              className="pl-9 bg-[#1a1a24] border-[#2a2a3a] text-slate-200 placeholder:text-slate-500 focus-visible:ring-blue-500"
            />
          </div>
          <div className="flex gap-2">
            <select className="bg-[#1a1a24] border border-[#2a2a3a] text-sm rounded-md px-3 py-2 text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500">
              <option>Todos os status</option>
              <option>Ativo</option>
              <option>Pausado</option>
              <option>Encerrado</option>
            </select>
            <select className="bg-[#1a1a24] border border-[#2a2a3a] text-sm rounded-md px-3 py-2 text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500">
              <option>Toda logística</option>
              <option>Full</option>
              <option>Flex</option>
              <option>Cross-docking</option>
            </select>
          </div>
        </div>

        {/* Product List */}
        <div className="space-y-3">
          {mockProducts.map((product) => {
            const hasPromo = product.regularAmount != null && product.regularAmount > product.amount;
            
            return (
              <div 
                key={product.id}
                className="group relative flex flex-col sm:flex-row gap-5 bg-[#111118] border border-[#1e1e2a] rounded-2xl p-5 hover:border-[#2a2a3a] hover:shadow-lg hover:shadow-blue-900/10 hover:scale-[1.002] transition-all duration-300 ease-out"
              >
                {/* Image */}
                <div className="shrink-0">
                  <img 
                    src={product.thumbnail} 
                    alt={product.title} 
                    className="w-20 h-20 rounded-xl object-cover bg-[#1a1a24] border border-[#2a2a3a]"
                  />
                </div>

                {/* Content */}
                <div className="flex-1 flex flex-col justify-between min-w-0 gap-3 sm:gap-0">
                  
                  {/* Top Row */}
                  <div className="flex items-start justify-between gap-4">
                    <button
                      onClick={() => setDetailProduct(product)}
                      className="text-base font-semibold text-white hover:text-blue-400 transition-colors leading-snug text-left line-clamp-2"
                    >
                      {product.title}
                    </button>
                    <div className="text-right shrink-0">
                      {hasPromo && (
                        <div className="text-xs text-slate-500 line-through mb-0.5">
                          {formatCurrency(product.regularAmount)}
                        </div>
                      )}
                      <div className="text-lg font-bold text-white leading-none">
                        {formatCurrency(product.amount)}
                      </div>
                    </div>
                  </div>

                  {/* Middle Row - Badges */}
                  <div className="flex flex-wrap items-center gap-2 mt-2 sm:mt-0">
                    <LogisticBadge product={product} />
                    <StatusBadge status={product.status} />
                    {hasPromo && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-pink-500/10 border border-pink-500/20 px-2.5 py-1 text-xs font-medium text-pink-400">
                        <Tag className="h-3.5 w-3.5" />
                        Promo
                      </span>
                    )}
                  </div>

                  {/* Bottom Row */}
                  <div className="flex items-center gap-4 mt-3 sm:mt-0 pt-3 sm:pt-0 border-t border-[#1e1e2a] sm:border-0">
                    <span className="font-mono text-xs text-slate-500 bg-[#1a1a24] px-2 py-0.5 rounded">
                      {product.sku}
                    </span>
                    <div className="w-1 h-1 rounded-full bg-[#2a2a3a] hidden sm:block" />
                    <StockDisplay qty={product.availableQuantity} />
                  </div>
                </div>

                {/* Edit Button (Hover) */}
                <div className="absolute top-4 right-4 sm:top-auto sm:bottom-4 sm:right-4 opacity-0 group-hover:opacity-100 transition-opacity duration-200 hidden sm:block">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setEditingProduct(product)}
                    className="bg-[#1a1a24] text-white hover:bg-[#2a2a3a] border border-[#2a2a3a]"
                  >
                    <Edit2 className="h-4 w-4 mr-2" />
                    Editar Estoque
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between pt-4">
          <p className="text-sm text-slate-500">
            Mostrando <span className="text-slate-300 font-medium">1</span> a <span className="text-slate-300 font-medium">6</span> de <span className="text-slate-300 font-medium">6</span> resultados
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled className="border-[#2a2a3a] bg-[#111118] text-slate-400">
              <ChevronLeft className="h-4 w-4 mr-1" />
              Anterior
            </Button>
            <Button variant="outline" size="sm" className="border-[#2a2a3a] bg-[#111118] text-slate-200 hover:bg-[#1a1a24] hover:text-white">
              Próxima
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>

      </div>

      {editingProduct && (
        <StockEditDialog product={editingProduct} onClose={() => setEditingProduct(null)} />
      )}
      {detailProduct && (
        <DetailDialog product={detailProduct} onClose={() => setDetailProduct(null)} />
      )}
    </div>
  );
}
