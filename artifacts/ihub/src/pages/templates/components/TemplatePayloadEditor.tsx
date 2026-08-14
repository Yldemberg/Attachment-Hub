import type { ReactNode } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  MLB_LISTING_TYPES,
  LISTING_CONDITIONS,
  type ListingFormAttribute,
} from "@/pages/products/components/listing-constants";

export type EditableTemplateForm = {
  title: string;
  familyName: string;
  categoryId: string;
  price: string;
  availableQuantity: string;
  condition: "new" | "used";
  listingTypeId: string;
  description: string;
  pictureSources: string[];
  attributes: ListingFormAttribute[];
  saleTerms: ListingFormAttribute[];
  videoId: string;
};

export const TEMPLATE_SCALAR_FIELDS = [
  "title",
  "familyName",
  "pictures",
  "price",
  "condition",
  "listingTypeId",
  "categoryId",
  "videoId",
  "description",
] as const;

export type TemplateScalarField = (typeof TEMPLATE_SCALAR_FIELDS)[number];

export type TemplatePropagateSelection = {
  fields: TemplateScalarField[];
  attributeIndexes: number[];
  saleTermIndexes: number[];
};

export const EMPTY_PROPAGATE_SELECTION: TemplatePropagateSelection = {
  fields: [],
  attributeIndexes: [],
  saleTermIndexes: [],
};

export function payloadToForm(payload: {
  title?: string;
  familyName?: string;
  categoryId?: string;
  price?: number;
  availableQuantity?: number;
  condition?: string;
  listingTypeId?: string;
  description?: string;
  pictureSources?: string[];
  attributes?: Array<{ [key: string]: unknown }>;
  saleTerms?: Array<{ [key: string]: unknown }>;
  videoId?: string | null;
}): EditableTemplateForm {
  const mapAttrs = (rows: Array<{ [key: string]: unknown }> | undefined): ListingFormAttribute[] =>
    (rows ?? [])
      .filter((a) => typeof a.id === "string" && a.id)
      .map((a) => ({
        id: a.id as string,
        value_name:
          typeof a.value_name === "string"
            ? a.value_name
            : typeof a.valueName === "string"
              ? a.valueName
              : "",
        ...(typeof a.value_id === "string" && a.value_id
          ? { value_id: a.value_id }
          : typeof a.valueId === "string" && a.valueId
            ? { value_id: a.valueId }
            : {}),
        ...(typeof a.name === "string" && a.name.trim() ? { name: a.name.trim() } : {}),
        ...(typeof a.groupName === "string" && a.groupName.trim()
          ? { groupName: a.groupName.trim() }
          : typeof a.group_name === "string" && a.group_name.trim()
            ? { groupName: a.group_name.trim() }
            : {}),
      }));

  return {
    title: payload.title ?? "",
    familyName: payload.familyName ?? "",
    categoryId: payload.categoryId ?? "",
    price: payload.price != null ? String(payload.price) : "",
    availableQuantity:
      payload.availableQuantity != null ? String(payload.availableQuantity) : "1",
    condition: payload.condition === "used" ? "used" : "new",
    listingTypeId: payload.listingTypeId ?? "gold_special",
    description: payload.description ?? "",
    pictureSources: [...(payload.pictureSources ?? [])],
    attributes: mapAttrs(payload.attributes),
    saleTerms: mapAttrs(payload.saleTerms),
    videoId: payload.videoId?.trim() ? payload.videoId.trim() : "",
  };
}

export function formToPublishOverrides(form: EditableTemplateForm): {
  title: string;
  familyName: string;
  categoryId: string;
  price: number;
  availableQuantity: number;
  condition: "new" | "used";
  listingTypeId: string;
  description?: string;
  pictureSources: string[];
  pictures: string[];
  attributes: ListingFormAttribute[];
  saleTerms?: ListingFormAttribute[];
  videoId?: string | null;
} {
  const pictureSources = form.pictureSources.map((u) => u.trim()).filter(Boolean);
  const videoId = form.videoId.trim();
  return {
    title: form.title.trim(),
    familyName: form.familyName.trim() || form.title.trim(),
    categoryId: form.categoryId.trim(),
    price: Number(form.price) || 0,
    availableQuantity: Number(form.availableQuantity) || 0,
    condition: form.condition,
    listingTypeId: form.listingTypeId,
    description: form.description.trim() || undefined,
    pictureSources,
    pictures: [],
    attributes: form.attributes.filter((a) => a.id && (a.value_name.trim() || a.value_id)),
    saleTerms: form.saleTerms.filter(
      (a) =>
        a.id &&
        (a.value_name.trim() || a.value_id) &&
        ["WARRANTY_TYPE", "WARRANTY_TIME", "MANUFACTURING_TIME"].includes(a.id),
    ),
    videoId: videoId || null,
  };
}

