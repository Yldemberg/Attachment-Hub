import { useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";
import {
  useListAccounts,
  usePrepareProductFromLink,
  usePublishProductDraft,
  useGetListingPrepareJob,
  getListProductsQueryKey,
  getGetListingPrepareJobQueryKey,
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
  getPublishBlockReasons,
  isAmazonListingDraft,
  normalizeAmazonDraftForReview,
  revalidateDraftReadiness,
  type ListingPrepareDraft,
} from "./components/n8n-listing-types";
import { ProductLinkPrepareForm } from "./components/ProductLinkPrepareForm";
import { N8nListingReviewForm } from "./components/N8nListingReviewForm";
import { AmazonListingReviewForm } from "./components/AmazonListingReviewForm";
import { MlAccountMultiSelect } from "./components/MlAccountMultiSelect";

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err) {
    return String((err as { message?: unknown }).message);
  }
  return "Ocorreu um erro inesperado.";
}

function accountDisplayName(
  accounts: Array<{
    id: string;
    platform?: string | null;
    mlNickname?: string | null;
    mlUserId?: string | null;
    amazonStoreName?: string | null;
    amazonSellerId?: string | null;
  }>,
  accountId: string,
): string {
  const account = accounts.find((a) => a.id === accountId);
  if (!account) return accountId;
  if (account.platform === "amazon") {
    return account.amazonStoreName ?? account.amazonSellerId ?? accountId;
  }
  return account.mlNickname ?? account.mlUserId ?? accountId;
}

