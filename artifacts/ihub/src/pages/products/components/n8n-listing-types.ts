import type {
  IhubUiCampo,
  IhubUiSecao,
  N8nListingDraft,
  N8nListingSaleTerm,
} from "@workspace/api-client-react";

export const PREPARE_JOB_TIMEOUT_MS = 60 * 1000;

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

function upsertAttribute(
  attributes: N8nListingDraft["payload"]["attributes"],
  attributeId: string,
  value: { value_name?: string; value_id?: string | null },
) {
  const exists = attributes.some((attr) => attr.id === attributeId);
  if (!exists) {
    return [
      ...attributes,
      {
        id: attributeId,
        ...(value.value_name !== undefined ? { value_name: value.value_name } : {}),
        ...(value.value_id !== undefined ? { value_id: value.value_id } : {}),
      },
    ];
  }

  return attributes.map((attr) =>
    attr.id === attributeId
      ? {
          ...attr,
          ...(value.value_name !== undefined ? { value_name: value.value_name } : {}),
          ...(value.value_id !== undefined ? { value_id: value.value_id } : {}),
        }
      : attr,
  );
}

function upsertSaleTerm(
  saleTerms: N8nListingSaleTerm[] | undefined,
  termId: string,
  value: { value_name?: string; value_id?: string | null },
): N8nListingSaleTerm[] {
  const current = saleTerms ?? [];
  const exists = current.some((term) => term.id === termId);
  if (!exists) {
    return [
      ...current,
      {
        id: termId,
        ...(value.value_name !== undefined ? { value_name: value.value_name } : {}),
        ...(value.value_id !== undefined ? { value_id: value.value_id } : {}),
      },
    ];
  }

  return current.map((term) =>
    term.id === termId
      ? {
          ...term,
          ...(value.value_name !== undefined ? { value_name: value.value_name } : {}),
          ...(value.value_id !== undefined ? { value_id: value.value_id } : {}),
        }
      : term,
  );
}

function syncCampoValue(campo: IhubUiCampo, value: { value_name?: string; value_id?: string | null }): IhubUiCampo {
  const nextValor =
    value.value_name !== undefined
      ? value.value_name
      : value.value_id !== undefined
        ? value.value_id
        : campo.valor;

  return {
    ...campo,
    ...(value.value_name !== undefined ? { value_name: value.value_name } : {}),
    ...(value.value_id !== undefined ? { value_id: value.value_id } : {}),
    valor: nextValor,
  };
}

export function isCampoFilled(campo: IhubUiCampo, draft: N8nListingDraft): boolean {
  if (campo.destino_payload === "description") {
    return Boolean(draft._description?.trim());
  }

  if (campo.destino_payload === "shipping") {
    const shipping = draft.payload.shipping ?? {};
    const raw = shipping[campo.id];
    if (typeof raw === "boolean") return true;
    if (raw == null) return false;
    return String(raw).trim().length > 0;
  }

  if (campo.destino_payload === "sale_terms") {
    const term = draft.payload.sale_terms?.find((item) => item.id === campo.id);
    return Boolean(term?.value_name?.trim() || term?.value_id);
  }

  const attr = draft.payload.attributes.find((item) => item.id === campo.id);
  return Boolean(attr?.value_name?.trim() || attr?.value_id);
}

function refreshIhubUi(draft: N8nListingDraft, touchedFieldId?: string, touchedValue?: { value_name?: string; value_id?: string | null }): N8nListingDraft["_ihub_ui"] {
  if (!draft._ihub_ui) return draft._ihub_ui;

  const mapCampos = (campos: IhubUiCampo[] | undefined) =>
    campos?.map((campo) => {
      if (!touchedFieldId || !touchedValue) return campo;
      const matchesId = campo.id === touchedFieldId;
      const matchesDescription =
        touchedFieldId === "description" && campo.destino_payload === "description";
      return matchesId || matchesDescription ? syncCampoValue(campo, touchedValue) : campo;
    });

  const secoes = draft._ihub_ui.secoes?.map((secao) => {
    const campos = mapCampos(secao.campos) ?? secao.campos;
    if (secao.status === "somente_leitura") {
      return { ...secao, campos };
    }
    const hasPendingRequired = campos.some(
      (campo) => campo.obrigatorio && !campo.somente_leitura && !isCampoFilled(campo, draft),
    );
    return {
      ...secao,
      campos,
      status: hasPendingRequired ? ("pendente" as const) : ("completo" as const),
    };
  });

  return {
    ...draft._ihub_ui,
    secoes,
    campos_editaveis: mapCampos(draft._ihub_ui.campos_editaveis),
  };
}

export function revalidateDraftReadiness(draft: N8nListingDraft): N8nListingDraft {
  const withUi = draft._ihub_ui
    ? { ...draft, _ihub_ui: refreshIhubUi(draft) }
    : draft;

  if (!withUi._ihub_ui && withUi._pronto_para_publicar === undefined) {
    return withUi;
  }

  const blocking = hasBlockingPendingIhubUi(withUi);
  const mlErrors = withUi._erros_validacao_ml?.length ?? 0;
  return {
    ...withUi,
    _pronto_para_publicar: !blocking && mlErrors === 0,
  };
}

