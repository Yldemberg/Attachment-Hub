import { Router } from "express";
import { requireAuth } from "../lib/auth";
import { requireActivePlan } from "../lib/trial";
import {
  assertUserOwnsAccount,
  buildFullOverviewForAccount,
  getOrCreateFullSettings,
  updateFullSettings,
} from "../lib/full-overview";
import { syncFullStockForAccount } from "../lib/full-sync";
import { runFullAlertsJob } from "../lib/full-alerts";
import {
  cancelFullInboundShipment,
  createFullInboundShipment,
  listFullInboundShipments,
  receiveFullInboundShipment,
  serializeInboundShipment,
} from "../lib/full-inbound";
import type { FullSkuStatus } from "../lib/full-engine";
import { logger } from "../lib/logger";

const router = Router();
const auth = [requireAuth, requireActivePlan];

const ALLOWED_PERIODS = new Set([7, 15, 30, 60]);

function parseStatus(raw: unknown): FullSkuStatus | "all" {
  if (raw === "ruptura" || raw === "critico" || raw === "saudavel" || raw === "parado") {
    return raw;
  }
  return "all";
}

router.get("/full/overview", ...auth, async (req, res) => {
  try {
    const accountId = typeof req.query.account_id === "string" ? req.query.account_id : "";
    if (!accountId) {
      res.status(400).json({ error: "account_id is required" });
      return;
    }
    const owns = await assertUserOwnsAccount(req.user!.id, accountId);
    if (!owns) {
      res.status(404).json({ error: "Account not found" });
      return;
    }

    const status = parseStatus(req.query.status);
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    const periodRaw =
      typeof req.query.period_days === "string" ? parseInt(req.query.period_days, 10) : NaN;
    const periodDaysOverride = ALLOWED_PERIODS.has(periodRaw) ? periodRaw : undefined;

    const overview = await buildFullOverviewForAccount({
      userId: req.user!.id,
      accountId,
      statusFilter: status,
      search,
      periodDaysOverride,
    });

    res.json(overview);
  } catch (err) {
    logger.error({ err }, "GET /full/overview failed");
    res.status(500).json({ error: "Failed to load Full overview" });
  }
});

router.get("/full/settings", ...auth, async (req, res) => {
  try {
    const accountId = typeof req.query.account_id === "string" ? req.query.account_id : "";
    if (!accountId) {
      res.status(400).json({ error: "account_id is required" });
      return;
    }
    const owns = await assertUserOwnsAccount(req.user!.id, accountId);
    if (!owns) {
      res.status(404).json({ error: "Account not found" });
      return;
    }
    const row = await getOrCreateFullSettings(req.user!.id, accountId);
    res.json({
      accountId: row.accountId,
      coverageTargetDays: row.coverageTargetDays,
      leadTimeDays: row.leadTimeDays,
      salesPeriodDays: row.salesPeriodDays,
      stuckMultiplier: row.stuckMultiplier,
      whatsappPhone: row.whatsappPhone,
      alertsEnabled: row.alertsEnabled,
      alertRuptura: row.alertRuptura,
      alertCritico: row.alertCritico,
      alertParado: row.alertParado,
      alertQuestions: row.alertQuestions,
      alertCooldownHours: row.alertCooldownHours,
    });
  } catch (err) {
    logger.error({ err }, "GET /full/settings failed");
    res.status(500).json({ error: "Failed to load Full settings" });
  }
});

