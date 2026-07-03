import type { N8nListingDraft } from "@workspace/api-client-react";
import { AlertTriangle, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { MLB_LISTING_TYPES, LISTING_CONDITIONS } from "./listing-constants";
import {
  removeDraftPicture,
  updateDraftAttributeValue,
  updateDraftDescription,
  updateDraftPayload,
} from "./n8n-listing-types";

type N8nListingReviewFormProps = {
  draft: N8nListingDraft;
  onDraftChange: (draft: N8nListingDraft) => void;
};

export function N8nListingReviewForm({ draft, onDraftChange }: N8nListingReviewFormProps) {
  const { payload } = draft;
  const pendingCount = draft._attributes_ainda_pendentes?.length ?? 0;
  const fictitious = draft._attributes_ficticios ?? [];
  const intelligent = draft._attributes_preenchidos_inteligente ?? [];

  const selectCls =
    "w-full bg-input border border-border text-sm rounded-lg px-3 h-9 text-foreground focus:outline-none focus:ring-1 focus:ring-primary";

  return (
    <div className="space-y-5">
      {pendingCount > 0 ? (
        <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">{pendingCount} atributo(s) ainda pendente(s)</p>
            <p className="mt-0.5 text-amber-700">Revise os campos abaixo antes de publicar.</p>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
        {draft._asin ? (
          <div>
            <span className="font-medium text-foreground">ASIN:</span> {draft._asin}
          </div>
        ) : null}
        <div>
          <span className="font-medium text-foreground">Categoria ML:</span> {payload.category_id}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Nome da família do produto</Label>
        <Input
          value={payload.family_name}
          onChange={(e) => onDraftChange(updateDraftPayload(draft, { family_name: e.target.value }))}
          className="h-9"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Preço (R$)</Label>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={payload.price ?? ""}
            onChange={(e) =>
              onDraftChange(
                updateDraftPayload(draft, {
                  price: e.target.value === "" ? undefined : Number(e.target.value),
                }),
              )
            }
            className="h-9"
          />
          {payload.price != null ? (
            <p className="text-[11px] text-muted-foreground">{formatCurrency(payload.price)}</p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label>Estoque</Label>
          <Input
            type="number"
            min={0}
            value={payload.available_quantity}
            onChange={(e) =>
              onDraftChange(
                updateDraftPayload(draft, {
                  available_quantity: Number(e.target.value) || 0,
                }),
              )
            }
            className="h-9"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Condição</Label>
          <select
            value={payload.condition}
            onChange={(e) =>
              onDraftChange(
                updateDraftPayload(draft, {
                  condition: e.target.value as "new" | "used",
                }),
              )
            }
            className={selectCls}
          >
            {LISTING_CONDITIONS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>Tipo de anúncio</Label>
          <select
            value={payload.listing_type_id}
            onChange={(e) =>
              onDraftChange(updateDraftPayload(draft, { listing_type_id: e.target.value }))
            }
            className={selectCls}
          >
            {MLB_LISTING_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Fotos ({payload.pictures.length})</Label>
        <div className="flex flex-wrap gap-2">
          {payload.pictures.map((pic, index) => (
            <div key={`${pic.source}-${index}`} className="relative group">
              <img
                src={pic.source}
                alt=""
                className="size-20 rounded-lg object-cover border border-border"
              />
              <Button
                type="button"
                variant="destructive"
                size="icon"
                className="absolute -top-2 -right-2 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => onDraftChange(removeDraftPicture(draft, index))}
              >
                <X className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>
        {payload.pictures.length === 0 ? (
          <p className="text-[11px] text-destructive">Adicione ao menos uma foto antes de publicar.</p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label>Descrição</Label>
        <textarea
          value={draft._description ?? ""}
          onChange={(e) => onDraftChange(updateDraftDescription(draft, e.target.value))}
          rows={6}
          className="w-full bg-input border border-border text-sm rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-y min-h-[120px]"
          placeholder="Descrição do anúncio…"
        />
      </div>

      {fictitious.length > 0 ? (
        <div className="space-y-3">
          <div>
            <Label>Revisar atributos</Label>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Atributos preenchidos automaticamente que podem precisar de ajuste.
            </p>
          </div>
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {fictitious.map((attr) => (
              <div key={attr.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-2 items-center">
                <span className="text-xs text-muted-foreground truncate" title={attr.name}>
                  {attr.name}
                </span>
                <Input
                  value={attr.valor.value_name ?? ""}
                  onChange={(e) =>
                    onDraftChange(
                      updateDraftAttributeValue(draft, attr.id, { value_name: e.target.value }),
                    )
                  }
                  className="h-8 text-xs"
                />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {intelligent.length > 0 ? (
        <div className="space-y-2">
          <Label>Atributos preenchidos automaticamente</Label>
          <div className="rounded-lg border border-border bg-muted/30 divide-y divide-border max-h-48 overflow-y-auto">
            {intelligent.map((attr) => (
              <div
                key={attr.id}
                className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
              >
                <span className="text-muted-foreground">{attr.name}</span>
                <span className="font-medium text-foreground truncate">
                  {attr.valor.value_name ?? "—"}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
