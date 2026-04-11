import React, { useState } from 'react';
import { 
  Warehouse, Zap, Truck, Tag, AlertTriangle, AlertCircle, 
  Search, Package, ChevronLeft, ChevronRight, Edit2, X, ExternalLink
} from 'lucide-react';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-white">Editar Estoque</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex items-center gap-3 mb-5 p-3 bg-slate-800 rounded-lg">
          <img src={product.thumbnail} alt={product.title} className="w-10 h-10 rounded-md object-cover" />
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
          className="bg-slate-800 border-slate-700 text-white text-lg font-semibold text-center mb-5"
        />
        <div className="flex gap-3">
          <Button variant="ghost" onClick={onClose} className="flex-1 text-slate-400 hover:text-white border border-slate-700 hover:bg-slate-800">
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
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
          <div className="bg-slate-800 rounded-lg p-3">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Preço</p>
            <p className="text-base font-bold text-white">{formatCurrency(product.amount)}</p>
            {product.regularAmount && <p className="text-xs text-slate-500 line-through">{formatCurrency(product.regularAmount)}</p>}
          </div>
          <div className="bg-slate-800 rounded-lg p-3">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Estoque</p>
            <p className={`text-base font-bold ${product.availableQuantity < 3 ? 'text-red-400' : product.availableQuantity <= 7 ? 'text-amber-400' : 'text-emerald-400'}`}>
              {product.availableQuantity} un.
            </p>
          </div>
          <div className="bg-slate-800 rounded-lg p-3 col-span-2">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Logística</p>
            <p className="text-sm font-medium text-white">
              {product.isFull ? 'Full (Mercado Envios Full)' : product.isFlex ? 'Flex' : 'Cross-docking'}
            </p>
          </div>
        </div>
        <Button onClick={onClose} className="w-full" variant="outline">
          <ExternalLink className="w-4 h-4 mr-2" />
          Ver no Mercado Livre
        </Button>
      </div>
    </div>
  );
}