router.put("/full/settings", ...auth, async (req, res) => {
  try {
    const body = req.body as Record<string, unknown>;
    const accountId = typeof body.accountId === "string" ? body.accountId : "";
    if (!accountId) {
      res.status(400).json({ error: "accountId is required" });
      return;
    }
    const owns = await assertUserOwnsAccount(req.user!.id, accountId);
    if (!owns) {
      res.status(404).json({ error: "Account not found" });
      return;
    }

    const patch: Parameters<typeof updateFullSettings>[2] = {};

    if (body.coverageTargetDays != null) {
      const n = Number(body.coverageTargetDays);
      if (!Number.isFinite(n) || n < 1 || n > 365) {
        res.status(400).json({ error: "coverageTargetDays must be 1–365" });
        return;
      }
      patch.coverageTargetDays = Math.round(n);
    }
    if (body.leadTimeDays != null) {
      const n = Number(body.leadTimeDays);
      if (!Number.isFinite(n) || n < 0 || n > 60) {
        res.status(400).json({ error: "leadTimeDays must be 0–60" });
        return;
      }
      patch.leadTimeDays = Math.round(n);
    }
    if (body.salesPeriodDays != null) {
      const n = Number(body.salesPeriodDays);
      if (!ALLOWED_PERIODS.has(n)) {
        res.status(400).json({ error: "salesPeriodDays must be 7, 15, 30 or 60" });
        return;
      }
      patch.salesPeriodDays = n;
    }
    if (body.stuckMultiplier != null) {
      const n = Number(body.stuckMultiplier);
      if (!Number.isFinite(n) || n < 1 || n > 10) {
        res.status(400).json({ error: "stuckMultiplier must be 1–10" });
        return;
      }
      patch.stuckMultiplier = Math.round(n);
    }
    if ("whatsappPhone" in body) {
      const phone =
        body.whatsappPhone == null || body.whatsappPhone === ""
          ? null
          : String(body.whatsappPhone).replace(/\D/g, "");
      if (phone && phone.length < 10) {
        res.status(400).json({ error: "whatsappPhone inválido" });
        return;
      }
      patch.whatsappPhone = phone;
    }
    if (typeof body.alertsEnabled === "boolean") patch.alertsEnabled = body.alertsEnabled;
    if (typeof body.alertRuptura === "boolean") patch.alertRuptura = body.alertRuptura;
    if (typeof body.alertCritico === "boolean") patch.alertCritico = body.alertCritico;
    if (typeof body.alertParado === "boolean") patch.alertParado = body.alertParado;
    if (typeof body.alertQuestions === "boolean") patch.alertQuestions = body.alertQuestions;
    if (body.alertCooldownHours != null) {
      const n = Number(body.alertCooldownHours);
      if (!Number.isFinite(n) || n < 1 || n > 168) {
        res.status(400).json({ error: "alertCooldownHours must be 1–168" });
        return;
      }
      patch.alertCooldownHours = Math.round(n);
    }

    const row = await updateFullSettings(req.user!.id, accountId, patch);
    res.json({
      accountId: row.accountId,
      coverageTargetDays: row.coverageTargetDays,
      leadTimeDays: row.leadTimeDays,
      salesPeriodDays: row.salesPeriodDays,
      stuckMultiplier: row.stuckMultiplier,
      whatsappPhone: row.whatsappPhone,
      alertsEnabled: row.alertsEnabled,
      alertRuptura: row.alertRuptura,
      alertCritico: row.alertCritico,
      alertParado: row.alertParado,
      alertQuestions: row.alertQuestions,
      alertCooldownHours: row.alertCooldownHours,
    });
  } catch (err) {
    logger.error({ err }, "PUT /full/settings failed");
    res.status(500).json({ error: "Failed to update Full settings" });
  }
});

router.post("/full/sync-stock", ...auth, async (req, res) => {
  try {
    const accountId =
      typeof req.body?.accountId === "string"
        ? req.body.accountId
        : typeof req.query.account_id === "string"
          ? req.query.account_id
          : "";
    if (!accountId) {
      res.status(400).json({ error: "accountId is required" });
      return;
    }
    const owns = await assertUserOwnsAccount(req.user!.id, accountId);
    if (!owns) {
      res.status(404).json({ error: "Account not found" });
      return;
    }

    const result = await syncFullStockForAccount(accountId);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "POST /full/sync-stock failed");
    res.status(500).json({ error: "Failed to sync Full stock" });
  }
});

/** Disparo manual de alertas (útil para testar N8N/Evolution). */
router.post("/full/alerts/run", ...auth, async (req, res) => {
  try {
    const result = await runFullAlertsJob();
    res.json(result);
  } catch (err) {
    logger.error({ err }, "POST /full/alerts/run failed");
    res.status(500).json({ error: "Failed to run Full alerts" });
  }
});

