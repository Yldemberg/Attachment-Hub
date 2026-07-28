import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, ImagePlus, Loader2, X } from "lucide-react";
import type { ReactNode } from "react";
import { useUploadProductPicture } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import {
  AMAZON_MAX_IMAGES,
  AMAZON_MODEL_NAME_MAX,
  getAmazonAttrText,
  getAmazonBrowseNodeId,
  getAmazonBulletPoints,
  getAmazonCompartment,
  getAmazonCondition,
  getAmazonImageUrls,
  getAmazonItemDimensions,
  getAmazonListPrice,
  getAmazonModelName,
  getAmazonPrice,
  getAmazonPublishBlockReasons,
  getAmazonQuantity,
  getAmazonScrapedAttributes,
  listAmazonExtraTextAttributes,
  AMAZON_BULLET_POINT_MAX,
  isValidAmazonMediaUrl,
  normalizeAmazonCountryCode,
  normalizeAmazonDraftForReview,
  productTypeNeedsCompartment,
  productTypeUsesDepthDimensions,
  setAmazonImageUrls,
  suggestAmazonCompartment,
  suggestAmazonProductType,
  updateAmazonBrowseNode,
  updateAmazonBulletPoints,
  updateAmazonCompartment,
  updateAmazonCondition,
  updateAmazonDraftBasics,
  updateAmazonExtraTextAttribute,
  updateAmazonItemDimensions,
  updateAmazonListPrice,
  updateAmazonModelName,
  updateAmazonScrapedAttribute,
  type N8nAmazonListingDraft,
} from "./n8n-listing-types";
import { readFileAsBase64 } from "./PictureUploader";

const COMMON_PRODUCT_TYPES = [
  { id: "COSMETIC_CASE", label: "Necessaire / maquiagem" },
  { id: "DUFFEL_BAG", label: "Bolsa esportiva / duffel" },
  { id: "BAG", label: "Bolsa" },
  { id: "LUGGAGE", label: "Mala / viagem" },
  { id: "BACKPACK", label: "Mochila" },
  { id: "SHOES", label: "Calçados" },
  { id: "SHIRT", label: "Camiseta / roupa" },
] as const;

