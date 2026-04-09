import { Router, type IRouter } from "express";
import { requireAuth } from "../lib/auth";
import healthRouter from "./health";

const router: IRouter = Router();

router.use(healthRouter);

router.get("/auth/me", requireAuth, (req, res) => {
  res.json({ data: req.user ?? null });
});

export default router;
