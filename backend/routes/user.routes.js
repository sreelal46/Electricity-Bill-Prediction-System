// ===================================================================
// User Dashboard Routes (with HBS views)
// Location: backend/routes/user.dashboard.routes.js
// Renders ML predictions in Handlebars templates
// ===================================================================

import express from "express";
import {
  checkSession,
  loginPage,
  verifyUser,
  registerPage,
  registration,
  predictPage,
  billsPage,
  profilePage,
  dashboardController,
  logoutController,
  alertController,
} from "../controllers/user.controller.js";
const router = express.Router();

router.get("/login", loginPage);
router.post("/login", verifyUser);

router.get("/registration", registerPage);
router.post("/registration", registration);
router.get("/dashboard", checkSession, dashboardController);

router.get("/predictions", checkSession, predictPage);
router.get("/bills", checkSession, billsPage);
router.get("/alerts", checkSession, alertController);
router.get("/profile", checkSession, profilePage);
router.get("/logout", checkSession, logoutController);

export default router;
