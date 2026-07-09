import { useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";
import {
  useListAccounts,
  usePrepareProductFromLink,
  usePublishProductDraft,
  useGetListingPrepareJob,
  getListProductsQueryKey,
  getGetListingPrepareJobQueryKey,
  type N8nListingDraft,
  type ListingPrepareJobResponse,
} from "@workspace/api-client-react";
import { useQueryClient, type Query } from "@tanstack/react-query";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { buildProductsListReturnPath } from "@/lib/products-list-persistence";
import {
  N8N_CREATE_STEPS,
  PREPARE_JOB_TIMEOUT_MS,
  canPublishDraft,
  getBlockingMlValidationErrors,
  hasBlockingPendingIhubUi,
  revalidateDraftReadiness,
} from "./components/n8n-listing-types";
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
  const [prepareJobId, setPrepareJobId] = useState<string | null>(null);
  const [prepareStartedAt, setPrepareStartedAt] = useState<number | null>(null);
  const [draft, setDraft] = useState<N8nListingDraft | null>(null);
  const [jobNeedsReview, setJobNeedsReview] = useState(false);

  const { data: accountsData } = useListAccounts();
  const accounts = accountsData?.data ?? [];

  const { mutateAsync: startPrepare, isPending: startingPrepare } = usePrepareProductFromLink();

  const clearPrepareJob = useCallback(() => {
    setPrepareJobId(null);
    setPrepareStartedAt(null);
  }, []);

  const {
    data: jobData,
    isError: isJobPollError,
    error: jobPollError,
  } = useGetListingPrepareJob(prepareJobId ?? "", {
    query: {
      queryKey: getGetListingPrepareJobQueryKey(prepareJobId ?? ""),
      enabled: !!prepareJobId,
      refetchInterval: (query: Query<ListingPrepareJobResponse>) => {
        const status = query.state.data?.status;
        if (status === "pending" || status === "processing") return 3000;
        return false;
      },
    },
  });

  const jobFinished =
    jobData?.status === "completed" ||
    jobData?.status === "needs_review" ||
    jobData?.status === "failed";
  const isPreparing = startingPrepare || (!!prepareJobId && !jobFinished);

  useEffect(() => {
    if (!jobData || !prepareJobId) return;

    if (
      (jobData.status === "completed" || jobData.status === "needs_review") &&
      jobData.data
    ) {
      setDraft(jobData.data);
      setJobNeedsReview(jobData.status === "needs_review");
      setStep(2);
      clearPrepareJob();
      toast({
        title:
          jobData.status === "needs_review"
            ? "Revisão necessária"
            : "Anúncio preparado",
        description:
          jobData.status === "needs_review"
            ? "Complete os campos pendentes antes de publicar no Mercado Livre."
            : "Revise os dados antes de publicar no Mercado Livre.",
      });
      return;
    }

    if (jobData.status === "failed") {
      clearPrepareJob();
      toast({
        variant: "destructive",
        title: "Falha ao preparar anúncio",
        description: jobData.errorMessage ?? "Não foi possível preparar o anúncio.",
      });
    }
  }, [jobData, prepareJobId, toast, clearPrepareJob]);

  useEffect(() => {
    if (!isJobPollError || !prepareJobId) return;
    clearPrepareJob();
    toast({
      variant: "destructive",
      title: "Falha ao preparar anúncio",
      description: getErrorMessage(jobPollError),
    });
  }, [isJobPollError, jobPollError, prepareJobId, toast, clearPrepareJob]);

  useEffect(() => {
    if (!prepareJobId || !prepareStartedAt) return;

    const elapsed = Date.now() - prepareStartedAt;
    const remaining = PREPARE_JOB_TIMEOUT_MS - elapsed;
    if (remaining <= 0) {
      clearPrepareJob();
      toast({
        variant: "destructive",
        title: "Tempo esgotado",
        description:
          "A preparação demorou demais. Verifique o workflow N8N ou tente novamente.",
      });
      return;
    }

    const timer = window.setTimeout(() => {
      clearPrepareJob();
      toast({
        variant: "destructive",
        title: "Tempo esgotado",
        description:
          "A preparação demorou demais. Verifique o workflow N8N ou tente novamente.",
      });
    }, remaining);

    return () => window.clearTimeout(timer);
  }, [prepareJobId, prepareStartedAt, toast, clearPrepareJob]);

  const { mutate: publishDraft, isPending: publishing } = usePublishProductDraft({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
        toast({
          title: "Anúncio publicado",
          description: "O anúncio foi criado no Mercado Livre.",
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
      const result = await startPrepare({
        data: { accountId, productUrl: productUrl.trim() },
      });
      setPrepareJobId(result.jobId);
      setPrepareStartedAt(Date.now());
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Falha ao iniciar preparação",
        description: getErrorMessage(err),
      });
    }
  };

  const handleCancelPrepare = () => {
    clearPrepareJob();
    toast({
      title: "Preparação cancelada",
      description: "Você pode tentar novamente quando quiser.",
    });
  };

  const handlePublish = () => {
    if (!draft || !canPublishDraft(draft)) {
      const hasMlErrors = draft ? getBlockingMlValidationErrors(draft).length > 0 : false;
      const hasPendingUi = draft ? hasBlockingPendingIhubUi(draft) : false;
      toast({
        variant: "destructive",
        title: hasMlErrors || hasPendingUi ? "Revisão incompleta" : "Dados incompletos",
        description: hasMlErrors
          ? "Corrija os erros de validação do Mercado Livre antes de publicar."
          : hasPendingUi
            ? "Complete os campos obrigatórios pendentes antes de publicar."
            : "Preencha nome, preço, estoque e ao menos uma foto.",
      });
      return;
    }

    publishDraft({
      data: {
        accountId,
        draft: revalidateDraftReadiness(draft),
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

  const prepareStatusMessage = isPreparing
    ? "Extraindo dados do produto… isso pode levar alguns minutos."
    : undefined;

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
              preparing={isPreparing}
              statusMessage={prepareStatusMessage}
              onAccountIdChange={setAccountId}
              onProductUrlChange={setProductUrl}
              onPrepare={handlePrepare}
              onCancel={isPreparing ? handleCancelPrepare : undefined}
            />
          ) : draft ? (
            <N8nListingReviewForm
              draft={draft}
              onDraftChange={setDraft}
              jobNeedsReview={jobNeedsReview}
            />
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