type BrowseNodeOption = { id: string; name: string };

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
  const compartment = getAmazonCompartment(draft);
  const needsCompartment = productTypeNeedsCompartment(draft.payload.productType || "");
  const usesDepthDims = productTypeUsesDepthDimensions(draft.payload.productType || "");
  const browseNodeId = getAmazonBrowseNodeId(draft);
  const dims = getAmazonItemDimensions(draft) || {
    length: 0,
    width: 0,
    height: 0,
    unit: "centimeters" as const,
  };

  const [productTypeOptions, setProductTypeOptions] = useState<ProductTypeOption[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(false);
  const [browseNodeOptions, setBrowseNodeOptions] = useState<BrowseNodeOption[]>([]);
  const [loadingBrowseNodes, setLoadingBrowseNodes] = useState(false);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [imageUrlInput, setImageUrlInput] = useState("");
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);
  const appliedNormalize = useRef(false);
  const lastTitleFetch = useRef("");
  const lastBrowseFetch = useRef("");
  const imageInputRef = useRef<HTMLInputElement>(null);
  const { mutateAsync: uploadPicture } = useUploadProductPicture();

  // Isenção GTIN + model_name ≤ 120 + product_type heurístico ao abrir
  useEffect(() => {
    if (appliedNormalize.current) return;
    appliedNormalize.current = true;
    onDraftChange(normalizeAmazonDraftForReview(draft));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on mount / first paint
  }, []);

  // Busca product types similares na SP-API (substitui heurística se ainda genérico)
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
        const current = (draft.payload.productType || "").toUpperCase();
        if (
          suggested &&
          (current === "PRODUCT" ||
            !current ||
            (suggestedTypeLocal && current === suggestedTypeLocal.toUpperCase()))
        ) {
          onDraftChange(
            updateAmazonDraftBasics(draft, { productType: suggested.toUpperCase() }),
          );
        }
      } catch {
        // fallback: COMMON_PRODUCT_TYPES no select
        setProductTypeOptions([]);
        const current = (draft.payload.productType || "").toUpperCase();
        if ((!current || current === "PRODUCT") && suggestedTypeLocal) {
          onDraftChange(
            updateAmazonDraftBasics(draft, {
              productType: suggestedTypeLocal.toUpperCase(),
            }),
          );
        }
      } finally {
        setLoadingTypes(false);
      }
    }, 500);

    return () => window.clearTimeout(timer);
  }, [accountId, title, draft, onDraftChange, suggestedTypeLocal]);

  // Caminhos de navegação (browse nodes) conforme product type
  useEffect(() => {
    const productType = (draft.payload.productType || "").trim().toUpperCase();
    if (!accountId || !productType || productType === "PRODUCT") {
      setBrowseNodeOptions([]);
      return;
    }
    const fetchKey = `${accountId}|${productType}|${title.trim().slice(0, 80)}`;
    if (lastBrowseFetch.current === fetchKey) return;

    const timer = window.setTimeout(async () => {
      lastBrowseFetch.current = fetchKey;
      setLoadingBrowseNodes(true);
      try {
        const params = new URLSearchParams({
          accountId,
          productType,
          itemName: title.trim().slice(0, 200),
        });
        const res = await fetch(`/api/products/amazon/browse-nodes?${params}`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as {
          suggested?: string | null;
          suggestedName?: string | null;
          browseNodes?: BrowseNodeOption[];
        };
        const list = data.browseNodes ?? [];
        setBrowseNodeOptions(list);
        const current = getAmazonBrowseNodeId(draft);
        if ((!current || !list.some((n) => n.id === current)) && data.suggested) {
          onDraftChange(updateAmazonBrowseNode(draft, data.suggested));
        }
      } catch {
        setBrowseNodeOptions([]);
      } finally {
        setLoadingBrowseNodes(false);
      }
    }, 400);

    return () => window.clearTimeout(timer);
  }, [accountId, draft, onDraftChange, title]);

  const bulletSlots = Array.from({ length: 5 }, (_, i) => bullets[i] ?? "");

  const patch = (partial: Parameters<typeof updateAmazonDraftBasics>[1]) => {
    onDraftChange(updateAmazonDraftBasics(draft, partial));
  };

  const setAttr = (key: string, value: string) => {
    onDraftChange(updateAmazonExtraTextAttribute(draft, key, value));
  };

  const moveImage = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= images.length) return;
    const next = [...images];
    const [item] = next.splice(index, 1);
    next.splice(nextIndex, 0, item!);
    onDraftChange(setAmazonImageUrls(draft, next));
  };

  const removeImage = (index: number) => {
    onDraftChange(setAmazonImageUrls(draft, images.filter((_, i) => i !== index)));
  };

  const addImageUrl = (url: string) => {
    const trimmed = url.trim();
    if (!trimmed) return;
    if (!isValidAmazonMediaUrl(trimmed)) {
      setImageUploadError("Informe uma URL pública válida (https://…).");
      return;
    }
    if (images.length >= AMAZON_MAX_IMAGES) return;
    if (images.includes(trimmed)) return;
    setImageUploadError(null);
    onDraftChange(setAmazonImageUrls(draft, [...images, trimmed]));
  };

  const handleAddImageUrl = () => {
    addImageUrl(imageUrlInput);
    setImageUrlInput("");
  };

  const handleImageFiles = async (files: FileList | null) => {
    if (!files?.length || uploadingImages) return;
    if (!accountId) {
      setImageUploadError("Selecione uma conta Amazon antes de enviar imagens.");
      return;
    }

    const remaining = AMAZON_MAX_IMAGES - images.length;
    const toProcess = Array.from(files).slice(0, remaining);
    if (toProcess.length === 0) return;

    setUploadingImages(true);
    setImageUploadError(null);
    let next = [...images];
    try {
      for (const file of toProcess) {
        if (file.size > 10 * 1024 * 1024) {
          setImageUploadError(`A imagem ${file.name} excede 10 MB.`);
          continue;
        }
        if (!file.type.startsWith("image/") && !/\.(jpe?g|png|gif|webp)$/i.test(file.name)) {
          setImageUploadError(`Formato não suportado: ${file.name}. Use JPG, PNG ou WEBP.`);
          continue;
        }
        const base64 = await readFileAsBase64(file);
        const mime = file.type || "image/jpeg";
        const uploaded = await uploadPicture({
          data: { accountId, imageBase64: base64, mimeType: mime },
        });
        const url = uploaded.url?.trim();
        if (url && !next.includes(url)) next = [...next, url];
      }
      onDraftChange(setAmazonImageUrls(draft, next));
    } catch (err) {
      const apiErr = err as { payload?: { error?: { message?: string } }; message?: string };
      setImageUploadError(
        apiErr.payload?.error?.message ??
          apiErr.message ??
          "Não foi possível enviar a imagem. Tente novamente.",
      );
    } finally {
      setUploadingImages(false);
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
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

        {browseNodeOptions.length > 0 || loadingBrowseNodes ? (
          <div className="space-y-1.5">
            <Label>
              Caminhos de Navegação{" "}
              <span className="text-muted-foreground font-normal">(recommended_browse_nodes)</span>
            </Label>
            <select
              value={browseNodeId}
              onChange={(e) => onDraftChange(updateAmazonBrowseNode(draft, e.target.value))}
              className="w-full bg-input border border-border text-sm rounded-lg px-3 h-9 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              disabled={loadingBrowseNodes}
            >
              <option value="">
                {loadingBrowseNodes ? "Carregando caminhos…" : "Selecione o caminho…"}
              </option>
              {browseNodeOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.name}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground">
              Preenchido automaticamente conforme o product type e o título. Evita caminhos
              genéricos/errados (ex.: “Barras dietéticas”).
            </p>
          </div>
        ) : null}

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

        {needsCompartment ? (
          <div className="space-y-1.5">
            <Label>
              Descrição do compartimento <span className="text-destructive">*</span>
            </Label>
            <Input
              value={compartment}
              onChange={(e) => onDraftChange(updateAmazonCompartment(draft, e.target.value))}
              placeholder={suggestAmazonCompartment(draft.payload.productType || "", title)}
              className="h-9"
            />
            <p className="text-[11px] text-muted-foreground">
              Atributo <code className="text-[10px]">compartment</code> exigido para{" "}
              {draft.payload.productType || "este product type"}.
            </p>
          </div>
        ) : null}

        <div className="space-y-1.5">
          <Label>
            Dimensões do item ({usesDepthDims ? "P × L × A" : "C × L × A"}){" "}
            <span className="text-destructive">*</span>
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
              placeholder={usesDepthDims ? "Prof." : "Comp."}
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
          Extraídos das features / descrição do produto na Amazon. Máx.{" "}
          {AMAZON_BULLET_POINT_MAX} caracteres por tópico.
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

      <section className="space-y-3">
        <SectionTitle>Fotos ({images.length}/{AMAZON_MAX_IMAGES})</SectionTitle>
        <p className="text-[11px] text-muted-foreground">
          A primeira foto é a capa. Use as setas para mudar a ordem, remova ou adicione novas.
          Imagens enviadas pelo upload são hospedadas em URL pública (exigência da Amazon).
        </p>

        {imageUploadError ? (
          <p className="text-xs text-destructive">{imageUploadError}</p>
        ) : null}

        {images.length === 0 ? (
          <p className="text-xs text-destructive">Adicione ao menos uma foto antes de publicar.</p>
        ) : (
          <div className="flex flex-wrap gap-2 pt-1">
            {images.map((url, index) => (
              <div
                key={`${index}-${url.slice(0, 48)}`}
                className="relative w-24 rounded-md overflow-hidden border border-border bg-muted"
              >
                <img src={url} alt="" className="w-full h-20 object-cover" />
                {index === 0 ? (
                  <span className="absolute bottom-1 left-1 rounded bg-background/90 px-1 text-[9px] font-medium">
                    Capa
                  </span>
                ) : null}
                <div className="flex items-center justify-between gap-0.5 p-1 bg-background/95 border-t border-border">
                  <button
                    type="button"
                    onClick={() => moveImage(index, -1)}
                    disabled={index === 0}
                    className="size-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30"
                    aria-label="Mover para a esquerda"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeImage(index)}
                    className="size-6 rounded flex items-center justify-center text-muted-foreground hover:text-destructive"
                    aria-label="Remover foto"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveImage(index, 1)}
                    disabled={index === images.length - 1}
                    className="size-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30"
                    aria-label="Mover para a direita"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={imageInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp"
            multiple
            className="hidden"
            onChange={(e) => void handleImageFiles(e.target.files)}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploadingImages || images.length >= AMAZON_MAX_IMAGES || !accountId}
            onClick={() => imageInputRef.current?.click()}
          >
            {uploadingImages ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
            ) : (
              <ImagePlus className="w-3.5 h-3.5 mr-1" />
            )}
            Subir imagens
          </Button>
          <span className="text-[11px] text-muted-foreground">ou cole uma URL:</span>
          <Input
            value={imageUrlInput}
            onChange={(e) => setImageUrlInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddImageUrl();
              }
            }}
            placeholder="https://…"
            className="h-8 max-w-xs"
            disabled={images.length >= AMAZON_MAX_IMAGES}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!imageUrlInput.trim() || images.length >= AMAZON_MAX_IMAGES}
            onClick={handleAddImageUrl}
          >
            Adicionar URL
          </Button>
        </div>
      </section>
    </div>
  );
}
