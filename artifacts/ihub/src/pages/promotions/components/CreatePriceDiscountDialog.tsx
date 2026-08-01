import { useEffect, useMemo, useState } from "react";
import {
  useCreatePriceDiscount,
  useListProducts,
  useListAccounts,
  getListProductsQueryKey,
  getListPromotionInboxQueryKey,
  getListPromotionsQueryKey,
  getGetPromotionsSummaryQueryKey,
} from "@workspace/api-client-react";
import type { Product } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn, formatCurrency } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Loader2, Package, Search } from "lucide-react";
import {
  calcDiscountAmount,
  calcDiscountPercent,
  calcFinalFromDiscount,
  formatPriceInput,
} from "./promotionActivationConfig";

const MIN_DISCOUNT_PERCENT = 5;
const MAX_DISCOUNT_PERCENT = 80;
const MAX_DURATION_DAYS = 14;

function todayIsoDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function daysInclusive(start: string, finish: string): number {
  const [ys, ms, ds] = start.split("-").map(Number);
  const [yf, mf, df] = finish.split("-").map(Number);
  const a = new Date(ys, ms - 1, ds).getTime();
  const b = new Date(yf, mf - 1, df).getTime();
  return Math.floor((b - a) / (24 * 60 * 60 * 1000)) + 1;
}

function resolveOriginalPrice(product: Product): number | null {
  const candidates = [
    product.regularAmount,
    product.originalPrice,
    product.amount,
    product.price,
  ];
  for (const v of candidates) {
    if (v != null && v > 0) return v;
  }
  return null;
}

