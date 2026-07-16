import { useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import {
  useGetListingTemplate,
  useListAccounts,
  useDeleteListingTemplate,
  usePublishListingTemplate,
  getGetListingTemplateQueryKey,
  getListListingTemplatesQueryKey,
  getListProductsQueryKey,
  type ListingTemplatePayload,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  LayoutTemplate,
  Package,
  Trash2,
  Upload,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/utils";
import { PublishTemplateDialog } from "./components/PublishTemplateDialog";
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

function attrLabel(attr: { [key: string]: unknown }): string {
  const id = typeof attr.id === "string" ? attr.id : "";
  const value =
    typeof attr.value_name === "string"
      ? attr.value_name
      : typeof attr.valueName === "string"
        ? attr.valueName
        : "—";
  return id ? `${id}: ${value}` : value;
}

function PayloadPreview({ payload }: { payload: ListingTemplatePayload }) {
  const photos = payload.pictureSources?.length
    ? payload.pictureSources
    : [];
  const attributes = payload.attributes ?? [];
  const variations = payload.variations ?? [];

  return (
    <div className="space-y-4">
      {photos.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground mb-2">Fotos ({photos.length})</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {photos.slice(0, 8).map((url, i) => (
              <img
                key={`${url}-${i}`}
                src={url}
                alt=""
                className="w-16 h-16 rounded-lg object-cover bg-muted flex-shrink-0 border border-border"
              />
            ))}
            {photos.length > 8 && (
              <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center text-xs text-muted-foreground flex-shrink-0">
                +{photos.length - 8}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-muted/40 rounded-lg px-3 py-2">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Preço</p>
          <p className="text-sm font-semibold text-foreground">
            {payload.price != null ? formatCurrency(payload.price) : "—"}
          </p>
        </div>
        <div className="bg-muted/40 rounded-lg px-3 py-2">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Estoque</p>
          <p className="text-sm font-semibold text-foreground">
            {payload.availableQuantity ?? "—"}
          </p>
        </div>
        <div className="bg-muted/40 rounded-lg px-3 py-2">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Categoria</p>
          <p className="text-sm font-mono text-foreground truncate">{payload.categoryId ?? "—"}</p>
        </div>
        <div className="bg-muted/40 rounded-lg px-3 py-2">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Tipo</p>
          <p className="text-sm text-foreground truncate">{payload.listingTypeId ?? "—"}</p>
        </div>
      </div>

      {payload.familyName && payload.familyName !== payload.title && (
        <div>
          <p className="text-xs text-muted-foreground mb-1">Família</p>
          <p className="text-sm text-foreground">{payload.familyName}</p>
        </div>
      )}

      {attributes.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground mb-2">
            Atributos ({attributes.length})
          </p>
          <ul className="space-y-1 max-h-40 overflow-y-auto">
            {attributes.slice(0, 20).map((attr, i) => (
              <li
                key={i}
                className="text-xs text-foreground/80 bg-muted/30 rounded px-2 py-1 truncate"
              >
                {attrLabel(attr)}
              </li>
            ))}
            {attributes.length > 20 && (
              <li className="text-[10px] text-muted-foreground px-1">
                +{attributes.length - 20} atributos
              </li>
            )}
          </ul>
        </div>
      )}

      {variations.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground mb-1">
            Variações ({variations.length})
          </p>
          <p className="text-xs text-foreground/80">
            Este modelo inclui variações e será publicado com elas.
          </p>
        </div>
      )}

      {payload.description && (
        <div>
          <p className="text-xs text-muted-foreground mb-1">Descrição</p>
          <p className="text-xs text-foreground/80 whitespace-pre-wrap line-clamp-8 bg-muted/30 rounded-lg px-3 py-2">
            {payload.description}
          </p>
        </div>
      )}
    </div>
  );
}

export default function ListingTemplateDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [publishOpen, setPublishOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [targetAccountId, setTargetAccountId] = useState("");

  const { data, isLoading, isError } = useGetListingTemplate(id, {
    query: { queryKey: getGetListingTemplateQueryKey(id), enabled: !!id },
  });

  const template = data?.data;
  const payload = template?.payload;

  const { data: accountsData } = useListAccounts();
  const accounts =
    (accountsData as { data?: { id: string; mlNickname?: string | null; mlUserId?: string | null }[] } | null)
      ?.data ?? [];

  const sourceAccountLabel = template?.sourceAccountId
    ? (accounts.find((a) => a.id === template.sourceAccountId)?.mlNickname ??
      accounts.find((a) => a.id === template.sourceAccountId)?.mlUserId ??
      "Conta")
    : "Sem conta";

  const blocked = template
    ? publishBlockedReason({ isCatalog: template.isCatalog, isFull: template.isFull })
    : null;

  const { mutate: publishTemplate, isPending: publishing } = usePublishListingTemplate({
    mutation: {
      onSuccess: (res) => {
        queryClient.invalidateQueries({ queryKey: getListProductsQueryKey({}) });
        setPublishOpen(false);
        toast({
          title: "Anúncio publicado",
          description: `Novo anúncio ${res.data.mlItemId} criado com sucesso.`,
        });
        navigate(`/products/${res.data.productId}`);
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

  if (isLoading) {
    return (
      <div className="h-full overflow-y-auto bg-background p-6 space-y-3">
        <div className="h-5 w-24 bg-muted rounded animate-pulse" />
        <div className="h-40 bg-card border border-card-border rounded-xl animate-pulse" />
      </div>
    );
  }

  if (isError || !template || !payload) {
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

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="p-6 space-y-4 max-w-2xl mx-auto">
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
                    size="sm"
                    className="h-7 text-xs gap-1"
                    disabled={!!blocked}
                    onClick={() => {
                      setTargetAccountId(template.sourceAccountId ?? accounts[0]?.id ?? "");
                      setPublishOpen(true);
                    }}
                  >
                    <Upload className="w-3.5 h-3.5" />
                    Publicar
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
                {template.condition && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-md border bg-muted/50 text-muted-foreground">
                    {template.condition === "used" ? "Usado" : "Novo"}
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

        <div className="bg-card border border-card-border rounded-xl p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">Campos do modelo</h2>
          <PayloadPreview payload={payload} />
        </div>
      </div>

      <PublishTemplateDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        templateName={template.name}
        sourceMlItemId={template.sourceMlItemId}
        sourceAccountId={template.sourceAccountId}
        accounts={accounts}
        targetAccountId={targetAccountId}
        onTargetAccountChange={setTargetAccountId}
        isPending={publishing}
        blockedReason={blocked}
        onConfirm={() => {
          if (!targetAccountId) return;
          publishTemplate({ id: template.id, data: { targetAccountId } });
        }}
      />

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
