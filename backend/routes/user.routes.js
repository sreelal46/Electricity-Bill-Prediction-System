// ===================================================================
// User Dashboard Routes (with HBS views)
// Location: backend/routes/user.dashboard.routes.js
// Renders ML predictions in Handlebars templates
// ===================================================================

import express from "express";
import {
  checkSession,
  isLogin,
  loginPage,
  verifyUser,
  registerPage,
  registration,
  predictPage,
  billsPage,
  profilePage,
  dashboardController,
  usageLimit,
  logoutController,
  alertController,
} from "../controllers/user.controller.js";
const router = express.Router();
import { sendEmail } from "../utils/mailer.js";

router.get("/login", isLogin, loginPage);
router.post("/login", verifyUser);

router.get("/registration", isLogin, registerPage);
router.post("/registration", registration);
router.get("/dashboard", checkSession, dashboardController);
router.post("/dashboard/usageLimit", checkSession, usageLimit);

router.get("/predictions", checkSession, predictPage);
router.get("/bills", checkSession, billsPage);
router.get("/alerts", checkSession, alertController);
router.get("/profile", checkSession, profilePage);
router.get("/logout", checkSession, logoutController);
router.get("/test-email", async (req, res) => {
  console.log("🧪 Manual email test triggered...");
  try {
    const email = "srijithk21@gmail.com";
    const userId = "Srijith123";
    await sendEmail(
      userId, // fake userId
      email, // sends to your own email
      850, // fake running bill
      700, // fake limit
    );
    console.log("✅ Test email triggered successfully");
    res.send("✅ Test email sent! Check your inbox at: " + email);
  } catch (error) {
    console.error("❌ Test email failed:", error.message);
    res.send("❌ Email failed: " + error.message);
  }
});

export default router;