export default function ProductCreate() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<1 | 2>(1);
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [productUrl, setProductUrl] = useState("");
  const [prepareJobId, setPrepareJobId] = useState<string | null>(null);
  const [prepareStartedAt, setPrepareStartedAt] = useState<number | null>(null);
  const [draft, setDraft] = useState<ListingPrepareDraft | null>(null);
  const [jobNeedsReview, setJobNeedsReview] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const { data: accountsData } = useListAccounts();
  const accounts = accountsData?.data ?? [];

  const { mutateAsync: startPrepare, isPending: startingPrepare } = usePrepareProductFromLink();
  const { mutateAsync: publishDraftAsync } = usePublishProductDraft();

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
  const isAmazonDraft = draft ? isAmazonListingDraft(draft) : false;

  useEffect(() => {
    if (!jobData || !prepareJobId) return;

    if (
      (jobData.status === "completed" || jobData.status === "needs_review") &&
      jobData.data
    ) {
      const nextDraft = jobData.data as ListingPrepareDraft;
      const amazon = isAmazonListingDraft(nextDraft);
      setDraft(
        amazon
          ? normalizeAmazonDraftForReview(nextDraft)
          : nextDraft,
      );
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
            ? amazon
              ? "Complete os campos pendentes antes de publicar na Amazon."
              : "Complete os campos pendentes antes de publicar no Mercado Livre."
            : amazon
              ? "Revise os dados antes de publicar na Amazon."
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
          "A preparação demorou mais de 6 minutos. Verifique no N8N se o nó \"Enviar ao iHub\" concluiu (URL/secret) e tente novamente.",
      });
      return;
    }

    const timer = window.setTimeout(() => {
      clearPrepareJob();
      toast({
        variant: "destructive",
        title: "Tempo esgotado",
        description:
          "A preparação demorou mais de 6 minutos. Verifique no N8N se o nó \"Enviar ao iHub\" concluiu (URL/secret) e tente novamente.",
      });
    }, remaining);

    return () => window.clearTimeout(timer);
  }, [prepareJobId, prepareStartedAt, toast, clearPrepareJob]);

  const handlePrepare = async () => {
    const primaryAccountId = accountIds[0];
    if (!primaryAccountId) {
      toast({
        variant: "destructive",
        title: "Selecione uma conta",
        description: "Escolha ao menos uma conta (Mercado Livre ou Amazon).",
      });
      return;
    }

    try {
      const result = await startPrepare({
        data: { accountId: primaryAccountId, productUrl: productUrl.trim() },
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

  const handlePublish = async () => {
    if (!draft || !canPublishDraft(draft)) {
      const reasons = draft ? getPublishBlockReasons(draft) : ["Dados incompletos."];
      toast({
        variant: "destructive",
        title: "Revisão incompleta",
        description: reasons[0] ?? "Complete os campos obrigatórios antes de publicar.",
      });
      return;
    }

    if (accountIds.length === 0) {
      toast({
        variant: "destructive",
        title: "Selecione uma conta",
        description: isAmazonDraft
          ? "Escolha ao menos uma conta Amazon para publicar."
          : "Escolha ao menos uma conta Mercado Livre para publicar.",
      });
      return;
    }

    const readyDraft: ListingPrepareDraft = isAmazonListingDraft(draft)
      ? { ...draft, _pronto_para_publicar: true }
      : revalidateDraftReadiness({
          ...draft,
          payload: {
            ...draft.payload,
            family_name:
              draft.payload.family_name?.trim() ||
              (draft.payload as { title?: string }).title?.trim() ||
              draft.payload.family_name,
          },
          _pronto_para_publicar: true,
        });

    setPublishing(true);
    const succeeded: string[] = [];
    const failed: Array<{ accountId: string; message: string }> = [];

    try {
      for (const accountId of accountIds) {
        try {
          await publishDraftAsync({
            data: {
              accountId,
              // API aceita draft Amazon em runtime; schema Orval ainda tipa só ML.
              draft: readyDraft as Parameters<typeof publishDraftAsync>[0]["data"]["draft"],
            },
          });
          succeeded.push(accountId);
        } catch (err) {
          failed.push({ accountId, message: getErrorMessage(err) });
        }
      }

      await queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });

      if (failed.length === 0) {
        toast({
          title: succeeded.length > 1 ? "Anúncios publicados" : "Anúncio publicado",
          description:
            succeeded.length > 1
              ? `Criado com sucesso em ${succeeded.length} contas.`
              : isAmazonDraft
                ? "O anúncio foi criado na Amazon."
                : "O anúncio foi criado no Mercado Livre.",
        });
        navigate(buildProductsListReturnPath());
        return;
      }

      if (succeeded.length === 0) {
        toast({
          variant: "destructive",
          title: "Falha ao publicar",
          description: failed[0]?.message ?? "Não foi possível publicar o anúncio.",
        });
        return;
      }

      toast({
        variant: "destructive",
        title: "Publicação parcial",
        description: `OK: ${succeeded.map((id) => accountDisplayName(accounts, id)).join(", ")}. Falhou: ${failed
          .map((f) => `${accountDisplayName(accounts, f.accountId)} (${f.message})`)
          .join("; ")}`,
      });
    } finally {
      setPublishing(false);
    }
  };

  const handleBack = () => {
    if (step === 2) {
      setStep(1);
      return;
    }
    navigate(buildProductsListReturnPath());
  };

  const prepareStatusMessage = isPreparing
    ? "Extraindo dados do produto (Amazon/Shopee)… pode levar até alguns minutos. Aguarde o retorno do N8N."
    : undefined;

  const publishLabel =
    accountIds.length > 1 ? `Criar anúncio (${accountIds.length} contas)` : "Criar anúncio";

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
            Importe um produto da Amazon ou Shopee e publique no Mercado Livre ou na Amazon
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
              accountIds={accountIds}
              productUrl={productUrl}
              accounts={accounts}
              preparing={isPreparing}
              statusMessage={prepareStatusMessage}
              onAccountIdsChange={setAccountIds}
              onProductUrlChange={setProductUrl}
              onPrepare={handlePrepare}
              onCancel={isPreparing ? handleCancelPrepare : undefined}
            />
          ) : draft ? (
            <div className="space-y-5">
              <MlAccountMultiSelect
                accounts={accounts}
                selectedIds={accountIds}
                onChange={setAccountIds}
                disabled={publishing}
                hint={
                  isAmazonDraft
                    ? "Confirme em quais contas Amazon o anúncio será publicado."
                    : "Confirme em quais contas o anúncio será publicado."
                }
              />
              {isAmazonListingDraft(draft) ? (
                <AmazonListingReviewForm
                  draft={draft}
                  onDraftChange={setDraft}
                  jobNeedsReview={jobNeedsReview}
                  accountId={
                    accountIds.find(
                      (id) => accounts.find((a) => a.id === id)?.platform === "amazon",
                    ) ?? accountIds[0]
                  }
                />
              ) : (
                <N8nListingReviewForm
                  draft={draft}
                  onDraftChange={setDraft}
                  jobNeedsReview={jobNeedsReview}
                />
              )}
            </div>
          ) : null}
        </div>

        {step === 2 ? (
          <div className="flex items-center justify-between">
            <Button variant="outline" onClick={handleBack} disabled={publishing}>
              Voltar
            </Button>
            <Button
              onClick={handlePublish}
              disabled={
                publishing ||
                accountIds.length === 0 ||
                !draft ||
                !canPublishDraft(draft)
              }
            >
              {publishing ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              {publishLabel}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
