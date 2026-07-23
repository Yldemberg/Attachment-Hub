import { AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/lib/utils";
import {
  getAmazonAttrText,
  getAmazonImageUrls,
  getAmazonPrice,
  getAmazonPublishBlockReasons,
  getAmazonQuantity,
  suggestAmazonProductType,
  updateAmazonDraftBasics,
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

type AmazonListingReviewFormProps = {
  draft: N8nAmazonListingDraft;
  onDraftChange: (draft: N8nAmazonListingDraft) => void;
  jobNeedsReview?: boolean;
};

export function AmazonListingReviewForm({
  draft,
  onDraftChange,
  jobNeedsReview = false,
}: AmazonListingReviewFormProps) {
  const publishBlockReasons = getAmazonPublishBlockReasons(draft);
  const images = getAmazonImageUrls(draft);
  const title = getAmazonAttrText(draft, "item_name");
  const brand = getAmazonAttrText(draft, "brand");
  const description = draft._description || getAmazonAttrText(draft, "product_description");
  const price = getAmazonPrice(draft);
  const quantity = getAmazonQuantity(draft);
  const suggestedType = suggestAmazonProductType(title);

  const patch = (partial: Parameters<typeof updateAmazonDraftBasics>[1]) => {
    onDraftChange(updateAmazonDraftBasics(draft, partial));
  };

  return (
    <div className="space-y-5">
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
                Confirme product type, SKU, preço e fotos antes de criar o listing.
              </p>
            )}
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
          <span className="font-medium text-foreground">Marketplace:</span>{" "}
          {draft._marketplace_id || "A2Q3Y263D00KWC"}
        </div>
        <div>
          <span className="font-medium text-foreground">Pronto para publicar:</span>{" "}
          {publishBlockReasons.length === 0 ? "Sim" : "Não"}
        </div>
      </div>

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
          <Input
            value={draft.payload.productType}
            onChange={(e) => patch({ productType: e.target.value.trim().toUpperCase() })}
            placeholder="COSMETIC_CASE, BAG, SHOES…"
            className="h-9"
          />
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {COMMON_PRODUCT_TYPES.map((opt) => {
              const selected = draft.payload.productType === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => patch({ productType: opt.id })}
                  className={`text-[11px] rounded-md border px-2 py-1 transition-colors ${
                    selected
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {suggestedType && draft.payload.productType === "PRODUCT" ? (
              <>
                Sugestão para este título:{" "}
                <button
                  type="button"
                  className="text-primary hover:underline font-medium"
                  onClick={() => patch({ productType: suggestedType })}
                >
                  {suggestedType}
                </button>
                .{" "}
              </>
            ) : null}
            Deve existir no catálogo Amazon BR. Evite o genérico PRODUCT.
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

      <div className="space-y-1.5">
        <Label>Marca</Label>
        <Input
          value={brand}
          onChange={(e) => patch({ brand: e.target.value })}
          className="h-9"
        />
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

      <div className="space-y-1.5">
        <Label>Fotos ({images.length})</Label>
        {images.length === 0 ? (
          <p className="text-xs text-destructive">Nenhuma foto no rascunho.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
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
      </div>
    </div>
  );
}
