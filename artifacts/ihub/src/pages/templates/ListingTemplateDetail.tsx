import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import {
  useGetListingTemplate,
  useListAccounts,
  useDeleteListingTemplate,
  usePublishListingTemplate,
  usePropagateListingTemplate,
  getGetListingTemplateQueryKey,
  getListListingTemplatesQueryKey,
  getListProductsQueryKey,
  PropagateListingTemplateField,
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
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { type PublishedListingRef } from "./components/PublishTemplateDialog";
import {
  TemplatePayloadEditor,
  formToPublishOverrides,
  payloadToForm,
  type EditableTemplateForm,
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

const PROPAGATE_FIELD_OPTIONS: Array<{
  id: (typeof PropagateListingTemplateField)[keyof typeof PropagateListingTemplateField];
  label: string;
  hint: string;
}> = [
  { id: PropagateListingTemplateField.title, label: "Título / família", hint: "Título ou family_name" },
  { id: PropagateListingTemplateField.pictures, label: "Fotos", hint: "URLs públicas" },
  { id: PropagateListingTemplateField.description, label: "Descrição", hint: "Texto do anúncio" },
  { id: PropagateListingTemplateField.attributes, label: "Atributos", hint: "Marca, modelo, etc." },
  { id: PropagateListingTemplateField.saleTerms, label: "Garantia", hint: "Condições de venda" },
  { id: PropagateListingTemplateField.price, label: "Preço", hint: "Não aplica em variações" },
  { id: PropagateListingTemplateField.videoId, label: "Video Clip", hint: "Pode falhar em outra conta" },
];

const DEFAULT_PROPAGATE_FIELDS = [
  PropagateListingTemplateField.title,
  PropagateListingTemplateField.pictures,
  PropagateListingTemplateField.description,
  PropagateListingTemplateField.attributes,
] as const;

function publishBlockedReason(flags: {
  isCatalog: boolean;
}): string | null {
  if (flags.isCatalog) {
    return "Modelos de catálogo compartilhado não podem ser publicados automaticamente.";
  }
  return null;
}

function sameAttrList(
  a: Array<{ id: string; value_name: string; value_id?: string }>,
  b: Array<{ id?: unknown; value_name?: unknown; value_id?: unknown }> | undefined,
): boolean {
  const norm = (rows: Array<{ id?: unknown; value_name?: unknown; value_id?: unknown }> | undefined) =>
    JSON.stringify(
      (rows ?? [])
        .map((r) => ({
          id: String(r.id ?? ""),
          value_name: String(r.value_name ?? "").trim(),
          value_id: typeof r.value_id === "string" ? r.value_id : "",
        }))
        .filter((r) => r.id),
    );
  return norm(a) === norm(b);
}

function changedPropagateFields(
  form: EditableTemplateForm,
  payload: {
    title?: string;
    familyName?: string;
    price?: number;
    description?: string;
    pictureSources?: string[];
    attributes?: Array<{ [key: string]: unknown }>;
    saleTerms?: Array<{ [key: string]: unknown }>;
    videoId?: string | null;
  },
): Array<(typeof PropagateListingTemplateField)[keyof typeof PropagateListingTemplateField]> {
  const changed: Array<(typeof PropagateListingTemplateField)[keyof typeof PropagateListingTemplateField]> =
    [];
  const origForm = payloadToForm(payload);
  if (form.title.trim() !== origForm.title.trim() || form.familyName.trim() !== origForm.familyName.trim()) {
    changed.push(PropagateListingTemplateField.title);
  }
  if (form.price !== origForm.price) changed.push(PropagateListingTemplateField.price);
  if (JSON.stringify(form.pictureSources) !== JSON.stringify(origForm.pictureSources)) {
    changed.push(PropagateListingTemplateField.pictures);
  }
  if (form.description.trim() !== origForm.description.trim()) {
    changed.push(PropagateListingTemplateField.description);
  }
  if (!sameAttrList(form.attributes, origForm.attributes)) {
    changed.push(PropagateListingTemplateField.attributes);
  }
  if (!sameAttrList(form.saleTerms, origForm.saleTerms)) {
    changed.push(PropagateListingTemplateField.saleTerms);
  }
  if (form.videoId.trim() !== origForm.videoId.trim()) {
    changed.push(PropagateListingTemplateField.videoId);
  }
  return changed;
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
  const [selectedFields, setSelectedFields] = useState<string[]>([...DEFAULT_PROPAGATE_FIELDS]);
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
    setSelectedFields([...DEFAULT_PROPAGATE_FIELDS]);
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

  const blocked = template
    ? publishBlockedReason({ isCatalog: template.isCatalog })
    : null;

  const liveChangedFields = useMemo(
    () => (form && payload ? changedPropagateFields(form, payload) : []),
    [form, payload],
  );

  const resetFormFromTemplate = () => {
    if (!payload) return;
    setForm(payloadToForm(payload));
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

  const busyNote = (publishing: boolean, propagating: boolean) => publishing || propagating;

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
    if (!template || !form) return;
    if (!sku) {
      toast({
        variant: "destructive",
        title: "SKU ausente",
        description: "Sincronize o anúncio de origem para obter o SKU.",
      });
      return;
    }
    if (selectedFields.length === 0) {
      toast({
        variant: "destructive",
        title: "Selecione campos",
        description: "Marque ao menos um campo para espelhar. Estoque nunca é enviado.",
      });
      return;
    }
    propagateTemplate({
      id: template.id,
      data: {
        fields: selectedFields as Array<
          (typeof PropagateListingTemplateField)[keyof typeof PropagateListingTemplateField]
        >,
        overrides: formToPublishOverrides(form),
      },
    });
  };

  const toggleField = (fieldId: string, checked: boolean) => {
    setSelectedFields((prev) =>
      checked ? (prev.includes(fieldId) ? prev : [...prev, fieldId]) : prev.filter((f) => f !== fieldId),
    );
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
  const isBusy = busyNote(publishing, propagating);
  const applicableTargets = skuTargets
    ? skuTargets.full + skuTargets.traditional
    : 0;

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
                  <h1 className="text-lg font-bold text-foreground leading-tight">
                    {template.name}
                  </h1>
                  <p className="text-muted-foreground text-xs mt-1 font-mono">
                    {template.sourceMlItemId}
                    {sku ? ` · SKU ${sku}` : ""}
                  </p>
                  <p className="text-muted-foreground text-xs mt-0.5">{sourceAccountLabel}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
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
                  <strong>tradicional</strong> (sem Fulfillment), com os mesmos dados editáveis abaixo.
                  O espelhamento por SKU, porém, <strong>também atualiza os Full</strong> existentes.
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
                sessão — edite os campos abaixo e publique outro quando quiser.
              </p>
            </div>
            <Button variant="outline" size="sm" className="h-7 text-xs" asChild>
              <Link href={`/products/${lastPublished.productId}`}>Abrir anúncio</Link>
            </Button>
          </div>
        )}

        <div className="bg-card border border-card-border rounded-xl p-5">
          <div className="flex items-center justify-between gap-2 mb-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Campos do anúncio</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Edite os valores e escolha, abaixo, quais campos espelhar nos anúncios do mesmo SKU.
              </p>
            </div>
          </div>
          <TemplatePayloadEditor form={form} onChange={setForm} disabled={isBusy} />
          {template.hasVariations && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mt-4">
              Este modelo tem variações clássicas: elas serão enviadas junto com os campos acima.
              Na publicação, <span className="font-mono">UNITS_PER_PACK</span> é forçado para{" "}
              <strong>1</strong> (venda por unidade). Se o anúncio de origem for uma família User
              Products (pai + filhos MLB separados), publique o modelo de cada filho — republicar
              o pai não recria os irmãos.
            </p>
          )}
        </div>

        <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Espelhar por SKU (Mercado Livre)</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Aplica os campos marcados em todos os anúncios ML com o mesmo SKU, em todas as contas,
              <strong> inclusive Full</strong>. Estoque nunca é alterado.
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {PROPAGATE_FIELD_OPTIONS.map((field) => {
              const checked = selectedFields.includes(field.id);
              const edited = liveChangedFields.includes(field.id);
              return (
                <label
                  key={field.id}
                  className="flex items-start gap-2 rounded-lg border border-border px-3 py-2 cursor-pointer hover:bg-muted/40"
                >
                  <Checkbox
                    checked={checked}
                    disabled={isBusy}
                    onCheckedChange={(value) => toggleField(field.id, value === true)}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="text-sm text-foreground">
                      {field.label}
                      {edited ? (
                        <span className="ml-1.5 text-[10px] text-primary font-medium">alterado</span>
                      ) : null}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">{field.hint}</span>
                  </span>
                </label>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={isBusy}
              onClick={() => setSelectedFields(PROPAGATE_FIELD_OPTIONS.map((f) => f.id))}
            >
              Marcar todos
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={isBusy || liveChangedFields.length === 0}
              onClick={() => setSelectedFields(liveChangedFields)}
            >
              Só campos alterados
            </Button>
          </div>

          <Button
            className="gap-1 w-full sm:w-auto"
            disabled={isBusy || !sku || selectedFields.length === 0 || applicableTargets === 0}
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
                    {row.reason ? (
                      <p className="text-muted-foreground mt-0.5">{row.reason}</p>
                    ) : null}
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
            {publishing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Upload className="w-4 h-4" />
            )}
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
            <AlertDialogTitle>Espelhar campos nos anúncios do SKU?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  Os campos marcados serão aplicados em{" "}
                  <strong className="text-foreground">{applicableTargets}</strong> anúncio
                  {applicableTargets === 1 ? "" : "s"} Mercado Livre com SKU{" "}
                  <span className="font-mono text-foreground">{sku}</span>
                  {skuTargets && skuTargets.full > 0 ? (
                    <>
                      , incluindo <strong className="text-foreground">{skuTargets.full} Full</strong>
                    </>
                  ) : null}
                  .
                </p>
                <p>
                  <strong className="text-foreground">Estoque não será alterado</strong> em nenhum
                  anúncio.
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
