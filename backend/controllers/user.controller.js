import db from "../config/firebase.js";
import axios from "axios";

export const checkSession = (req, res, next) => {
  if (!req.session || !req.session.user) {
    return res.redirect("/user/login"); // change to your login route
  }

  next(); // user is logged in
};

export const loginPage = (req, res) => {
  res.status(200).render("user/login", { layout: false });
};

// Clean verifyUser controller
export const verifyUser = async (req, res) => {
  try {
    const { consumerNumber, phone } = req.body;

    // Validation
    if (!consumerNumber || !phone) {
      return res.status(400).json({
        success: false,
        message: "Consumer number and phone are required",
      });
    }

    // Get all users from Firebase
    const allUsersSnapshot = await db.ref("users").once("value");

    if (!allUsersSnapshot.exists()) {
      return res.status(500).json({
        success: false,
        message: "No users registered in the system",
      });
    }

    const allUsers = allUsersSnapshot.val();

    // Convert input to both string and number for comparison
    const inputAsString = String(consumerNumber);
    const inputAsNumber = Number(consumerNumber);

    let foundUser = null;
    let foundUserId = null;

    // Search for user with flexible matching
    for (const [userId, userData] of Object.entries(allUsers)) {
      const dbConsumerNumber = userData.consumerNumber;
      const dbAsString = String(dbConsumerNumber);
      const dbAsNumber = Number(dbConsumerNumber);

      // Try multiple matching strategies
      if (
        dbConsumerNumber === consumerNumber ||
        dbConsumerNumber === inputAsNumber ||
        dbAsString === inputAsString ||
        dbAsNumber === inputAsNumber ||
        dbAsString.toLowerCase() === inputAsString.toLowerCase() ||
        dbAsString.trim() === inputAsString.trim()
      ) {
        foundUser = userData;
        foundUserId = userId;
        break;
      }
    }

    if (!foundUser) {
      return res.status(401).json({
        success: false,
        message: "Invalid consumer number",
      });
    }

    // Validate phone number
    const dbPhone = foundUser.phoneNumber;
    const cleanDbPhone = String(dbPhone).replace(/\D/g, "");
    const cleanInputPhone = String(phone).replace(/\D/g, "");

    const phoneMatch =
      dbPhone === phone ||
      String(dbPhone) === String(phone) ||
      cleanDbPhone === cleanInputPhone ||
      Number(dbPhone) === Number(phone);

    if (!phoneMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid phone number",
      });
    }
    if (!foundUser.isInstalled) {
      return res.status(401).json({
        success: false,
        message: "Your service is not installed yet. Please contact support.",
      });
    }

    // Get alerts count
    const alertSnapshot = await db
      .ref(`user_alerts/${foundUserId}`)
      .once("value");
    const alertsObj = alertSnapshot.val();
    const alertLength = alertsObj ? Object.keys(alertsObj).length : 0;

    // Create session
    req.session.user = {
      id: foundUserId,
      alertLength,
      consumerNumber: foundUser.consumerNumber,
      name: foundUser.name,
      phone: foundUser.phoneNumber,
      email: foundUser.email,
      approved_phase: foundUser.approved_phase,
      approved_load_kw: foundUser.approved_load_kw,
      address: foundUser.address,
      isInstalled: foundUser.isInstalled,
    };

    // Save session
    await new Promise((resolve, reject) => {
      req.session.save((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    return res.status(200).json({
      success: true,
      redirectUrl: "/user/dashboard",
      message: "Login successful",
    });
  } catch (error) {
    console.error("Login error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Server error during login",
    });
  }
};

export const registration = async (req, res, next) => {
  try {
    const {
      name,
      consumerNumber,
      phoneNumber,
      email,
      address,
      approvedLoad,
      phaseType,
    } = req.body;

    if (!consumerNumber) {
      return res.status(400).json({
        success: false,
        message: "Consumer number is required",
      });
    }

    // 🔍 Check if consumerNumber already exists
    const existingUserSnapshot = await db
      .ref("users")
      .orderByChild("consumerNumber")
      .equalTo(consumerNumber)
      .once("value");

    if (existingUserSnapshot.exists()) {
      return res.status(400).json({
        success: false,
        message: "Consumer number already registered",
      });
    }

    // ✅ If not exists → create new user
    const newRef = db.ref("users").push();

    await newRef.set({
      id: newRef.key,
      name,
      consumerNumber,
      phoneNumber,
      email,
      address,
      approved_load_kw: approvedLoad,
      approved_phase: phaseType,
      isInstalled: false,
      registration_date: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });

    return res.status(200).json({
      success: true,
      message: "Registration successful",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const registerPage = (req, res) => {
  res.status(200).render("user/registration", { layout: false });
};

export const dashboardController = async (req, res) => {
  const userId = req.session.user.id;

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

    //  Keep only last 7 days
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

        // Filter readings for TODAY only
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
    res.status(500).send(err.message);
  }
};

export const alertController = async (req, res, next) => {
  const userId = req.session.user.id;

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
export const profilePage = async (req, res, next) => {
  const userId = req.session.user.id;

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

    // Render profile page with user data
    res.render("user/profile", {
      title: "User Profile",
      user,
    });
  } catch (error) {
    res.status(500).render("500", {
      title: "Server Error",
      message: "Something went wrong while loading profile",
      layout: false,
    });
  }
};
export const predictPage = async (req, res, next) => {
  const userId = req.session.user.id;

  try {
    const snapshot = await db.ref(`daily_data/${userId}`).once("value");

    if (!snapshot.exists()) {
      return res.render("user/predictions", {
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
      results.predictions.monthly = {
        error: "Failed to generate monthly prediction",
        details: error.message,
      };
    }

    // Render the predictions page with all data
    res.render("user/predictions", results);
  } catch (error) {
    res.status(500).render("error", {
      error: "Server error while generating predictions",
      details: error.message,
    });
  }
};

// Logout Controller
export const logoutController = (req, res) => {
  // Destroy the session
  delete req.session.user;
  // Redirect to home page
  res.redirect("/");
};
