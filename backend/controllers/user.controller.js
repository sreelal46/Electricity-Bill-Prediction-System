import db from "../config/firebase.js";
import axios from "axios";
export const dashboardController = async (req, res, next) => {
  const { userId } = req.params;

  try {
    const userSnap = await db.ref(`users/${userId}`).once("value");
    const readingSnap = await db.ref(`latest_readings/${userId}`).once("value");

    if (!userSnap.exists()) {
      return res.send("<h1>User not found</h1>");
    }
    const user = userSnap.val();
    let latestReading = readingSnap.val();

    res.render("user/dashboard", { latestReading, user });
  } catch (err) {
    console.log(err);
    res.status(500).send(`<pre>${err.message}</pre>`);
  }
};

export const allReadingController = async (req, res, next) => {
  const { userId } = req.params;
  const { start, end, limit = 1000 } = req.query;

  try {
    let ref = db.ref(`readings/${userId}`);

    if (start && end) {
      ref = ref.orderByChild("timestamp").startAt(start).endAt(end);
    }

    const snapshot = await ref.limitToFirst(Number(limit)).once("value");

    if (!snapshot.exists()) {
      return res.json([]);
    }

    const data = [];
    snapshot.forEach((child) => {
      data.push({ id: child.key, ...child.val() });
    });

    res.render("user/readings", { readings: data });
    // res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const dailyUseage = async (req, res, next) => {
  const { userId } = req.params;

  try {
    const snapshot = await db.ref(`daily_data/${userId}`).once("value");

    if (!snapshot.exists()) return res.json([]);

    const data = [];
    snapshot.forEach((day) => {
      data.push({ date: day.key, ...day.val() });
    });
    res.render("user/daily-summary", { summaries: data });
    // res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const alertController = async (req, res, next) => {
  const { userId } = req.params;

  try {
    const snapshot = await db.ref(`user_alerts/${userId}`).once("value");

    const alertsObj = snapshot.val();

    if (!alertsObj) {
      return res.render("user/alerts", { alerts: [] });
    }

    // 🔥 Convert object → array
    const alerts = Object.entries(alertsObj).map(([id, value]) => ({
      id,
      ...value,
    }));

    res.render("user/alerts", { alerts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const predictNextDay = async (req, res, next) => {
  const { userId } = req.params;

  try {
    const snapshot = await db.ref(`daily_data/${userId}`).once("value");

    if (!snapshot.exists()) {
      return res.json({ message: "No data found for this user" });
    }

    const allData = snapshot.val();
    const dataArray = Object.values(allData);

    // Sort latest first
    dataArray.sort((a, b) => new Date(b.date) - new Date(a.date));

    let selectedDays = [];
    let daysUsed = 0;

    // Smart fallback logic for daily prediction
    if (dataArray.length >= 30) {
      selectedDays = dataArray.slice(0, 30); // Best case: 30 days
      daysUsed = 30;
    } else if (dataArray.length >= 14) {
      selectedDays = dataArray.slice(0, 14); // Good: 14+ days
      daysUsed = 14;
    } else if (dataArray.length >= 7) {
      selectedDays = dataArray.slice(0, 7); // Acceptable: 7+ days
      daysUsed = 7;
    } else if (dataArray.length >= 3) {
      selectedDays = dataArray.slice(0, 3); // Minimum: 3+ days
      daysUsed = 3;
    } else {
      return res.json({
        message: "Not enough data for prediction (minimum 3 days required)",
        availableDays: dataArray.length,
      });
    }

    const aiResponse = await axios.post("http://localhost:5000/predict", {
      history: selectedDays,
      prediction_type: "daily",
    });

    res.json({
      daysUsed,
      inputCount: selectedDays.length,
      prediction: aiResponse.data,
    });
  } catch (error) {
    console.error("Daily prediction error:", error.message);
    res.status(500).json({ error: "Server error during daily prediction" });
  }
};

export const predictNextWeek = async (req, res, next) => {
  const { userId } = req.params;

  try {
    const snapshot = await db.ref(`daily_data/${userId}`).once("value");

    if (!snapshot.exists()) {
      return res.json({ message: "No data found for this user" });
    }

    const allData = snapshot.val();
    const dataArray = Object.values(allData);

    // Sort latest first
    dataArray.sort((a, b) => new Date(b.date) - new Date(a.date));

    let selectedDays = [];
    let daysUsed = 0;

    // Improved fallback logic for weekly prediction - NO GAPS
    if (dataArray.length >= 30) {
      selectedDays = dataArray.slice(0, 30); // Ideal: 30 days
      daysUsed = 30;
    } else if (dataArray.length >= 21) {
      selectedDays = dataArray.slice(0, 21); // Good: 3 weeks
      daysUsed = 21;
    } else if (dataArray.length >= 14) {
      selectedDays = dataArray.slice(0, 14); // Minimum: 2 weeks
      daysUsed = 14;
    } else if (dataArray.length >= 7) {
      // NEW: Handle 7-13 days (previously fell through)
      selectedDays = dataArray.slice(0, dataArray.length); // Use all available
      daysUsed = dataArray.length;
    } else {
      return res.json({
        message:
          "Not enough data for weekly prediction (minimum 7 days required)",
        availableDays: dataArray.length,
      });
    }

    const aiResponse = await axios.post("http://localhost:5000/predict", {
      history: selectedDays,
      prediction_type: "weekly",
    });

    res.json({
      daysUsed,
      inputCount: selectedDays.length,
      prediction: aiResponse.data,
    });
  } catch (error) {
    console.error("Weekly prediction error:", error.message);
    res.status(500).json({ error: "Server error during weekly prediction" });
  }
};

export const predictNextMonth = async (req, res, next) => {
  const { userId } = req.params;
  try {
    const snapshot = await db.ref(`daily_data/${userId}`).once("value");

    if (!snapshot.exists()) {
      return res.json({ message: "No data found for this user" });
    }

    const allData = snapshot.val();
    const dataArray = Object.values(allData);

    // Sort latest first
    dataArray.sort((a, b) => new Date(b.date) - new Date(a.date));

    let selectedDays = [];
    let daysUsed = 0;

    // Improved fallback logic for monthly prediction - NO GAPS
    if (dataArray.length >= 60) {
      selectedDays = dataArray.slice(0, 60); // Ideal: 60 days
      daysUsed = 60;
    } else if (dataArray.length >= 45) {
      selectedDays = dataArray.slice(0, 45); // Good: 6+ weeks
      daysUsed = 45;
    } else if (dataArray.length >= 30) {
      selectedDays = dataArray.slice(0, 30); // Acceptable: 30+ days
      daysUsed = 30;
    } else if (dataArray.length >= 21) {
      // NEW: Handle 21-29 days (previously fell through)
      selectedDays = dataArray.slice(0, dataArray.length); // Use all available
      daysUsed = dataArray.length;
    } else if (dataArray.length >= 14) {
      // NEW: Handle 14-20 days (bare minimum for monthly)
      selectedDays = dataArray.slice(0, dataArray.length); // Use all available
      daysUsed = dataArray.length;
    } else {
      return res.json({
        message:
          "Not enough data for monthly prediction (minimum 14 days required)",
        availableDays: dataArray.length,
      });
    }

    console.log("Selected days for monthly prediction:", selectedDays.length);

    const aiResponse = await axios.post("http://localhost:5000/predict", {
      history: selectedDays,
      prediction_type: "monthly",
    });

    res.json({
      daysUsed,
      inputCount: selectedDays.length,
      prediction: aiResponse.data,
    });
  } catch (error) {
    console.error("Monthly prediction error:", error.message);
    res.status(500).json({ error: "Server error during monthly prediction" });
  }
};
