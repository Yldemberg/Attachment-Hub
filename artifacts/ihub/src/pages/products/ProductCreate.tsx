import { useState } from "react";
import { useLocation } from "wouter";
import {
  useListAccounts,
  usePrepareProductFromLink,
  usePublishProductDraft,
  getListProductsQueryKey,
  type N8nListingDraft,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { buildProductsListReturnPath } from "@/lib/products-list-persistence";
import { N8N_CREATE_STEPS, canPublishDraft } from "./components/n8n-listing-types";
import { ProductLinkPrepareForm } from "./components/ProductLinkPrepareForm";
import { N8nListingReviewForm } from "./components/N8nListingReviewForm";

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err) {
    return String((err as { message?: unknown }).message);
  }
  return "Ocorreu um erro inesperado.";
}

export default function ProductCreate() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<1 | 2>(1);
  const [accountId, setAccountId] = useState("");
  const [productUrl, setProductUrl] = useState("");
  const [draft, setDraft] = useState<N8nListingDraft | null>(null);

  const { data: accountsData } = useListAccounts();
  const accounts = accountsData?.data ?? [];

  const { mutateAsync: prepareFromLink, isPending: preparing } = usePrepareProductFromLink();
  const { mutate: publishDraft, isPending: publishing } = usePublishProductDraft({
    mutation: {
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
        toast({
          title: "Anúncio enviado para publicação",
          description:
            result.message ??
            "O N8N recebeu os dados. O anúncio pode levar alguns instantes para aparecer na listagem.",
        });
        navigate(buildProductsListReturnPath());
      },
      onError: (err: Error) => {
        toast({
          variant: "destructive",
          title: "Falha ao publicar",
          description: getErrorMessage(err),
        });
      },
    },
  });

  const handlePrepare = async () => {
    try {
      const result = await prepareFromLink({
        data: { accountId, productUrl: productUrl.trim() },
      });
      setDraft(result.data);
      setStep(2);
      toast({
        title: "Anúncio preparado",
        description: "Revise os dados antes de publicar no Mercado Livre.",
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Falha ao preparar anúncio",
        description: getErrorMessage(err),
      });
    }
  };

  const handlePublish = () => {
    if (!draft || !canPublishDraft(draft)) {
      toast({
        variant: "destructive",
        title: "Dados incompletos",
        description: "Preencha nome, preço, estoque e ao menos uma foto.",
      });
      return;
    }

    publishDraft({
      data: {
        accountId,
        draft,
      },
    });
  };

  const handleBack = () => {
    if (step === 2) {
      setStep(1);
      return;
    }
    navigate(buildProductsListReturnPath());
  };

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="p-6 space-y-6 max-w-2xl mx-auto">
        <button
          onClick={() => navigate(buildProductsListReturnPath())}
          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-sm transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Produtos
        </button>

        <div>
          <h1 className="text-lg font-bold text-foreground">Criar anúncio</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Importe um produto da Amazon ou Shopee e publique no Mercado Livre
          </p>
        </div>

        <div className="flex items-center gap-1 overflow-x-auto pb-1">
          {N8N_CREATE_STEPS.map((s) => (
            <div
              key={s.id}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap ${
                step === s.id
                  ? "bg-primary text-primary-foreground"
                  : step > s.id
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {step > s.id ? <Check className="w-3 h-3" /> : <span>{s.id}</span>}
              {s.label}
            </div>
          ))}
        </div>

        <div className="bg-card border border-card-border rounded-xl p-5">
          {step === 1 ? (
            <ProductLinkPrepareForm
              accountId={accountId}
              productUrl={productUrl}
              accounts={accounts}
              preparing={preparing}
              onAccountIdChange={setAccountId}
              onProductUrlChange={setProductUrl}
              onPrepare={handlePrepare}
            />
          ) : draft ? (
            <N8nListingReviewForm draft={draft} onDraftChange={setDraft} />
          ) : null}
        </div>

        {step === 2 ? (
          <div className="flex items-center justify-between">
            <Button variant="outline" onClick={handleBack} disabled={publishing}>
              Voltar
            </Button>
            <Button onClick={handlePublish} disabled={publishing || !draft || !canPublishDraft(draft)}>
              {publishing ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Criar anúncio
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
