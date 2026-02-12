// ===================================================================
// User Dashboard Routes (with HBS views)
// Location: backend/routes/user.dashboard.routes.js
// Renders ML predictions in Handlebars templates
// ===================================================================

import express from "express";
import mlService from "../config/ml.service.js";

const router = express.Router();

/**
 * User Dashboard - Main page
 * GET /user/dashboard
 */
router.get("/dashboard", async (req, res) => {
  try {
    // Get userId from session/auth (replace with your auth system)
    const userId = req.session?.userId || req.query.userId || "USER001";

    // Get current power from query or set default
    const currentPowerW = req.query.currentPowerW || null;

    // Get ML insights
    const insights = await mlService.getInsights(userId, currentPowerW);

    // Render the dashboard view
    res.render("user/dashboard", {
      title: "My Energy Dashboard",
      userId: userId,
      insights: insights.success ? insights.data.insights : null,
      error: insights.success ? null : insights.error,
      currentPower: currentPowerW,
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    res.render("user/dashboard", {
      title: "My Energy Dashboard",
      error: "Failed to load dashboard data",
    });
  }
});

/**
 * Weekly Prediction Page
 * GET /user/predictions/weekly
 */
router.get("/predictions/weekly", async (req, res) => {
  try {
    const userId = req.session?.userId || req.query.userId || "USER001";

    const prediction = await mlService.predictConsumption(userId, 7);

    res.render("user/weekly-prediction", {
      title: "7-Day Energy Forecast",
      userId: userId,
      prediction: prediction.success ? prediction.data : null,
      error: prediction.success ? null : prediction.error,
    });
  } catch (error) {
    console.error("Weekly prediction error:", error);
    res.render("user/weekly-prediction", {
      title: "7-Day Energy Forecast",
      error: "Failed to load predictions",
    });
  }
});

/**
 * Monthly Forecast Page
 * GET /user/predictions/monthly
 */
router.get("/predictions/monthly", async (req, res) => {
  try {
    const userId = req.session?.userId || req.query.userId || "USER001";

    const forecast = await mlService.getMonthlyForecast(userId);

    res.render("user/monthly-forecast", {
      title: "Monthly Bill Forecast",
      userId: userId,
      forecast: forecast.success ? forecast.data : null,
      error: forecast.success ? null : forecast.error,
    });
  } catch (error) {
    console.error("Monthly forecast error:", error);
    res.render("user/monthly-forecast", {
      title: "Monthly Bill Forecast",
      error: "Failed to load forecast",
    });
  }
});

/**
 * Anomaly Check Page
 * GET /user/anomaly-check
 */
router.get("/anomaly-check", async (req, res) => {
  try {
    const userId = req.session?.userId || req.query.userId || "USER001";
    const currentPowerW = req.query.currentPowerW || 0;

    let anomalyData = null;

    if (currentPowerW > 0) {
      const anomaly = await mlService.detectAnomaly(
        userId,
        parseFloat(currentPowerW),
      );
      anomalyData = anomaly.success ? anomaly.data : null;
    }

    res.render("user/anomaly-check", {
      title: "Consumption Monitor",
      userId: userId,
      anomaly: anomalyData,
      currentPowerW: currentPowerW,
    });
  } catch (error) {
    console.error("Anomaly check error:", error);
    res.render("user/anomaly-check", {
      title: "Consumption Monitor",
      error: "Failed to check anomalies",
    });
  }
});

export default router;
