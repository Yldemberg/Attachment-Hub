import type {
  IhubUiCampo,
  IhubUiSecao,
  N8nListingDraft,
  N8nListingSaleTerm,
} from "@workspace/api-client-react";

/** Apify sync no N8N pode levar até ~5 min; dá folga para validação ML + callback. */
export const PREPARE_JOB_TIMEOUT_MS = 6 * 60 * 1000;

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
  if (!campo?.id) return false;

  const row = campo as IhubUiCampo & {
    preenchido?: boolean;
    valor_atual?: unknown;
    sugestao?: string;
  };
  if (row.preenchido === true) return true;

  if (campo.destino_payload === "description") {
    return Boolean(draft._description?.trim());
  }

  if (campo.destino_payload === "shipping") {
    const shipping = draft.payload.shipping ?? {};
    const key = campo.id.includes(".") ? campo.id.split(".").pop()! : campo.id;
    const raw = shipping[key];
    if (typeof raw === "boolean") return true;
    if (raw == null) return false;
    return String(raw).trim().length > 0;
  }

  if (campo.destino_payload === "sale_terms") {
    const term = draft.payload.sale_terms?.find((item) => item.id === campo.id);
    return Boolean(term?.value_name?.trim() || term?.value_id);
  }

  // Default / attributes (also when destino_payload is missing from N8N)
  const attr = draft.payload.attributes.find((item) => item.id === campo.id);
  if (attr?.value_name?.trim() || attr?.value_id) return true;
  if (campo.value_name?.trim() || campo.value_id) return true;
  if (campo.valor != null && String(campo.valor).trim().length > 0) return true;
  if (row.valor_atual != null) {
    if (typeof row.valor_atual === "object") {
      const v = row.valor_atual as { value_name?: string; value_id?: string | null };
      if (v.value_name?.trim() || v.value_id) return true;
    } else if (String(row.valor_atual).trim()) {
      return true;
    }
  }
  if (row.sugestao?.trim()) return true;
  return false;
}

