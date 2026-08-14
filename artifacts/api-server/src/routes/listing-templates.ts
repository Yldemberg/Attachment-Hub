import { Router } from "express";
import { requireAuth } from "../lib/auth";
import { requireActivePlan } from "../lib/trial";
import { getDb } from "../lib/db";
import { productsTable, accountsTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { MlListingError } from "../lib/ml-listings";
import {
  deleteListingTemplateForUser,
  getListingTemplateForUser,
  hydrateListingTemplatePayloadForDisplay,
  listListingTemplatesForUser,
  publishListingTemplate,
  propagateListingTemplate,
  resolveTemplateSku,
  serializeListingTemplate,
  summarizeMlSkuTargets,
  syncListingTemplateForProduct,
  syncListingTemplatesForUser,
  type ListingTemplatePayload,
} from "../lib/listing-templates";

const router = Router();
const auth = [requireAuth, requireActivePlan];

router.get("/listing-templates", ...auth, async (req, res) => {
  try {
    const accountId =
      typeof req.query.account_id === "string" && req.query.account_id.trim()
        ? req.query.account_id.trim()
        : undefined;
    const search =
      typeof req.query.search === "string" && req.query.search.trim()
        ? req.query.search.trim()
        : undefined;
    const page = req.query.page ? Number(req.query.page) : 1;
    const limit = req.query.limit ? Number(req.query.limit) : 20;

    const result = await listListingTemplatesForUser({
      userId: req.user!.id,
      accountId,
      search,
      page: Number.isFinite(page) ? page : 1,
      limit: Number.isFinite(limit) ? limit : 20,
    });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to list listing templates");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  }
});

router.post("/listing-templates/sync", ...auth, async (req, res) => {
  try {
    const userId = req.user!.id;
    res.status(202).json({ message: "Sincronização de modelos de anúncio iniciada" });

    setImmediate(() => {
      syncListingTemplatesForUser(userId).catch((err) => {
        req.log.error({ err, userId }, "Listing templates sync failed");
      });
    });
  } catch (err) {
    req.log.error({ err }, "Failed to initiate listing templates sync");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  }
});

router.post("/listing-templates/from-product/:productId", ...auth, async (req, res) => {
  try {
    const db = getDb();
    const productId = req.params.productId as string;

    const [row] = await db
      .select({
        id: productsTable.id,
        mlItemId: productsTable.mlItemId,
        accountId: productsTable.accountId,
      })
      .from(productsTable)
      .innerJoin(accountsTable, eq(productsTable.accountId, accountsTable.id))
      .where(and(eq(productsTable.id, productId), eq(accountsTable.userId, req.user!.id)))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Product not found" } });
      return;
    }

    if (!row.mlItemId) {
      res.status(400).json({
        error: { code: "BAD_REQUEST", message: "Templates disponíveis apenas para anúncios Mercado Livre" },
      });
      return;
    }

    const templateId = await syncListingTemplateForProduct({
      userId: req.user!.id,
      accountId: row.accountId,
      productId: row.id,
      mlItemId: row.mlItemId,
    });

    const found = await getListingTemplateForUser(req.user!.id, templateId);
    const sku = found
      ? await resolveTemplateSku({
          userId: req.user!.id,
          template: found.template,
          joinedSku: found.sku,
        })
      : null;
    res.status(201).json({
      data: found
        ? {
            ...serializeListingTemplate(found.template, {
              includePayload: true,
              sku,
            }),
            skuTargets: sku
              ? await summarizeMlSkuTargets(req.user!.id, sku)
              : { total: 0, full: 0, traditional: 0, closed: 0 },
          }
        : { id: templateId },
    });
  } catch (err) {
    req.log.error({ err }, "Failed to save product as listing template");
    const message = err instanceof Error ? err.message : "Internal server error";
    res.status(502).json({ error: { code: "ML_ERROR", message } });
  }
});

router.get("/listing-templates/:id", ...auth, async (req, res) => {
  try {
    const found = await getListingTemplateForUser(req.user!.id, req.params.id as string);
    if (!found) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Listing template not found" } });
      return;
    }
    const sku =
      (await resolveTemplateSku({
        userId: req.user!.id,
        template: found.template,
        joinedSku: found.sku,
      })) || null;
    const serialized = serializeListingTemplate(found.template, { includePayload: true, sku });
    const payload = await hydrateListingTemplatePayloadForDisplay(
      found.template.sourceAccountId,
      found.template.payloadJson as ListingTemplatePayload,
      found.template.sourceMlItemId,
    );
    res.json({
      data: {
        ...serialized,
        payload,
        skuTargets: sku
          ? await summarizeMlSkuTargets(req.user!.id, sku)
          : { total: 0, full: 0, traditional: 0, closed: 0 },
      },
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get listing template");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  }
});

router.delete("/listing-templates/:id", ...auth, async (req, res) => {
  try {
    const deleted = await deleteListingTemplateForUser(req.user!.id, req.params.id as string);
    if (!deleted) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Listing template not found" } });
      return;
    }
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete listing template");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  }
});

router.post("/listing-templates/:id/publish", ...auth, async (req, res) => {
  try {
    const targetAccountId =
      typeof req.body?.targetAccountId === "string" ? req.body.targetAccountId.trim() : "";
    if (!targetAccountId) {
      res.status(400).json({
        error: { code: "BAD_REQUEST", message: "Informe targetAccountId" },
      });
      return;
    }

    const result = await publishListingTemplate({
      userId: req.user!.id,
      templateId: req.params.id as string,
      targetAccountId,
      overrides: req.body?.overrides,
    });

    res.status(201).json({
      data: {
        productId: result.productId,
        mlItemId: result.itemId,
      },
    });
  } catch (err) {
    if (err instanceof MlListingError) {
      const status =
        err.code === "TEMPLATE_NOT_FOUND" || err.code === "ACCOUNT_NOT_FOUND" ? 404 : 400;
      res.status(status).json({ error: { code: err.code, message: err.message } });
      return;
    }
    req.log.error({ err }, "Failed to publish listing template");
    const message = err instanceof Error ? err.message : "Internal server error";
    res.status(502).json({ error: { code: "ML_ERROR", message } });
  }
});

router.post("/listing-templates/:id/propagate", ...auth, async (req, res) => {
  try {
    const fields = Array.isArray(req.body?.fields)
      ? (req.body.fields as unknown[]).filter((f): f is string => typeof f === "string")
      : [];

    const result = await propagateListingTemplate({
      userId: req.user!.id,
      templateId: req.params.id as string,
      fields,
      attributeIds: Array.isArray(req.body?.attributeIds)
        ? (req.body.attributeIds as unknown[]).filter((f): f is string => typeof f === "string")
        : undefined,
      saleTermIds: Array.isArray(req.body?.saleTermIds)
        ? (req.body.saleTermIds as unknown[]).filter((f): f is string => typeof f === "string")
        : undefined,
      overrides: req.body?.overrides,
    });

    res.json({ data: result });
  } catch (err) {
    if (err instanceof MlListingError) {
      const status =
        err.code === "TEMPLATE_NOT_FOUND" ? 404 : 400;
      res.status(status).json({ error: { code: err.code, message: err.message } });
      return;
    }
    req.log.error({ err }, "Failed to propagate listing template");
    const message = err instanceof Error ? err.message : "Internal server error";
    res.status(502).json({ error: { code: "ML_ERROR", message } });
  }
});

export default router;
