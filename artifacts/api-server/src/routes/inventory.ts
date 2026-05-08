import { Router } from "express";
import { requireAuth } from "../lib/auth";
import { requireActivePlan } from "../lib/trial";
import { getDb } from "../lib/db";
import { productsTable, accountsTable, skuMandateInventoryTable, inventorySkuFinancialsTable } from "@workspace/db/schema";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { ml, putMlItemStockForSellerSku, MlItem } from "../lib/mercadolivre";
import { upsertSkuMandateQuantity } from "../lib/sku-mandate";
import { propagateStockBySku } from "../lib/order-mandate-stock";

const router = Router();
const auth = [requireAuth, requireActivePlan];

async function getUserAccountIds(userId: string): Promise<string[]> {
  const db = getDb();
  const accounts = await db
    .select({ id: accountsTable.id })
    .from(accountsTable)
    .where(and(eq(accountsTable.userId, userId), eq(accountsTable.isActive, true)));
  return accounts.map((a) => a.id);
}

function escapeIlikePattern(token: string): string {
  return token.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

type VariationJsonRow = {
  sku?: string | null;
  attributes?: Array<{ name?: string; value_name?: string | null }>;
  attribute_combinations?: Array<{ name?: string; value_name?: string | null }>;
};

function variationLabelFromProduct(
  variationsJson: unknown,
  effectiveSku: string,
  shortTitle: string,
): string | null {
  if (!variationsJson || !Array.isArray(variationsJson)) {
    if (shortTitle.length > 0 && shortTitle !== effectiveSku) {
      return shortTitle.slice(0, 80);
    }
    return null;
  }
  const rows = variationsJson as VariationJsonRow[];
  const match = rows.find((r) => r.sku === effectiveSku) ?? rows[0];
  if (!match) return null;
  const combos = match.attribute_combinations ?? [];
  const attrs = match.attributes ?? [];
  const parts: string[] = [];
  for (const c of combos) {
    if (c.name && c.value_name) parts.push(`${c.name}: ${c.value_name}`);
  }
  if (parts.length === 0) {
    for (const a of attrs) {
      if (a.name && a.value_name) parts.push(`${a.name}: ${a.value_name}`);
    }
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

function shortTitle(title: string | null | undefined, max = 72): string {
  if (!title) return "";
  const t = title.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

/** GET /inventory/search — anúncios não Full com SKU; agrupa por SKU para inventário mandatário. */
router.get("/inventory/search", ...auth, async (req, res) => {
  try {
    const db = getDb();
    const qRaw = typeof req.query.query === "string" ? req.query.query : "";
    const q = qRaw.trim();

    const accountIds = await getUserAccountIds(req.user!.id);
    if (accountIds.length === 0) {
      res.json({ data: [] });
      return;
    }

    const baseScope = [
      inArray(productsTable.accountId, accountIds),
      eq(productsTable.isFull, false),
      isNotNull(productsTable.sku),
    ];

    type Row = (typeof productsTable.$inferSelect);
    let bySku: Map<string, Row[]>;
    let listingCountOverride: Map<string, number> | null = null;

    if (!q) {
      const whereBase = and(...baseScope);
      const agg = await db
        .select({
          sku: productsTable.sku,
          repId: sql<string>`min(${productsTable.id})::text`,
          listingCount: sql<number>`cast(count(*) as int)`,
        })
        .from(productsTable)
        .where(whereBase)
        .groupBy(productsTable.sku);

      if (agg.length === 0) {
        res.json({ data: [] });
        return;
      }

      const repIds = [...new Set(agg.map((a) => a.repId))];
      const reps = await db.select().from(productsTable).where(inArray(productsTable.id, repIds));
      const repById = new Map(reps.map((r) => [String(r.id), r]));

      bySku = new Map();
      listingCountOverride = new Map();
      for (const row of agg) {
        const sku = row.sku!;
        const rep = repById.get(row.repId);
        if (!rep) {
          req.log.warn({ sku, repId: row.repId }, "inventory list-all: linha representativa ausente");
          continue;
        }
        bySku.set(sku, [rep]);
        listingCountOverride.set(sku, row.listingCount);
      }

      if (bySku.size === 0) {
        res.json({ data: [] });
        return;
      }
    } else {
      const tokens = q
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 0);

      const conditions = [...baseScope];
      for (const token of tokens) {
        const pat = `%${escapeIlikePattern(token)}%`;
        conditions.push(
          sql`(
            coalesce(${productsTable.title}, '') ILIKE ${pat} ESCAPE '\\'
            OR coalesce(${productsTable.sku}, '') ILIKE ${pat} ESCAPE '\\'
            OR ${productsTable.mlItemId} ILIKE ${pat} ESCAPE '\\'
            OR coalesce(${productsTable.variationsJson}::text, '') ILIKE ${pat} ESCAPE '\\'
          )`,
        );
      }

      const where = and(...conditions);
      const rows = await db.select().from(productsTable).where(where).limit(120);

      bySku = new Map();
      for (const row of rows) {
        const sku = row.sku!;
        const list = bySku.get(sku) ?? [];
        list.push(row);
        bySku.set(sku, list);
      }
    }

    const skus = [...bySku.keys()];
    const mandateRows =
      skus.length === 0
        ? []
        : await db
            .select()
            .from(skuMandateInventoryTable)
            .where(
              and(
                eq(skuMandateInventoryTable.userId, req.user!.id),
                inArray(skuMandateInventoryTable.sku, skus),
              ),
            );
    const mandateMap = Object.fromEntries(mandateRows.map((m) => [m.sku, m.quantity]));

    /** Se a migração `007_inventory_sku_financials.sql` ainda não foi aplicada, não quebra a busca. */
    let financialRows: (typeof inventorySkuFinancialsTable.$inferSelect)[] = [];
    try {
      financialRows =
        skus.length === 0
          ? []
          : await db
              .select()
              .from(inventorySkuFinancialsTable)
              .where(
                and(
                  eq(inventorySkuFinancialsTable.userId, req.user!.id),
                  inArray(inventorySkuFinancialsTable.sku, skus),
                ),
              );
    } catch (err) {
      req.log.warn(
        { err },
        "inventory_sku_financials indisponível — aplique scripts/migrations/007_inventory_sku_financials.sql",
      );
      financialRows = [];
    }
    const financialMap = Object.fromEntries(
      financialRows.map((f) => [
        f.sku,
        {
          taxPercent: f.taxPercent != null ? Number(f.taxPercent) : null,
          purchasePrice: f.purchasePrice != null ? Number(f.purchasePrice) : null,
        },
      ]),
    );

    const qLower = q.toLowerCase();
    const data = skus.map((sku) => {
      const list = bySku.get(sku)!;
      const exactSku = q ? list.find((r) => r.sku?.toLowerCase() === qLower) : undefined;
      const rep = exactSku ?? list[0];
      const mandateQty = mandateMap[sku];
      const fin = financialMap[sku];
      const titleShort = shortTitle(rep.title);
      const varLabel = variationLabelFromProduct(rep.variationsJson, sku, titleShort);
      return {
        sku,
        mandateQuantity: mandateQty ?? null,
        taxPercent: fin?.taxPercent ?? null,
        purchasePrice: fin?.purchasePrice ?? null,
        thumbnail: rep.thumbnail ?? null,
        titleShort,
        variationLabel: varLabel,
        currentStock: rep.availableQuantity,
        representativeProductId: rep.id,
        listingCount: listingCountOverride?.get(sku) ?? list.length,
      };
    });

    data.sort((a, b) => a.sku.localeCompare(b.sku, "pt-BR"));
    res.json({ data });
  } catch (err) {
    req.log.error({ err }, "inventory search failed");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  }
});

/** PATCH /inventory/sku/:sku/financials — imposto (%) e preço de compra por SKU (persistência para relatórios). */
router.patch("/inventory/sku/:sku/financials", ...auth, async (req, res) => {
  try {
    const rawSku = typeof req.params.sku === "string" ? req.params.sku : "";
    let sku = rawSku;
    try {
      sku = decodeURIComponent(rawSku);
    } catch {
      sku = rawSku;
    }
    sku = sku.trim();
    if (!sku) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "sku é obrigatório" } });
      return;
    }

    const body = req.body as Partial<{ taxPercent: number | null; purchasePrice: number | null }>;
    if (body.taxPercent !== undefined && body.taxPercent !== null) {
      if (typeof body.taxPercent !== "number" || !Number.isFinite(body.taxPercent)) {
        res.status(400).json({ error: { code: "BAD_REQUEST", message: "taxPercent deve ser número ou null" } });
        return;
      }
      if (body.taxPercent < 0 || body.taxPercent > 100) {
        res.status(400).json({ error: { code: "BAD_REQUEST", message: "taxPercent deve estar entre 0 e 100" } });
        return;
      }
    }
    if (body.purchasePrice !== undefined && body.purchasePrice !== null) {
      if (typeof body.purchasePrice !== "number" || !Number.isFinite(body.purchasePrice)) {
        res.status(400).json({ error: { code: "BAD_REQUEST", message: "purchasePrice deve ser número ou null" } });
        return;
      }
      if (body.purchasePrice < 0) {
        res.status(400).json({ error: { code: "BAD_REQUEST", message: "purchasePrice deve ser >= 0" } });
        return;
      }
    }

    if (body.taxPercent === undefined && body.purchasePrice === undefined) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "Informe taxPercent e/ou purchasePrice" } });
      return;
    }

    const db = getDb();
    const accountIds = await getUserAccountIds(req.user!.id);
    if (accountIds.length === 0) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Nenhuma conta ativa" } });
      return;
    }

    const [allowed] = await db
      .select({ id: productsTable.id })
      .from(productsTable)
      .where(
        and(
          inArray(productsTable.accountId, accountIds),
          eq(productsTable.sku, sku),
          eq(productsTable.isFull, false),
        ),
      )
      .limit(1);

    if (!allowed) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Nenhum anúncio não Full com este SKU" } });
      return;
    }

    const [existing] = await db
      .select()
      .from(inventorySkuFinancialsTable)
      .where(
        and(
          eq(inventorySkuFinancialsTable.userId, req.user!.id),
          eq(inventorySkuFinancialsTable.sku, sku),
        ),
      )
      .limit(1);

    let taxPercent = existing?.taxPercent != null ? Number(existing.taxPercent) : null;
    let purchasePrice = existing?.purchasePrice != null ? Number(existing.purchasePrice) : null;

    if (body.taxPercent !== undefined) {
      taxPercent = body.taxPercent;
    }
    if (body.purchasePrice !== undefined) {
      purchasePrice = body.purchasePrice;
    }

    await db
      .insert(inventorySkuFinancialsTable)
      .values({
        userId: req.user!.id,
        sku,
        taxPercent: taxPercent !== null ? String(taxPercent) : null,
        purchasePrice: purchasePrice !== null ? String(purchasePrice) : null,
      })
      .onConflictDoUpdate({
        target: [inventorySkuFinancialsTable.userId, inventorySkuFinancialsTable.sku],
        set: {
          taxPercent: taxPercent !== null ? String(taxPercent) : null,
          purchasePrice: purchasePrice !== null ? String(purchasePrice) : null,
          updatedAt: new Date(),
        },
      });

    res.json({
      sku,
      taxPercent,
      purchasePrice,
    });
  } catch (err) {
    req.log.error({ err }, "inventory sku financials patch failed");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  }
});

