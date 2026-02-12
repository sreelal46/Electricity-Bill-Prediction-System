// ===================================================================
// Admin Dashboard Routes (with HBS views)
// Location: backend/routes/admin.dashboard.routes.js
// Admin panel for managing ML models and viewing all users
// ===================================================================

import express from "express";
import mlService from "../config/ml.service.js";

const router = express.Router();

/**
 * Admin Dashboard - Main page
 * GET /admin/dashboard
 */
router.get("/dashboard", async (req, res) => {
  try {
    // Get ML service health
    const health = await mlService.checkHealth();

    // In real app, get all users from database
    const users = await getAllUsers(); // You need to implement this

    res.render("admin/dashboard", {
      title: "Admin Dashboard",
      layout: false,
      mlServiceStatus: health.success ? "online" : "offline",
      mlServiceData: health.data,
      totalUsers: users.length,
      users: users,
    });
  } catch (error) {
    console.error("Admin dashboard error:", error);
    res.render("admin/dashboard", {
      title: "Admin Dashboard",
      layout: "admin-layout",
      error: "Failed to load dashboard",
    });
  }
});

/**
 * Train Models Page
 * GET /admin/ml/train
 */
router.get("/ml/train", async (req, res) => {
  try {
    const users = await getAllUsers();

    res.render("admin/train-models", {
      title: "Train ML Models",
      layout: "admin-layout",
      users: users,
    });
  } catch (error) {
    res.render("admin/train-models", {
      title: "Train ML Models",
      layout: "admin-layout",
      error: "Failed to load users",
    });
  }
});

/**
 * Train Models - POST action
 * POST /admin/ml/train
 */
router.post("/ml/train", async (req, res) => {
  try {
    const { userId, days } = req.body;

    const result = await mlService.trainModels(userId, parseInt(days) || 14);

    res.json({
      success: result.success,
      message: result.success ? "Models trained successfully" : result.error,
      data: result.data,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to train models",
      error: error.message,
    });
  }
});

/**
 * View User Predictions
 * GET /admin/user/:userId/predictions
 */
router.get("/user/:userId/predictions", async (req, res) => {
  try {
    const { userId } = req.params;

    // Get user info from database
    const user = await getUserById(userId); // Implement this

    // Get ML insights
    const insights = await mlService.getInsights(userId, null);

    res.render("admin/user-predictions", {
      title: `Predictions - ${user.name}`,
      layout: "admin-layout",
      user: user,
      insights: insights.success ? insights.data.insights : null,
      error: insights.success ? null : insights.error,
    });
  } catch (error) {
    res.render("admin/user-predictions", {
      title: "User Predictions",
      layout: "admin-layout",
      error: "Failed to load predictions",
    });
  }
});

/**
 * All Users Overview
 * GET /admin/users/overview
 */
router.get("/users/overview", async (req, res) => {
  try {
    const users = await getAllUsers();

    // Get predictions for all users
    const usersWithPredictions = await Promise.all(
      users.map(async (user) => {
        const forecast = await mlService.getMonthlyForecast(user.id);
        return {
          ...user,
          predictedBill: forecast.success
            ? forecast.data.predicted_bill_inr
            : null,
          predictedKwh: forecast.success
            ? forecast.data.total_predicted_kwh
            : null,
        };
      }),
    );

    res.render("admin/users-overview", {
      title: "Users Overview",
      layout: "admin-layout",
      users: usersWithPredictions,
    });
  } catch (error) {
    res.render("admin/users-overview", {
      title: "Users Overview",
      layout: "admin-layout",
      error: "Failed to load users",
    });
  }
});

// Helper functions (implement these based on your database)
async function getAllUsers() {
  // TODO: Replace with actual database query
  return [
    { id: "USER001", name: "John Doe", email: "john@example.com" },
    { id: "USER002", name: "Jane Smith", email: "jane@example.com" },
  ];
}

async function getUserById(userId) {
  // TODO: Replace with actual database query
  const users = await getAllUsers();
  return users.find((u) => u.id === userId);
}

export default router;
