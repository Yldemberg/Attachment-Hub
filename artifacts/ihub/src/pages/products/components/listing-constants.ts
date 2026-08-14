export const MLB_LISTING_TYPES = [
  { id: "gold_special", label: "Clássico" },
  { id: "gold_pro", label: "Premium" },
  { id: "gold_premium", label: "Diamante" },
] as const;

export const LISTING_CONDITIONS = [
  { id: "new", label: "Novo" },
  { id: "used", label: "Usado" },
] as const;

export const WIZARD_STEPS = [
  { id: 1, label: "Conta e título" },
  { id: 2, label: "Categoria" },
  { id: 3, label: "Atributos" },
  { id: 4, label: "Fotos e preço" },
  { id: 5, label: "Revisão" },
] as const;

export type ListingFormAttribute = {
  id: string;
  value_name: string;
  value_id?: string;
  name?: string;
  groupName?: string;
};

export type UploadedPicture = {
  id: string;
  url: string;
  previewUrl?: string;
};
