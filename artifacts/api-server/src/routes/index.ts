import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import accountsRouter from "./accounts";
import productsRouter from "./products";
import inventoryRouter from "./inventory";
import ordersRouter from "./orders";
import paymentsRouter from "./payments";
import questionsRouter from "./questions";
import notificationsRouter from "./notifications";
import dashboardRouter from "./dashboard";
import promotionsRouter from "./promotions";
import criticalAdsRouter from "./critical-ads";
import webhooksRouter from "./webhooks";

const router: IRouter = Router();

router.use(healthRouter);
router.use(webhooksRouter);
router.use(authRouter);
router.use(accountsRouter);
router.use(productsRouter);
router.use(inventoryRouter);
router.use(ordersRouter);
router.use(paymentsRouter);
router.use(questionsRouter);
router.use(notificationsRouter);
router.use(dashboardRouter);
router.use(promotionsRouter);
router.use(criticalAdsRouter);

export default router;
