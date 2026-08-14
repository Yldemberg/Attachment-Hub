import { Plus, Trash2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
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
    attributes: form.attributes.filter((a) => a.id && a.value_name.trim()),
    // PURCHASE_MAX_QUANTITY e similares costumam ser read_only no ML e geram HTTP 400.
    saleTerms: form.saleTerms.filter(
      (a) =>
        a.id &&
        (a.value_name.trim() || a.value_id) &&
        ["WARRANTY_TYPE", "WARRANTY_TIME", "MANUFACTURING_TIME"].includes(a.id),
    ),
    videoId: videoId || null,
  };
}

type Props = {
  form: EditableTemplateForm;
  onChange: (form: EditableTemplateForm) => void;
  disabled?: boolean;
};

function AttrRows({
  label,
  rows,
  onChange,
  disabled,
  idPlaceholder,
}: {
  label: string;
  rows: ListingFormAttribute[];
  onChange: (rows: ListingFormAttribute[]) => void;
  disabled?: boolean;
  idPlaceholder: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
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
        <div className="space-y-2">
          {rows.map((row, index) => (
            <div key={`${row.id}-${index}`} className="flex gap-2 items-start">
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
                placeholder="Valor"
                className="h-9 flex-1"
                disabled={disabled}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 w-9 p-0 text-destructive hover:text-destructive flex-shrink-0"
                disabled={disabled}
                onClick={() => onChange(rows.filter((_, i) => i !== index))}
                title="Remover"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TemplatePayloadEditor({ form, onChange, disabled }: Props) {
  const selectCls =
    "w-full bg-input border border-border text-sm rounded-lg px-3 h-9 text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60";

  const patch = (partial: Partial<EditableTemplateForm>) => onChange({ ...form, ...partial });

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label>
          Título <span className="text-destructive">*</span>
        </Label>
        <Input
          value={form.title}
          onChange={(e) => patch({ title: e.target.value })}
          className="h-9"
          disabled={disabled}
        />
      </div>

      <div className="space-y-1.5">
        <Label>Nome da família</Label>
        <Input
          value={form.familyName}
          onChange={(e) => patch({ familyName: e.target.value })}
          className="h-9"
          disabled={disabled}
          placeholder="Obrigatório em contas User Products"
        />
      </div>

      <div className="space-y-1.5">
        <Label>Fotos (URLs públicas)</Label>
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
        <div className="space-y-1.5">
          <Label>
            Preço (R$) <span className="text-destructive">*</span>
          </Label>
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
        <div className="space-y-1.5">
          <Label>
            Estoque <span className="text-destructive">*</span>
          </Label>
          <Input
            type="number"
            min={0}
            value={form.availableQuantity}
            onChange={(e) => patch({ availableQuantity: e.target.value })}
            className="h-9"
            disabled={disabled}
          />
          <p className="text-[11px] text-muted-foreground leading-snug">
            Usado só ao <strong>publicar um anúncio novo</strong>. O espelhamento por SKU nunca
            altera estoque — nem em anúncios tradicionais nem Full.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Condição</Label>
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
        <div className="space-y-1.5">
          <Label>Tipo de anúncio</Label>
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

      <div className="space-y-1.5">
        <Label>Categoria (ID)</Label>
        <Input
          value={form.categoryId}
          onChange={(e) => patch({ categoryId: e.target.value })}
          className="h-9 font-mono text-xs"
          disabled={disabled}
        />
      </div>

      <div className="space-y-1.5">
        <Label>Video Clip (ID)</Label>
        <Input
          value={form.videoId}
          onChange={(e) => patch({ videoId: e.target.value })}
          className="h-9 font-mono text-xs"
          disabled={disabled}
          placeholder="ID do clip do Mercado Livre"
        />
        <p className="text-[11px] text-muted-foreground leading-snug">
          Preenchido automaticamente quando o anúncio de origem tem Clips. Funciona melhor ao
          republicar na <strong>mesma conta</strong>; em outra conta o ML pode rejeitar o clip (ele
          fica vinculado ao vendedor que fez o upload).
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>Descrição</Label>
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
        />
        <p className="text-[11px] text-muted-foreground mt-2 leading-snug">
          Na publicação, o iHub consulta a categoria no Mercado Livre e remove atributos{" "}
          <em>read_only</em>, <em>fixed</em> ou <em>inferred</em> gerenciados pelo ML (ex.: AGE_GROUP,
          marcas internas). Atributos de regra de venda como{" "}
          <span className="font-mono">SALE_FORMAT</span> e{" "}
          <span className="font-mono">UNITS_PER_PACK</span> são enviados quando preenchidos. Com
          variações clássicas, <span className="font-mono">UNITS_PER_PACK</span> vai como{" "}
          <strong>1</strong> (Unidade); sem variações, se for maior que 1 o formato vira Pack.
          Você pode deixar a lista completa no modelo.
        </p>
      </div>

      <div className="border-t border-border pt-4">
        <AttrRows
          label="Condições de venda"
          rows={form.saleTerms}
          onChange={(saleTerms) => patch({ saleTerms })}
          disabled={disabled}
          idPlaceholder="ID (ex.: WARRANTY_TYPE)"
        />
        <p className="text-[11px] text-muted-foreground mt-2 leading-snug">
          Na publicação, o iHub envia apenas garantia e prazo de fabricação. Termos como{" "}
          <span className="font-mono">PURCHASE_MAX_QUANTITY</span> o Mercado Livre costuma rejeitar
          (read_only).
        </p>
      </div>
    </div>
  );
}
