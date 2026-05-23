import { Router } from "express";
import { requireAuth } from "../lib/auth";
import { requireActivePlan } from "../lib/trial";
import { getUserAccountIds } from "../lib/account-scope";
import { fetchMpPayment, MercadoPagoApiError } from "../lib/mercadopago";

const router = Router();
const auth = [requireAuth, requireActivePlan];

router.get("/payments/:paymentId", ...auth, async (req, res) => {
  const accountId = typeof req.query.account_id === "string" ? req.query.account_id.trim() : "";
  if (!accountId) {
    res.status(400).json({
      error: { code: "BAD_REQUEST", message: "Query parameter account_id is required" },
    });
    return;
  }

  try {
    const accountIds = await getUserAccountIds(req.user!.id, accountId);
    if (accountIds.length === 0) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Account not found" } });
      return;
    }

    const payment = await fetchMpPayment(accountId, req.params.paymentId as string);
    res.json(payment);
  } catch (err) {
    if (err instanceof MercadoPagoApiError) {
      if (err.status === 400) {
        res.status(400).json({ error: { code: "BAD_REQUEST", message: err.message } });
        return;
      }
      if (err.status === 404) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "Payment not found" } });
        return;
      }
      if (err.status === 504) {
        res.status(504).json({ error: { code: "GATEWAY_TIMEOUT", message: err.message } });
        return;
      }
      req.log.warn({ err, paymentId: req.params.paymentId, accountId }, "Mercado Pago payment fetch failed");
      res.status(502).json({
        error: { code: "UPSTREAM_ERROR", message: "Mercado Pago API request failed" },
      });
      return;
    }

    req.log.error({ err, paymentId: req.params.paymentId, accountId }, "Failed to fetch Mercado Pago payment");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  }
});

export default router;
