import React, { useState } from "react";
import {
  Warehouse,
  Zap,
  Truck,
  Tag,
  AlertTriangle,
  AlertCircle,
  Search,
  ChevronLeft,
  ChevronRight,
  Package,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

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

const formatCurrency = (v: number | null | undefined) =>
  v == null ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

export function V2CommerceGrid() {
  const [hoveredCardId, setHoveredCardId] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 p-6 md:p-8 font-sans">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Page Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">Produtos</h1>
            <p className="text-sm text-gray-500 mt-1">Gerencie seu catálogo no Mercado Livre</p>
          </div>
          <Button className="bg-blue-600 hover:bg-blue-700 text-white">
            <Package className="w-4 h-4 mr-2" />
            Adicionar Produto
          </Button>
        </div>

        {/* Filter Bar */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input 
              placeholder="Buscar título ou SKU..." 
              className="pl-9 bg-gray-50 border-gray-200 focus-visible:ring-blue-500"
            />
          </div>
          <div className="flex gap-4">
            <Select defaultValue="all_status">
              <SelectTrigger className="w-[140px] bg-gray-50 border-gray-200">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all_status">Todos</SelectItem>
                <SelectItem value="active">Ativo</SelectItem>
                <SelectItem value="paused">Pausado</SelectItem>
                <SelectItem value="closed">Encerrado</SelectItem>
              </SelectContent>
            </Select>
            <Select defaultValue="all_logistics">
              <SelectTrigger className="w-[160px] bg-gray-50 border-gray-200">
                <SelectValue placeholder="Logística" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all_logistics">Todos</SelectItem>
                <SelectItem value="full">Full</SelectItem>
                <SelectItem value="flex">Flex</SelectItem>
                <SelectItem value="cross">Cross-docking</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Product Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {mockProducts.map((product) => {
            const isPromo = product.regularAmount != null && product.regularAmount > product.amount;
            
            return (
              <div 
                key={product.id}
                className="group bg-white rounded-xl overflow-hidden shadow-sm border border-gray-200 hover:shadow-lg hover:border-blue-200 transition-all duration-200 flex flex-col"
                onMouseEnter={() => setHoveredCardId(product.id)}
                onMouseLeave={() => setHoveredCardId(null)}
              >
                {/* Image & Overlays */}
                <div className="relative aspect-square w-full bg-gray-100 overflow-hidden">
                  <img 
                    src={product.thumbnail} 
                    alt={product.title}
                    className="w-full h-full object-cover mix-blend-multiply group-hover:scale-105 transition-transform duration-300"
                  />
                  
                  {/* Status Indicator (Top Left) */}
                  <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-white/90 backdrop-blur-sm px-2 py-1 rounded-full text-xs font-medium shadow-sm">
                    {product.status === 'active' ? (
                      <>
                        <span className="relative flex h-2.5 w-2.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                        </span>
                        <span className="text-gray-700">Ativo</span>
                      </>
                    ) : (
                      <>
                        <span className="h-2.5 w-2.5 rounded-full bg-amber-500"></span>
                        <span className="text-gray-700">Pausado</span>
                      </>
                    )}
                  </div>

                  {/* Logistics Badges (Top Right) */}
                  <div className="absolute top-3 right-3 flex flex-col items-end gap-1.5">
                    {product.isFull && (
                      <div className="flex items-center gap-1 bg-emerald-100 text-emerald-800 px-2 py-1 rounded text-xs font-bold shadow-sm">
                        <Warehouse className="w-3 h-3" />
                        <span>FULL</span>
                      </div>
                    )}
                    {product.isFlex && (
                      <div className="flex items-center gap-1 bg-orange-100 text-orange-800 px-2 py-1 rounded text-xs font-bold shadow-sm">
                        <Zap className="w-3 h-3" />
                        <span>FLEX</span>
                      </div>
                    )}
                    {!product.isFull && !product.isFlex && product.logisticType === 'cross_docking' && (
                      <div className="flex items-center gap-1 bg-yellow-100 text-yellow-800 px-2 py-1 rounded text-xs font-bold shadow-sm">
                        <Truck className="w-3 h-3" />
                        <span>CROSS</span>
                      </div>
                    )}
                  </div>

                  {/* Promo Banner (Bottom) */}
                  {isPromo && (
                    <div className="absolute bottom-0 left-0 right-0 bg-red-500/90 text-white px-3 py-1.5 flex items-center justify-center gap-1.5 backdrop-blur-sm">
                      <Tag className="w-3.5 h-3.5" />
                      <span className="text-xs font-bold tracking-wider">% PROMO</span>
                    </div>
                  )}

                  {/* Quick Action Overlay on Hover */}
                  <div className={`absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 transition-opacity duration-200 ${hoveredCardId === product.id ? 'opacity-100' : ''} pointer-events-none`}>
                     <Button className="pointer-events-auto bg-white text-gray-900 hover:bg-gray-100 font-semibold" size="sm">
                        Editar Produto
                     </Button>
                  </div>
                </div>

                {/* Body */}
                <div className="p-4 flex-1 flex flex-col">
                  <h3 className="text-sm font-semibold text-gray-900 line-clamp-2 leading-tight flex-1">
                    {product.title}
                  </h3>
                  <div className="text-xs text-gray-400 font-mono mt-2 truncate">
                    {product.sku}
                  </div>
                </div>

                {/* Footer */}
                <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between bg-gray-50/50">
                  {/* Stock */}
                  <div className="flex items-center gap-1.5">
                    {product.availableQuantity === 0 ? (
                      <div className="flex items-center gap-1 text-red-600">
                        <AlertTriangle className="w-4 h-4" />
                        <span className="text-sm font-bold">0</span>
                      </div>
                    ) : product.availableQuantity < 3 ? (
                      <div className="flex items-center gap-1 text-red-600">
                        <AlertTriangle className="w-4 h-4" />
                        <span className="text-sm font-bold">{product.availableQuantity}</span>
                      </div>
                    ) : product.availableQuantity <= 7 ? (
                      <div className="flex items-center gap-1 text-amber-600">
                        <AlertCircle className="w-4 h-4" />
                        <span className="text-sm font-bold">{product.availableQuantity}</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-gray-500">
                        <Package className="w-4 h-4" />
                        <span className="text-sm font-medium">{product.availableQuantity} un.</span>
                      </div>
                    )}
                  </div>

                  {/* Price */}
                  <div className="text-right">
                    {isPromo && product.regularAmount && (
                      <div className="text-xs line-through text-gray-400 -mb-0.5">
                        {formatCurrency(product.regularAmount)}
                      </div>
                    )}
                    <div className="text-base font-bold text-gray-900">
                      {formatCurrency(product.amount)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between py-4">
          <p className="text-sm text-gray-500">
            Mostrando <span className="font-medium text-gray-900">1</span> a <span className="font-medium text-gray-900">6</span> de <span className="font-medium text-gray-900">24</span> produtos
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled>
              <ChevronLeft className="w-4 h-4 mr-1" /> Anterior
            </Button>
            <div className="text-sm font-medium text-gray-900 px-2">
              1 / 4
            </div>
            <Button variant="outline" size="sm">
              Próxima <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
