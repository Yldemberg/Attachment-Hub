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

/** Fallback when the ML API does not send `name` (labels of the seller form on MLB). */
const ML_ATTRIBUTE_LABELS_PT: Record<string, string> = {
  BRAND: "Marca",
  MODEL: "Modelo",
  LINE: "Linha",
  COLOR: "Cor",
  MAIN_COLOR: "Cor principal",
  GENDER: "Gênero",
  GTIN: "GTIN",
  MPN: "MPN",
  SELLER_SKU: "SKU",
  MATERIAL: "Material",
  WEIGHT: "Peso",
  HEIGHT: "Altura",
  WIDTH: "Largura",
  DEPTH: "Profundidade",
  VOLUME_CAPACITY: "Capacidade em volume",
  CLOSURE_TYPE: "Tipo de fecho",
  CLOSURE_TYPES: "Tipos de fecho",
  IS_WATERPROOF: "É à prova d'água",
  IS_FOLDABLE: "É dobrável",
  WITH_WHEELS: "Com rodas",
  WITH_RECYCLED_MATERIALS: "Com materiais reciclados",
  WITH_ADJUSTABLE_SHOULDER_STRAP: "Com correia de ombro ajustável",
  POCKETS_NUMBER: "Quantidade de bolsos",
  USE_TYPE: "Tipo de uso",
  SELLER_PACKAGE_LENGTH: "Comprimento da embalagem do vendor",
  SELLER_PACKAGE_HEIGHT: "Altura da embalagem do vendor",
  SELLER_PACKAGE_WIDTH: "Largura da embalagem do vendor",
  SELLER_PACKAGE_WEIGHT: "Peso da embalagem do vendor",
  PACKAGE_LENGTH: "Comprimento da embalagem",
  PACKAGE_HEIGHT: "Altura da embalagem",
  PACKAGE_WIDTH: "Largura da embalagem",
  PACKAGE_WEIGHT: "Peso da embalagem",
  KELLER_PACKAGE_LENGTH: "Comprimento da embalagem",
  KELLER_PACKAGE_HEIGHT: "Altura da embalagem",
  KELLER_PACKAGE_WIDTH: "Largura da embalagem",
  KELLER_PACKAGE_WEIGHT: "Peso da embalagem",
  IS_FLAMMABLE: "É inflamável",
  PACKAGE_DATA_SOURCE: "Origem do dado do pacote de fábrica",
  HAZMAT_TRANSPORTABILITY: "Transportabilidade Hazmat",
  IS_KIT: "É kit",
  DESCRIPTIVE_TAGS: "Tags descritivos",
  PRODUCT_CHEMICAL_FEATURES: "Características químicas do produto",
  FOODS_AND_DRINKS: "Alimentos e bebidas",
  MEDICINES: "Medicamentos",
  BATTERIES_FEATURES: "Características das baterias",
  SHIPMENT_PACKING: "Embalagem para envio",
  WARRANTY_TIME: "Tempo de garantia",
  WARRANTY_TYPE: "Tipo de garantia",
  MANUFACTURING_TIME: "Tempo de fabricação",
};

function looksLikeAttributeId(value: string): boolean {
  return /^[A-Z][A-Z0-9_]+$/.test(value.trim());
}

export function mlAttributeLabel(row: { id: string; name?: string }): string {
  const fromApi = row.name?.trim();
  if (fromApi && !looksLikeAttributeId(fromApi)) return fromApi;
  return ML_ATTRIBUTE_LABELS_PT[row.id] ?? fromApi ?? row.id;
}

export type UploadedPicture = {
  id: string;
  url: string;
  previewUrl?: string;
};