router.get("/full/inbounds", ...auth, async (req, res) => {
  try {
    const accountId = typeof req.query.account_id === "string" ? req.query.account_id : "";
    if (!accountId) {
      res.status(400).json({ error: "account_id is required" });
      return;
    }
    const owns = await assertUserOwnsAccount(req.user!.id, accountId);
    if (!owns) {
      res.status(404).json({ error: "Account not found" });
      return;
    }
    const rows = await listFullInboundShipments({
      userId: req.user!.id,
      accountId,
    });
    res.json({ data: rows.map(serializeInboundShipment) });
  } catch (err) {
    logger.error({ err }, "GET /full/inbounds failed");
    res.status(500).json({ error: "Failed to list Full inbounds" });
  }
});

router.post("/full/inbounds", ...auth, async (req, res) => {
  try {
    const body = req.body as Record<string, unknown>;
    const accountId = typeof body.accountId === "string" ? body.accountId : "";
    if (!accountId) {
      res.status(400).json({ error: "accountId is required" });
      return;
    }
    const owns = await assertUserOwnsAccount(req.user!.id, accountId);
    if (!owns) {
      res.status(404).json({ error: "Account not found" });
      return;
    }

    const scheduledDate =
      typeof body.scheduledDate === "string" ? body.scheduledDate : "";
    const notes =
      body.notes == null || body.notes === ""
        ? null
        : typeof body.notes === "string"
          ? body.notes
          : null;
    const rawItems = Array.isArray(body.items) ? body.items : [];
    const items = rawItems.map((it) => {
      const row = it as Record<string, unknown>;
      return {
        productId: typeof row.productId === "string" ? row.productId : null,
        mlItemId: typeof row.mlItemId === "string" ? row.mlItemId : null,
        sku: typeof row.sku === "string" ? row.sku : "",
        quantity: Number(row.quantity),
      };
    });

    try {
      const created = await createFullInboundShipment({
        userId: req.user!.id,
        accountId,
        scheduledDate,
        notes,
        items,
      });
      res.status(201).json(serializeInboundShipment(created));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "INVALID_SCHEDULED_DATE") {
        res.status(400).json({ error: "scheduledDate must be YYYY-MM-DD" });
        return;
      }
      if (msg === "NO_ITEMS") {
        res.status(400).json({ error: "items with sku and quantity >= 1 are required" });
        return;
      }
      throw err;
    }
  } catch (err) {
    logger.error({ err }, "POST /full/inbounds failed");
    res.status(500).json({ error: "Failed to create Full inbound" });
  }
});

router.post("/full/inbounds/:id/receive", ...auth, async (req, res) => {
  try {
    const id = typeof req.params.id === "string" ? req.params.id : "";
    if (!id) {
      res.status(400).json({ error: "id is required" });
      return;
    }
    const updated = await receiveFullInboundShipment(req.user!.id, id);
    if (!updated) {
      res.status(404).json({ error: "Inbound not found" });
      return;
    }
    const owns = await assertUserOwnsAccount(req.user!.id, updated.accountId);
    if (!owns) {
      res.status(404).json({ error: "Inbound not found" });
      return;
    }
    res.json(serializeInboundShipment(updated));
  } catch (err) {
    logger.error({ err }, "POST /full/inbounds/:id/receive failed");
    res.status(500).json({ error: "Failed to receive Full inbound" });
  }
});

router.post("/full/inbounds/:id/cancel", ...auth, async (req, res) => {
  try {
    const id = typeof req.params.id === "string" ? req.params.id : "";
    if (!id) {
      res.status(400).json({ error: "id is required" });
      return;
    }
    const updated = await cancelFullInboundShipment(req.user!.id, id);
    if (!updated) {
      res.status(404).json({ error: "Inbound not found" });
      return;
    }
    const owns = await assertUserOwnsAccount(req.user!.id, updated.accountId);
    if (!owns) {
      res.status(404).json({ error: "Inbound not found" });
      return;
    }
    res.json(serializeInboundShipment(updated));
  } catch (err) {
    logger.error({ err }, "POST /full/inbounds/:id/cancel failed");
    res.status(500).json({ error: "Failed to cancel Full inbound" });
  }
});

export default router;
