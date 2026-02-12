// ===================================================================
// ML Controller (ES6 Module)
// Location: backend/controllers/ml.controller.js
// Handles all ML-related API requests
// ===================================================================

import mlService from "../config/ml.service.js";

/**
 * Check ML service health
 * GET /api/ml/health
 */
export const checkHealth = async (req, res) => {
  try {
    const health = await mlService.checkHealth();

    if (!health.success) {
      return res.status(503).json({
        success: false,
        error: "ML service unavailable",
        message: "Please ensure Python ML service is running on port 5001",
      });
    }

    res.json({
      success: true,
      data: health.data,
    });
  } catch (error) {
    console.error("Health check error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to check ML service health",
      message: error.message,
    });
  }
};

/**
 * Train ML models for a user
 * POST /api/ml/train
 * Body: { userId, days }
 */
export const trainModels = async (req, res) => {
  try {
    const { userId, days = 14 } = req.body;

    // Validation
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "userId is required",
      });
    }

    console.log(`[ML] Training models for user: ${userId}`);

    const result = await mlService.trainModels(userId, days);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error,
      });
    }

    res.json({
      success: true,
      message: "Models trained successfully",
      data: result.data,
    });
  } catch (error) {
    console.error("Train models error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to train models",
      message: error.message,
    });
  }
};

/**
 * Predict future consumption
 * POST /api/ml/predict
 * Body: { userId, predictDays }
 */
export const predictConsumption = async (req, res) => {
  try {
    const { userId, predictDays = 7 } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "userId is required",
      });
    }

    console.log(`[ML] Predicting ${predictDays} days for user: ${userId}`);

    const result = await mlService.predictConsumption(userId, predictDays);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error,
        suggestion: "Ensure models are trained first using /api/ml/train",
      });
    }

    res.json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    console.error("Predict consumption error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to predict consumption",
      message: error.message,
    });
  }
};

/**
 * Detect consumption anomaly
 * POST /api/ml/detect-anomaly
 * Body: { userId, currentPowerW }
 */
export const detectAnomaly = async (req, res) => {
  try {
    const { userId, currentPowerW } = req.body;

    if (!userId || currentPowerW === undefined) {
      return res.status(400).json({
        success: false,
        error: "userId and currentPowerW are required",
      });
    }

    console.log(
      `[ML] Detecting anomaly for user: ${userId}, power: ${currentPowerW}W`,
    );

    const result = await mlService.detectAnomaly(userId, currentPowerW);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error,
      });
    }

    res.json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    console.error("Detect anomaly error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to detect anomaly",
      message: error.message,
    });
  }
};

/**
 * Get monthly forecast
 * POST /api/ml/monthly-forecast
 * Body: { userId }
 */
export const getMonthlyForecast = async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "userId is required",
      });
    }

    console.log(`[ML] Getting monthly forecast for user: ${userId}`);

    const result = await mlService.getMonthlyForecast(userId);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error,
      });
    }

    res.json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    console.error("Monthly forecast error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get monthly forecast",
      message: error.message,
    });
  }
};

/**
 * Get comprehensive ML insights
 * GET /api/ml/insights/:userId
 * Query: ?currentPowerW=2500
 */
export const getInsights = async (req, res) => {
  try {
    const { userId } = req.params;
    const { currentPowerW } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "userId is required",
      });
    }

    console.log(`[ML] Getting insights for user: ${userId}`);

    // Get all ML data in parallel
    const [weeklyPrediction, monthlyForecast, anomalyResult] =
      await Promise.all([
        mlService.predictConsumption(userId, 7),
        mlService.getMonthlyForecast(userId),
        currentPowerW
          ? mlService.detectAnomaly(userId, parseFloat(currentPowerW))
          : null,
      ]);

    res.json({
      success: true,
      userId,
      insights: {
        weeklyPrediction: weeklyPrediction.success
          ? weeklyPrediction.data
          : null,
        monthlyForecast: monthlyForecast.success ? monthlyForecast.data : null,
        currentAnomaly: anomalyResult?.success ? anomalyResult.data : null,
      },
      errors: {
        weeklyPrediction: weeklyPrediction.success
          ? null
          : weeklyPrediction.error,
        monthlyForecast: monthlyForecast.success ? null : monthlyForecast.error,
        currentAnomaly:
          anomalyResult?.success === false ? anomalyResult.error : null,
      },
    });
  } catch (error) {
    console.error("Get insights error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get ML insights",
      message: error.message,
    });
  }
};
