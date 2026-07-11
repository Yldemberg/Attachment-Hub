import { useState } from "react";
import {
  useListCriticalAds,
  type CriticalAd,
} from "@workspace/api-client-react";
import { AlertTriangle, ExternalLink, Search, Store } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 border-emerald-200",
  paused: "bg-amber-50 text-amber-700 border-amber-200",
  closed: "bg-slate-100 text-slate-500 border-slate-200",
  under_review: "bg-blue-50 text-blue-700 border-blue-200",
};

function statusBadgeClass(status: string | null | undefined): string {
  if (!status) return "bg-slate-100 text-slate-600 border-slate-200";
  const key = status.toLowerCase().replace(/\s+/g, "_");
  return STATUS_COLORS[key] ?? "bg-red-50 text-red-600 border-red-200";
}

function CriticalAdCard({ ad }: { ad: CriticalAd }) {
  return (
    <article className="bg-card border border-card-border rounded-xl p-4 hover:border-primary/40 hover:shadow-sm transition-all">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="size-9 rounded-lg bg-red-50 border border-red-200 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-4 h-4 text-red-600" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-muted-foreground text-xs mb-0.5">
              <Store className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{ad.nomeLoja ?? "Loja não informada"}</span>
            </div>
            <h3 className="text-foreground text-sm font-semibold leading-snug line-clamp-2">
              {ad.titulo ?? "Sem título"}
            </h3>
          </div>
        </div>
        {ad.status && (
          <span
            className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md border flex-shrink-0 ${statusBadgeClass(ad.status)}`}
          >
            {ad.status}
          </span>
        )}
      </div>

      {ad.problemas && (
        <div className="bg-red-50/60 border border-red-100 rounded-lg px-3 py-2 mb-3">
          <p className="text-[10px] font-medium text-red-700 mb-0.5 uppercase tracking-wide">Problemas</p>
          <p className="text-foreground/80 text-sm leading-relaxed whitespace-pre-wrap">{ad.problemas}</p>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
        <div className="bg-muted/40 rounded-lg px-2.5 py-2">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Tipo de envio</p>
          <p className="text-sm font-medium text-foreground truncate">{ad.tipoEnvio ?? "—"}</p>
        </div>
        <div className="bg-muted/40 rounded-lg px-2.5 py-2">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Faltas relevância</p>
          <p className="text-sm font-medium text-foreground">{ad.faltasRelevancia ?? "—"}</p>
        </div>
        <div className="bg-muted/40 rounded-lg px-2.5 py-2 col-span-2 sm:col-span-1">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Dias sem vender</p>
          <p className="text-sm font-medium text-foreground">
            {ad.diasSemVend ?? "—"}
          </p>
        </div>
      </div>

      {ad.permalink && (
        <a
          href={ad.permalink}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-primary font-medium hover:underline"
        >
          <ExternalLink className="w-3 h-3 flex-shrink-0" />
          Ver anúncio no Mercado Livre
        </a>
      )}
    </article>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-card border border-card-border rounded-xl p-4 animate-pulse">
      <div className="flex gap-3 mb-3">
        <div className="size-9 rounded-lg bg-muted" />
        <div className="flex-1 space-y-2">
          <div className="h-3 bg-muted rounded w-1/3" />
          <div className="h-4 bg-muted rounded w-full" />
        </div>
      </div>
      <div className="h-16 bg-muted rounded-lg mb-3" />
      <div className="grid grid-cols-3 gap-2">
        <div className="h-12 bg-muted rounded-lg" />
        <div className="h-12 bg-muted rounded-lg" />
        <div className="h-12 bg-muted rounded-lg" />
      </div>
    </div>
  );
}

export default function CriticalAds() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, error } = useListCriticalAds({
    search: search || undefined,
    page,
    limit: 20,
  });

  const ads = data?.data ?? [];
  const pagination = data?.pagination;

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="p-6 space-y-6 max-w-5xl mx-auto">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Anúncios Críticos</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Diagnósticos de anúncios com problemas no Mercado Livre
          </p>
        </div>

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(searchInput.trim());
            setPage(1);
          }}
        >
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Buscar por loja, título ou problema..."
              className="pl-9"
            />
          </div>
          <Button type="submit" variant="secondary">
            Buscar
          </Button>
        </form>

        {isLoading && (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        )}

        {isError && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
            Não foi possível carregar os anúncios críticos.
            {error instanceof Error && (
              <p className="text-xs mt-1 text-red-600/80">{error.message}</p>
            )}
          </div>
        )}

        {!isLoading && !isError && ads.length === 0 && (
          <div className="bg-card border border-card-border rounded-xl p-10 text-center">
            <AlertTriangle className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-foreground font-medium">Nenhum anúncio crítico encontrado</p>
            <p className="text-muted-foreground text-sm mt-1">
              {search ? "Tente ajustar os termos da busca." : "Os dados aparecerão aqui quando a tabela estiver conectada."}
            </p>
          </div>
        )}

        {!isLoading && !isError && ads.length > 0 && (
          <>
            <div className="space-y-3">
              {ads.map((ad) => (
                <CriticalAdCard key={ad.itemId} ad={ad} />
              ))}
            </div>

            {pagination && pagination.totalPages > 1 && (
              <div className="flex items-center justify-between pt-2">
                <p className="text-xs text-muted-foreground">
                  {pagination.total} anúncio{pagination.total !== 1 ? "s" : ""} · página {pagination.page} de {pagination.totalPages}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Anterior
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= pagination.totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Próxima
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
