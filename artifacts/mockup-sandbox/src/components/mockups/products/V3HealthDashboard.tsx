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
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Pencil,
  MoreVertical
} from "lucide-react";

const cn = (...classes: (string | undefined | null | false)[]) => classes.filter(Boolean).join(" ");

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

type Product = typeof mockProducts[0];

const getHealthLevel = (qty: number) => {
  if (qty < 3) return "critical";
  if (qty <= 7) return "attention";
  return "ok";
};

const getHealthConfig = (level: ReturnType<typeof getHealthLevel>) => {
  switch (level) {
    case "critical":
      return {
        color: "text-red-500",
        bg: "bg-red-500/10",
        border: "border-t-red-500",
        borderCore: "border-red-500",
        shadow: "hover:shadow-[inset_4px_0_0_0_rgba(239,68,68,1),0_0_20px_rgba(239,68,68,0.15)]",
        icon: <AlertTriangle className="w-6 h-6 text-red-500" />,
        glow: "hover:shadow-[inset_4px_0_0_0_rgba(239,68,68,1)]"
      };
    case "attention":
      return {
        color: "text-amber-500",
        bg: "bg-amber-500/10",
        border: "border-t-amber-500",
        borderCore: "border-amber-500",
        shadow: "hover:shadow-[inset_4px_0_0_0_rgba(245,158,11,1),0_0_20px_rgba(245,158,11,0.15)]",
        icon: <AlertCircle className="w-6 h-6 text-amber-500" />,
        glow: "hover:shadow-[inset_4px_0_0_0_rgba(245,158,11,1)]"
      };
    case "ok":
      return {
        color: "text-emerald-500",
        bg: "bg-emerald-500/10",
        border: "border-t-emerald-500",
        borderCore: "border-emerald-500",
        shadow: "hover:shadow-[inset_4px_0_0_0_rgba(16,185,129,1),0_0_20px_rgba(16,185,129,0.15)]",
        icon: <CheckCircle2 className="w-6 h-6 text-emerald-500" />,
        glow: "hover:shadow-[inset_4px_0_0_0_rgba(16,185,129,1)]"
      };
  }
};

