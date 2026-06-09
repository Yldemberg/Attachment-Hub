import { useState } from "react";
import { useLocation } from "wouter";
import {
  useListAccounts,
  usePredictProductCategory,
  useGetProductCategoryAttributes,
  useUploadProductPicture,
  useCreateProduct,
  getListProductsQueryKey,
  getPredictProductCategoryQueryKey,
  getGetProductCategoryAttributesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/utils";
import { buildProductsListReturnPath } from "@/lib/products-list-persistence";
import {
  WIZARD_STEPS,
  MLB_LISTING_TYPES,
  LISTING_CONDITIONS,
  type ListingFormAttribute,
  type UploadedPicture,
} from "./components/listing-constants";
import { DynamicAttributesForm, validateRequiredAttributes } from "./components/DynamicAttributesForm";
import { PictureUploader, readFileAsBase64 } from "./components/PictureUploader";

export default function ProductCreate() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [step, setStep] = useState(1);
  const [accountId, setAccountId] = useState("");
  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [attributes, setAttributes] = useState<ListingFormAttribute[]>([]);
  const [pictures, setPictures] = useState<UploadedPicture[]>([]);
  const [price, setPrice] = useState("");
  const [availableQuantity, setAvailableQuantity] = useState("1");
  const [condition, setCondition] = useState<"new" | "used">("new");
  const [listingTypeId, setListingTypeId] = useState("gold_special");
  const [description, setDescription] = useState("");

  const { data: accountsData } = useListAccounts();
  const accounts = accountsData?.data ?? [];

  const predictEnabled = step >= 2 && accountId.length > 0 && title.trim().length >= 3;
  const predictParams = { account_id: accountId, title: title.trim() };
  const { data: predictData, isLoading: predicting } = usePredictProductCategory(
    predictParams,
    {
      query: {
        queryKey: getPredictProductCategoryQueryKey(predictParams),
        enabled: predictEnabled,
        staleTime: 60_000,
      },
    },
  );
  const predictions = predictData?.data ?? [];

  const attrsEnabled = step >= 3 && accountId.length > 0 && categoryId.length > 0;
  const attrsParams = { account_id: accountId };
  const { data: attrsData, isLoading: loadingAttrs } = useGetProductCategoryAttributes(
    categoryId,
    attrsParams,
    {
      query: {
        queryKey: getGetProductCategoryAttributesQueryKey(categoryId, attrsParams),
        enabled: attrsEnabled,
        staleTime: 300_000,
      },
    },
  );
  const categoryAttributes = attrsData?.data ?? [];

  const { mutateAsync: uploadPicture, isPending: uploadingPicture } = useUploadProductPicture();
  const { mutate: createProduct, isPending: creating } = useCreateProduct({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
        toast({ title: "Anúncio publicado", description: "O anúncio foi criado no Mercado Livre." });
        navigate(buildProductsListReturnPath());
      },
      onError: (err: Error) => {
        toast({
          variant: "destructive",
          title: "Falha ao publicar",
          description: err.message || "Não foi possível criar o anúncio.",
        });
      },
    },
  });

  const handleUpload = async (file: File): Promise<UploadedPicture> => {
    if (!accountId) {
      throw new Error("Selecione a conta Mercado Livre no passo 1.");
    }
    const imageBase64 = await readFileAsBase64(file);
    const result = await uploadPicture({
      data: { accountId, imageBase64, mimeType: file.type || "image/jpeg" },
    });
    return { id: result.id, url: result.url };
  };

  const handleUploadError = (message: string) => {
    toast({ variant: "destructive", title: "Falha no upload", description: message });
  };

  const canGoNext = (): boolean => {
    if (step === 1) return accountId.length > 0 && title.trim().length >= 3;
    if (step === 2) return categoryId.length > 0;
    if (step === 3) return validateRequiredAttributes(categoryAttributes, attributes) === null;
    if (step === 4) {
      const p = Number(price);
      const q = Number(availableQuantity);
      return pictures.length > 0 && p > 0 && q >= 0;
    }
    return true;
  };

  const goNext = () => {
    if (step === 3) {
      const err = validateRequiredAttributes(categoryAttributes, attributes);
      if (err) {
        toast({ variant: "destructive", title: "Atributos obrigatórios", description: err });
        return;
      }
    }
    if (step === 4 && pictures.length === 0) {
      toast({ variant: "destructive", title: "Fotos obrigatórias", description: "Adicione ao menos uma foto." });
      return;
    }
    if (canGoNext()) setStep((s) => Math.min(5, s + 1));
  };

  const handlePublish = () => {
    const conditionAttr = LISTING_CONDITIONS.find((c) => c.id === condition);
    const allAttributes: ListingFormAttribute[] = [
      ...attributes,
      { id: "ITEM_CONDITION", value_name: conditionAttr?.label ?? "Novo" },
    ];

    createProduct({
      data: {
        accountId,
        title: title.trim(),
        categoryId,
        price: Number(price),
        availableQuantity: Number(availableQuantity),
        condition,
        listingTypeId,
        pictures: pictures.map((p) => p.id),
        attributes: allAttributes,
        description: description.trim() || undefined,
      },
    });
  };

  const selectCls =
    "w-full bg-input border border-border text-sm rounded-lg px-3 h-9 text-foreground focus:outline-none focus:ring-1 focus:ring-primary";

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="p-6 space-y-6 max-w-2xl mx-auto">
        <button
          onClick={() => navigate(buildProductsListReturnPath())}
          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-sm transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Produtos
        </button>

        <div>
          <h1 className="text-lg font-bold text-foreground">Criar anúncio</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Publique um novo anúncio no Mercado Livre</p>
        </div>

        <div className="flex items-center gap-1 overflow-x-auto pb-1">
          {WIZARD_STEPS.map((s) => (
            <div
              key={s.id}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap ${
                step === s.id
                  ? "bg-primary text-primary-foreground"
                  : step > s.id
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {step > s.id ? <Check className="w-3 h-3" /> : <span>{s.id}</span>}
              {s.label}
            </div>
          ))}
        </div>

        <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
          {step === 1 && (
            <>
              <div className="space-y-1.5">
                <Label>Conta Mercado Livre</Label>
                <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={selectCls}>
                  <option value="">Selecione a conta…</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.mlNickname ?? a.mlUserId ?? a.id}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Título do anúncio</Label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ex.: Tênis Nike Air Max 42 Preto"
                  className="h-9"
                />
                <p className="text-[11px] text-muted-foreground">Mínimo 3 caracteres. Use palavras-chave relevantes.</p>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <p className="text-sm text-muted-foreground">
                Sugestões de categoria para: <strong className="text-foreground">{title}</strong>
              </p>
              {predicting ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Buscando categorias…
                </div>
              ) : predictions.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma categoria encontrada. Ajuste o título.</p>
              ) : (
                <div className="space-y-2">
                  {predictions.map((p) => (
                    <button
                      key={p.categoryId}
                      type="button"
                      onClick={() => {
                        setCategoryId(p.categoryId);
                        setCategoryName(p.categoryName);
                        setAttributes([]);
                      }}
                      className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors ${
                        categoryId === p.categoryId
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/40"
                      }`}
                    >
                      <p className="text-sm font-medium text-foreground">{p.categoryName}</p>
                      {p.domainName ? (
                        <p className="text-[11px] text-muted-foreground mt-0.5">{p.domainName}</p>
                      ) : null}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {step === 3 && (
            <>
              {loadingAttrs ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Carregando atributos da categoria…
                </div>
              ) : (
                <DynamicAttributesForm
                  attributes={categoryAttributes}
                  values={attributes}
                  onChange={setAttributes}
                />
              )}
            </>
          )}

          {step === 4 && (
            <>
              <div className="space-y-1.5">
                <Label>Fotos</Label>
                <PictureUploader
                  pictures={pictures}
                  onPicturesChange={setPictures}
                  onUpload={handleUpload}
                  uploading={uploadingPicture}
                  disabled={!accountId}
                  onError={handleUploadError}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Preço (R$)</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    className="h-9"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Estoque</Label>
                  <Input
                    type="number"
                    min={0}
                    value={availableQuantity}
                    onChange={(e) => setAvailableQuantity(e.target.value)}
                    className="h-9"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Condição</Label>
                  <select
                    value={condition}
                    onChange={(e) => setCondition(e.target.value as "new" | "used")}
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
                    value={listingTypeId}
                    onChange={(e) => setListingTypeId(e.target.value)}
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
                <Label>Descrição (opcional)</Label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={5}
                  className="w-full bg-input border border-border text-sm rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-y min-h-[100px]"
                  placeholder="Descreva o produto, características, garantia…"
                />
              </div>
            </>
          )}

          {step === 5 && (
            <div className="space-y-3 text-sm">
              <div className="flex gap-3">
                {pictures[0] ? (
                  <img
                    src={pictures[0].previewUrl ?? pictures[0].url}
                    alt=""
                    className="size-16 rounded-lg object-cover border border-border"
                  />
                ) : null}
                <div>
                  <p className="font-medium text-foreground">{title}</p>
                  <p className="text-muted-foreground text-xs mt-0.5">{categoryName}</p>
                  <p className="text-amber-600 font-bold mt-1">{formatCurrency(Number(price))}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground">Estoque:</span> {availableQuantity} un.
                </div>
                <div>
                  <span className="text-muted-foreground">Condição:</span>{" "}
                  {LISTING_CONDITIONS.find((c) => c.id === condition)?.label}
                </div>
                <div>
                  <span className="text-muted-foreground">Tipo:</span>{" "}
                  {MLB_LISTING_TYPES.find((t) => t.id === listingTypeId)?.label}
                </div>
                <div>
                  <span className="text-muted-foreground">Fotos:</span> {pictures.length}
                </div>
              </div>
              {description.trim() ? (
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Descrição</p>
                  <p className="text-xs whitespace-pre-wrap line-clamp-4">{description}</p>
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            onClick={() => (step > 1 ? setStep((s) => s - 1) : navigate(buildProductsListReturnPath()))}
            disabled={creating}
          >
            {step > 1 ? "Voltar" : "Cancelar"}
          </Button>
          {step < 5 ? (
            <Button onClick={goNext} disabled={!canGoNext()}>
              Próximo
              <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          ) : (
            <Button onClick={handlePublish} disabled={creating}>
              {creating ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Publicar anúncio
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