/** POST /inventory/mandate-adjust — atualiza mandatário e espelha em todos os anúncios não Full do SKU. */
router.post("/inventory/mandate-adjust", ...auth, async (req, res) => {
  try {
    const db = getDb();
    const body = req.body as { sku?: string; operation?: string; amount?: number };
    const sku = typeof body.sku === "string" ? body.sku.trim() : "";
    const operation = body.operation;
    const amount = body.amount;

    if (!sku) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "sku é obrigatório" } });
      return;
    }
    if (operation !== "add" && operation !== "subtract" && operation !== "set") {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "operation deve ser add, subtract ou set" } });
      return;
    }
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0 || !Number.isInteger(amount)) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "amount deve ser um inteiro >= 0" } });
      return;
    }
    if ((operation === "add" || operation === "subtract") && amount === 0) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "amount deve ser > 0 para add ou subtract" } });
      return;
    }

    const accountIds = await getUserAccountIds(req.user!.id);
    if (accountIds.length === 0) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Nenhuma conta ativa" } });
      return;
    }

    const products = await db
      .select()
      .from(productsTable)
      .where(
        and(
          inArray(productsTable.accountId, accountIds),
          eq(productsTable.sku, sku),
          eq(productsTable.isFull, false),
        ),
      );

    if (products.length === 0) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Nenhum anúncio não Full com este SKU" } });
      return;
    }

    const [mandateRow] = await db
      .select()
      .from(skuMandateInventoryTable)
      .where(
        and(eq(skuMandateInventoryTable.userId, req.user!.id), eq(skuMandateInventoryTable.sku, sku)),
      )
      .limit(1);

    const listingMins = products.map((p) => p.availableQuantity);
    const baseline = mandateRow
      ? mandateRow.quantity
      : listingMins.length > 0
        ? Math.min(...listingMins)
        : 0;

    let mandateQty: number;
    if (operation === "set") {
      mandateQty = amount;
    } else if (operation === "add") {
      mandateQty = baseline + amount;
    } else {
      mandateQty = Math.max(0, baseline - amount);
    }

    await upsertSkuMandateQuantity(req.user!.id, sku, mandateQty);

    const results: Array<{ productId: string; mlItemId: string; success: boolean; reason: string | null }> = [];
    let updated = 0;
    let failed = 0;

    for (const product of products) {
      try {
        await putMlItemStockForSellerSku(product.accountId, product.mlItemId, sku, mandateQty);
        const after = await ml.get<MlItem>(product.accountId, `/items/${encodeURIComponent(product.mlItemId)}`);
        await db
          .update(productsTable)
          .set({ availableQuantity: after.available_quantity })
          .where(eq(productsTable.id, product.id));
        updated++;
        results.push({ productId: product.id, mlItemId: product.mlItemId, success: true, reason: null });
      } catch (err) {
        failed++;
        results.push({
          productId: product.id,
          mlItemId: product.mlItemId,
          success: false,
          reason: (err as Error).message,
        });
      }
    }

    res.json({
      sku,
      mandateQuantity: mandateQty,
      updated,
      failed,
      results,
    });
  } catch (err) {
    req.log.error({ err }, "mandate adjust failed");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  }
});

