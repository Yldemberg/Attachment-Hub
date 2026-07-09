import type {
  IhubUiCampo,
  N8nListingAttributeReview,
  N8nListingDraft,
} from "@workspace/api-client-react";

/** Atributos do ML que não ajudam na publicação e poluem a revisão. */
export const HIDDEN_LISTING_ATTRIBUTE_IDS = new Set([
  "HAZMAT_TRANSPORTABILITY",
  "EXCLUDED_PLATFORMS",
  "IS_FLAMMABLE",
  "WITH_POSITIVE_IMPACT",
  "HAS_COMPATIBILITIES",
  "IS_NEW_OFFER",
  "IS_SUITABLE_FOR_SHIPMENT",
  "WITH_EXPIRATION_DATE",
  "EXPIRATION_DATE",
  "ITEM_CONDITION",
]);

export const FACTORY_PACKAGE_ATTRIBUTE_IDS = [
  "PACKAGE_HEIGHT",
  "PACKAGE_WIDTH",
  "PACKAGE_LENGTH",
  "PACKAGE_WEIGHT",
] as const;

/** Campos prioritários para publicação (sempre editáveis quando aplicável). */
export const PRIORITY_ATTRIBUTE_IDS = [
  "SELLER_SKU",
  "GTIN",
  "BRAND",
  "MODEL",
  "NET_VOLUME",
  "NET_WEIGHT",
  "SALE_FORMAT",
  "UNITS_PER_PACK",
  "UNIT_VOLUME",
  "COLOR",
  "SIZE",
] as const;

export const WARRANTY_SALE_TERM_IDS = ["WARRANTY_TYPE", "WARRANTY_TIME"] as const;

export const ATTR_LABELS: Record<string, string> = {
  SELLER_SKU: "SKU",
  GTIN: "Código universal de produto (GTIN)",
  BRAND: "Marca",
  MODEL: "Modelo",
  NET_VOLUME: "Volume líquido",
  NET_WEIGHT: "Peso líquido",
  SALE_FORMAT: "Formato de venda",
  UNITS_PER_PACK: "Unidades por kit",
  UNIT_VOLUME: "Volume da unidade",
  COLOR: "Cor",
  SIZE: "Tamanho",
  WARRANTY_TYPE: "Tipo de garantia",
  WARRANTY_TIME: "Tempo de garantia",
  PACKAGE_HEIGHT: "Altura da embalagem de fábrica",
  PACKAGE_WIDTH: "Largura da embalagem de fábrica",
  PACKAGE_LENGTH: "Comprimento da embalagem de fábrica",
  PACKAGE_WEIGHT: "Peso da embalagem de fábrica",
  SELLER_PACKAGE_HEIGHT: "Altura da embalagem de envio",
  SELLER_PACKAGE_WIDTH: "Largura da embalagem de envio",
  SELLER_PACKAGE_LENGTH: "Comprimento da embalagem de envio",
  SELLER_PACKAGE_WEIGHT: "Peso da embalagem de envio",
};

export const WARRANTY_TYPE_OPTIONS = [
  { id: "2230279", name: "Garantia de fábrica" },
  { id: "2230280", name: "Garantia do vendedor" },
  { id: "6150835", name: "Sem garantia" },
] as const;

export type ReviewFieldGroup =
  | "essenciais"
  | "caracteristicas"
  | "embalagem_fabrica"
  | "embalagem_envio"
  | "outros";

export type ReviewEditableField = {
  id: string;
  label: string;
  group: ReviewFieldGroup;
  valueName: string;
  valueId?: string | null;
  required?: boolean;
  kind: "attribute" | "sale_term";
  inputType?: "text" | "number" | "select";
  options?: Array<{ id: string; name: string }>;
};

function labelFor(id: string, fallback?: string): string {
  return ATTR_LABELS[id] ?? fallback ?? id;
}

export function isHiddenListingAttribute(id: string): boolean {
  return HIDDEN_LISTING_ATTRIBUTE_IDS.has(id);
}

function groupForAttribute(id: string): ReviewFieldGroup {
  if (id === "SELLER_SKU" || id === "GTIN" || id === "BRAND" || id === "MODEL") {
    return "essenciais";
  }
  if ((FACTORY_PACKAGE_ATTRIBUTE_IDS as readonly string[]).includes(id)) {
    return "embalagem_fabrica";
  }
  if (id.startsWith("SELLER_PACKAGE_")) return "embalagem_envio";
  if (
    id === "NET_VOLUME" ||
    id === "NET_WEIGHT" ||
    id === "SALE_FORMAT" ||
    id === "UNITS_PER_PACK" ||
    id === "COLOR" ||
    id === "SIZE" ||
    id === "UNIT_VOLUME"
  ) {
    return "caracteristicas";
  }
  return "outros";
}

