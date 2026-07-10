import type { N8nListingDraft } from "@workspace/api-client-react";
import { AlertTriangle, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { MLB_LISTING_TYPES, LISTING_CONDITIONS } from "./listing-constants";
import {
  REVIEW_GROUP_LABELS,
  buildReviewEditableFields,
  isHiddenListingAttribute,
  type ReviewEditableField,
  type ReviewFieldGroup,
} from "./listing-review-fields";
import {
  formatMlValidationMessage,
  getBlockingMlValidationErrors,
  getMlValidationWarnings,
  getPendingRequiredIhubUiCampos,
  getRequiredAttributeIdsFromMlErrors,
  removeDraftPicture,
  updateDraftAttributeValue,
  updateDraftDescription,
  updateDraftPayload,
  updateDraftSaleTerm,
} from "./n8n-listing-types";

type N8nListingReviewFormProps = {
  draft: N8nListingDraft;
  onDraftChange: (draft: N8nListingDraft) => void;
  jobNeedsReview?: boolean;
};

function ReviewFieldInput({
  field,
  draft,
  onDraftChange,
}: {
  field: ReviewEditableField;
  draft: N8nListingDraft;
  onDraftChange: (draft: N8nListingDraft) => void;
}) {
  const selectCls =
    "w-full bg-input border border-border text-sm rounded-lg px-3 h-9 text-foreground focus:outline-none focus:ring-1 focus:ring-primary";

  const apply = (next: { value_name?: string; value_id?: string | null }) => {
    try {
      if (field.kind === "sale_term") {
        onDraftChange(updateDraftSaleTerm(draft, field.id, next));
        return;
      }
      onDraftChange(
        updateDraftAttributeValue(draft, field.id, {
          ...(next.value_name !== undefined ? { value_name: next.value_name } : {}),
          ...(next.value_id !== undefined && next.value_id !== null
            ? { value_id: next.value_id }
            : {}),
        }),
      );
    } catch (err) {
      console.error("Falha ao atualizar campo do anúncio", field.id, err);
    }
  };

  return (
    <div className="space-y-1.5">
      <Label className="text-sm">
        {field.label}
        {field.required ? <span className="text-destructive ml-0.5">*</span> : null}
      </Label>
      {field.inputType === "select" && field.options ? (
        <select
          value={field.valueName || field.valueId || ""}
          onChange={(e) => {
            const selected = field.options?.find(
              (opt) => opt.name === e.target.value || opt.id === e.target.value,
            );
            apply({
              value_name: selected?.name ?? e.target.value,
              value_id: selected?.id ?? null,
            });
          }}
          className={`${selectCls} relative z-10`}
        >
          <option value="">Selecione…</option>
          {field.options.map((opt) => (
            <option key={opt.id} value={opt.name}>
              {opt.name}
            </option>
          ))}
        </select>
      ) : (
        <Input
          type={field.inputType === "number" ? "number" : "text"}
          value={field.valueName ?? ""}
          onChange={(e) => apply({ value_name: e.target.value })}
          className="h-9 relative z-10"
          autoComplete="off"
          placeholder={
            field.id === "WARRANTY_TIME"
              ? "Ex.: 3 meses"
              : field.id === "SELLER_SKU"
                ? "SKU do produto"
                : field.id === "UNITS_PER_PACK"
                  ? "Ex.: 1"
                  : undefined
          }
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
  const pendingRequired = getPendingRequiredIhubUiCampos(draft).filter(
    (campo) => !isHiddenListingAttribute(campo.id),
  );
  const pendingCount = pendingRequired.length;
  const blockingErrors = getBlockingMlValidationErrors(draft);
  const warnings = getMlValidationWarnings(draft);
  const requiredFromMl = getRequiredAttributeIdsFromMlErrors(draft);
  const reviewFields = buildReviewEditableFields(draft, requiredFromMl);
  const missingEssentials = reviewFields.filter((field) => {
    if (!field.required) return false;
    return !(field.valueName.trim() || field.valueId);
  });
  const readyToPublish =
    blockingErrors.length === 0 && pendingCount === 0 && missingEssentials.length === 0;

  const grouped = (Object.keys(REVIEW_GROUP_LABELS) as ReviewFieldGroup[])
    .map((group) => ({
      group,
      label: REVIEW_GROUP_LABELS[group],
      fields: reviewFields.filter((f) => f.group === group),
    }))
    .filter((g) => g.fields.length > 0);

  const selectCls =
    "w-full bg-input border border-border text-sm rounded-lg px-3 h-9 text-foreground focus:outline-none focus:ring-1 focus:ring-primary";

  return (
    <div className="space-y-5">
      {jobNeedsReview ||
      pendingCount > 0 ||
      blockingErrors.length > 0 ||
      missingEssentials.length > 0 ? (
        <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">
              {blockingErrors.length > 0 || missingEssentials.length > 0
                ? "Complete os campos obrigatórios antes de publicar"
                : jobNeedsReview
                  ? "Revisão necessária antes de publicar"
                  : `${pendingCount} campo(s) obrigatório(s) pendente(s)`}
            </p>
            <p className="mt-0.5 text-amber-700">
              Todos os atributos listados podem ser editados, inclusive os preenchidos automaticamente.
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

      {grouped.map(({ group, label, fields }) => (
        <div key={group} className="space-y-3 rounded-lg border border-border p-3">
          <div>
            <Label>{label}</Label>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {group === "essenciais"
                ? "SKU, garantia e identificadores necessários para publicar."
                : group === "caracteristicas"
                  ? "Principais e secundárias — todas editáveis."
                  : group === "embalagem_fabrica"
                    ? "Dimensões e peso da embalagem de fábrica."
                    : group === "embalagem_envio"
                      ? "Dimensões e peso da embalagem de envio."
                      : "Revise e ajuste se necessário."}
            </p>
          </div>
          <div className="space-y-3">
            {fields.map((field) => (
              <ReviewFieldInput
                key={`${field.kind}-${field.id}`}
                field={field}
                draft={draft}
                onDraftChange={onDraftChange}
              />
            ))}
          </div>
        </div>
      ))}

    </div>
  );
}