function idsFromIndexes(rows: ListingFormAttribute[], indexes: number[]): string[] {
  const ids: string[] = [];
  for (const index of indexes) {
    const id = rows[index]?.id.trim();
    if (id && !ids.some((x) => x.toLowerCase() === id.toLowerCase())) ids.push(id);
  }
  return ids;
}

export function selectionToPropagatePayload(
  form: EditableTemplateForm,
  selection: TemplatePropagateSelection,
): {
  fields: TemplateScalarField[];
  attributeIds: string[];
  saleTermIds: string[];
} {
  return {
    fields: selection.fields,
    attributeIds: idsFromIndexes(form.attributes, selection.attributeIndexes),
    saleTermIds: idsFromIndexes(form.saleTerms, selection.saleTermIndexes),
  };
}

export function allPropagateSelection(form: EditableTemplateForm): TemplatePropagateSelection {
  return {
    fields: [...TEMPLATE_SCALAR_FIELDS],
    attributeIndexes: form.attributes.map((_, i) => i),
    saleTermIndexes: form.saleTerms.map((_, i) => i),
  };
}

export function changedPropagateSelection(
  form: EditableTemplateForm,
  original: EditableTemplateForm,
): TemplatePropagateSelection {
  const fields: TemplateScalarField[] = [];
  if (form.title.trim() !== original.title.trim()) fields.push("title");
  if (form.familyName.trim() !== original.familyName.trim()) fields.push("familyName");
  if (JSON.stringify(form.pictureSources) !== JSON.stringify(original.pictureSources)) {
    fields.push("pictures");
  }
  if (form.price !== original.price) fields.push("price");
  if (form.condition !== original.condition) fields.push("condition");
  if (form.listingTypeId !== original.listingTypeId) fields.push("listingTypeId");
  if (form.categoryId.trim() !== original.categoryId.trim()) fields.push("categoryId");
  if (form.videoId.trim() !== original.videoId.trim()) fields.push("videoId");
  if (form.description.trim() !== original.description.trim()) fields.push("description");

  const sameRow = (a?: ListingFormAttribute, b?: ListingFormAttribute) =>
    (a?.id ?? "").trim().toLowerCase() === (b?.id ?? "").trim().toLowerCase() &&
    (a?.value_name ?? "").trim() === (b?.value_name ?? "").trim() &&
    (a?.value_id ?? "") === (b?.value_id ?? "");

  return {
    fields,
    attributeIndexes: form.attributes
      .map((_, i) => i)
      .filter((i) => !sameRow(form.attributes[i], original.attributes[i])),
    saleTermIndexes: form.saleTerms
      .map((_, i) => i)
      .filter((i) => !sameRow(form.saleTerms[i], original.saleTerms[i])),
  };
}

function removeIndex(indexes: number[], removed: number): number[] {
  return indexes.filter((i) => i !== removed).map((i) => (i > removed ? i - 1 : i));
}

type Props = {
  form: EditableTemplateForm;
  onChange: (form: EditableTemplateForm) => void;
  disabled?: boolean;
  selection: TemplatePropagateSelection;
  onSelectionChange: (selection: TemplatePropagateSelection) => void;
};

function FieldCheck({
  checked,
  onCheckedChange,
  disabled,
  locked,
  children,
}: {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  locked?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      {locked ? (
        <span
          className="inline-flex size-4 shrink-0 items-center justify-center text-[10px] text-muted-foreground"
          title="Estoque nunca é espelhado"
        >
          —
        </span>
      ) : (
        <Checkbox
          checked={!!checked}
          disabled={disabled}
          onCheckedChange={(value) => onCheckedChange?.(value === true)}
        />
      )}
      <Label className={cn(!locked && "cursor-pointer")} onClick={() => !locked && !disabled && onCheckedChange?.(!checked)}>
        {children}
      </Label>
    </div>
  );
}

