import { useCallback, useEffect, useRef, useState } from "react";
import {
  useSearchInventory,
  useAdjustMandateInventory,
  getSearchInventoryQueryKey,
} from "@workspace/api-client-react";
import type { InventorySearchItem, MandateAdjustRequestOperation } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Search, Package, ScanBarcode, Loader2, Layers } from "lucide-react";
import { cn } from "@/lib/utils";

type Operation = MandateAdjustRequestOperation;

function stockColorClass(qty: number): string {
  if (qty === 0) return "text-muted-foreground";
  if (qty < 3) return "text-red-600";
  if (qty <= 7) return "text-amber-600";
  return "text-emerald-600";
}

/** Leitura de código de barras via BarcodeDetector (Chrome/Edge, HTTPS). */
function BarcodeScanDialog({
  open,
  onOpenChange,
  onDetected,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDetected: (text: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<{ detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>> } | null>(
    null,
  );
  const rafRef = useRef<number>(0);
  const { toast } = useToast();

  const stopCamera = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    detectorRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => {
    if (!open) {
      stopCamera();
      return;
    }

    const BD = (typeof window !== "undefined" && (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => unknown })
      .BarcodeDetector) as
      | (new (opts: { formats: string[] }) => { detect: (el: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>> })
      | undefined;

    if (!BD) {
      toast({
        variant: "destructive",
        title: "Scanner indisponível",
        description: "Este navegador não suporta leitura de código (BarcodeDetector). Use o campo de texto ou outro navegador.",
      });
      onOpenChange(false);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        const detector = new BD({
          formats: ["ean_13", "ean_8", "code_128", "code_39", "qr_code", "upc_a", "upc_e"],
        });
        detectorRef.current = detector;

        const tick = async () => {
          if (cancelled || !videoRef.current || !detectorRef.current) return;
          try {
            const codes = await detectorRef.current.detect(videoRef.current);
            const raw = codes[0]?.rawValue;
            if (raw) {
              stopCamera();
              onDetected(raw);
              onOpenChange(false);
              return;
            }
          } catch {
            /* frame skip */
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch {
        toast({
          variant: "destructive",
          title: "Câmera",
          description: "Não foi possível acessar a câmera. Verifique permissões.",
        });
        onOpenChange(false);
      }
    })();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [open, onDetected, onOpenChange, stopCamera, toast]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) stopCamera(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Escanear código</DialogTitle>
        </DialogHeader>
        <div className="rounded-lg overflow-hidden bg-black aspect-video flex items-center justify-center">
          <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
        </div>
        <p className="text-xs text-muted-foreground">
          Aponte para o código de barras ou QR. A leitura fecha automaticamente.
        </p>
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={() => { stopCamera(); onOpenChange(false); }}>
            Cancelar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const SEARCH_DEBOUNCE_MS = 320;

export default function GeneralInventory() {
  const [input, setInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selected, setSelected] = useState<InventorySearchItem | null>(null);
  const [operation, setOperation] = useState<Operation>("set");
  const [amountStr, setAmountStr] = useState("1");
  const [scanOpen, setScanOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    const trimmed = input.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (trimmed.length === 0) {
      setDebouncedQuery("");
      return;
    }
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(trimmed);
      debounceRef.current = null;
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [input]);

  const searchParams = { query: debouncedQuery };
  const searchQuery = useSearchInventory(searchParams, {
    query: {
      queryKey: getSearchInventoryQueryKey(searchParams),
      enabled: debouncedQuery.length > 0,
    },
  });

  const { mutate: adjust, isPending: adjusting } = useAdjustMandateInventory({
    mutation: {
      onSuccess: (data) => {
        toast({
          title: "Estoque atualizado",
          description: `SKU ${data.sku}: mandatário ${data.mandateQuantity} un. · ${data.updated} anúncio(s) no ML.`,
        });
        queryClient.invalidateQueries({ queryKey: ["/api/inventory/search"] });
        queryClient.invalidateQueries({ queryKey: ["/api/products"] });
        if (selected?.sku === data.sku) {
          setSelected((s) =>
            s
              ? {
                  ...s,
                  mandateQuantity: data.mandateQuantity,
                  currentStock: data.mandateQuantity,
                }
              : null,
          );
        }
      },
      onError: (err: unknown) => {
        const msg = err instanceof Error ? err.message : "Falha ao ajustar estoque";
        toast({ variant: "destructive", title: "Erro", description: msg });
      },
    },
  });

  const flushSearchNow = (raw: string) => {
    const q = raw.trim();
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    setDebouncedQuery(q);
  };

  const runSearch = () => {
    const q = input.trim();
    if (!q) {
      toast({ variant: "destructive", title: "Busca vazia", description: "Digite SKU, descrição ou MLB." });
      return;
    }
    flushSearchNow(q);
    setSelected(null);
  };

  const onBarcodeDetected = (text: string) => {
    const t = text.trim();
    setInput(t);
    flushSearchNow(t);
    setSelected(null);
    toast({ title: "Código lido", description: t.slice(0, 80) });
  };

  const applyAdjust = () => {
    if (!selected) return;
    const amount = Math.floor(Number(amountStr));
    if (!Number.isFinite(amount) || amount < 0) {
      toast({ variant: "destructive", title: "Quantidade inválida", description: "Use um número inteiro ≥ 0." });
      return;
    }
    if ((operation === "add" || operation === "subtract") && amount === 0) {
      toast({ variant: "destructive", title: "Quantidade", description: "Para somar ou subtrair, use valor > 0." });
      return;
    }
    adjust({
      data: { sku: selected.sku, operation, amount },
    });
  };

  const displayMandate = selected?.mandateQuantity;
  const displayCurrent = selected?.currentStock ?? 0;

  return (
    <div className="h-full flex flex-col overflow-hidden bg-background">
      <div className="sticky top-0 z-10 bg-background border-b border-border flex-shrink-0 px-3 py-3 sm:px-4 space-y-3">
        <div>
          <h1 className="text-base font-bold text-foreground">Inventário geral</h1>
          <p className="text-muted-foreground text-xs leading-snug">
            Busque por SKU, descrição ou MLB. O estoque mandatário é espelhado em todos os anúncios não Full.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="inv-search" className="text-xs text-muted-foreground">
            SKU, descrição, código de barras ou MLB
          </Label>
          <div className="flex flex-col gap-2 min-[480px]:flex-row min-[480px]:items-center min-[480px]:gap-2">
            <Input
              id="inv-search"
              ref={searchInputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") runSearch();
              }}
              placeholder="Ex.: K12MeCMe ou título do produto"
              className="h-10 text-sm w-full min-[480px]:flex-1 min-[480px]:min-w-0"
              autoComplete="off"
            />
            <div className="flex gap-2 w-full min-[480px]:w-auto min-[480px]:shrink-0">
              <Button
                type="button"
                size="sm"
                className="h-10 flex-1 min-[480px]:flex-initial min-[480px]:px-4"
                onClick={runSearch}
                disabled={searchQuery.isFetching}
              >
                {searchQuery.isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                <span className="ml-1.5">Buscar</span>
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-10 flex-1 min-[480px]:flex-initial min-[480px]:px-4"
                onClick={() => setScanOpen(true)}
              >
                <ScanBarcode className="w-4 h-4 shrink-0" />
                <span className="ml-1.5">Câmera</span>
              </Button>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground leading-snug">
            Resultados aparecem enquanto você digita. Leitor USB: foco no campo e escaneie (Enter força busca imediata).
          </p>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 sm:px-4">
        {debouncedQuery && searchQuery.isError && (
          <p className="text-sm text-destructive">Não foi possível buscar. Tente novamente.</p>
        )}
        {debouncedQuery && searchQuery.data?.data?.length === 0 && !searchQuery.isFetching && (
          <p className="text-sm text-muted-foreground">Nenhum anúncio não Full com SKU encontrado.</p>
        )}

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {searchQuery.data?.data.map((item) => (
            <button
              key={item.sku}
              type="button"
              onClick={() => setSelected(item)}
              className={cn(
                "text-left rounded-xl border p-3 transition-colors hover:border-primary/40",
                selected?.sku === item.sku ? "border-primary bg-primary/5" : "border-border bg-card",
              )}
            >
              <div className="flex gap-3">
                {item.thumbnail ? (
                  <img src={item.thumbnail} alt="" className="size-14 rounded-lg object-cover border border-border bg-muted shrink-0" />
                ) : (
                  <div className="size-14 rounded-lg border border-border bg-muted flex items-center justify-center shrink-0">
                    <Package className="w-6 h-6 text-muted-foreground/50" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-mono text-muted-foreground truncate">{item.sku}</p>
                  <p className="text-sm font-medium text-foreground line-clamp-2 leading-tight">{item.titleShort}</p>
                  {item.variationLabel && (
                    <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">{item.variationLabel}</p>
                  )}
                  <div className="flex items-center gap-2 mt-2 text-xs">
                    <span className={cn("font-bold tabular-nums", stockColorClass(item.currentStock))}>
                      {item.currentStock} un.
                    </span>
                    {item.listingCount > 1 && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                        <Layers className="w-3 h-3" />
                        {item.listingCount} anúncios
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>

        {selected && (
          <div className="mt-6 rounded-xl border border-border bg-card p-3 sm:p-4 w-full max-w-lg mx-auto sm:mx-0">
            <h2 className="text-sm font-semibold text-foreground mb-3">Ajustar estoque mandatário</h2>
            <div className="flex gap-3 mb-4">
              {selected.thumbnail ? (
                <img src={selected.thumbnail} alt="" className="size-16 rounded-lg object-cover border border-border" />
              ) : (
                <div className="size-16 rounded-lg border border-border bg-muted flex items-center justify-center">
                  <Package className="w-7 h-7 text-muted-foreground/50" />
                </div>
              )}
              <div className="min-w-0">
                <p className="text-xs font-mono text-muted-foreground">{selected.sku}</p>
                <p className="text-sm font-medium line-clamp-2">{selected.titleShort}</p>
                {selected.variationLabel && (
                  <p className="text-xs text-muted-foreground mt-1">{selected.variationLabel}</p>
                )}
                <div className="mt-2 text-xs space-y-0.5">
                  <p>
                    <span className="text-muted-foreground">Mandatário (DB): </span>
                    <span className="font-semibold tabular-nums">{displayMandate ?? "—"}</span>
                  </p>
                  <p>
                    <span className="text-muted-foreground">Representativo (DB): </span>
                    <span className={cn("font-semibold tabular-nums", stockColorClass(displayCurrent))}>
                      {displayCurrent} un.
                    </span>
                  </p>
                </div>
              </div>
            </div>

            <RadioGroup
              value={operation}
              onValueChange={(v) => setOperation(v as Operation)}
              className="grid gap-2 mb-3"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="add" id="op-add" />
                <Label htmlFor="op-add" className="text-sm font-normal cursor-pointer">
                  Somar ao estoque mandatário
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="subtract" id="op-sub" />
                <Label htmlFor="op-sub" className="text-sm font-normal cursor-pointer">
                  Subtrair do estoque mandatário
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="set" id="op-set" />
                <Label htmlFor="op-set" className="text-sm font-normal cursor-pointer">
                  Sobrescrever (definir valor exato)
                </Label>
              </div>
            </RadioGroup>

            <div className="space-y-1 mb-4">
              <Label htmlFor="inv-amount" className="text-xs">
                Quantidade
              </Label>
              <Input
                id="inv-amount"
                type="number"
                min={0}
                step={1}
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                className="h-9 text-sm max-w-[140px]"
              />
            </div>

            <Button type="button" size="sm" className="w-full sm:w-auto" onClick={applyAdjust} disabled={adjusting}>
              {adjusting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              <span className={cn(adjusting && "ml-2")}>Aplicar e espelhar no Mercado Livre</span>
            </Button>
          </div>
        )}
      </div>

      <BarcodeScanDialog open={scanOpen} onOpenChange={setScanOpen} onDetected={onBarcodeDetected} />
    </div>
  );
}
