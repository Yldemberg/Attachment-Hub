import { Router, type IRouter } from "express";
import { requireAuth } from "../lib/auth";
import healthRouter from "./health";

const router: IRouter = Router();

router.use(healthRouter);

router.get("/auth/me", requireAuth, (req, res) => {
  res.status(501).json({
    error: {
      code: "NOT_IMPLEMENTED",
      message: "Route to be implemented in Task 2",
    },
    _debug: { userId: req.user?.id },
  });
});

export default router;
