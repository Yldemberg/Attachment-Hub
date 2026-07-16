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
  listListingTemplatesForUser,
  publishListingTemplate,
  serializeListingTemplate,
  syncListingTemplateForProduct,
  syncListingTemplatesForUser,
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

    const templateId = await syncListingTemplateForProduct({
      userId: req.user!.id,
      accountId: row.accountId,
      productId: row.id,
      mlItemId: row.mlItemId,
    });

    const template = await getListingTemplateForUser(req.user!.id, templateId);
    res.status(201).json({
      data: template ? serializeListingTemplate(template, { includePayload: true }) : { id: templateId },
    });
  } catch (err) {
    req.log.error({ err }, "Failed to save product as listing template");
    const message = err instanceof Error ? err.message : "Internal server error";
    res.status(502).json({ error: { code: "ML_ERROR", message } });
  }
});

router.get("/listing-templates/:id", ...auth, async (req, res) => {
  try {
    const template = await getListingTemplateForUser(req.user!.id, req.params.id as string);
    if (!template) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Listing template not found" } });
      return;
    }
    res.json({ data: serializeListingTemplate(template, { includePayload: true }) });
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

export default router;