export function updateDraftPayload(
  draft: N8nListingDraft,
  patch: Partial<N8nListingDraft["payload"]>,
): N8nListingDraft {
  return revalidateDraftReadiness({
    ...draft,
    payload: {
      ...draft.payload,
      ...patch,
    },
  });
}

export function updateDraftDescription(draft: N8nListingDraft, description: string): N8nListingDraft {
  const next = { ...draft, _description: description };
  return revalidateDraftReadiness({
    ...next,
    _ihub_ui: refreshIhubUi(next, "description", { value_name: description }),
  });
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
  const attributes = upsertAttribute(draft.payload.attributes, attributeId, value);

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

  const next: N8nListingDraft = {
    ...draft,
    payload: { ...draft.payload, attributes },
    _attributes_ficticios: syncReviewList(draft._attributes_ficticios),
  };

  return revalidateDraftReadiness({
    ...next,
    _ihub_ui: refreshIhubUi(next, attributeId, value),
  });
}

export function updateDraftIhubUiCampo(
  draft: N8nListingDraft,
  campo: IhubUiCampo,
  value: { value_name?: string; value_id?: string | null },
): N8nListingDraft {
  if (campo.somente_leitura) return draft;

  if (campo.destino_payload === "description") {
    return updateDraftDescription(draft, value.value_name ?? "");
  }

  if (campo.destino_payload === "shipping") {
    const shippingValue =
      campo.tipo === "boolean"
        ? value.value_name === "true" || value.value_id === "true"
        : campo.tipo === "number"
          ? Number(value.value_name)
          : (value.value_name ?? value.value_id ?? "");

    const next: N8nListingDraft = {
      ...draft,
      payload: {
        ...draft.payload,
        shipping: {
          ...(draft.payload.shipping ?? {}),
          [campo.id]: shippingValue,
        },
      },
    };
    return revalidateDraftReadiness({
      ...next,
      _ihub_ui: refreshIhubUi(next, campo.id, value),
    });
  }

  if (campo.destino_payload === "sale_terms") {
    const next: N8nListingDraft = {
      ...draft,
      payload: {
        ...draft.payload,
        sale_terms: upsertSaleTerm(draft.payload.sale_terms, campo.id, value),
      },
    };
    return revalidateDraftReadiness({
      ...next,
      _ihub_ui: refreshIhubUi(next, campo.id, value),
    });
  }

  return updateDraftAttributeValue(draft, campo.id, {
    ...(value.value_name !== undefined ? { value_name: value.value_name } : {}),
    ...(value.value_id !== undefined && value.value_id !== null ? { value_id: value.value_id } : {}),
  });
}

export function getIhubUiSecoes(draft: N8nListingDraft): IhubUiSecao[] {
  return draft._ihub_ui?.secoes ?? [];
}

export function getPendingRequiredIhubUiCampos(draft: N8nListingDraft): IhubUiCampo[] {
  return getIhubUiSecoes(draft).flatMap((secao) =>
    secao.status === "pendente"
      ? (secao.campos ?? []).filter(
          (campo) => campo.obrigatorio && !campo.somente_leitura && !isCampoFilled(campo, draft),
        )
      : [],
  );
}

export function hasBlockingPendingIhubUi(draft: N8nListingDraft): boolean {
  return getPendingRequiredIhubUiCampos(draft).length > 0;
}

export function canPublishDraft(draft: N8nListingDraft): boolean {
  const basics =
    draft.payload.family_name.trim().length > 0 &&
    draft.payload.pictures.length > 0 &&
    draft.payload.available_quantity >= 0 &&
    (draft.payload.price ?? 0) > 0;

  if (!basics) return false;
  if ((draft._erros_validacao_ml?.length ?? 0) > 0) return false;
  if (hasBlockingPendingIhubUi(draft)) return false;
  if (draft._pronto_para_publicar === false) return false;
  return true;
}

export function getCampoDisplayValue(campo: IhubUiCampo, draft: N8nListingDraft): string {
  if (campo.destino_payload === "description") {
    return draft._description ?? "";
  }

  if (campo.destino_payload === "shipping") {
    const raw = draft.payload.shipping?.[campo.id];
    if (typeof raw === "boolean") return raw ? "true" : "false";
    if (raw == null) return campo.value_name ?? (campo.valor == null ? "" : String(campo.valor));
    return String(raw);
  }

  if (campo.destino_payload === "sale_terms") {
    const term = draft.payload.sale_terms?.find((item) => item.id === campo.id);
    return (
      term?.value_name ??
      term?.value_id ??
      campo.value_name ??
      (campo.valor == null ? "" : String(campo.valor))
    );
  }

  const attr = draft.payload.attributes.find((item) => item.id === campo.id);
  return (
    attr?.value_name ??
    attr?.value_id ??
    campo.value_name ??
    (campo.valor == null ? "" : String(campo.valor))
  );
}