export function V1CommandCenter() {
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);

  return (
    <div className="min-h-screen bg-slate-950 p-6 text-slate-200 font-sans">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white tracking-tight">Produtos</h1>
            <p className="text-slate-400 mt-1 flex items-center gap-2">
              <Package className="w-4 h-4" />
              <span>{mockProducts.length} itens encontrados</span>
            </p>
          </div>
          <Button className="bg-blue-600 hover:bg-blue-700 text-white">
            Criar Anúncio
          </Button>
        </div>

        {/* Filter Bar */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col md:flex-row gap-4 shadow-sm">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <Input 
              placeholder="Buscar título ou SKU..." 
              className="pl-9 bg-slate-800 border-slate-700 text-slate-200 placeholder:text-slate-500 w-full"
            />
          </div>
          <div className="flex gap-4 w-full md:w-auto">
            <Select defaultValue="all">
              <SelectTrigger className="w-full md:w-[160px] bg-slate-800 border-slate-700 text-slate-200">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700 text-slate-200">
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="active">Ativo</SelectItem>
                <SelectItem value="paused">Pausado</SelectItem>
                <SelectItem value="closed">Encerrado</SelectItem>
              </SelectContent>
            </Select>

            <Select defaultValue="all">
              <SelectTrigger className="w-full md:w-[180px] bg-slate-800 border-slate-700 text-slate-200">
                <SelectValue placeholder="Logística" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700 text-slate-200">
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="full">Full</SelectItem>
                <SelectItem value="flex">Flex</SelectItem>
                <SelectItem value="cross">Cross-docking</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Product List */}
        <div className="space-y-3">
          {mockProducts.map((product) => {
            let borderClass = "";
            if (product.isFull) borderClass = "border-l-[4px] border-l-green-500";
            else if (product.isFlex) borderClass = "border-l-[4px] border-l-orange-500";
            else borderClass = "border-l-[4px] border-l-yellow-500";

            return (
              <div 
                key={product.id}
                className={`bg-slate-900 rounded-xl shadow-sm border border-slate-800 ${borderClass} p-4 flex flex-col md:flex-row items-start md:items-center gap-4 transition-all duration-200 hover:-translate-y-[2px] hover:shadow-[0_4px_20px_-4px_rgba(59,130,246,0.15)] group`}
              >
                {/* Left Side: Thumbnail */}
                <div className="flex flex-col items-center gap-2 shrink-0">
                  <button
                    onClick={() => setDetailProduct(product)}
                    className="w-14 h-14 rounded-lg overflow-hidden bg-slate-800 border border-slate-700 hover:ring-2 hover:ring-blue-500 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500"
                    title="Ver detalhes"
                  >
                    <img 
                      src={product.thumbnail} 
                      alt={product.title}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  </button>
                  
                  <div className="flex flex-col gap-1 w-full items-center md:items-start md:hidden">
                    {product.isFull && (
                      <Badge className="bg-green-500/10 text-green-400 hover:bg-green-500/20 border-green-500/20 text-[10px] px-1.5 py-0 h-5 w-full justify-center">
                        <Warehouse className="w-3 h-3 mr-1" /> Full
                      </Badge>
                    )}
                    {product.isFlex && (
                      <Badge className="bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 border-orange-500/20 text-[10px] px-1.5 py-0 h-5 w-full justify-center">
                        <Zap className="w-3 h-3 mr-1" /> Flex
                      </Badge>
                    )}
                    {!product.isFull && !product.isFlex && (
                      <Badge className="bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 border-yellow-500/20 text-[10px] px-1.5 py-0 h-5 w-full justify-center">
                        <Truck className="w-3 h-3 mr-1" /> Cross
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Center: Title & SKU & Inline Badges for Desktop */}
                <div className="flex-1 min-w-0 flex flex-col justify-center">
                  <div className="flex items-center gap-2 mb-1">
                    <button
                      onClick={() => setDetailProduct(product)}
                      className="text-sm font-semibold text-white hover:text-blue-400 transition-colors truncate line-clamp-2 leading-tight text-left"
                      title={product.title}
                    >
                      {product.title}
                    </button>
                  </div>
                  
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-xs font-mono text-slate-500">{product.sku}</span>
                    
                    <div className="hidden md:flex items-center gap-2">
                      {product.isFull && (
                        <Badge className="bg-green-500/10 text-green-400 hover:bg-green-500/20 border-green-500/20 text-xs px-2 py-0.5">
                          <Warehouse className="w-3 h-3 mr-1.5" /> Full
                        </Badge>
                      )}
                      {product.isFlex && (
                        <Badge className="bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 border-orange-500/20 text-xs px-2 py-0.5">
                          <Zap className="w-3 h-3 mr-1.5" /> Flex
                        </Badge>
                      )}
                      {!product.isFull && !product.isFlex && (
                        <Badge className="bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 border-yellow-500/20 text-xs px-2 py-0.5">
                          <Truck className="w-3 h-3 mr-1.5" /> Cross
                        </Badge>
                      )}
                      
                      {product.regularAmount != null && product.regularAmount > product.amount && (
                        <Badge className="bg-pink-500/10 text-pink-400 hover:bg-pink-500/20 border-pink-500/20 text-xs px-2 py-0.5">
                          <Tag className="w-3 h-3 mr-1.5" /> Promo
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="md:hidden mt-2">
                    {product.regularAmount != null && product.regularAmount > product.amount && (
                      <Badge className="bg-pink-500/10 text-pink-400 hover:bg-pink-500/20 border-pink-500/20 text-xs px-2 py-0.5">
                        <Tag className="w-3 h-3 mr-1.5" /> Promo
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Right Side Cluster */}
                <div className="flex flex-row md:flex-row items-center justify-between md:justify-end w-full md:w-auto gap-4 md:gap-6 mt-4 md:mt-0 pt-4 md:pt-0 border-t border-slate-800 md:border-none">
                  
                  {/* Stock Pill */}
                  <div className="flex flex-col items-start md:items-end">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 font-medium">Estoque</span>
                    <Badge variant="outline" className={`
                      text-xs font-semibold px-2.5 py-1 border 
                      ${product.availableQuantity < 3 ? 'bg-red-500/10 text-red-400 border-red-500/30' : 
                        product.availableQuantity <= 7 ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' : 
                        'bg-slate-800 text-emerald-400 border-slate-700'}
                    `}>
                      {product.availableQuantity < 3 ? <AlertTriangle className="w-3.5 h-3.5 mr-1.5" /> : 
                       product.availableQuantity <= 7 ? <AlertCircle className="w-3.5 h-3.5 mr-1.5" /> : null}
                      {product.availableQuantity} un.
                    </Badge>
                  </div>

                  {/* Price */}
                  <div className="flex flex-col items-end min-w-[90px]">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 font-medium">Preço</span>
                    <div className="flex flex-col items-end">
                      <span className="text-sm font-semibold text-white">
                        {formatCurrency(product.amount)}
                      </span>
                      {product.regularAmount && (
                        <span className="text-xs text-slate-500 line-through">
                          {formatCurrency(product.regularAmount)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Status */}
                  <div className="hidden md:flex flex-col items-center min-w-[70px]">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 font-medium">Status</span>
                    <div className="flex items-center gap-1.5">
                      <div className={`w-2 h-2 rounded-full ${product.status === 'active' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                      <span className="text-xs text-slate-300 capitalize">
                        {product.status === 'active' ? 'Ativo' : 'Pausado'}
                      </span>
                    </div>
                  </div>

                  {/* Edit Stock Action */}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setEditingProduct(product)}
                    className="text-slate-400 hover:text-white hover:bg-slate-800 h-9 w-9 rounded-full opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Editar estoque"
                  >
                    <Edit2 className="w-4 h-4" />
                    <span className="sr-only">Editar estoque</span>
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between border-t border-slate-800 pt-6 mt-6">
          <p className="text-sm text-slate-500 hidden md:block">
            Mostrando <span className="font-medium text-slate-300">1</span> a <span className="font-medium text-slate-300">6</span> de <span className="font-medium text-slate-300">42</span> resultados
          </p>
          <div className="flex items-center gap-2 w-full md:w-auto justify-between md:justify-end">
            <Button variant="outline" size="sm" className="bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white">
              <ChevronLeft className="w-4 h-4 mr-1" /> Anterior
            </Button>
            <div className="text-sm text-slate-400 font-medium px-3">
              Página 1 de 7
            </div>
            <Button variant="outline" size="sm" className="bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white">
              Próxima <ChevronRight className="w-4 h-4 ml-1" />
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
