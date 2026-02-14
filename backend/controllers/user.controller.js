import db from "../config/firebase.js";
import axios from "axios";

export const loginPage = (req, res) => {
  res.status(200).render("user/login", { layout: false });
};

export const verifyUser = async (req, res, next) => {
  try {
    console.log(req.body);
    req.session.user = { id: "USER001" };
    res.redirect("/user/dashboard");
  } catch (error) {}
};

export const registerPage = (req, res) => {
  res.status(200).render("user/register", { layout: false });
};

export const dashboardController = async (req, res) => {
  const userId = req.session?.user?.id || "USER001";

  try {
    /* ===============================
       GET DAILY TREND (LAST 7 DAYS ONLY)
    =============================== */
    const dailySnap = await db.ref(`daily_data/${userId}`).once("value");

    const allDailyData = [];

    if (dailySnap.exists()) {
      dailySnap.forEach((day) => {
        allDailyData.push({
          id: day.key,
          ...day.val(),
        });
      });
    }

    // Sort by date
    allDailyData.sort((a, b) => new Date(a.date) - new Date(b.date));

    // ✅ FIX: Keep only last 7 days
    const dailyTrend = allDailyData.slice(-7);

    // Get latest reading from daily data
    const latestReading =
      dailyTrend.length > 0 ? dailyTrend[dailyTrend.length - 1] : null;

    /* ===============================
       GET TODAY'S READINGS ONLY
    =============================== */
    const readingSnap = await db.ref(`readings/${userId}`).once("value");

    const todayReadings = [];
    const today = new Date().toISOString().split("T")[0]; // format: YYYY-MM-DD

    if (readingSnap.exists()) {
      readingSnap.forEach((child) => {
        const reading = child.val();

        // ✅ FIX: Filter readings for TODAY only
        if (reading.timestamp && reading.timestamp.startsWith(today)) {
          todayReadings.push({
            id: child.key,
            ...reading,
          });
        }
      });
    }

    // Sort by timestamp
    todayReadings.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    console.log("📊 Dashboard Data Summary:", {
      dailyTrendCount: dailyTrend.length,
      todayReadingsCount: todayReadings.length,
      hasLatestReading: !!latestReading,
      dateRange:
        dailyTrend.length > 0
          ? `${dailyTrend[0].date} to ${dailyTrend[dailyTrend.length - 1].date}`
          : "No data",
      todayDate: today,
    });

    /* ===============================
       RENDER DASHBOARD VIEW
    =============================== */
    res.render("user/dashboard", {
      // Send JSON-stringified data for Handlebars
      dailyTrendJSON: JSON.stringify(dailyTrend),
      latestReadingJSON: JSON.stringify(latestReading),
      todayReadingsJSON: JSON.stringify(todayReadings),

      // Also send raw data in case you want to use it directly in HBS
      dailyTrend,
      latestReading,
      todayReadings,
    });
  } catch (err) {
    console.error("❌ Dashboard Error:", err);
    res.status(500).send(err.message);
  }
};

/* ===============================
   ALTERNATIVE: More efficient query-based approach
   Use this if you want to filter at database level
=============================== */

