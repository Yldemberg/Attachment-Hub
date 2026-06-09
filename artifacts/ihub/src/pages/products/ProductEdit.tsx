import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import {
  useGetProductListingDetail,
  useGetProductCategoryAttributes,
  useUploadProductPicture,
  useUpdateProduct,
  getGetProductQueryKey,
  getGetProductListingDetailQueryKey,
  getGetProductCategoryAttributesQueryKey,
  getListProductsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { buildProductsListReturnPath } from "@/lib/products-list-persistence";
import type { ListingFormAttribute, UploadedPicture } from "./components/listing-constants";
import { DynamicAttributesForm, validateRequiredAttributes } from "./components/DynamicAttributesForm";
import { PictureUploader, readFileAsBase64 } from "./components/PictureUploader";

export default function ProductEdit() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: detail, isLoading } = useGetProductListingDetail(id!, {
    query: { queryKey: getGetProductListingDetailQueryKey(id!), enabled: !!id },
  });

  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [availableQuantity, setAvailableQuantity] = useState("");
  const [description, setDescription] = useState("");
  const [pictures, setPictures] = useState<UploadedPicture[]>([]);
  const [attributes, setAttributes] = useState<ListingFormAttribute[]>([]);
  const [initialized, setInitialized] = useState(false);

  const accountId = detail?.product?.accountId ?? "";
  const categoryId = detail?.categoryId ?? detail?.product?.mlCategoryId ?? "";
  const isFull = detail?.product?.isFull ?? false;
  const isClosed = detail?.product?.status === "closed";

  useEffect(() => {
    if (!detail || initialized) return;
    setTitle(detail.product?.title ?? "");
    setPrice(String(detail.product?.price ?? ""));
    setAvailableQuantity(String(detail.product?.availableQuantity ?? 0));
    setDescription(detail.description ?? "");
    setPictures(
      (detail.pictures ?? []).map((p) => ({ id: p.id, url: p.url })),
    );
    setAttributes(
      (detail.attributes ?? [])
        .filter((a) => a.id !== "ITEM_CONDITION" && a.value_name)
        .map((a) => ({
          id: a.id,
          value_name: a.value_name ?? "",
          value_id: a.value_id ?? undefined,
        })),
    );
    setInitialized(true);
  }, [detail, initialized]);

  const editAttrsParams = { account_id: accountId };
  const { data: attrsData, isLoading: loadingAttrs } = useGetProductCategoryAttributes(
    categoryId,
    editAttrsParams,
    {
      query: {
        queryKey: getGetProductCategoryAttributesQueryKey(categoryId, editAttrsParams),
        enabled: !!categoryId && !!accountId,
        staleTime: 300_000,
      },
    },
  );
  const categoryAttributes = attrsData?.data ?? [];

  const { mutateAsync: uploadPicture, isPending: uploadingPicture } = useUploadProductPicture();
  const { mutate: updateProduct, isPending: saving } = useUpdateProduct({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetProductQueryKey(id!) });
        queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
        toast({ title: "Anúncio atualizado", description: "As alterações foram salvas no Mercado Livre." });
        navigate(`/products/${id}`);
      },
      onError: (err: Error) => {
        toast({
          variant: "destructive",
          title: "Falha ao salvar",
          description: err.message || "Não foi possível atualizar o anúncio.",
        });
      },
    },
  });

  const handleUpload = async (file: File): Promise<UploadedPicture> => {
    const imageBase64 = await readFileAsBase64(file);
    const result = await uploadPicture({
      data: { accountId, imageBase64, mimeType: file.type || "image/jpeg" },
    });
    return { id: result.id, url: result.url };
  };

  const handleSave = () => {
    const attrErr = validateRequiredAttributes(categoryAttributes, attributes);
    if (attrErr) {
      toast({ variant: "destructive", title: "Atributos obrigatórios", description: attrErr });
      return;
    }
    if (pictures.length === 0) {
      toast({ variant: "destructive", title: "Fotos obrigatórias", description: "O anúncio precisa de ao menos uma foto." });
      return;
    }

    updateProduct({
      id: id!,
      data: {
        title: title.trim(),
        price: Number(price),
        availableQuantity: isFull ? undefined : Number(availableQuantity),
        pictures: pictures.map((p) => p.id),
        attributes,
        description: description.trim() || undefined,
      },
    });
  };

  if (isLoading) {
    return (
      <div className="h-full overflow-y-auto bg-background p-6 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        Carregando anúncio…
      </div>
    );
  }

  if (!detail?.product) {
    return (
      <div className="h-full overflow-y-auto bg-background p-6 text-center">
        <p className="text-muted-foreground">Anúncio não encontrado</p>
        <Button variant="outline" size="sm" onClick={() => navigate(buildProductsListReturnPath())} className="mt-4">
          Voltar
        </Button>
      </div>
    );
  }

  if (isClosed) {
    return (
      <div className="h-full overflow-y-auto bg-background p-6 text-center max-w-md mx-auto">
        <p className="text-muted-foreground">Anúncios encerrados não podem ser editados.</p>
        <Button variant="outline" size="sm" onClick={() => navigate(`/products/${id}`)} className="mt-4">
          Voltar ao detalhe
        </Button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="p-6 space-y-6 max-w-2xl mx-auto">
        <button
          onClick={() => navigate(`/products/${id}`)}
          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-sm transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Voltar ao anúncio
        </button>

        <div>
          <h1 className="text-lg font-bold text-foreground">Editar anúncio</h1>
          <p className="text-sm text-muted-foreground font-mono mt-0.5">{detail.product.mlItemId}</p>
        </div>

        <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
          <div className="space-y-1.5">
            <Label>Título</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-9" />
          </div>

          <div className="space-y-1.5">
            <Label>Fotos</Label>
            <PictureUploader
              pictures={pictures}
              onPicturesChange={setPictures}
              onUpload={handleUpload}
              uploading={uploadingPicture}
              onError={(message) =>
                toast({ variant: "destructive", title: "Falha no upload", description: message })
              }
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
                disabled={isFull}
                className="h-9"
              />
              {isFull ? (
                <p className="text-[11px] text-muted-foreground">Estoque FULL é gerenciado pelo ML.</p>
              ) : null}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Descrição</Label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              className="w-full bg-input border border-border text-sm rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-y min-h-[100px]"
            />
          </div>

          {categoryId ? (
            <div className="border-t border-border pt-4">
              <h2 className="text-sm font-semibold text-foreground mb-3">Atributos da categoria</h2>
              {loadingAttrs ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Carregando…
                </div>
              ) : (
                <DynamicAttributesForm
                  attributes={categoryAttributes}
                  values={attributes}
                  onChange={setAttributes}
                />
              )}
            </div>
          ) : null}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => navigate(`/products/${id}`)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
            Salvar alterações
          </Button>
        </div>
      </div>
    </div>
  );
}
