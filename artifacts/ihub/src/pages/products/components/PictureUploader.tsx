import { useRef } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UploadedPicture } from "./listing-constants";

const MAX_PICTURES = 12;
const MAX_SIZE_MB = 10;

type Props = {
  pictures: UploadedPicture[];
  onPicturesChange: (pictures: UploadedPicture[]) => void;
  onUpload: (file: File) => Promise<UploadedPicture>;
  uploading?: boolean;
  disabled?: boolean;
};

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.includes(",") ? result.split(",")[1]! : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Falha ao ler arquivo"));
    reader.readAsDataURL(file);
  });
}

export { readFileAsBase64, MAX_PICTURES };

export function PictureUploader({ pictures, onPicturesChange, onUpload, uploading, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length || disabled) return;
    const remaining = MAX_PICTURES - pictures.length;
    const toProcess = Array.from(files).slice(0, remaining);

    for (const file of toProcess) {
      if (file.size > MAX_SIZE_MB * 1024 * 1024) continue;
      if (!file.type.startsWith("image/")) continue;
      const previewUrl = URL.createObjectURL(file);
      try {
        const uploaded = await onUpload(file);
        onPicturesChange([...pictures, { ...uploaded, previewUrl }]);
      } catch {
        URL.revokeObjectURL(previewUrl);
      }
    }
    if (inputRef.current) inputRef.current.value = "";
  };

  const removePicture = (index: number) => {
    const removed = pictures[index];
    if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
    onPicturesChange(pictures.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {pictures.map((pic, i) => (
          <div key={pic.id} className="relative size-20 rounded-lg overflow-hidden border border-border bg-muted">
            <img
              src={pic.previewUrl ?? pic.url}
              alt=""
              className="w-full h-full object-cover"
            />
            {!disabled && (
              <button
                type="button"
                onClick={() => removePicture(i)}
                className="absolute top-1 right-1 size-5 rounded-full bg-background/90 border border-border flex items-center justify-center text-muted-foreground hover:text-destructive"
                aria-label="Remover foto"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}
        {pictures.length < MAX_PICTURES && !disabled && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="size-20 rounded-lg border border-dashed border-border flex flex-col items-center justify-center gap-1 text-muted-foreground hover:border-primary hover:text-primary transition-colors"
          >
            {uploading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <ImagePlus className="w-5 h-5" />
                <span className="text-[10px]">Adicionar</span>
              </>
            )}
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => void handleFiles(e.target.files)}
      />
      <p className="text-[11px] text-muted-foreground">
        Até {MAX_PICTURES} fotos, máximo {MAX_SIZE_MB} MB cada. A primeira será a capa.
      </p>
      {pictures.length === 0 && (
        <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={uploading || disabled}>
          Selecionar imagens
        </Button>
      )}
    </div>
  );
}