function refreshIhubUi(draft: N8nListingDraft, touchedFieldId?: string, touchedValue?: { value_name?: string; value_id?: string | null }): N8nListingDraft["_ihub_ui"] {
  if (!draft._ihub_ui) return draft._ihub_ui;

  const mapCampos = (campos: IhubUiCampo[] | undefined) =>
    (campos ?? []).map((campo) => {
      if (!touchedFieldId || !touchedValue) return campo;
      const matchesId = campo.id === touchedFieldId;
      const matchesDescription =
        touchedFieldId === "description" && campo.destino_payload === "description";
      return matchesId || matchesDescription ? syncCampoValue(campo, touchedValue) : campo;
    });

  const secoes = draft._ihub_ui.secoes?.map((secao) => {
    const campos = mapCampos(Array.isArray(secao.campos) ? secao.campos : undefined);
    const statusRaw = String(secao.status ?? "");
    if (statusRaw === "somente_leitura") {
      return { ...secao, campos };
    }
    const hasPendingRequired = campos.some(
      (campo) =>
        Boolean(campo?.obrigatorio) &&
        !campo?.somente_leitura &&
        Boolean(campo?.destino_payload) &&
        !isCampoFilled(campo, draft),
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
    campos_editaveis: mapCampos(
      Array.isArray(draft._ihub_ui.campos_editaveis) ? draft._ihub_ui.campos_editaveis : undefined,
    ),
  };
}

export type MlValidationItem = {
  type?: string;
  code?: string;
  message?: string;
  cause_id?: number;
  department?: string;
  references?: string[];
  raw?: unknown;
};

/** N8N may send objects or stringified JSON / "Validation error" wrappers. */
export function normalizeMlValidationItems(
  items: N8nListingDraft["_erros_validacao_ml"] | undefined,
): MlValidationItem[] {
  if (!items?.length) return [];

  const out: MlValidationItem[] = [];
  for (const item of items) {
    const unknownItem: unknown = item;
    if (typeof unknownItem === "string") {
      const trimmed = unknownItem.trim();
      if (!trimmed || /^validation error$/i.test(trimmed)) continue;
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        if (parsed && typeof parsed === "object") {
          out.push({
            type: typeof parsed.type === "string" ? parsed.type : undefined,
            code: typeof parsed.code === "string" ? parsed.code : undefined,
            message: typeof parsed.message === "string" ? parsed.message : trimmed,
            cause_id: typeof parsed.cause_id === "number" ? parsed.cause_id : undefined,
            department: typeof parsed.department === "string" ? parsed.department : undefined,
            references: Array.isArray(parsed.references)
              ? parsed.references.filter((r): r is string => typeof r === "string")
              : undefined,
            raw: parsed,
          });
          continue;
        }
      } catch {
        /* plain string */
      }
      out.push({ type: "error", message: trimmed, raw: unknownItem });
      continue;
    }

    if (unknownItem && typeof unknownItem === "object") {
      const row = unknownItem as Record<string, unknown>;
      // Nested string payload: { message: "{...json...}" }
      if (typeof row.message === "string" && row.message.trim().startsWith("{")) {
        try {
          const nested = JSON.parse(row.message) as Record<string, unknown>;
          out.push({
            type:
              typeof nested.type === "string"
                ? nested.type
                : typeof row.type === "string"
                  ? row.type
                  : undefined,
            code: typeof nested.code === "string" ? nested.code : undefined,
            message: typeof nested.message === "string" ? nested.message : row.message,
            cause_id: typeof nested.cause_id === "number" ? nested.cause_id : undefined,
            department: typeof nested.department === "string" ? nested.department : undefined,
            references: Array.isArray(nested.references)
              ? nested.references.filter((r): r is string => typeof r === "string")
              : undefined,
            raw: nested,
          });
          continue;
        } catch {
          /* fall through */
        }
      }
      out.push({
        type: typeof row.type === "string" ? row.type : undefined,
        code: typeof row.code === "string" ? row.code : undefined,
        message: typeof row.message === "string" ? row.message : undefined,
        cause_id: typeof row.cause_id === "number" ? row.cause_id : undefined,
        department: typeof row.department === "string" ? row.department : undefined,
        references: Array.isArray(row.references)
          ? row.references.filter((r): r is string => typeof r === "string")
          : undefined,
        raw: unknownItem,
      });
    }
  }
  return out;
}

export function isBlockingMlValidation(item: MlValidationItem): boolean {
  const type = (item.type ?? "").toLowerCase();
  if (type === "warning" || type === "info") return false;
  if (type === "error") return true;
  // Unknown type: treat as blocking only if it looks like a hard validation failure
  if (item.code?.includes("invalid") || item.code?.includes("required")) return true;
  if (item.message && /preencha|obrigat|invalid|required/i.test(item.message)) return true;
  return type === "" && Boolean(item.message);
}

function isMlErrorResolvedByDraft(item: MlValidationItem, draft: N8nListingDraft): boolean {
  const blob = `${item.code ?? ""} ${item.message ?? ""} ${JSON.stringify(item.raw ?? {})}`;
  if (/UNITS_PER_PACK|unidades por kit|invalid_sale_units/i.test(blob)) {
    const units = draft.payload.attributes.find((a) => a.id === "UNITS_PER_PACK");
    return Boolean(units?.value_name?.trim() || units?.value_id);
  }
  return false;
}

export function getBlockingMlValidationErrors(
  draft: N8nListingDraft,
): MlValidationItem[] {
  return normalizeMlValidationItems(draft._erros_validacao_ml).filter(
    (item) => isBlockingMlValidation(item) && !isMlErrorResolvedByDraft(item, draft),
  );
}

export function getMlValidationWarnings(draft: N8nListingDraft): MlValidationItem[] {
  return normalizeMlValidationItems(draft._erros_validacao_ml).filter(
    (item) => !isBlockingMlValidation(item),
  );
}

export function formatMlValidationMessage(item: MlValidationItem): string {
  return item.message?.trim() || item.code || "Erro de validação do Mercado Livre";
}

/** Attribute IDs mentioned in blocking ML errors (e.g. UNITS_PER_PACK). */
export function getRequiredAttributeIdsFromMlErrors(draft: N8nListingDraft): string[] {
  const ids = new Set<string>();
  for (const err of getBlockingMlValidationErrors(draft)) {
    const blob = `${err.code ?? ""} ${err.message ?? ""} ${JSON.stringify(err.raw ?? {})}`;
    if (/UNITS_PER_PACK|unidades por kit|invalid_sale_units/i.test(blob)) {
      ids.add("UNITS_PER_PACK");
    }
    const attrMatch = blob.match(/Attribute\s*\[([A-Z0-9_]+)\]/i);
    if (attrMatch?.[1] && isBlockingMlValidation(err)) {
      // Only from error-type items; warnings about ignored attrs are skipped above
      if (!/ignored because it is not modifiable/i.test(blob)) {
        ids.add(attrMatch[1]);
      }
    }
  }
  return [...ids];
}

export function revalidateDraftReadiness(draft: N8nListingDraft): N8nListingDraft {
  const withUi = draft._ihub_ui
    ? { ...draft, _ihub_ui: refreshIhubUi(draft) }
    : draft;

  const blockingUi = hasBlockingPendingIhubUi(withUi);
  const blockingMl = getBlockingMlValidationErrors(withUi).length > 0;
  return {
    ...withUi,
    _pronto_para_publicar: !blockingUi && !blockingMl,
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
    _attributes_preenchidos_inteligente: syncReviewList(draft._attributes_preenchidos_inteligente),
  };

  return revalidateDraftReadiness({
    ...next,
    _ihub_ui: refreshIhubUi(next, attributeId, value),
  });
}

export function updateDraftSaleTerm(
  draft: N8nListingDraft,
  termId: string,
  value: { value_name?: string; value_id?: string | null },
): N8nListingDraft {
  const next: N8nListingDraft = {
    ...draft,
    payload: {
      ...draft.payload,
      sale_terms: upsertSaleTerm(draft.payload.sale_terms, termId, value),
    },
  };
  return revalidateDraftReadiness({
    ...next,
    _ihub_ui: refreshIhubUi(next, termId, value),
  });
}

export function updateDraftIhubUiCampo(
  draft: N8nListingDraft,
  campo: IhubUiCampo,
  value: { value_name?: string; value_id?: string | null },
): N8nListingDraft {
  // Campos sugeridos como somente_leitura pelo N8N ainda podem ser editados no iHub.
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
    return updateDraftSaleTerm(draft, campo.id, value);
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
  const hidden = new Set([
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

  return getIhubUiSecoes(draft).flatMap((secao) => {
    // N8N pode enviar "ok" / "completo" / "pendente" / "somente_leitura"
    const status = String(secao.status || "");
    if (status !== "pendente") return [];
    return (secao.campos ?? []).filter(
      (campo) =>
        campo.obrigatorio &&
        !hidden.has(campo.id) &&
        !isCampoFilled(campo, draft),
    );
  });
}

export function hasBlockingPendingIhubUi(draft: N8nListingDraft): boolean {
  return getPendingRequiredIhubUiCampos(draft).length > 0;
}

/** Motivos que impedem publicar — usados no botão e no alerta. */
export function getPublishBlockReasons(draft: N8nListingDraft): string[] {
  const reasons: string[] = [];
  const familyName = (draft.payload.family_name || (draft.payload as { title?: string }).title || "").trim();
  if (!familyName) reasons.push("Informe o nome da família / título do produto.");
  if (!draft.payload.pictures.length) reasons.push("Adicione ao menos uma foto.");
  if ((draft.payload.price ?? 0) <= 0) reasons.push("Informe um preço válido.");
  if (draft.payload.available_quantity < 0) reasons.push("Informe o estoque.");

  const blockingMl = getBlockingMlValidationErrors(draft);
  for (const err of blockingMl.slice(0, 3)) {
    reasons.push(formatMlValidationMessage(err));
  }

  const missingRequired = getRequiredAttributeIdsFromMlErrors(draft).filter((id) => {
    const current = draft.payload.attributes.find((a) => a.id === id);
    return !(current?.value_name?.trim() || current?.value_id);
  });
  for (const id of missingRequired) {
    reasons.push(`Preencha o campo obrigatório: ${id === "UNITS_PER_PACK" ? "Unidades por kit" : id}.`);
  }

  const sku = draft.payload.attributes.find((a) => a.id === "SELLER_SKU");
  if (!(sku?.value_name?.trim() || sku?.value_id)) {
    reasons.push("Informe o SKU.");
  }

  const warrantyType = draft.payload.sale_terms?.find((t) => t.id === "WARRANTY_TYPE");
  if (!(warrantyType?.value_name?.trim() || warrantyType?.value_id)) {
    reasons.push("Selecione o tipo de garantia.");
  } else {
    const isNoWarranty =
      warrantyType.value_id === "6150835" ||
      /sem garantia/i.test(warrantyType.value_name || "");
    if (!isNoWarranty) {
      const warrantyTime = draft.payload.sale_terms?.find((t) => t.id === "WARRANTY_TIME");
      if (!(warrantyTime?.value_name?.trim() || warrantyTime?.value_id)) {
        reasons.push("Informe o tempo de garantia (ex.: 3 meses).");
      }
    }
  }

  return reasons;
}

export function canPublishDraft(draft: N8nListingDraft): boolean {
  return getPublishBlockReasons(draft).length === 0;
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
