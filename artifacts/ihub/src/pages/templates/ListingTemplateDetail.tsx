import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import {
  useGetListingTemplate,
  useListAccounts,
  useDeleteListingTemplate,
  usePublishListingTemplate,
  getGetListingTemplateQueryKey,
  getListListingTemplatesQueryKey,
  getListProductsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ExternalLink,
  LayoutTemplate,
  Loader2,
  Package,
  RotateCcw,
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

function publishBlockedReason(flags: {
  isCatalog: boolean;
  isFull: boolean;
}): string | null {
  if (flags.isCatalog) {
    return "Modelos de catálogo compartilhado não podem ser publicados automaticamente.";
  }
  if (flags.isFull) {
    return "Modelos Full (Fulfillment) não podem ser publicados automaticamente.";
  }
  return null;
}

export default function ListingTemplateDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [targetAccountId, setTargetAccountId] = useState("");
  const [form, setForm] = useState<EditableTemplateForm | null>(null);
  const [formReadyForId, setFormReadyForId] = useState<string | null>(null);
  const [publishedListings, setPublishedListings] = useState<PublishedListingRef[]>([]);

  const { data, isLoading, isError } = useGetListingTemplate(id, {
    query: { queryKey: getGetListingTemplateQueryKey(id), enabled: !!id },
  });

  const template = data?.data;
  const payload = template?.payload;

  useEffect(() => {
    if (!template?.id || !payload) return;
    if (formReadyForId === template.id) return;
    setForm(payloadToForm(payload));
    setFormReadyForId(template.id);
    setPublishedListings([]);
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
    ? publishBlockedReason({ isCatalog: template.isCatalog, isFull: template.isFull })
    : null;

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
                  </p>
                  <p className="text-muted-foreground text-xs mt-0.5">{sourceAccountLabel}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1"
                    onClick={resetFormFromTemplate}
                    disabled={publishing}
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
              </div>

              {blocked && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mt-3">
                  {blocked}
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
                Edite livremente antes de publicar. As alterações valem para esta publicação.
              </p>
            </div>
          </div>
          <TemplatePayloadEditor form={form} onChange={setForm} disabled={publishing} />
          {template.hasVariations && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mt-4">
              Este modelo tem variações: elas serão enviadas junto com os campos editados acima.
            </p>
          )}
        </div>
      </div>

      <div className="sticky bottom-0 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 px-4 py-3">
        <div className="max-w-2xl mx-auto flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex-1 space-y-1.5">
            <Label className="text-xs">Conta de destino</Label>
            <select
              value={targetAccountId}
              onChange={(e) => setTargetAccountId(e.target.value)}
              disabled={publishing || !!blocked || accounts.length === 0}
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
            disabled={publishing || !!blocked || !targetAccountId}
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
    </div>
  );
}
