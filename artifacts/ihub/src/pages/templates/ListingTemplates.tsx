import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  useListListingTemplates,
  useListAccounts,
  useSyncListingTemplates,
  useDeleteListingTemplate,
  getListListingTemplatesQueryKey,
  type ListingTemplate,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  LayoutTemplate,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  Eye,
  Package,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
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

function publishBlockedReason(t: ListingTemplate): string | null {
  if (t.isCatalog) {
    return "Modelos de catálogo compartilhado não podem ser publicados automaticamente.";
  }
  if (t.isFull) {
    return "Modelos Full (Fulfillment) não podem ser publicados automaticamente.";
  }
  return null;
}

function TemplateCard({
  template,
  accountLabel,
  onDelete,
}: {
  template: ListingTemplate;
  accountLabel: string;
  onDelete: () => void;
}) {
  const blocked = publishBlockedReason(template);

  return (
    <article className="bg-card border border-card-border rounded-xl px-3 py-2.5 hover:border-primary/40 transition-all">
      <div className="flex items-start gap-3">
        {template.thumbnail ? (
          <img
            src={template.thumbnail}
            alt=""
            className="w-12 h-12 rounded-lg object-cover bg-muted flex-shrink-0"
          />
        ) : (
          <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
            <Package className="w-5 h-5 text-muted-foreground/40" />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <Link
                href={`/listing-templates/${template.id}`}
                className="text-sm font-semibold text-foreground hover:text-primary line-clamp-2 leading-snug"
              >
                {template.name}
              </Link>
              <p className="text-[10px] font-mono text-muted-foreground mt-0.5 truncate">
                {template.sourceMlItemId}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{accountLabel}</p>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                title="Editar e publicar"
                asChild
              >
                <Link href={`/listing-templates/${template.id}`}>
                  <Eye className="w-3.5 h-3.5" />
                </Link>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                title={blocked ?? "Editar e publicar"}
                disabled={!!blocked}
                asChild={!blocked}
              >
                {blocked ? (
                  <span>
                    <Upload className="w-3.5 h-3.5" />
                  </span>
                ) : (
                  <Link href={`/listing-templates/${template.id}`}>
                    <Upload className="w-3.5 h-3.5" />
                  </Link>
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                title="Excluir modelo"
                onClick={onDelete}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-1 mt-2">
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
        </div>
      </div>
    </article>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-card border border-card-border rounded-xl px-3 py-2.5 animate-pulse flex gap-3">
      <div className="w-12 h-12 rounded-lg bg-muted flex-shrink-0" />
      <div className="flex-1 space-y-2 py-1">
        <div className="h-4 bg-muted rounded w-3/4" />
        <div className="h-3 bg-muted rounded w-1/3" />
      </div>
    </div>
  );
}

export default function ListingTemplates() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [accountId, setAccountId] = useState("all");
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<ListingTemplate | null>(null);

  const params = {
    page,
    limit: 20,
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(accountId !== "all" ? { account_id: accountId } : {}),
  };

  const { data, isLoading, isError, error, isFetching } = useListListingTemplates(params, {
    query: { queryKey: getListListingTemplatesQueryKey(params) },
  });

  const { data: accountsData } = useListAccounts();
  const accounts =
    (accountsData as { data?: { id: string; mlNickname?: string | null; mlUserId?: string | null }[] } | null)
      ?.data ?? [];

  const accountLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of accounts) {
      map.set(a.id, a.mlNickname ?? a.mlUserId ?? a.id.slice(0, 8));
    }
    return map;
  }, [accounts]);

  const templates = data?.data ?? [];
  const pagination = data?.pagination;
  const total = pagination?.total ?? templates.length;

  const { mutate: syncTemplates, isPending: syncing } = useSyncListingTemplates({
    mutation: {
      onSuccess: () => {
        toast({
          title: "Sincronização iniciada",
          description: "Os modelos serão atualizados em segundo plano. Atualize a lista em breve.",
        });
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: getListListingTemplatesQueryKey({}) });
        }, 3000);
      },
      onError: (err: Error & { payload?: { error?: { message?: string } } }) => {
        toast({
          variant: "destructive",
          title: "Erro ao sincronizar",
          description: err.payload?.error?.message ?? err.message ?? "Não foi possível sincronizar.",
        });
      },
    },
  });

  const { mutate: deleteTemplate, isPending: deleting } = useDeleteListingTemplate({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListListingTemplatesQueryKey({}) });
        setDeleteTarget(null);
        toast({ title: "Modelo excluído", description: "O modelo de anúncio foi removido." });
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

  return (
    <div className="h-full flex flex-col overflow-hidden bg-background">
      <div className="sticky top-0 z-10 bg-background border-b border-border flex-shrink-0 px-4 py-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-base font-bold text-foreground">Modelos de anúncio</h1>
            <p className="text-muted-foreground text-xs">
              {total} modelo{total === 1 ? "" : "s"} encontrado{total === 1 ? "" : "s"}
              {isFetching && !isLoading ? " · atualizando…" : ""}
            </p>
          </div>
          <Button
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => syncTemplates()}
            disabled={syncing}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
            Sincronizar
          </Button>
        </div>

        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(searchInput.trim());
            setPage(1);
          }}
        >
          <div className="relative flex-1 min-w-[160px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Buscar por título ou MLB…"
              className="h-8 pl-8 text-xs"
            />
          </div>
          <select
            value={accountId}
            onChange={(e) => {
              setAccountId(e.target.value);
              setPage(1);
            }}
            className="bg-input border border-border text-xs rounded-lg px-2 h-8 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="all">Todas as contas</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.mlNickname ?? a.mlUserId ?? a.id}
              </option>
            ))}
          </select>
          <Button type="submit" variant="secondary" size="sm" className="h-8 text-xs">
            Buscar
          </Button>
        </form>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {isLoading && (
          <>
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </>
        )}

        {isError && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
            Não foi possível carregar os modelos.
            {error instanceof Error && (
              <p className="text-xs mt-1 text-red-600/80">{error.message}</p>
            )}
          </div>
        )}

        {!isLoading && !isError && templates.length === 0 && (
          <div className="bg-card border border-card-border rounded-xl p-10 text-center">
            <LayoutTemplate className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-foreground font-medium">Nenhum modelo encontrado</p>
            <p className="text-muted-foreground text-sm mt-1 max-w-sm mx-auto">
              {search || accountId !== "all"
                ? "Tente ajustar os filtros ou a busca."
                : "Sincronize as contas para importar anúncios existentes como modelos."}
            </p>
            {!search && accountId === "all" && (
              <Button
                size="sm"
                className="mt-4 gap-1"
                onClick={() => syncTemplates()}
                disabled={syncing}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
                Sincronizar modelos
              </Button>
            )}
          </div>
        )}

        {!isLoading &&
          !isError &&
          templates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              accountLabel={
                template.sourceAccountId
                  ? (accountLabelById.get(template.sourceAccountId) ?? "Conta desconectada")
                  : "Sem conta"
              }
              onDelete={() => setDeleteTarget(template)}
            />
          ))}

        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between pt-2 pb-4">
            <p className="text-xs text-muted-foreground">
              Página {pagination.page} de {pagination.totalPages}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={page >= pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Próxima
              </Button>
            </div>
          </div>
        )}
      </div>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir modelo?</AlertDialogTitle>
            <AlertDialogDescription>
              O modelo <strong>{deleteTarget?.name}</strong> será removido. O anúncio original no
              Mercado Livre não será alterado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                if (!deleteTarget) return;
                deleteTemplate({ id: deleteTarget.id });
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
