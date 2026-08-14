import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import {
  useGetListingTemplate,
  useListAccounts,
  useDeleteListingTemplate,
  usePublishListingTemplate,
  usePropagateListingTemplate,
  useSaveListingTemplateFromProduct,
  getGetListingTemplateQueryKey,
  getListListingTemplatesQueryKey,
  getListProductsQueryKey,
  type PropagateListingTemplateField,
  type PropagateListingTemplateResponseData,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ExternalLink,
  LayoutTemplate,
  Loader2,
  Package,
  Repeat,
  RotateCcw,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { type PublishedListingRef } from "./components/PublishTemplateDialog";
import {
  TemplatePayloadEditor,
  formToPublishOverrides,
  payloadToForm,
  allPropagateSelection,
  changedPropagateSelection,
  selectionToPropagatePayload,
  EMPTY_PROPAGATE_SELECTION,
  type EditableTemplateForm,
  type TemplatePropagateSelection,
} from "./components/TemplatePayloadEditor";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const STATUS_LABELS: Record<string, string> = {
  active: "Ativo",
  paused: "Pausado",
  closed: "Encerrado",
  under_review: "Em revisão",
};

function publishBlockedReason(flags: { isCatalog: boolean }): string | null {
  if (flags.isCatalog) {
    return "Modelos de catálogo compartilhado não podem ser publicados automaticamente.";
  }
  return null;
}

function hasAnySelection(selection: TemplatePropagateSelection): boolean {
  return (
    selection.fields.length > 0 ||
    selection.attributeIndexes.length > 0 ||
    selection.saleTermIndexes.length > 0
  );
}

export default function ListingTemplateDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [propagateOpen, setPropagateOpen] = useState(false);
  const [targetAccountId, setTargetAccountId] = useState("");
  const [form, setForm] = useState<EditableTemplateForm | null>(null);
  const [formReadyForId, setFormReadyForId] = useState<string | null>(null);
  const [publishedListings, setPublishedListings] = useState<PublishedListingRef[]>([]);
  const [selection, setSelection] = useState<TemplatePropagateSelection>(EMPTY_PROPAGATE_SELECTION);
  const [propagateResult, setPropagateResult] = useState<PropagateListingTemplateResponseData | null>(
    null,
  );

  const { data, isLoading, isError } = useGetListingTemplate(id, {
    query: { queryKey: getGetListingTemplateQueryKey(id), enabled: !!id },
  });

  const template = data?.data;
  const payload = template?.payload;
  const skuTargets = template?.skuTargets;
  const sku = template?.sku?.trim() || "";

  useEffect(() => {
    if (!template?.id || !payload) return;
    if (formReadyForId === template.id) return;
    setForm(payloadToForm(payload));
    setFormReadyForId(template.id);
    setPublishedListings([]);
    setPropagateResult(null);
    setSelection(EMPTY_PROPAGATE_SELECTION);
  }, [template?.id, payload, formReadyForId]);

  const { data: accountsData } = useListAccounts();
  const accounts =
    (accountsData as { data?: { id: string; mlNickname?: string | null; mlUserId?: string | null }[] } | null)
      ?.data ?? [];

  useEffect(() => {
    if (!template || targetAccountId) return;
    setTargetAccountId(template.sourceAccountId ?? accounts[0]?.id ?? "");
  }, [template, accounts, targetAccountId]);

  const sourceAccountLabel = template?.sourceAccountId
    ? (accounts.find((a) => a.id === template.sourceAccountId)?.mlNickname ??
      accounts.find((a) => a.id === template.sourceAccountId)?.mlUserId ??
      "Conta")
    : "Sem conta";

  const blocked = template ? publishBlockedReason({ isCatalog: template.isCatalog }) : null;

  const originalForm = useMemo(() => (payload ? payloadToForm(payload) : null), [payload]);
  const changedSelection = useMemo(
    () => (form && originalForm ? changedPropagateSelection(form, originalForm) : EMPTY_PROPAGATE_SELECTION),
    [form, originalForm],
  );
  const propagatePayload = useMemo(
    () => (form ? selectionToPropagatePayload(form, selection) : null),
    [form, selection],
  );

  const resetFormFromTemplate = () => {
    if (!payload) return;
    setForm(payloadToForm(payload));
    setSelection(EMPTY_PROPAGATE_SELECTION);
    toast({ title: "Campos restaurados", description: "Valores originais do modelo foram recarregados." });
  };

  const validateForm = (): string | null => {
    if (!form) return "Formulário não carregado.";
    if (!form.title.trim()) return "Informe o título do anúncio.";
    if (!form.categoryId.trim()) return "Informe a categoria.";
    if (!(Number(form.price) > 0)) return "Informe um preço válido.";
    if (Number(form.availableQuantity) < 0) return "Informe um estoque válido.";
    if (form.pictureSources.map((u) => u.trim()).filter(Boolean).length === 0) {
      return "Adicione ao menos uma foto (URL pública).";
    }
    return null;
  };

  const { mutate: publishTemplate, isPending: publishing } = usePublishListingTemplate({
    mutation: {
      onSuccess: (res) => {
        queryClient.invalidateQueries({ queryKey: getListProductsQueryKey({}) });
        const entry = { productId: res.data.productId, mlItemId: res.data.mlItemId };
        setPublishedListings((prev) => [...prev, entry]);
        toast({
          title: "Anúncio publicado",
          description: `${res.data.mlItemId} criado. Ajuste os campos e publique outro quando quiser.`,
        });
      },
      onError: (err: Error & { payload?: { error?: { message?: string } } }) => {
        toast({
          variant: "destructive",
          title: "Erro ao publicar",
          description:
            err.payload?.error?.message ?? err.message ?? "Não foi possível publicar o anúncio.",
        });
      },
    },
  });

  const { mutate: propagateTemplate, isPending: propagating } = usePropagateListingTemplate({
    mutation: {
      onSuccess: (res) => {
        queryClient.invalidateQueries({ queryKey: getGetListingTemplateQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getListProductsQueryKey({}) });
        queryClient.invalidateQueries({ queryKey: getListListingTemplatesQueryKey({}) });
        setPropagateResult(res.data);
        setPropagateOpen(false);
        const { updated, failed, skipped, sku: resultSku } = res.data;
        toast({
          variant: failed > 0 && updated === 0 ? "destructive" : "default",
          title:
            failed > 0
              ? updated > 0
                ? "Espelhamento parcial"
                : "Falha ao espelhar"
              : "Campos espelhados",
          description: `SKU ${resultSku}: ${updated} atualizado(s), ${skipped} ignorado(s), ${failed} falha(s). Estoque não foi alterado.`,
        });
      },
      onError: (err: Error & { payload?: { error?: { message?: string } } }) => {
        toast({
          variant: "destructive",
          title: "Erro ao espelhar",
          description:
            err.payload?.error?.message ?? err.message ?? "Não foi possível aplicar os campos.",
        });
      },
    },
  });

  const { mutate: refreshFromMl, isPending: refreshingFromMl } = useSaveListingTemplateFromProduct({
    mutation: {
      onSuccess: () => {
        setFormReadyForId(null);
        queryClient.invalidateQueries({ queryKey: getGetListingTemplateQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getListListingTemplatesQueryKey({}) });
        toast({
          title: "Modelo atualizado do ML",
          description: "Atributos principais e secundários foram recarregados do anúncio de origem.",
        });
      },
      onError: (err: Error & { payload?: { error?: { message?: string } } }) => {
        toast({
          variant: "destructive",
          title: "Erro ao atualizar do ML",
          description:
            err.payload?.error?.message ?? err.message ?? "Não foi possível recarregar o anúncio.",
        });
      },
    },
  });

  const handlePublish = () => {
    if (!template || !form) return;
    const err = validateForm();
    if (err) {
      toast({ variant: "destructive", title: "Campos incompletos", description: err });
      return;
    }
    if (!targetAccountId) {
      toast({
        variant: "destructive",
        title: "Conta obrigatória",
        description: "Escolha a conta de destino para publicar.",
      });
      return;
    }
    publishTemplate({
      id: template.id,
      data: {
        targetAccountId,
        overrides: formToPublishOverrides(form),
      },
    });
  };

  const handlePropagate = () => {
    if (!template || !form || !propagatePayload) return;
    if (!sku) {
      toast({
        variant: "destructive",
        title: "SKU ausente",
        description: "Sincronize o anúncio de origem para obter o SKU.",
      });
      return;
    }
    if (!hasAnySelection(selection)) {
      toast({
        variant: "destructive",
        title: "Selecione campos",
        description: "Marque a checkbox ao lado de cada campo que deve ser alterado.",
      });
      return;
    }
    propagateTemplate({
      id: template.id,
      data: {
        fields: propagatePayload.fields as PropagateListingTemplateField[],
        attributeIds: propagatePayload.attributeIds,
        saleTermIds: propagatePayload.saleTermIds,
        overrides: formToPublishOverrides(form),
      },
    });
  };

  const { mutate: deleteTemplate, isPending: deleting } = useDeleteListingTemplate({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListListingTemplatesQueryKey({}) });
        toast({ title: "Modelo excluído", description: "O modelo de anúncio foi removido." });
        navigate("/listing-templates");
      },
      onError: (err: Error & { payload?: { error?: { message?: string } } }) => {
        toast({
          variant: "destructive",
          title: "Erro ao excluir",
          description: err.payload?.error?.message ?? err.message ?? "Não foi possível excluir.",
        });
      },
    },
  });

  if (isLoading || (template && !form)) {
    return (
      <div className="h-full overflow-y-auto bg-background p-6 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        Carregando modelo…
      </div>
    );
  }

  if (isError || !template || !payload || !form) {
    return (
      <div className="h-full overflow-y-auto bg-background p-6 text-center">
        <LayoutTemplate className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-muted-foreground">Modelo não encontrado</p>
        <Button variant="outline" size="sm" className="mt-4" asChild>
          <Link href="/listing-templates">Voltar</Link>
        </Button>
      </div>
    );
  }

  const lastPublished = publishedListings[publishedListings.length - 1];
  const isBusy = publishing || propagating || refreshingFromMl;
  const applicableTargets = skuTargets ? skuTargets.full + skuTargets.traditional : 0;

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="p-6 space-y-4 max-w-2xl mx-auto pb-28">
        <button
          onClick={() => navigate("/listing-templates")}
          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-sm transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Modelos
        </button>

        <div className="bg-card border border-card-border rounded-xl p-5">
          <div className="flex items-start gap-3">
            {template.thumbnail ? (
              <img
                src={template.thumbnail}
                alt=""
                className="w-14 h-14 rounded-lg object-cover bg-muted flex-shrink-0"
              />
            ) : (
              <div className="w-14 h-14 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                <Package className="w-6 h-6 text-muted-foreground/40" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="min-w-0">
                  <h1 className="text-lg font-bold text-foreground leading-tight">{template.name}</h1>
                  <p className="text-muted-foreground text-xs mt-1 font-mono">
                    {template.sourceMlItemId}
                    {sku ? ` · SKU ${sku}` : ""}
                  </p>
                  <p className="text-muted-foreground text-xs mt-0.5">{sourceAccountLabel}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {template.sourceProductId ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1"
                      onClick={() => refreshFromMl({ productId: template.sourceProductId as string })}
                      disabled={isBusy}
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${refreshingFromMl ? "animate-spin" : ""}`} />
                      Atualizar do ML
                    </Button>
                  ) : null}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1"
                    onClick={resetFormFromTemplate}
                    disabled={isBusy}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Restaurar
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1 text-destructive hover:text-destructive"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Excluir
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap gap-1 mt-3">
                {template.sourceStatus && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-md border bg-muted/50 text-muted-foreground">
                    {STATUS_LABELS[template.sourceStatus] ?? template.sourceStatus}
                  </span>
                )}
                {template.isFull && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-md border bg-sky-50 text-sky-700 border-sky-200">
                    Full
                  </span>
                )}
                {template.isCatalog && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-md border bg-violet-50 text-violet-700 border-violet-200">
                    Catálogo
                  </span>
                )}
                {template.hasVariations && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-md border bg-amber-50 text-amber-700 border-amber-200">
                    Variações
                  </span>
                )}
                {skuTargets && skuTargets.total > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-md border bg-emerald-50 text-emerald-800 border-emerald-200">
                    {skuTargets.total} anúncio{skuTargets.total === 1 ? "" : "s"} do SKU
                    {skuTargets.full > 0 ? ` · ${skuTargets.full} Full` : ""}
                  </span>
                )}
              </div>

              {blocked && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mt-3">
                  {blocked}
                </p>
              )}

              {!blocked && template.isFull && (
                <p className="text-xs text-sky-800 bg-sky-50 border border-sky-200 rounded-lg px-2.5 py-1.5 mt-3">
                  Este modelo veio de um anúncio Full. Ao publicar, será criado um anúncio{" "}
                  <strong>tradicional</strong> (sem Fulfillment). O espelhamento por SKU também
                  atualiza os Full existentes.
                </p>
              )}

              {payload.sourcePermalink && (
                <a
                  href={payload.sourcePermalink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-primary font-medium hover:underline mt-3"
                >
                  <ExternalLink className="w-3 h-3" />
                  Ver anúncio original no Mercado Livre
                </a>
              )}
            </div>
          </div>
        </div>

        {lastPublished && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-sm text-emerald-800 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-medium">
                Último anúncio: <span className="font-mono">{lastPublished.mlItemId}</span>
              </p>
              <p className="text-xs text-emerald-700/80 mt-0.5">
                {publishedListings.length} publicado{publishedListings.length === 1 ? "" : "s"} nesta
                sessão.
              </p>
            </div>
            <Button variant="outline" size="sm" className="h-7 text-xs" asChild>
              <Link href={`/products/${lastPublished.productId}`}>Abrir anúncio</Link>
            </Button>
          </div>
        )}

        <div className="bg-card border border-card-border rounded-xl p-5">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Campos do anúncio</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Marque a checkbox ao lado do campo para espelhá-lo. Campos desmarcados{" "}
                <strong>não são alterados</strong> nos anúncios. Estoque nunca entra.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 shrink-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={isBusy}
                onClick={() => setSelection(allPropagateSelection(form))}
              >
                Marcar todos
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={isBusy || !hasAnySelection(changedSelection)}
                onClick={() => setSelection(changedSelection)}
              >
                Só alterados
              </Button>
            </div>
          </div>
          <TemplatePayloadEditor
            form={form}
            onChange={setForm}
            disabled={isBusy}
            selection={selection}
            onSelectionChange={setSelection}
          />
          {template.hasVariations && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mt-4">
              Anúncios com variações: preço por variação não é aplicado automaticamente. Na
              publicação de anúncio novo, as variações do modelo continuam sendo enviadas.
            </p>
          )}
        </div>

        <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Espelhar por SKU (Mercado Livre)</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Aplica <strong>somente as checkboxes marcadas</strong> em todos os anúncios ML com o
              mesmo SKU, em todas as contas, inclusive Full.
            </p>
          </div>

          {!sku ? (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
              Este modelo ainda não tem SKU. Sincronize o anúncio de origem para habilitar o
              espelhamento.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              SKU <span className="font-mono text-foreground">{sku}</span>
              {skuTargets ? (
                <>
                  {" "}
                  · {applicableTargets} anúncio{applicableTargets === 1 ? "" : "s"} elegível
                  {skuTargets.full > 0 ? ` (${skuTargets.full} Full)` : ""}
                  {skuTargets.closed > 0 ? ` · ${skuTargets.closed} encerrado(s) serão ignorados` : ""}
                </>
              ) : null}
            </p>
          )}

          <Button
            className="gap-1 w-full sm:w-auto"
            disabled={isBusy || !sku || applicableTargets === 0 || !hasAnySelection(selection)}
            onClick={() => setPropagateOpen(true)}
          >
            {propagating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Repeat className="w-4 h-4" />}
            Aplicar nos anúncios do SKU
          </Button>
        </div>

        {propagateResult && (
          <div className="bg-card border border-card-border rounded-xl p-5 space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Último espelhamento</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                SKU {propagateResult.sku}: {propagateResult.updated} atualizado
                {propagateResult.updated === 1 ? "" : "s"}, {propagateResult.skipped} ignorado
                {propagateResult.skipped === 1 ? "" : "s"}, {propagateResult.failed} falha
                {propagateResult.failed === 1 ? "" : "s"}.
              </p>
            </div>
            <ul className="space-y-1.5 max-h-64 overflow-y-auto">
              {propagateResult.results.map((row) => (
                <li
                  key={`${row.accountId}-${row.mlItemId}`}
                  className="flex items-start justify-between gap-2 text-xs border border-border rounded-lg px-2.5 py-1.5"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-foreground truncate">{row.mlItemId}</p>
                    <p className="text-muted-foreground truncate">
                      {row.accountLabel ?? "Conta"}
                      {row.isFull ? " · Full" : ""}
                    </p>
                    {row.reason ? <p className="text-muted-foreground mt-0.5">{row.reason}</p> : null}
                  </div>
                  <span
                    className={
                      row.status === "updated"
                        ? "text-emerald-700 shrink-0"
                        : row.status === "skipped"
                          ? "text-muted-foreground shrink-0"
                          : "text-destructive shrink-0"
                    }
                  >
                    {row.status === "updated"
                      ? "Atualizado"
                      : row.status === "skipped"
                        ? "Ignorado"
                        : "Falha"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="sticky bottom-0 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 px-4 py-3">
        <div className="max-w-2xl mx-auto flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex-1 space-y-1.5">
            <Label className="text-xs">Conta de destino (novo anúncio)</Label>
            <select
              value={targetAccountId}
              onChange={(e) => setTargetAccountId(e.target.value)}
              disabled={isBusy || !!blocked || accounts.length === 0}
              className="w-full bg-input border border-border text-sm rounded-lg px-3 h-9 text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
            >
              {accounts.length === 0 ? (
                <option value="">Nenhuma conta conectada</option>
              ) : (
                accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.mlNickname ?? a.mlUserId ?? a.id}
                    {a.id === template.sourceAccountId ? " (mesma conta)" : ""}
                  </option>
                ))
              )}
            </select>
          </div>
          <Button
            className="gap-1 sm:min-w-[180px]"
            disabled={isBusy || !!blocked || !targetAccountId}
            onClick={handlePublish}
          >
            {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {lastPublished ? "Publicar outro" : "Publicar anúncio"}
          </Button>
        </div>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir modelo?</AlertDialogTitle>
            <AlertDialogDescription>
              O modelo <strong>{template.name}</strong> será removido. O anúncio original no Mercado
              Livre não será alterado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                deleteTemplate({ id: template.id });
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={propagateOpen} onOpenChange={setPropagateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Espelhar campos marcados?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  Somente as checkboxes marcadas serão aplicadas em{" "}
                  <strong className="text-foreground">{applicableTargets}</strong> anúncio
                  {applicableTargets === 1 ? "" : "s"} com SKU{" "}
                  <span className="font-mono text-foreground">{sku}</span>
                  {skuTargets && skuTargets.full > 0 ? (
                    <>
                      , incluindo <strong className="text-foreground">{skuTargets.full} Full</strong>
                    </>
                  ) : null}
                  . Campos desmarcados permanecem como estão.
                </p>
                {propagatePayload && propagatePayload.attributeIds.length > 0 ? (
                  <p>
                    Atributos:{" "}
                    <span className="font-mono text-foreground">
                      {propagatePayload.attributeIds.join(", ")}
                    </span>
                  </p>
                ) : null}
                {propagatePayload && propagatePayload.saleTermIds.length > 0 ? (
                  <p>
                    Condições de venda:{" "}
                    <span className="font-mono text-foreground">
                      {propagatePayload.saleTermIds.join(", ")}
                    </span>
                  </p>
                ) : null}
                <p>
                  <strong className="text-foreground">Estoque não será alterado</strong>.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={propagating}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={propagating}
              onClick={(e) => {
                e.preventDefault();
                handlePropagate();
              }}
            >
              {propagating ? "Aplicando…" : "Aplicar agora"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