function collectNamedAttributes(draft: N8nListingDraft): Map<string, { name: string; value_name?: string; value_id?: string | null }> {
  const map = new Map<string, { name: string; value_name?: string; value_id?: string | null }>();

  const addReview = (items: N8nListingAttributeReview[] | undefined) => {
    for (const item of items ?? []) {
      if (!item.id || isHiddenListingAttribute(item.id)) continue;
      map.set(item.id, {
        name: item.name || labelFor(item.id),
        value_name: item.valor?.value_name,
        value_id: item.valor?.value_id,
      });
    }
  };

  addReview(draft._attributes_ficticios);
  addReview(draft._attributes_preenchidos_inteligente);

  for (const attr of draft.payload.attributes) {
    if (!attr.id || isHiddenListingAttribute(attr.id)) continue;
    const prev = map.get(attr.id);
    map.set(attr.id, {
      name: prev?.name ?? labelFor(attr.id),
      value_name: attr.value_name ?? prev?.value_name,
      value_id: attr.value_id ?? prev?.value_id,
    });
  }

  // Garante SKU mesmo se o N8N não enviou; demais prioritários só se já existirem no draft
  if (!map.has("SELLER_SKU")) {
    map.set("SELLER_SKU", { name: labelFor("SELLER_SKU"), value_name: "", value_id: null });
  }

  return map;
}

export function buildReviewEditableFields(
  draft: N8nListingDraft,
  requiredIds: string[] = [],
): ReviewEditableField[] {
  const required = new Set(requiredIds);
  const attrs = collectNamedAttributes(draft);
  // Inclui atributos exigidos pelo ML (ex.: UNITS_PER_PACK) mesmo se ainda não existirem
  for (const id of requiredIds) {
    if (isHiddenListingAttribute(id)) continue;
    if (!attrs.has(id)) {
      attrs.set(id, { name: labelFor(id), value_name: "", value_id: null });
    }
  }

  const fields: ReviewEditableField[] = [];

  for (const [id, meta] of attrs) {
    fields.push({
      id,
      label: labelFor(id, meta.name),
      group: groupForAttribute(id),
      valueName: meta.value_name ?? "",
      valueId: meta.value_id,
      required: required.has(id) || id === "SELLER_SKU",
      kind: "attribute",
      inputType: id === "UNITS_PER_PACK" ? "number" : "text",
    });
  }

  // Garantia (sale_terms)
  const saleTerms = draft.payload.sale_terms ?? [];
  const warrantyType = saleTerms.find((t) => t.id === "WARRANTY_TYPE");
  const warrantyTime = saleTerms.find((t) => t.id === "WARRANTY_TIME");

  fields.push({
    id: "WARRANTY_TYPE",
    label: "Tipo de garantia",
    group: "essenciais",
    valueName: warrantyType?.value_name ?? "",
    valueId: warrantyType?.value_id,
    required: true,
    kind: "sale_term",
    inputType: "select",
    options: WARRANTY_TYPE_OPTIONS.map((o) => ({ id: o.id, name: o.name })),
  });

  fields.push({
    id: "WARRANTY_TIME",
    label: "Tempo de garantia",
    group: "essenciais",
    valueName: warrantyTime?.value_name ?? "",
    valueId: warrantyTime?.value_id,
    required: warrantyType?.value_id !== "6150835" && warrantyType?.value_name !== "Sem garantia",
    kind: "sale_term",
    inputType: "text",
  });

  const order: ReviewFieldGroup[] = [
    "essenciais",
    "caracteristicas",
    "embalagem_fabrica",
    "embalagem_envio",
    "outros",
  ];
  const priorityIndex = new Map(PRIORITY_ATTRIBUTE_IDS.map((id, i) => [id, i]));

  return fields.sort((a, b) => {
    const g = order.indexOf(a.group) - order.indexOf(b.group);
    if (g !== 0) return g;
    const pa = priorityIndex.get(a.id as (typeof PRIORITY_ATTRIBUTE_IDS)[number]) ?? 999;
    const pb = priorityIndex.get(b.id as (typeof PRIORITY_ATTRIBUTE_IDS)[number]) ?? 999;
    if (pa !== pb) return pa - pb;
    return a.label.localeCompare(b.label, "pt-BR");
  });
}

export const REVIEW_GROUP_LABELS: Record<ReviewFieldGroup, string> = {
  essenciais: "Essenciais para publicação",
  caracteristicas: "Características principais e secundárias",
  embalagem_fabrica: "Embalagem de fábrica",
  embalagem_envio: "Embalagem de envio",
  outros: "Outros atributos",
};

/** Filtra seções/campos _ihub_ui ocultos e força edição (ignora somente_leitura). */
export function filterEditableIhubUiCampos(campos: IhubUiCampo[] | undefined): IhubUiCampo[] {
  return (campos ?? [])
    .filter((campo) => !isHiddenListingAttribute(campo.id))
    .map((campo) => ({
      ...campo,
      somente_leitura: false,
      label: labelFor(campo.id, campo.label),
    }));
}
