import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { formatCurrency } from "@/lib/utils";
import {
  AMAZON_MODEL_NAME_MAX,
  applyAmazonGtinExemption,
  getAmazonAttrText,
  getAmazonBulletPoints,
  getAmazonCondition,
  getAmazonImageUrls,
  getAmazonItemDimensions,
  getAmazonListPrice,
  getAmazonModelName,
  getAmazonPrice,
  getAmazonPublishBlockReasons,
  getAmazonQuantity,
  getAmazonScrapedAttributes,
  hasAmazonGtinExemption,
  listAmazonExtraTextAttributes,
  normalizeAmazonCountryCode,
  suggestAmazonProductType,
  updateAmazonBulletPoints,
  updateAmazonCondition,
  updateAmazonDraftBasics,
  updateAmazonExtraTextAttribute,
  updateAmazonItemDimensions,
  updateAmazonListPrice,
  updateAmazonModelName,
  updateAmazonScrapedAttribute,
  type N8nAmazonListingDraft,
} from "./n8n-listing-types";

const COMMON_PRODUCT_TYPES = [
  { id: "COSMETIC_CASE", label: "Necessaire / maquiagem" },
  { id: "BAG", label: "Bolsa" },
  { id: "LUGGAGE", label: "Mala / viagem" },
  { id: "BACKPACK", label: "Mochila" },
  { id: "SHOES", label: "Calçados" },
  { id: "SHIRT", label: "Camiseta / roupa" },
] as const;

const CONDITION_OPTIONS = [
  { id: "new_new", label: "Novo" },
  { id: "used_like_new", label: "Usado — como novo" },
  { id: "used_very_good", label: "Usado — muito bom" },
  { id: "used_good", label: "Usado — bom" },
] as const;

const DEPARTMENT_OPTIONS = [
  { id: "beauty", label: "beauty" },
  { id: "handbags", label: "handbags" },
  { id: "luggage", label: "luggage" },
  { id: "shoes", label: "shoes" },
  { id: "clothing", label: "clothing" },
  { id: "unisex", label: "unisex" },
] as const;

const COUNTRY_OPTIONS = [
  { id: "BR", label: "BR — Brasil" },
  { id: "CN", label: "CN — China" },
  { id: "US", label: "US — Estados Unidos" },
  { id: "PY", label: "PY — Paraguai" },
  { id: "IN", label: "IN — Índia" },
  { id: "VN", label: "VN — Vietnã" },
] as const;

const DG_OPTIONS = [
  { id: "not_applicable", label: "not_applicable (não se aplica)" },
  { id: "unknown", label: "unknown" },
  { id: "ghs", label: "ghs" },
  { id: "storage", label: "storage" },
  { id: "transportation", label: "transportation" },
  { id: "waste", label: "waste" },
] as const;

type ProductTypeOption = { name: string; displayName?: string };

type AmazonListingReviewFormProps = {
  draft: N8nAmazonListingDraft;
  onDraftChange: (draft: N8nAmazonListingDraft) => void;
  jobNeedsReview?: boolean;
  accountId?: string;
};

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-sm font-semibold text-foreground border-b border-border pb-1.5">
      {children}
    </h3>
  );
}

