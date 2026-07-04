import type { N8nListingDraft } from "@workspace/api-client-react";

export const PREPARE_JOB_TIMEOUT_MS = 15 * 60 * 1000;

export const N8N_CREATE_STEPS = [
  { id: 1, label: "Link do produto" },
  { id: 2, label: "Revisão e publicação" },
] as const;

export function isSupportedProductUrl(productUrl: string): boolean {
  try {
    const host = new URL(productUrl.trim()).hostname.toLowerCase();
    return (
      host.includes("amazon.") ||
      host === "amzn.to" ||
      host.includes("amzn.") ||
      host.includes("shopee.") ||
      host === "shope.ee"
    );
  } catch {
    return false;
  }
}

export function updateDraftPayload(
  draft: N8nListingDraft,
  patch: Partial<N8nListingDraft["payload"]>,
): N8nListingDraft {
  return {
    ...draft,
    payload: {
      ...draft.payload,
      ...patch,
    },
  };
}

export function updateDraftDescription(draft: N8nListingDraft, description: string): N8nListingDraft {
  return { ...draft, _description: description };
}

export function removeDraftPicture(draft: N8nListingDraft, index: number): N8nListingDraft {
  return updateDraftPayload(draft, {
    pictures: draft.payload.pictures.filter((_, i) => i !== index),
  });
}

export function updateDraftAttributeValue(
  draft: N8nListingDraft,
  attributeId: string,
  value: { value_name?: string; value_id?: string },
): N8nListingDraft {
  const attributes = draft.payload.attributes.map((attr) =>
    attr.id === attributeId
      ? {
          ...attr,
          ...(value.value_name !== undefined ? { value_name: value.value_name } : {}),
          ...(value.value_id !== undefined ? { value_id: value.value_id } : {}),
        }
      : attr,
  );

  const syncReviewList = (items: N8nListingDraft["_attributes_ficticios"]) =>
    items?.map((item) =>
      item.id === attributeId
        ? {
            ...item,
            valor: {
              ...item.valor,
              ...(value.value_name !== undefined ? { value_name: value.value_name } : {}),
              ...(value.value_id !== undefined ? { value_id: value.value_id } : {}),
            },
          }
        : item,
    );

  return {
    ...draft,
    payload: { ...draft.payload, attributes },
    _attributes_ficticios: syncReviewList(draft._attributes_ficticios),
  };
}

export function canPublishDraft(draft: N8nListingDraft): boolean {
  return (
    draft.payload.family_name.trim().length > 0 &&
    draft.payload.pictures.length > 0 &&
    draft.payload.available_quantity >= 0 &&
    (draft.payload.price ?? 0) > 0
  );
}
