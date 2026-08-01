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
import listingTemplatesRouter from "./listing-templates";
import webhooksRouter from "./webhooks";
import fullRouter from "./full";

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
router.use(listingTemplatesRouter);
router.use(fullRouter);

export default router;
