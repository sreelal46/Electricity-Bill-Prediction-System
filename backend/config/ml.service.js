// ===================================================================
// ML Service Client (ES6 Module)
// Location: backend/config/ml.service.js
// Handles communication with Python ML service
// ===================================================================

import axios from "axios";

class MLService {
  constructor() {
    this.baseUrl = process.env.ML_SERVICE_URL || "http://localhost:5001";
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  /**
   * Check ML service health
   */
  async checkHealth() {
    try {
      const response = await this.client.get("/");
      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Train ML models for a user
   */
  async trainModels(userId, days = 14) {
    try {
      const response = await this.client.post("/train", {
        user_id: userId,
        days: days,
      });

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      console.error(
        "ML Training Error:",
        error.response?.data || error.message,
      );
      return {
        success: false,
        error: error.response?.data?.error || error.message,
      };
    }
  }

  /**
   * Predict future energy consumption
   */
  async predictConsumption(userId, predictDays = 7) {
    try {
      const response = await this.client.post("/predict", {
        user_id: userId,
        predict_days: predictDays,
      });

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      console.error(
        "ML Prediction Error:",
        error.response?.data || error.message,
      );
      return {
        success: false,
        error: error.response?.data?.error || error.message,
      };
    }
  }

  /**
   * Detect consumption anomalies
   */
  async detectAnomaly(userId, currentPowerW) {
    try {
      const response = await this.client.post("/detect-anomaly", {
        user_id: userId,
        current_power_w: currentPowerW,
      });

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      console.error(
        "ML Anomaly Detection Error:",
        error.response?.data || error.message,
      );
      return {
        success: false,
        error: error.response?.data?.error || error.message,
      };
    }
  }

  /**
   * Get monthly forecast
   */
  async getMonthlyForecast(userId) {
    try {
      const response = await this.client.post("/monthly-forecast", {
        user_id: userId,
      });

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      console.error(
        "ML Monthly Forecast Error:",
        error.response?.data || error.message,
      );
      return {
        success: false,
        error: error.response?.data?.error || error.message,
      };
    }
  }

  /**
   * Get combined dashboard insights
   */
  async getInsights(userId, currentPowerW = null) {
    try {
      const [prediction, monthly, anomaly] = await Promise.all([
        this.predictConsumption(userId, 7),
        this.getMonthlyForecast(userId),
        currentPowerW
          ? this.detectAnomaly(userId, Number(currentPowerW))
          : Promise.resolve({ success: true, data: null }),
      ]);

      return {
        success: true,
        data: {
          insights: {
            weeklyPrediction: prediction.success ? prediction.data : null,
            monthlyForecast: monthly.success ? monthly.data : null,
            anomaly: anomaly.success ? anomaly.data : null,
          },
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

// Export singleton instance
export default new MLService();