export function AmazonListingReviewForm({
  draft,
  onDraftChange,
  jobNeedsReview = false,
  accountId,
}: AmazonListingReviewFormProps) {
  const publishBlockReasons = getAmazonPublishBlockReasons(draft);
  const images = getAmazonImageUrls(draft);
  const title = getAmazonAttrText(draft, "item_name");
  const brand = getAmazonAttrText(draft, "brand");
  const description = draft._description || getAmazonAttrText(draft, "product_description");
  const price = getAmazonPrice(draft);
  const quantity = getAmazonQuantity(draft);
  const suggestedTypeLocal = suggestAmazonProductType(title);
  const bullets = getAmazonBulletPoints(draft);
  const scraped = getAmazonScrapedAttributes(draft);
  const extraAttrs = listAmazonExtraTextAttributes(draft);
  const condition = getAmazonCondition(draft);
  const department = getAmazonAttrText(draft, "department");
  const country = normalizeAmazonCountryCode(getAmazonAttrText(draft, "country_of_origin") || "BR");
  const dg = getAmazonAttrText(draft, "supplier_declared_dg_hz_regulation") || "not_applicable";
  const listPrice = getAmazonListPrice(draft) || price;
  const modelName = getAmazonModelName(draft);
  const gtinExempt = hasAmazonGtinExemption(draft);
  const dims = getAmazonItemDimensions(draft) || {
    length: 0,
    width: 0,
    height: 0,
    unit: "centimeters" as const,
  };

  const [productTypeOptions, setProductTypeOptions] = useState<ProductTypeOption[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(false);
  const appliedExemption = useRef(false);
  const lastTitleFetch = useRef("");

  // Garante isenção GTIN ao abrir o form
  useEffect(() => {
    if (appliedExemption.current) return;
    if (gtinExempt && !draft.payload.attributes?.externally_assigned_product_identifier) {
      appliedExemption.current = true;
      return;
    }
    appliedExemption.current = true;
    onDraftChange(applyAmazonGtinExemption(draft));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on mount / first paint
  }, []);

  // Truncar model_name se vier > 12 do scrape
  useEffect(() => {
    if (modelName.length > AMAZON_MODEL_NAME_MAX) {
      onDraftChange(updateAmazonModelName(draft, modelName));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Busca product types similares na SP-API
  useEffect(() => {
    if (!accountId || !title.trim()) return;
    if (lastTitleFetch.current === title.trim()) return;

    const timer = window.setTimeout(async () => {
      lastTitleFetch.current = title.trim();
      setLoadingTypes(true);
      try {
        const params = new URLSearchParams({
          accountId,
          itemName: title.trim().slice(0, 200),
        });
        if (typeof draft._asin === "string" && draft._asin.trim()) {
          params.set("asin", draft._asin.trim());
        }
        const res = await fetch(`/api/products/amazon/product-types?${params}`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as {
          suggested?: string | null;
          productTypes?: ProductTypeOption[];
        };
        const list = data.productTypes ?? [];
        setProductTypeOptions(list);

        const suggested = data.suggested || list[0]?.name;
        if (
          suggested &&
          (draft.payload.productType === "PRODUCT" ||
            !draft.payload.productType ||
            draft.payload.productType === suggestedTypeLocal)
        ) {
          // Só auto-aplica se ainda estiver genérico/heurística inicial
          if (draft.payload.productType === "PRODUCT" || !draft.payload.productType) {
            onDraftChange(
              updateAmazonDraftBasics(draft, { productType: suggested.toUpperCase() }),
            );
          }
        }
      } catch {
        // fallback: chips locais
        setProductTypeOptions([]);
      } finally {
        setLoadingTypes(false);
      }
    }, 500);

    return () => window.clearTimeout(timer);
  }, [accountId, title, draft, onDraftChange, suggestedTypeLocal]);

  const bulletSlots = Array.from({ length: 5 }, (_, i) => bullets[i] ?? "");

  const patch = (partial: Parameters<typeof updateAmazonDraftBasics>[1]) => {
    onDraftChange(updateAmazonDraftBasics(draft, partial));
  };

  const setAttr = (key: string, value: string) => {
    onDraftChange(updateAmazonExtraTextAttribute(draft, key, value));
  };

  const typeOptionsMerged: ProductTypeOption[] = (() => {
    const map = new Map<string, ProductTypeOption>();
    for (const opt of productTypeOptions) {
      map.set(opt.name.toUpperCase(), {
        name: opt.name.toUpperCase(),
        displayName: opt.displayName || opt.name,
      });
    }
    for (const opt of COMMON_PRODUCT_TYPES) {
      if (!map.has(opt.id)) {
        map.set(opt.id, { name: opt.id, displayName: opt.label });
      }
    }
    const current = draft.payload.productType?.toUpperCase();
    if (current && !map.has(current)) {
      map.set(current, { name: current, displayName: current });
    }
    return [...map.values()];
  })();

  return (
    <div className="space-y-6">
      {jobNeedsReview || publishBlockReasons.length > 0 ? (
        <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-medium">
              {publishBlockReasons.length > 0
                ? "Complete os itens abaixo para liberar a publicação na Amazon"
                : "Revisão necessária antes de publicar na Amazon"}
            </p>
            {publishBlockReasons.length > 0 ? (
              <ul className="list-disc pl-4 text-amber-700 space-y-0.5">
                {publishBlockReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : (
              <p className="text-amber-700">
                Revise product type, atributos do scrape e bullets antes de criar o listing.
              </p>
            )}
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
        {draft._asin ? (
          <div className="col-span-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-amber-900">
            <span className="font-medium">ASIN fonte (referência):</span> {draft._asin}
            <p className="mt-1 text-[11px] text-amber-800">
              A Amazon cria o <strong>ASIN novo</strong> na publicação. Não enviamos ASIN sugerido de
              terceiros.
            </p>
          </div>
        ) : (
          <div className="col-span-2 text-[11px]">
            ASIN será criado pela Amazon após a publicação.
          </div>
        )}
        <div>
          <span className="font-medium text-foreground">Marketplace:</span>{" "}
          {draft._marketplace_id || "A2Q3Y263D00KWC"}
        </div>
        <div>
          <span className="font-medium text-foreground">Modo:</span> LISTING (produto novo)
        </div>
        <div>
          <span className="font-medium text-foreground">Pronto para publicar:</span>{" "}
          {publishBlockReasons.length === 0 ? "Sim" : "Não"}
        </div>
      </div>

      <section className="space-y-4">
        <SectionTitle>Dados principais</SectionTitle>

        <div className="space-y-1.5">
          <Label>
            Título <span className="text-destructive">*</span>
          </Label>
          <Input
            value={title}
            onChange={(e) => patch({ title: e.target.value })}
            className="h-9"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>
              Seller SKU <span className="text-destructive">*</span>
            </Label>
            <Input
              value={draft.payload.sellerSku}
              onChange={(e) => patch({ sellerSku: e.target.value })}
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label>
              Product type <span className="text-destructive">*</span>
            </Label>
            <select
              value={draft.payload.productType}
              onChange={(e) => patch({ productType: e.target.value.trim().toUpperCase() })}
              className="w-full bg-input border border-border text-sm rounded-lg px-3 h-9 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {typeOptionsMerged.map((opt) => (
                <option key={opt.name} value={opt.name}>
                  {opt.displayName && opt.displayName !== opt.name
                    ? `${opt.name} — ${opt.displayName}`
                    : opt.name}
                </option>
              ))}
            </select>
            <Input
              value={draft.payload.productType}
              onChange={(e) => patch({ productType: e.target.value.trim().toUpperCase() })}
              placeholder="Ou digite o product type…"
              className="h-9"
            />
            <p className="text-[11px] text-muted-foreground">
              {loadingTypes
                ? "Buscando categorias similares na Amazon…"
                : productTypeOptions.length > 0
                  ? `${productTypeOptions.length} categorias sugeridas pela SP-API (título/ASIN).`
                  : suggestedTypeLocal
                    ? `Fallback local: ${suggestedTypeLocal}`
                    : "Informe um product type válido do catálogo BR."}
            </p>
          </div>
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
              value={price || ""}
              onChange={(e) =>
                patch({
                  price: e.target.value === "" ? 0 : Number(e.target.value),
                })
              }
              className="h-9"
            />
            {price > 0 ? (
              <p className="text-[11px] text-muted-foreground">{formatCurrency(price)}</p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label>Estoque</Label>
            <Input
              type="number"
              min={0}
              value={quantity}
              onChange={(e) => patch({ availableQuantity: Number(e.target.value) || 0 })}
              className="h-9"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Marca</Label>
            <Input
              value={brand}
              onChange={(e) => patch({ brand: e.target.value })}
              className="h-9"
            />
            <p className="text-[11px] text-muted-foreground">
              Marca aprovada na Seller Central (ex.: OTM SHOP).
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Condição</Label>
            <select
              value={condition}
              onChange={(e) => onDraftChange(updateAmazonCondition(draft, e.target.value))}
              className="w-full bg-input border border-border text-sm rounded-lg px-3 h-9 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {CONDITION_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>
            model_name <span className="text-muted-foreground font-normal">(máx. {AMAZON_MODEL_NAME_MAX})</span>
          </Label>
          <Input
            value={modelName}
            maxLength={AMAZON_MODEL_NAME_MAX}
            onChange={(e) => onDraftChange(updateAmazonModelName(draft, e.target.value))}
            placeholder="Até 12 caracteres"
            className="h-9"
          />
          <p className="text-[11px] text-muted-foreground">
            {modelName.length}/{AMAZON_MODEL_NAME_MAX}
          </p>
        </div>

        <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 space-y-1.5">
          <label className="flex items-center gap-2.5 text-sm cursor-default">
            <Checkbox checked disabled />
            <span>Produto isento de GTIN/EAN</span>
          </label>
          <p className="text-[11px] text-muted-foreground pl-7">
            Marcado automaticamente. O iHub não envia código de barras — na Amazon aparece que o
            produto não possui GTIN/EAN.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label>Descrição</Label>
          <textarea
            value={description}
            onChange={(e) => patch({ description: e.target.value })}
            rows={5}
            className="w-full bg-input border border-border text-sm rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-y min-h-[100px]"
          />
        </div>
      </section>

      <section className="space-y-4">
        <SectionTitle>Campos obrigatórios Amazon</SectionTitle>
        <p className="text-[11px] text-muted-foreground">
          Preenchidos automaticamente a partir do scrape quando possível. Ajuste se a Amazon rejeitar.
        </p>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>
              Department <span className="text-destructive">*</span>
            </Label>
            <Input
              value={department}
              onChange={(e) => setAttr("department", e.target.value.trim())}
              list="amazon-department-options"
              placeholder="beauty, handbags…"
              className="h-9"
            />
            <datalist id="amazon-department-options">
              {DEPARTMENT_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </datalist>
          </div>
          <div className="space-y-1.5">
            <Label>
              País de origem <span className="text-destructive">*</span>
            </Label>
            <select
              value={country}
              onChange={(e) => setAttr("country_of_origin", e.target.value)}
              className="w-full bg-input border border-border text-sm rounded-lg px-3 h-9 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {COUNTRY_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground">Use código ISO (BR), não “Brasil”.</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>
              Produto perigoso (DG) <span className="text-destructive">*</span>
            </Label>
            <select
              value={dg}
              onChange={(e) => setAttr("supplier_declared_dg_hz_regulation", e.target.value)}
              className="w-full bg-input border border-border text-sm rounded-lg px-3 h-9 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {DG_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>
              List price (R$) <span className="text-destructive">*</span>
            </Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={listPrice || ""}
              onChange={(e) =>
                onDraftChange(
                  updateAmazonListPrice(
                    draft,
                    e.target.value === "" ? 0 : Number(e.target.value),
                  ),
                )
              }
              className="h-9"
            />
            <p className="text-[11px] text-muted-foreground">
              Preço sugerido com impostos (value_with_tax).
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>
            Dimensões do item (C × L × A) <span className="text-destructive">*</span>
          </Label>
          <div className="grid grid-cols-4 gap-2">
            <Input
              type="number"
              min={0}
              step="0.1"
              value={dims.length || ""}
              onChange={(e) =>
                onDraftChange(
                  updateAmazonItemDimensions(draft, {
                    ...dims,
                    length: Number(e.target.value) || 0,
                  }),
                )
              }
              placeholder="Comp."
              className="h-9"
            />
            <Input
              type="number"
              min={0}
              step="0.1"
              value={dims.width || ""}
              onChange={(e) =>
                onDraftChange(
                  updateAmazonItemDimensions(draft, {
                    ...dims,
                    width: Number(e.target.value) || 0,
                  }),
                )
              }
              placeholder="Larg."
              className="h-9"
            />
            <Input
              type="number"
              min={0}
              step="0.1"
              value={dims.height || ""}
              onChange={(e) =>
                onDraftChange(
                  updateAmazonItemDimensions(draft, {
                    ...dims,
                    height: Number(e.target.value) || 0,
                  }),
                )
              }
              placeholder="Alt."
              className="h-9"
            />
            <select
              value={dims.unit}
              onChange={(e) =>
                onDraftChange(
                  updateAmazonItemDimensions(draft, {
                    ...dims,
                    unit: e.target.value === "inches" ? "inches" : "centimeters",
                  }),
                )
              }
              className="w-full bg-input border border-border text-sm rounded-lg px-2 h-9 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="centimeters">cm</option>
              <option value="inches">in</option>
            </select>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <SectionTitle>Bullet points (até 5)</SectionTitle>
        <p className="text-[11px] text-muted-foreground">
          Extraídos das features / descrição do produto na Amazon.
        </p>
        <div className="space-y-2">
          {bulletSlots.map((value, index) => (
            <Input
              key={`bullet-${index}`}
              value={value}
              onChange={(e) => {
                const next = [...bulletSlots];
                next[index] = e.target.value;
                onDraftChange(updateAmazonBulletPoints(draft, next));
              }}
              placeholder={`Bullet ${index + 1}`}
              className="h-9"
            />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <SectionTitle>
          Atributos do scrape Amazon ({scraped.length})
        </SectionTitle>
        <p className="text-[11px] text-muted-foreground">
          Todos os campos chave/valor capturados da página do produto. Edite antes de publicar.
        </p>
        {scraped.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nenhum atributo estruturado veio do scrape. Reimporte o workflow Amazon no n8n e prepare de
            novo.
          </p>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto rounded-lg border border-border p-2">
            {scraped.map((attr, index) => (
              <div key={`${attr.key}-${index}`} className="grid grid-cols-[1fr_1.4fr] gap-2">
                <Input
                  value={attr.key}
                  onChange={(e) =>
                    onDraftChange(
                      updateAmazonScrapedAttribute(draft, index, { key: e.target.value }),
                    )
                  }
                  className="h-8 text-xs"
                />
                <Input
                  value={attr.value}
                  onChange={(e) =>
                    onDraftChange(
                      updateAmazonScrapedAttribute(draft, index, { value: e.target.value }),
                    )
                  }
                  className="h-8 text-xs"
                />
              </div>
            ))}
          </div>
        )}
      </section>

      {extraAttrs.length > 0 ? (
        <section className="space-y-3">
          <SectionTitle>Atributos SP-API mapeados ({extraAttrs.length})</SectionTitle>
          <p className="text-[11px] text-muted-foreground">
            Campos já convertidos para o formato da Amazon (cor, material, etc.).
          </p>
          <div className="space-y-2">
            {extraAttrs.map((attr) => (
              <div key={attr.key} className="space-y-1">
                <Label className="text-xs font-mono text-muted-foreground">{attr.key}</Label>
                <Input
                  value={attr.value}
                  onChange={(e) =>
                    onDraftChange(updateAmazonExtraTextAttribute(draft, attr.key, e.target.value))
                  }
                  className="h-9"
                />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-1.5">
        <SectionTitle>Fotos ({images.length})</SectionTitle>
        {images.length === 0 ? (
          <p className="text-xs text-destructive">Nenhuma foto no rascunho.</p>
        ) : (
          <div className="flex flex-wrap gap-2 pt-1">
            {images.map((url) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="block w-16 h-16 rounded-md overflow-hidden border border-border bg-muted"
              >
                <img src={url} alt="" className="w-full h-full object-cover" />
              </a>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