export const dashboardControllerOptimized = async (req, res) => {
  const userId = req.session?.user?.id || "USER001";

  try {
    // Calculate date 7 days ago
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const startDate = sevenDaysAgo.toISOString().split("T")[0];

    // Today's date
    const today = new Date().toISOString().split("T")[0];

    /* ===============================
       GET DAILY TREND (with Firebase query)
    =============================== */
    const dailySnap = await db
      .ref(`daily_data/${userId}`)
      .orderByChild("date")
      .startAt(startDate)
      .once("value");

    const dailyTrend = [];

    if (dailySnap.exists()) {
      dailySnap.forEach((day) => {
        dailyTrend.push({
          id: day.key,
          ...day.val(),
        });
      });
    }

    // Sort by date
    dailyTrend.sort((a, b) => new Date(a.date) - new Date(b.date));

    const latestReading =
      dailyTrend.length > 0 ? dailyTrend[dailyTrend.length - 1] : null;

    /* ===============================
       GET TODAY'S READINGS (with Firebase query)
    =============================== */
    const todayStart = `${today} 00:00:00`;
    const todayEnd = `${today} 23:59:59`;

    const readingSnap = await db
      .ref(`readings/${userId}`)
      .orderByChild("timestamp")
      .startAt(todayStart)
      .endAt(todayEnd)
      .once("value");

    const todayReadings = [];

    if (readingSnap.exists()) {
      readingSnap.forEach((child) => {
        todayReadings.push({
          id: child.key,
          ...child.val(),
        });
      });
    }

    // Sort by timestamp
    todayReadings.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    console.log("📊 Dashboard Data Summary (Optimized):", {
      dailyTrendCount: dailyTrend.length,
      todayReadingsCount: todayReadings.length,
      hasLatestReading: !!latestReading,
      dateRange:
        dailyTrend.length > 0
          ? `${dailyTrend[0].date} to ${dailyTrend[dailyTrend.length - 1].date}`
          : "No data",
      todayDate: today,
      queryFiltered: true,
    });

    /* ===============================
       RENDER DASHBOARD VIEW
    =============================== */
    res.render("user/dashboard", {
      dailyTrendJSON: JSON.stringify(dailyTrend),
      latestReadingJSON: JSON.stringify(latestReading),
      todayReadingsJSON: JSON.stringify(todayReadings),
      dailyTrend,
      latestReading,
      todayReadings,
    });
  } catch (err) {
    console.error("❌ Dashboard Error:", err);
    res.status(500).send(err.message);
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
  // const { userId } = req.params;
  const userId = "USER001";

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
    console.log(alerts);
    res.render("user/alerts", { alerts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
export const profilePage = async (req, res, next) => {
  const userId = "USER001"; // later you can use req.session.user.id

  try {
    const snapshot = await db.ref(`users/${userId}`).once("value");

    // If user does not exist
    if (!snapshot.exists()) {
      return res.status(404).render("404", {
        title: "User Not Found",
        message: "User profile does not exist",
        layout: false,
      });
    }

    const user = snapshot.val();
    console.log(user);
    // Render profile page with user data
    res.render("user/profile", {
      title: "User Profile",
      user,
    });
  } catch (error) {
    console.error("Profile Page Error:", error);

    res.status(500).render("500", {
      title: "Server Error",
      message: "Something went wrong while loading profile",
      layout: false,
    });
  }
};
export const predictPage = async (req, res, next) => {
  // const { userId } = req.query;
  const userId = "USER001";

  if (!userId) {
    return res.status(400).render("error", {
      message: "userId is required as a query parameter",
    });
  }

  try {
    const snapshot = await db.ref(`daily_data/${userId}`).once("value");

    if (!snapshot.exists()) {
      return res.render("predictions", {
        message: "No data found for this user",
        userId: userId,
        noData: true,
      });
    }

    const allData = snapshot.val();
    const dataArray = Object.values(allData);
    dataArray.sort((a, b) => new Date(b.date) - new Date(a.date));

    const availableDays = dataArray.length;
    const results = {
      userId: userId,
      availableDays: availableDays,
      predictions: {},
      generatedAt: new Date().toISOString(),
    };

    // DAILY PREDICTION
    try {
      let dailySelectedDays = [];
      let dailyDaysUsed = 0;

      if (availableDays >= 30) {
        dailySelectedDays = dataArray.slice(0, 30);
        dailyDaysUsed = 30;
      } else if (availableDays >= 14) {
        dailySelectedDays = dataArray.slice(0, 14);
        dailyDaysUsed = 14;
      } else if (availableDays >= 7) {
        dailySelectedDays = dataArray.slice(0, 7);
        dailyDaysUsed = 7;
      } else if (availableDays >= 3) {
        dailySelectedDays = dataArray.slice(0, 3);
        dailyDaysUsed = 3;
      } else {
        results.predictions.daily = {
          error: "Not enough data for prediction (minimum 3 days required)",
          availableDays: availableDays,
        };
      }

      if (dailySelectedDays.length > 0) {
        const dailyResponse = await axios.post(
          "http://localhost:5000/predict",
          {
            history: dailySelectedDays,
            prediction_type: "daily",
          },
        );

        results.predictions.daily = {
          daysUsed: dailyDaysUsed,
          inputCount: dailySelectedDays.length,
          prediction: dailyResponse.data,
        };
      }
    } catch (error) {
      console.error("Daily prediction error:", error.message);
      results.predictions.daily = {
        error: "Failed to generate daily prediction",
        details: error.message,
      };
    }

    // WEEKLY PREDICTION
    try {
      let weeklySelectedDays = [];
      let weeklyDaysUsed = 0;

      if (availableDays >= 30) {
        weeklySelectedDays = dataArray.slice(0, 30);
        weeklyDaysUsed = 30;
      } else if (availableDays >= 21) {
        weeklySelectedDays = dataArray.slice(0, 21);
        weeklyDaysUsed = 21;
      } else if (availableDays >= 14) {
        weeklySelectedDays = dataArray.slice(0, 14);
        weeklyDaysUsed = 14;
      } else if (availableDays >= 7) {
        weeklySelectedDays = dataArray.slice(0, availableDays);
        weeklyDaysUsed = availableDays;
      } else {
        results.predictions.weekly = {
          error:
            "Not enough data for weekly prediction (minimum 7 days required)",
          availableDays: availableDays,
        };
      }

      if (weeklySelectedDays.length > 0) {
        const weeklyResponse = await axios.post(
          "http://localhost:5000/predict",
          {
            history: weeklySelectedDays,
            prediction_type: "weekly",
          },
        );

        results.predictions.weekly = {
          daysUsed: weeklyDaysUsed,
          inputCount: weeklySelectedDays.length,
          prediction: weeklyResponse.data,
        };
      }
    } catch (error) {
      console.error("Weekly prediction error:", error.message);
      results.predictions.weekly = {
        error: "Failed to generate weekly prediction",
        details: error.message,
      };
    }

    // MONTHLY PREDICTION
    try {
      let monthlySelectedDays = [];
      let monthlyDaysUsed = 0;

      if (availableDays >= 60) {
        monthlySelectedDays = dataArray.slice(0, 60);
        monthlyDaysUsed = 60;
      } else if (availableDays >= 45) {
        monthlySelectedDays = dataArray.slice(0, 45);
        monthlyDaysUsed = 45;
      } else if (availableDays >= 30) {
        monthlySelectedDays = dataArray.slice(0, 30);
        monthlyDaysUsed = 30;
      } else if (availableDays >= 21) {
        monthlySelectedDays = dataArray.slice(0, availableDays);
        monthlyDaysUsed = availableDays;
      } else if (availableDays >= 14) {
        monthlySelectedDays = dataArray.slice(0, availableDays);
        monthlyDaysUsed = availableDays;
      } else {
        results.predictions.monthly = {
          error:
            "Not enough data for monthly prediction (minimum 14 days required)",
          availableDays: availableDays,
        };
      }

      if (monthlySelectedDays.length > 0) {
        const monthlyResponse = await axios.post(
          "http://localhost:5000/predict",
          {
            history: monthlySelectedDays,
            prediction_type: "monthly",
          },
        );

        results.predictions.monthly = {
          daysUsed: monthlyDaysUsed,
          inputCount: monthlySelectedDays.length,
          prediction: monthlyResponse.data,
        };
      }
    } catch (error) {
      console.error("Monthly prediction error:", error.message);
      results.predictions.monthly = {
        error: "Failed to generate monthly prediction",
        details: error.message,
      };
    }

    // Render the predictions page with all data
    res.render("user/predictions", results);
  } catch (error) {
    console.error("Predictions page error:", error.message);
    res.status(500).render("error", {
      error: "Server error while generating predictions",
      details: error.message,
    });
  }
};

// Logout Controller
export const logoutController = (req, res) => {
  // Destroy the session
  // req.session.destroy((err) => {
  //   if (err) {
  //     console.error("❌ Logout Error:", err);
  //     return res.status(500).send("Error logging out");
  //   }

  //   // Clear the session cookie
  //   res.clearCookie('connect.sid'); // Default session cookie name

  //   // Redirect to home page
  res.redirect("/");
  // });
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