function AttrRows({
  label,
  rows,
  onChange,
  disabled,
  idPlaceholder,
  selectedIndexes,
  onSelectedIndexesChange,
}: {
  label: string;
  rows: ListingFormAttribute[];
  onChange: (rows: ListingFormAttribute[]) => void;
  disabled?: boolean;
  idPlaceholder: string;
  selectedIndexes: number[];
  onSelectedIndexesChange: (indexes: number[]) => void;
}) {
  const allChecked = rows.length > 0 && selectedIndexes.length === rows.length;
  const someChecked = selectedIndexes.length > 0 && !allChecked;
  const selectedSet = new Set(selectedIndexes);

  const toggleRow = (index: number, checked: boolean) => {
    if (checked) {
      if (selectedSet.has(index)) return;
      onSelectedIndexesChange([...selectedIndexes, index].sort((a, b) => a - b));
      return;
    }
    onSelectedIndexesChange(selectedIndexes.filter((i) => i !== index));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <FieldCheck
          checked={allChecked}
          onCheckedChange={(checked) =>
            onSelectedIndexesChange(checked ? rows.map((_, i) => i) : [])
          }
          disabled={disabled || rows.length === 0}
        >
          {label}
          {someChecked ? (
            <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">
              {selectedIndexes.length}/{rows.length}
            </span>
          ) : null}
        </FieldCheck>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          disabled={disabled}
          onClick={() => onChange([...rows, { id: "", value_name: "" }])}
        >
          <Plus className="w-3.5 h-3.5 mr-1" />
          Adicionar
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhum item. Clique em Adicionar.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((row, index) => {
            const prevGroup = index > 0 ? rows[index - 1]?.groupName : undefined;
            const showGroup = row.groupName && row.groupName !== prevGroup;
            return (
              <div key={`${row.id}-${index}`} className="space-y-1">
                {showGroup ? (
                  <p className="text-[11px] font-medium text-muted-foreground pt-1">{row.groupName}</p>
                ) : null}
                <div
                  className={cn(
                    "flex gap-2 items-start",
                    !selectedSet.has(index) && "opacity-55",
                  )}
                >
                  <Checkbox
                    className="mt-2.5"
                    checked={selectedSet.has(index)}
                    disabled={disabled}
                    onCheckedChange={(value) => toggleRow(index, value === true)}
                  />
                  <div className="flex-1 min-w-0 space-y-1">
                    {row.name ? (
                      <p className="text-[11px] text-foreground leading-tight">{row.name}</p>
                    ) : null}
                    <div className="flex gap-2 items-start">
                      <Input
                        value={row.id}
                        onChange={(e) => {
                          const next = [...rows];
                          next[index] = { ...row, id: e.target.value };
                          onChange(next);
                        }}
                        placeholder={idPlaceholder}
                        className="h-9 font-mono text-xs w-[40%]"
                        disabled={disabled}
                      />
                      <Input
                        value={row.value_name}
                        onChange={(e) => {
                          const next = [...rows];
                          next[index] = { ...row, value_name: e.target.value };
                          onChange(next);
                        }}
                        placeholder={row.name ? `Valor de ${row.name}` : "Valor"}
                        className="h-9 flex-1"
                        disabled={disabled}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-9 w-9 p-0 text-destructive hover:text-destructive flex-shrink-0"
                        disabled={disabled}
                        onClick={() => {
                          onChange(rows.filter((_, i) => i !== index));
                          onSelectedIndexesChange(removeIndex(selectedIndexes, index));
                        }}
                        title="Remover"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function TemplatePayloadEditor({
  form,
  onChange,
  disabled,
  selection,
  onSelectionChange,
}: Props) {
  const selectCls =
    "w-full bg-input border border-border text-sm rounded-lg px-3 h-9 text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60";

  const patch = (partial: Partial<EditableTemplateForm>) => onChange({ ...form, ...partial });
  const fieldOn = (field: TemplateScalarField) => selection.fields.includes(field);
  const toggleField = (field: TemplateScalarField, checked: boolean) => {
    const fields = checked
      ? selection.fields.includes(field)
        ? selection.fields
        : [...selection.fields, field]
      : selection.fields.filter((f) => f !== field);
    onSelectionChange({ ...selection, fields });
  };

  return (
    <div className="space-y-5">
      <div className={cn("space-y-1.5", !fieldOn("title") && "opacity-55")}>
        <FieldCheck
          checked={fieldOn("title")}
          onCheckedChange={(checked) => toggleField("title", checked)}
          disabled={disabled}
        >
          Título <span className="text-destructive">*</span>
        </FieldCheck>
        <Input
          value={form.title}
          onChange={(e) => patch({ title: e.target.value })}
          className="h-9"
          disabled={disabled}
        />
      </div>

      <div className={cn("space-y-1.5", !fieldOn("familyName") && "opacity-55")}>
        <FieldCheck
          checked={fieldOn("familyName")}
          onCheckedChange={(checked) => toggleField("familyName", checked)}
          disabled={disabled}
        >
          Nome da família
        </FieldCheck>
        <Input
          value={form.familyName}
          onChange={(e) => patch({ familyName: e.target.value })}
          className="h-9"
          disabled={disabled}
          placeholder="Obrigatório em contas User Products"
        />
      </div>

      <div className={cn("space-y-1.5", !fieldOn("pictures") && "opacity-55")}>
        <FieldCheck
          checked={fieldOn("pictures")}
          onCheckedChange={(checked) => toggleField("pictures", checked)}
          disabled={disabled}
        >
          Fotos (URLs públicas)
        </FieldCheck>
        <div className="flex gap-2 overflow-x-auto pb-1 mb-2">
          {form.pictureSources.map((url, i) =>
            url.trim() ? (
              <div key={`${url}-${i}`} className="relative flex-shrink-0">
                <img
                  src={url}
                  alt=""
                  className="w-16 h-16 rounded-lg object-cover bg-muted border border-border"
                />
                <button
                  type="button"
                  disabled={disabled}
                  className="absolute -top-1.5 -right-1.5 size-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center"
                  onClick={() =>
                    patch({ pictureSources: form.pictureSources.filter((_, idx) => idx !== i) })
                  }
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : null,
          )}
        </div>
        <div className="space-y-2">
          {form.pictureSources.map((url, index) => (
            <div key={index} className="flex gap-2">
              <Input
                value={url}
                onChange={(e) => {
                  const next = [...form.pictureSources];
                  next[index] = e.target.value;
                  patch({ pictureSources: next });
                }}
                placeholder="https://…"
                className="h-9 text-xs"
                disabled={disabled}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 w-9 p-0 text-destructive hover:text-destructive"
                disabled={disabled}
                onClick={() =>
                  patch({ pictureSources: form.pictureSources.filter((_, i) => i !== index) })
                }
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs mt-1"
          disabled={disabled}
          onClick={() => patch({ pictureSources: [...form.pictureSources, ""] })}
        >
          <Plus className="w-3.5 h-3.5 mr-1" />
          Adicionar foto
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className={cn("space-y-1.5", !fieldOn("price") && "opacity-55")}>
          <FieldCheck
            checked={fieldOn("price")}
            onCheckedChange={(checked) => toggleField("price", checked)}
            disabled={disabled}
          >
            Preço (R$) <span className="text-destructive">*</span>
          </FieldCheck>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={form.price}
            onChange={(e) => patch({ price: e.target.value })}
            className="h-9"
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5 opacity-55">
          <FieldCheck locked>
            Estoque <span className="text-destructive">*</span>
          </FieldCheck>
          <Input
            type="number"
            min={0}
            value={form.availableQuantity}
            onChange={(e) => patch({ availableQuantity: e.target.value })}
            className="h-9"
            disabled={disabled}
          />
          <p className="text-[11px] text-muted-foreground leading-snug">
            Usado só ao <strong>publicar um anúncio novo</strong>. O espelhamento nunca altera
            estoque.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className={cn("space-y-1.5", !fieldOn("condition") && "opacity-55")}>
          <FieldCheck
            checked={fieldOn("condition")}
            onCheckedChange={(checked) => toggleField("condition", checked)}
            disabled={disabled}
          >
            Condição
          </FieldCheck>
          <select
            value={form.condition}
            onChange={(e) => patch({ condition: e.target.value as "new" | "used" })}
            className={selectCls}
            disabled={disabled}
          >
            {LISTING_CONDITIONS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className={cn("space-y-1.5", !fieldOn("listingTypeId") && "opacity-55")}>
          <FieldCheck
            checked={fieldOn("listingTypeId")}
            onCheckedChange={(checked) => toggleField("listingTypeId", checked)}
            disabled={disabled}
          >
            Tipo de anúncio
          </FieldCheck>
          <select
            value={form.listingTypeId}
            onChange={(e) => patch({ listingTypeId: e.target.value })}
            className={selectCls}
            disabled={disabled}
          >
            {MLB_LISTING_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
            {!MLB_LISTING_TYPES.some((t) => t.id === form.listingTypeId) && form.listingTypeId ? (
              <option value={form.listingTypeId}>{form.listingTypeId}</option>
            ) : null}
          </select>
        </div>
      </div>

      <div className={cn("space-y-1.5", !fieldOn("categoryId") && "opacity-55")}>
        <FieldCheck
          checked={fieldOn("categoryId")}
          onCheckedChange={(checked) => toggleField("categoryId", checked)}
          disabled={disabled}
        >
          Categoria (ID)
        </FieldCheck>
        <Input
          value={form.categoryId}
          onChange={(e) => patch({ categoryId: e.target.value })}
          className="h-9 font-mono text-xs"
          disabled={disabled}
        />
      </div>

      <div className={cn("space-y-1.5", !fieldOn("videoId") && "opacity-55")}>
        <FieldCheck
          checked={fieldOn("videoId")}
          onCheckedChange={(checked) => toggleField("videoId", checked)}
          disabled={disabled}
        >
          Video Clip (ID)
        </FieldCheck>
        <Input
          value={form.videoId}
          onChange={(e) => patch({ videoId: e.target.value })}
          className="h-9 font-mono text-xs"
          disabled={disabled}
          placeholder="ID do clip do Mercado Livre"
        />
        <p className="text-[11px] text-muted-foreground leading-snug">
          Preenchido automaticamente quando o anúncio de origem tem Clips. Funciona melhor ao
          republicar na <strong>mesma conta</strong>; em outra conta o ML pode rejeitar o clip.
        </p>
      </div>

      <div className={cn("space-y-1.5", !fieldOn("description") && "opacity-55")}>
        <FieldCheck
          checked={fieldOn("description")}
          onCheckedChange={(checked) => toggleField("description", checked)}
          disabled={disabled}
        >
          Descrição
        </FieldCheck>
        <textarea
          value={form.description}
          onChange={(e) => patch({ description: e.target.value })}
          rows={8}
          disabled={disabled}
          className="w-full bg-input border border-border text-sm rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-y min-h-[140px] disabled:opacity-60"
        />
      </div>

      <div className="border-t border-border pt-4">
        <AttrRows
          label="Atributos"
          rows={form.attributes}
          onChange={(attributes) => patch({ attributes })}
          disabled={disabled}
          idPlaceholder="ID (ex.: BRAND)"
          selectedIndexes={selection.attributeIndexes}
          onSelectedIndexesChange={(attributeIndexes) =>
            onSelectionChange({ ...selection, attributeIndexes })
          }
        />
        <p className="text-[11px] text-muted-foreground mt-2 leading-snug">
          A lista vem da categoria do ML (principais e secundárias), inclusive campos ainda vazios
          (tipo de uso, bolsos, à prova d&apos;água, etc.). Só as linhas com checkbox marcada são
          espelhadas. Sincronize o modelo de novo para atualizar esta lista.
        </p>
      </div>

      <div className="border-t border-border pt-4">
        <AttrRows
          label="Condições de venda"
          rows={form.saleTerms}
          onChange={(saleTerms) => patch({ saleTerms })}
          disabled={disabled}
          idPlaceholder="ID (ex.: WARRANTY_TYPE)"
          selectedIndexes={selection.saleTermIndexes}
          onSelectedIndexesChange={(saleTermIndexes) =>
            onSelectionChange({ ...selection, saleTermIndexes })
          }
        />
        <p className="text-[11px] text-muted-foreground mt-2 leading-snug">
          Marque só os termos a espelhar (garantia/prazo).{" "}
          <span className="font-mono">PURCHASE_MAX_QUANTITY</span> o ML costuma rejeitar.
        </p>
      </div>
    </div>
  );
}
