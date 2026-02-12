// ===================================================================
// User Dashboard Routes (with HBS views)
// Location: backend/routes/user.dashboard.routes.js
// Renders ML predictions in Handlebars templates
// ===================================================================

import express from "express";
import mlService from "../config/ml.service.js";
import db from "../config/firebase.js";
import {
  dashboardController,
  allReadingController,
  dailyUseage,
  alertController,
  predictNextDay,
  predictNextWeek,
  predictNextMonth,
} from "../controllers/user.controller.js";
const router = express.Router();

/**
 * USER DASHBOARD PAGE (HTML)
 */
router.get("/dashboard/:userId", dashboardController);

router.get("/api/readings/:userId", allReadingController);

router.get("/api/daily-summary/:userId", dailyUseage);
router.get("/api/alerts/:userId", alertController);
router.get("/api/predict/next-day/:userId", predictNextDay);
router.get("/api/predict/next-week/:userId", predictNextWeek);
router.get("/api/predict/next-month/:userId", predictNextMonth);

//out
router.get("/api/readings/:userId/latest", async (req, res) => {
  const { userId } = req.params;

  try {
    const ref = db.ref(`latest_readings/${userId}`);
    const snapshot = await ref.limitToLast(1).once("value");

    if (!snapshot.exists()) {
      return res.status(404).json({ message: "No data found" });
    }

    let latest;
    snapshot.forEach((child) => {
      latest = { id: child.key, ...child.val() };
    });
    res.render("user/latest-reading", { reading: latest });
    // res.status(200).json(latest);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