export function V3HealthDashboard() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [logisticFilter, setLogisticFilter] = useState("all");

  // Sort products by urgency
  const sortedProducts = [...mockProducts].sort((a, b) => {
    const levelA = getHealthLevel(a.availableQuantity);
    const levelB = getHealthLevel(b.availableQuantity);
    const order = { critical: 1, attention: 2, ok: 3 };
    return order[levelA] - order[levelB];
  });

  const stats = {
    critical: mockProducts.filter(p => getHealthLevel(p.availableQuantity) === "critical").length,
    attention: mockProducts.filter(p => getHealthLevel(p.availableQuantity) === "attention").length,
    ok: mockProducts.filter(p => getHealthLevel(p.availableQuantity) === "ok").length,
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 p-6 font-sans flex flex-col items-center">
      <div className="max-w-5xl w-full space-y-6">
        
        {/* Header & Stats */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Monitor de Estoque</h1>
            <p className="text-slate-400 text-sm mt-1">Acompanhe a saúde dos seus anúncios no Mercado Livre</p>
          </div>
          
          <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-1.5 gap-1.5 shadow-sm">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-red-500/10 rounded-md">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-sm font-medium text-red-500">{stats.critical} críticos</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 rounded-md">
              <div className="w-2 h-2 rounded-full bg-amber-500" />
              <span className="text-sm font-medium text-amber-500">{stats.attention} atenção</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 rounded-md">
              <div className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="text-sm font-medium text-emerald-500">{stats.ok} ok</span>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col md:flex-row gap-3 bg-slate-900/50 p-4 rounded-xl border border-slate-800">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input 
              className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-4 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
              placeholder="Buscar título ou SKU..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          
          <div className="flex gap-3">
            <select 
              className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500 transition-all appearance-none pr-8 relative"
              style={{ backgroundImage: 'url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%2394A3B8%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.7rem top 50%', backgroundSize: '0.65rem auto' }}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">Status: Todos</option>
              <option value="active">Ativo</option>
              <option value="paused">Pausado</option>
              <option value="closed">Encerrado</option>
            </select>
            <select 
              className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500 transition-all appearance-none pr-8"
              style={{ backgroundImage: 'url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%2394A3B8%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.7rem top 50%', backgroundSize: '0.65rem auto' }}
              value={logisticFilter}
              onChange={(e) => setLogisticFilter(e.target.value)}
            >
              <option value="all">Logística: Todas</option>
              <option value="fulfillment">Full</option>
              <option value="flex">Flex</option>
              <option value="cross_docking">Cross-docking</option>
            </select>
          </div>
        </div>

        {/* Product List */}
        <div className="space-y-4">
          {sortedProducts.map((product) => {
            const level = getHealthLevel(product.availableQuantity);
            const config = getHealthConfig(level);
            const hasPromo = product.regularAmount != null && product.regularAmount > product.amount;
            
            return (
              <div 
                key={product.id}
                className={cn(
                  "group relative flex flex-col sm:flex-row bg-slate-900 rounded-xl overflow-hidden border-x border-b border-t-4 border-slate-800 transition-all duration-300 transform hover:-translate-y-1",
                  config.glow,
                  config.border
                )}
              >
                {/* Left Indicator Strip */}
                <div className={cn("w-full sm:w-16 flex items-center justify-center py-3 sm:py-0 border-b sm:border-b-0 sm:border-r border-slate-800/50", config.bg)}>
                  {config.icon}
                </div>

                {/* Card Body */}
                <div className="flex-1 flex flex-col sm:flex-row p-4 gap-6 items-center">
                  
                  {/* Thumbnail & Info */}
                  <div className="flex-1 flex gap-4 w-full items-start">
                    <img 
                      src={product.thumbnail} 
                      alt={product.title} 
                      className="w-16 h-16 rounded-lg object-cover bg-slate-800 flex-shrink-0 border border-slate-700/50"
                    />
                    <div className="flex flex-col gap-1.5 min-w-0">
                      <h3 className="text-sm font-semibold text-white leading-tight line-clamp-2" title={product.title}>
                        {product.title}
                      </h3>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-slate-400">
                          {product.sku}
                        </span>
                        
                        {product.status === "paused" && (
                          <span className="flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded-sm">
                            Pausado
                          </span>
                        )}
                      </div>

                      {/* Logistic Badges */}
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {product.isFull && (
                          <div className="flex items-center gap-1 bg-[#00A650]/10 text-[#00A650] border border-[#00A650]/20 px-2 py-0.5 rounded-full text-xs font-medium">
                            <Warehouse className="w-3 h-3" />
                            Full
                          </div>
                        )}
                        {product.isFlex && (
                          <div className="flex items-center gap-1 bg-[#F59E0B]/10 text-[#F59E0B] border border-[#F59E0B]/20 px-2 py-0.5 rounded-full text-xs font-medium">
                            <Zap className="w-3 h-3" />
                            Flex
                          </div>
                        )}
                        {!product.isFull && !product.isFlex && product.logisticType === "cross_docking" && (
                          <div className="flex items-center gap-1 bg-yellow-500/10 text-yellow-500 border border-yellow-500/20 px-2 py-0.5 rounded-full text-xs font-medium">
                            <Truck className="w-3 h-3" />
                            Cross
                          </div>
                        )}
                        {hasPromo && (
                          <div className="flex items-center gap-1 bg-pink-500/10 text-pink-500 border border-pink-500/20 px-2 py-0.5 rounded-full text-xs font-medium">
                            <Tag className="w-3 h-3" />
                            Promo
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right Action Cluster */}
                  <div className="flex flex-row sm:flex-col items-center sm:items-end justify-between w-full sm:w-auto gap-4 sm:gap-2 pl-0 sm:pl-6 sm:border-l border-slate-800/50">
                    
                    {/* Stock Block */}
                    <div className="flex flex-col items-end text-right">
                      <span className={cn("text-3xl font-black leading-none tracking-tight", config.color)}>
                        {product.availableQuantity}
                      </span>
                      <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mt-1">
                        Unidades
                      </span>
                    </div>

                    {/* Price Block */}
                    <div className="flex flex-col items-end text-right mt-1 sm:mt-2">
                      {hasPromo && (
                        <span className="text-xs text-slate-500 line-through">
                          {formatCurrency(product.regularAmount)}
                        </span>
                      )}
                      <span className="text-sm font-medium text-slate-300">
                        {formatCurrency(product.amount)}
                      </span>
                    </div>

                  </div>

                  {/* Actions / Status */}
                  <div className="hidden sm:flex flex-col justify-center items-center gap-2 pl-4">
                    <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-md transition-colors whitespace-nowrap">
                        <Pencil className="w-3.5 h-3.5" />
                        Editar Estoque
                      </button>
                    </div>
                  </div>
                  
                </div>

                {/* Mobile action button */}
                <button className="sm:hidden absolute top-4 right-4 p-2 rounded-md bg-slate-800 text-slate-300">
                  <Pencil className="w-4 h-4" />
                </button>

                {/* Banner overlay if paused & 0 stock */}
                {product.availableQuantity === 0 && product.status === "paused" && (
                  <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-[2px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
                    <div className="flex items-center gap-2 bg-slate-800 px-4 py-2.5 rounded-full border border-amber-500/20 shadow-2xl shadow-amber-500/10">
                      <AlertTriangle className="w-5 h-5 text-amber-500" />
                      <span className="text-sm font-medium text-amber-500">Pausado — sem estoque</span>
                    </div>
                  </div>
                )}
                
              </div>
            );
          })}
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between border-t border-slate-800 pt-4 pb-8">
          <p className="text-sm text-slate-500">
            Mostrando <span className="font-medium text-slate-300">1</span> a <span className="font-medium text-slate-300">6</span> de <span className="font-medium text-slate-300">24</span> anúncios
          </p>
          <div className="flex items-center gap-2">
            <button className="p-2 border border-slate-700 rounded-md hover:bg-slate-800 text-slate-400 transition-colors disabled:opacity-50" disabled>
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="text-sm font-medium text-slate-300 px-2">1 / 4</div>
            <button className="p-2 border border-slate-700 rounded-md hover:bg-slate-800 text-slate-400 transition-colors">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