export function CreatePriceDiscountDialog({
  open,
  onOpenChange,
  defaultAccountId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultAccountId?: string;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: accountsData } = useListAccounts();
  const accounts = accountsData?.data ?? [];

  const [step, setStep] = useState<"pick" | "confirm">("pick");
  const [accountId, setAccountId] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selected, setSelected] = useState<Product | null>(null);

  const [startDate, setStartDate] = useState(todayIsoDate());
  const [finishDate, setFinishDate] = useState(addDaysIso(todayIsoDate(), 6));
  const [discountPercent, setDiscountPercent] = useState("10");
  const [finalPrice, setFinalPrice] = useState("");
  const [topDealPrice, setTopDealPrice] = useState("");
  const [lastEdited, setLastEdited] = useState<"percent" | "price">("percent");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!open) return;
    setStep("pick");
    setSearch("");
    setDebouncedSearch("");
    setSelected(null);
    setTopDealPrice("");
    const start = todayIsoDate();
    setStartDate(start);
    setFinishDate(addDaysIso(start, 6));
    setDiscountPercent("10");
    setFinalPrice("");
    setLastEdited("percent");

    const preferred =
      defaultAccountId && defaultAccountId !== "all"
        ? defaultAccountId
        : accounts[0]?.id ?? "";
    setAccountId(preferred);
  }, [open, defaultAccountId, accounts]);

  const productsParams = {
    account_id: accountId || undefined,
    listing_filter: "active" as const,
    search: debouncedSearch || undefined,
    page: 1,
    limit: 20,
  };

  const { data: productsData, isLoading: productsLoading, isFetching } = useListProducts(
    productsParams,
    {
      query: {
        queryKey: getListProductsQueryKey(productsParams),
        enabled: open && step === "pick" && !!accountId,
      },
    },
  );

  const products = useMemo(
    () => (productsData?.data ?? []).filter((p) => !!p.mlItemId),
    [productsData?.data],
  );

  const original = selected ? resolveOriginalPrice(selected) : null;

  function handleSelectProduct(product: Product) {
    if (!product.mlItemId) {
      toast({
        title: "Anúncio sem MLB",
        description: "Este produto não tem ID do Mercado Livre.",
        variant: "destructive",
      });
      return;
    }
    const price = resolveOriginalPrice(product);
    if (price == null) {
      toast({
        title: "Preço indisponível",
        description: "Não foi possível obter o preço original deste anúncio.",
        variant: "destructive",
      });
      return;
    }
    setSelected(product);
    setDiscountPercent("10");
    setFinalPrice(formatPriceInput(calcFinalFromDiscount(price, 10)));
    setLastEdited("percent");
    setTopDealPrice("");
    setStep("confirm");
  }

  const { mutate: createDiscount, isPending } = useCreatePriceDiscount({
    mutation: {
      onSuccess: () => {
        toast({
          title: "Desconto criado",
          description: "O desconto por porcentagem foi publicado no Mercado Livre.",
        });
        queryClient.invalidateQueries({ queryKey: getListPromotionInboxQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListPromotionsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetPromotionsSummaryQueryKey() });
        onOpenChange(false);
      },
      onError: (err: unknown) => {
        const msg =
          err && typeof err === "object" && "message" in err
            ? String((err as { message: string }).message)
            : "Não foi possível criar o desconto.";
        toast({ title: "Erro ao criar desconto", description: msg, variant: "destructive" });
      },
    },
  });

  function handleDiscountChange(raw: string) {
    const normalized = raw.replace(",", ".");
    setDiscountPercent(normalized);
    setLastEdited("percent");
    const pct = parseFloat(normalized);
    if (original != null && normalized.trim() !== "" && !Number.isNaN(pct)) {
      setFinalPrice(formatPriceInput(calcFinalFromDiscount(original, pct)));
    }
  }

  function handleFinalPriceChange(raw: string) {
    const normalized = raw.replace(",", ".");
    setFinalPrice(normalized);
    setLastEdited("price");
    const price = parseFloat(normalized);
    if (original != null && normalized.trim() !== "" && !Number.isNaN(price)) {
      setDiscountPercent(String(calcDiscountPercent(original, price)));
    }
  }

  function handleConfirm() {
    if (!selected?.mlItemId || !accountId || original == null) return;

    const parsedPrice = parseFloat(finalPrice.replace(",", "."));
    const pct = parseFloat(discountPercent.replace(",", ".")) || 0;
    const parsedTop = topDealPrice.trim()
      ? parseFloat(topDealPrice.replace(",", "."))
      : undefined;

    if (Number.isNaN(parsedPrice) || parsedPrice <= 0) {
      toast({
        title: "Preço inválido",
        description: "Informe o preço final da promoção.",
        variant: "destructive",
      });
      return;
    }

    if (pct < MIN_DISCOUNT_PERCENT || pct > MAX_DISCOUNT_PERCENT) {
      toast({
        title: "Desconto fora da faixa",
        description: `O desconto deve estar entre ${MIN_DISCOUNT_PERCENT}% e ${MAX_DISCOUNT_PERCENT}%.`,
        variant: "destructive",
      });
      return;
    }

    if (parsedPrice >= original) {
      toast({
        title: "Preço final inválido",
        description: "O preço com desconto deve ser menor que o preço original.",
        variant: "destructive",
      });
      return;
    }

    if (!startDate || !finishDate) {
      toast({
        title: "Vigência obrigatória",
        description: "Selecione a data de início e de fim.",
        variant: "destructive",
      });
      return;
    }

    const span = daysInclusive(startDate, finishDate);
    if (span < 1) {
      toast({
        title: "Datas inválidas",
        description: "A data de fim deve ser igual ou posterior à de início.",
        variant: "destructive",
      });
      return;
    }
    if (span > MAX_DURATION_DAYS) {
      toast({
        title: "Vigência longa demais",
        description: `Selecione até ${MAX_DURATION_DAYS} dias.`,
        variant: "destructive",
      });
      return;
    }

    if (parsedTop != null) {
      if (Number.isNaN(parsedTop) || parsedTop <= 0) {
        toast({
          title: "Preço meli+ inválido",
          description: "Informe um valor válido ou deixe em branco.",
          variant: "destructive",
        });
        return;
      }
      if (parsedTop >= parsedPrice) {
        toast({
          title: "Preço meli+ inválido",
          description: "O preço exclusivo deve ser menor que o preço com desconto geral.",
          variant: "destructive",
        });
        return;
      }
    }

    createDiscount({
      data: {
        accountId: selected.accountId || accountId,
        itemId: selected.mlItemId,
        dealPrice: Math.round(parsedPrice * 100) / 100,
        topDealPrice: parsedTop != null ? Math.round(parsedTop * 100) / 100 : null,
        startDate,
        finishDate,
      },
    });
  }

  const discountAmount =
    original != null && discountPercent.trim()
      ? calcDiscountAmount(original, parseFloat(discountPercent.replace(",", ".")) || 0)
      : null;

  const durationOk =
    !!startDate &&
    !!finishDate &&
    daysInclusive(startDate, finishDate) >= 1 &&
    daysInclusive(startDate, finishDate) <= MAX_DURATION_DAYS;

  const canConfirm =
    !!selected?.mlItemId &&
    !!finalPrice.trim() &&
    durationOk &&
    !isPending;

  const maxFinish = addDaysIso(startDate || todayIsoDate(), MAX_DURATION_DAYS - 1);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border">
          <DialogTitle className="text-base font-semibold">
            {step === "pick"
              ? "Criar desconto por porcentagem"
              : "Confirme os detalhes da promoção"}
          </DialogTitle>
        </DialogHeader>

        {step === "pick" ? (
          <div className="px-5 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
            <div>
              <Label className="text-sm font-medium">Conta</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger className="mt-1.5 h-9 text-sm">
                  <SelectValue placeholder="Selecione a conta" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id!}>
                      {a.mlNickname ?? a.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-sm font-medium">Anúncio</Label>
              <div className="relative mt-1.5">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar por SKU, MLB ou título..."
                  className="pl-8 h-9 text-sm"
                />
              </div>
            </div>

            {!accountId ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                Selecione uma conta para listar anúncios.
              </p>
            ) : productsLoading || isFetching ? (
              <div className="flex justify-center py-10">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : products.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                {debouncedSearch
                  ? `Nenhum anúncio ativo para "${debouncedSearch}".`
                  : "Nenhum anúncio ativo encontrado."}
              </p>
            ) : (
              <div className="space-y-1.5">
                {products.map((p) => {
                  const price = resolveOriginalPrice(p);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleSelectProduct(p)}
                      className="w-full flex items-center gap-3 p-2.5 rounded-lg border border-border hover:border-primary/40 hover:bg-muted/40 text-left transition-colors"
                    >
                      {p.thumbnail ? (
                        <img
                          src={p.thumbnail}
                          alt=""
                          className="size-12 rounded-md object-cover bg-muted flex-shrink-0"
                        />
                      ) : (
                        <div className="size-12 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
                          <Package className="w-5 h-5 text-muted-foreground/40" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground line-clamp-2 leading-snug">
                          {p.title ?? p.mlItemId}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                          {[p.sku, p.mlItemId].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      {price != null && (
                        <span className="text-sm font-semibold tabular-nums text-foreground flex-shrink-0">
                          {formatCurrency(price)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : selected ? (
          <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
            <button
              type="button"
              onClick={() => setStep("pick")}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Trocar anúncio
            </button>

            <div className="flex gap-3 p-3 bg-muted/40 rounded-xl border border-border">
              {selected.thumbnail ? (
                <img
                  src={selected.thumbnail}
                  alt=""
                  className="size-16 rounded-lg object-cover bg-muted flex-shrink-0"
                />
              ) : (
                <div className="size-16 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                  <Package className="w-7 h-7 text-muted-foreground/40" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground leading-snug line-clamp-2">
                  {selected.title ?? selected.mlItemId}
                </p>
                {selected.availableQuantity != null && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Estoque total:{" "}
                    <span className="font-semibold text-foreground">
                      {selected.availableQuantity} unidade
                      {selected.availableQuantity !== 1 ? "s" : ""}
                    </span>
                  </p>
                )}
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Cumulativo com: outros descontos que estiverem ativos na vigência que você definir.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="pd-start" className="text-sm font-medium">
                  Início
                </Label>
                <Input
                  id="pd-start"
                  type="date"
                  value={startDate}
                  min={todayIsoDate()}
                  onChange={(e) => {
                    const next = e.target.value;
                    setStartDate(next);
                    if (finishDate && daysInclusive(next, finishDate) > MAX_DURATION_DAYS) {
                      setFinishDate(addDaysIso(next, MAX_DURATION_DAYS - 1));
                    } else if (finishDate && finishDate < next) {
                      setFinishDate(next);
                    }
                  }}
                  className="mt-1.5 h-10 bg-background"
                />
              </div>
              <div>
                <Label htmlFor="pd-finish" className="text-sm font-medium">
                  Fim
                </Label>
                <Input
                  id="pd-finish"
                  type="date"
                  value={finishDate}
                  min={startDate || todayIsoDate()}
                  max={maxFinish}
                  onChange={(e) => setFinishDate(e.target.value)}
                  className="mt-1.5 h-10 bg-background"
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground -mt-2">
              Selecione até {MAX_DURATION_DAYS} dias
              {startDate && finishDate
                ? ` · ${daysInclusive(startDate, finishDate)} dia(s) selecionado(s)`
                : ""}
            </p>

            {original != null && (
              <div className="space-y-3 pt-1 border-t border-border">
                <div className="flex items-center justify-between">
                  <Label className="text-sm text-muted-foreground">Preço original</Label>
                  <p className="text-base font-semibold text-foreground">
                    {formatCurrency(original)}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="pd-discount" className="text-sm font-medium">
                      Desconto
                    </Label>
                    <div className="relative mt-1.5">
                      <Input
                        id="pd-discount"
                        type="text"
                        inputMode="decimal"
                        value={discountPercent}
                        onChange={(e) => handleDiscountChange(e.target.value)}
                        className="h-10 pr-8 text-base font-semibold bg-background"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                        %
                      </span>
                    </div>
                    {discountAmount != null && lastEdited === "percent" && (
                      <p className="text-[11px] text-muted-foreground mt-1">
                        Equivale a {formatCurrency(discountAmount)}
                      </p>
                    )}
                  </div>

                  <div>
                    <Label htmlFor="pd-final" className="text-sm font-medium">
                      Preço final
                    </Label>
                    <div className="relative mt-1.5">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                        R$
                      </span>
                      <Input
                        id="pd-final"
                        type="text"
                        inputMode="decimal"
                        value={finalPrice}
                        onChange={(e) => handleFinalPriceChange(e.target.value)}
                        className="h-10 pl-9 text-base font-semibold bg-background"
                      />
                    </div>
                  </div>
                </div>

                <p className="text-[11px] text-muted-foreground">
                  Desconto permitido: {MIN_DISCOUNT_PERCENT}% — {MAX_DISCOUNT_PERCENT}%
                </p>

                <div>
                  <Label htmlFor="pd-top" className="text-sm font-medium">
                    Desconto exclusivo meli+{" "}
                    <span className="text-muted-foreground font-normal">(opcional)</span>
                  </Label>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Preço menor para assinantes / compradores nível 3–6.
                  </p>
                  <div className="relative mt-1.5">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      R$
                    </span>
                    <Input
                      id="pd-top"
                      type="text"
                      inputMode="decimal"
                      value={topDealPrice}
                      onChange={(e) => setTopDealPrice(e.target.value)}
                      placeholder="Deixe em branco se não quiser"
                      className="h-10 pl-9 bg-background"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : null}

        <DialogFooter className="px-5 py-4 border-t border-border flex-col sm:flex-col gap-2">
          {step === "confirm" && (
            <Button
              onClick={handleConfirm}
              disabled={!canConfirm}
              className={cn("w-full h-11 text-sm font-semibold", !canConfirm && "opacity-60")}
            >
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Confirmar"}
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
            className="w-full text-primary hover:text-primary"
          >
            Cancelar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
