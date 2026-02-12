// ===================================================================
// Admin Dashboard Routes
// Location: backend/routes/admin.dashboard.routes.js
// Admin can access ALL users, readings, alerts
// ===================================================================

import express from "express";
import db from "../config/firebase.js";
const router = express.Router();
import {
  dashboardController,
  allUsers,
  latestReadingController,
  dailyUseage,
  allAlert,
} from "../controllers/admin.controller.js";

/**
 * GET /admin/dashboard
 */
router.get("/dashboard", dashboardController);
/**
 * GET /admin/api/users
 * List all registered users
 */
router.get("/users", allUsers);

/**
 * GET /admin/api/user/:userId/latest
 * Latest reading of ANY user
 */
router.get("/user/:userId/latest", latestReadingController);

/**
 * GET /admin/api/user/:userId/readings
 * Full reading history of ANY user
 */
router.get("/user/:userId/readings", async (req, res) => {
  const { userId } = req.params;
  const { start, end, limit = 2000 } = req.query;

  try {
    let ref = db.ref(`readings/${userId}`);

    if (start && end) {
      ref = ref.orderByChild("timestamp").startAt(start).endAt(end);
    }

    const snapshot = await ref.limitToFirst(Number(limit)).once("value");

    if (!snapshot.exists()) return res.json([]);

    const data = [];
    snapshot.forEach((child) => {
      data.push({ id: child.key, ...child.val() });
    });

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /admin/api/alerts
 * All unresolved alerts (system-wide)
 */
router.get("/alerts", allAlert);

/**
 * GET /admin/api/summary
 * System-wide usage overview
 */
router.get("/daily-summary/:userId", dailyUseage);

export default router;
