import type { IhubUiCampo, IhubUiSecao, N8nListingDraft } from "@workspace/api-client-react";
import { AlertTriangle, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { MLB_LISTING_TYPES, LISTING_CONDITIONS } from "./listing-constants";
import {
  formatMlValidationMessage,
  getBlockingMlValidationErrors,
  getCampoDisplayValue,
  getIhubUiSecoes,
  getMlValidationWarnings,
  getPendingRequiredIhubUiCampos,
  getRequiredAttributeIdsFromMlErrors,
  removeDraftPicture,
  updateDraftAttributeValue,
  updateDraftDescription,
  updateDraftIhubUiCampo,
  updateDraftPayload,
} from "./n8n-listing-types";

type N8nListingReviewFormProps = {
  draft: N8nListingDraft;
  onDraftChange: (draft: N8nListingDraft) => void;
  jobNeedsReview?: boolean;
};

const ATTR_LABELS: Record<string, string> = {
  UNITS_PER_PACK: "Unidades por kit",
};

function sectionStatusLabel(status: IhubUiSecao["status"]): string {
  if (status === "pendente") return "Pendente";
  if (status === "somente_leitura") return "Somente leitura";
  return "Completo";
}

function IhubUiCampoInput({
  campo,
  draft,
  onDraftChange,
}: {
  campo: IhubUiCampo;
  draft: N8nListingDraft;
  onDraftChange: (draft: N8nListingDraft) => void;
}) {
  const value = getCampoDisplayValue(campo, draft);
  const disabled = Boolean(campo.somente_leitura);
  const selectCls =
    "w-full bg-input border border-border text-sm rounded-lg px-3 h-9 text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60";

  const applyValue = (next: { value_name?: string; value_id?: string | null }) => {
    onDraftChange(updateDraftIhubUiCampo(draft, campo, next));
  };

  return (
    <div className="space-y-1.5">
      <Label className="text-sm">
        {campo.label}
        {campo.obrigatorio ? <span className="text-destructive ml-0.5">*</span> : null}
      </Label>
      {campo.hint ? <p className="text-[11px] text-muted-foreground">{campo.hint}</p> : null}

      {campo.tipo === "textarea" || campo.destino_payload === "description" ? (
        <textarea
          value={value}
          disabled={disabled}
          rows={5}
          onChange={(e) => applyValue({ value_name: e.target.value })}
          className="w-full bg-input border border-border text-sm rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-y min-h-[100px] disabled:opacity-60"
        />
      ) : campo.tipo === "boolean" ? (
        <select
          value={value || ""}
          disabled={disabled}
          onChange={(e) => applyValue({ value_name: e.target.value, value_id: e.target.value })}
          className={selectCls}
        >
          <option value="">Selecione…</option>
          <option value="true">Sim</option>
          <option value="false">Não</option>
        </select>
      ) : campo.tipo === "select" || (campo.opcoes && campo.opcoes.length > 0) ? (
        <select
          value={value}
          disabled={disabled}
          onChange={(e) => {
            const selected = campo.opcoes?.find(
              (opt) => opt.name === e.target.value || opt.id === e.target.value,
            );
            applyValue({
              value_name: selected?.name ?? e.target.value,
              value_id: selected?.id ?? null,
            });
          }}
          className={selectCls}
        >
          <option value="">Selecione…</option>
          {(campo.opcoes ?? []).map((opt) => (
            <option key={opt.id} value={opt.name}>
              {opt.name}
            </option>
          ))}
        </select>
      ) : (
        <Input
          type={campo.tipo === "number" ? "number" : "text"}
          value={value}
          disabled={disabled}
          onChange={(e) => applyValue({ value_name: e.target.value })}
          className="h-9"
        />
      )}
    </div>
  );
}

export function N8nListingReviewForm({
  draft,
  onDraftChange,
  jobNeedsReview = false,
}: N8nListingReviewFormProps) {
  const { payload } = draft;
  const secoes = getIhubUiSecoes(draft);
  const hasIhubUi = secoes.length > 0;
  const pendingRequired = getPendingRequiredIhubUiCampos(draft);
  const pendingCount = hasIhubUi
    ? pendingRequired.length
    : (draft._attributes_ainda_pendentes?.length ?? 0);
  const fictitious = draft._attributes_ficticios ?? [];
  const intelligent = draft._attributes_preenchidos_inteligente ?? [];
  const blockingErrors = getBlockingMlValidationErrors(draft);
  const warnings = getMlValidationWarnings(draft);
  const requiredFromMl = getRequiredAttributeIdsFromMlErrors(draft).filter((id) => {
    const current = payload.attributes.find((a) => a.id === id);
    return !(current?.value_name?.trim() || current?.value_id);
  });
  const readyToPublish =
    blockingErrors.length === 0 && pendingCount === 0 && requiredFromMl.length === 0;

  const selectCls =
    "w-full bg-input border border-border text-sm rounded-lg px-3 h-9 text-foreground focus:outline-none focus:ring-1 focus:ring-primary";

  return (
    <div className="space-y-5">
      {jobNeedsReview ||
      pendingCount > 0 ||
      blockingErrors.length > 0 ||
      requiredFromMl.length > 0 ? (
        <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">
              {blockingErrors.length > 0 || requiredFromMl.length > 0
                ? "Corrija os erros abaixo antes de publicar"
                : jobNeedsReview
                  ? "Revisão necessária antes de publicar"
                  : `${pendingCount} campo(s) obrigatório(s) pendente(s)`}
            </p>
            <p className="mt-0.5 text-amber-700">
              Avisos do Mercado Livre não bloqueiam a publicação; apenas erros reais.
            </p>
          </div>
        </div>
      ) : null}

      {blockingErrors.length > 0 ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive space-y-1">
          {blockingErrors.map((err, index) => (
            <p key={index}>{formatMlValidationMessage(err)}</p>
          ))}
        </div>
      ) : null}

      {warnings.length > 0 ? (
        <details className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer font-medium text-foreground">
            {warnings.length} aviso(s) do Mercado Livre (não bloqueiam)
          </summary>
          <ul className="mt-2 space-y-1 list-disc pl-4">
            {warnings.map((w, index) => (
              <li key={index}>{formatMlValidationMessage(w)}</li>
            ))}
          </ul>
        </details>
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
        <div>
          <span className="font-medium text-foreground">Pronto para publicar:</span>{" "}
          {readyToPublish ? "Sim" : "Não"}
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

      {requiredFromMl.length > 0 ? (
        <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/50 p-3">
          <div>
            <Label>Campos exigidos pelo Mercado Livre</Label>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Preencha para liberar a publicação.
            </p>
          </div>
          {requiredFromMl.map((attrId) => {
            const current = payload.attributes.find((a) => a.id === attrId);
            return (
              <div key={attrId} className="space-y-1.5">
                <Label className="text-sm">
                  {ATTR_LABELS[attrId] ?? attrId}
                  <span className="text-destructive ml-0.5">*</span>
                </Label>
                <Input
                  type="number"
                  min={1}
                  value={current?.value_name ?? ""}
                  onChange={(e) =>
                    onDraftChange(
                      updateDraftAttributeValue(draft, attrId, { value_name: e.target.value }),
                    )
                  }
                  className="h-9"
                  placeholder={attrId === "UNITS_PER_PACK" ? "Ex.: 1" : undefined}
                />
              </div>
            );
          })}
        </div>
      ) : null}

      {hasIhubUi ? (
        <div className="space-y-4">
          {secoes.map((secao) => (
            <div key={secao.id} className="space-y-3 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <Label>{secao.titulo}</Label>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {sectionStatusLabel(secao.status)}
                  </p>
                </div>
                <span
                  className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                    secao.status === "pendente"
                      ? "bg-amber-50 text-amber-800 border border-amber-200"
                      : secao.status === "somente_leitura"
                        ? "bg-muted text-muted-foreground"
                        : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                  }`}
                >
                  {sectionStatusLabel(secao.status)}
                </span>
              </div>
              <div className="space-y-3">
                {(secao.campos ?? []).map((campo) => (
                  <IhubUiCampoInput
                    key={`${secao.id}-${campo.id}`}
                    campo={campo}
                    draft={draft}
                    onDraftChange={onDraftChange}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
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
                  <div
                    key={attr.id}
                    className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-2 items-center"
                  >
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
        </>
      )}
    </div>
  );
}