/** POST /inventory/sync-sku — força re-sincronização imediata de todos os anúncios não-Full com o SKU. */
router.post("/inventory/sync-sku", ...auth, async (req, res) => {
  try {
    const db = getDb();
    const body = req.body as { sku?: string; sourceProductId?: string };
    const sku = typeof body.sku === "string" ? body.sku.trim() : "";

    if (!sku) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "sku é obrigatório" } });
      return;
    }

    const accountIds = await getUserAccountIds(req.user!.id);
    if (accountIds.length === 0) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Nenhuma conta ativa" } });
      return;
    }

    const products = await db
      .select()
      .from(productsTable)
      .where(
        and(
          inArray(productsTable.accountId, accountIds),
          eq(productsTable.sku, sku),
          eq(productsTable.isFull, false),
        ),
      );

    if (products.length === 0) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Nenhum anúncio não Full com este SKU" } });
      return;
    }

    let sourceProduct = products[0]!;
    if (body.sourceProductId) {
      const found = products.find((p) => p.id === body.sourceProductId);
      if (!found) {
        res.status(400).json({ error: { code: "BAD_REQUEST", message: "sourceProductId não encontrado entre os anúncios não Full com este SKU" } });
        return;
      }
      sourceProduct = found;
    } else {
      const active = products.find((p) => p.status === "active");
      if (active) sourceProduct = active;
    }

    const mlItem = await ml.get<MlItem>(
      sourceProduct.accountId,
      `/items/${encodeURIComponent(sourceProduct.mlItemId)}`,
    );
    const newStock = mlItem.available_quantity;

    await db
      .update(productsTable)
      .set({ availableQuantity: newStock, lastSyncedAt: new Date(), updatedAt: new Date() })
      .where(eq(productsTable.id, sourceProduct.id));

    const { synced, skipped } = await propagateStockBySku({
      userId: req.user!.id,
      effectiveSku: sku,
      sourceListingStock: newStock,
      excludeMlItemId: sourceProduct.mlItemId,
      excludeAccountId: sourceProduct.accountId,
    });

    res.json({ synced: synced + 1, skipped, sku, newStock });
  } catch (err) {
    req.log.error({ err }, "sync-sku failed");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  }
});

export default router;
