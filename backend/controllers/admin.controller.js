import db from "../config/firebase.js";

export const loginPage = async (req, res) => {
  res.status(200).render("admin/login", { layout: false });
};
// Logout Controller
export const logoutController = (req, res) => {
  // Destroy the session
  delete req.session.admin;
  res.redirect("/");
};
export const verifyAdmin = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Check required fields
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    // Query admin by email
    const snapshot = await db
      .ref("admin")
      .orderByChild("email")
      .equalTo(email)
      .once("value");

    if (!snapshot.exists()) {
      return res.status(401).json({
        success: false,
        message: "Invalid email",
      });
    }

    const admins = snapshot.val();
    const adminId = Object.keys(admins)[0];
    const adminData = admins[adminId];

    // Check password
    if (adminData.password !== password) {
      return res.status(401).json({
        success: false,
        message: "Invalid password",
      });
    }

    // Store session
    req.session.admin = {
      id: adminId,
      email: adminData.email,
    };

    return res.status(200).json({
      success: true,
      redirect: "/admin/dashboard",
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};
export const registrationPage = async (req, res) => {
  res.status(200).render("admin/registration");
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

    // Check if consumerNumber already exists
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

    //  If not exists → create new user
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
      redirectUrl: "/admin/users",
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const dashboardController = async (req, res, next) => {
  try {
    //Get all users
    const usersSnap = await db.ref("users").once("value");

    if (!usersSnap.exists()) {
      return res.send("<h1>No users found</h1>");
    }

    const users = [];
    usersSnap.forEach((child) => {
      users.push({ id: child.key, ...child.val() });
    });
    // Count total users
    const totalUsers = users.length;

    const snapshot = await db.ref("admin_alerts").once("value");
    const alerts = [];

    snapshot.forEach((alert) => {
      alerts.push({
        id: alert.key,
        ...alert.val(),
      });
    });
    users.sort((a, b) =>
      b.registration_date.localeCompare(a.registration_date),
    );
    const totalAlerts = alerts.length;
    // res.json(alertsSnap);
    res.render("admin/dashboard", {
      title: "Admin Dashboard",
      users,
      totalUsers,
      totalAlerts,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const allUsers = async (req, res, next) => {
  try {
    const snapshot = await db.ref("users").once("value");

    if (!snapshot.exists()) return res.json([]);

    const users = [];
    snapshot.forEach((child) => {
      users.push({ id: child.key, ...child.val() });
    });

    users.sort((a, b) =>
      b.registration_date.localeCompare(a.registration_date),
    );

    // res.json(users);
    res.render("admin/admin-users", {
      title: "All Users",
      users,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
export const markInstalled = async (req, res, next) => {
  const { userId } = req.params;

  try {
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    // Update only isInstalled field
    await db.ref(`users/${userId}`).update({
      isInstalled: true,
      installedAt: new Date().toISOString(), // optional
    });

    res.status(200).json({
      success: true,
      message: "Installation marked successfully",
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
export const latestReadingController = async (req, res, next) => {
  const { userId } = req.params;
  try {
    const snapshot = await db.ref(`latest_readings/${userId}`).once("value");

    const latest = snapshot.val();
    res.render("admin/user-latest-readings", {
      title: "Latest Reading",
      latestReading: latest,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const dailyUseage = async (req, res, next) => {
  const { userId } = req.params;

  try {
    /* ===============================
       GET DAILY TREND 
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

    // Keep only last
    const weekTrend = allDailyData.slice(-7);
    const _10dayTrend = allDailyData.slice(-10);
    const _2WeekTrend = allDailyData.slice(-14);
    const monthTrend = allDailyData.slice(-30);
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

    res.render("admin/user-daily-summary", {
      weekTrend,
      _10dayTrend,
      _2WeekTrend,
      monthTrend,
      todayReadings,
    });
    // res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const allAlert = async (req, res, next) => {
  try {
    const snapshot = await db.ref("admin_alerts").once("value");
    const alerts = [];

    snapshot.forEach((alert) => {
      alerts.push({
        id: alert.key,
        ...alert.val(),
      });
    });
    console.log("alerts", alerts);
    res.render("admin/alerts", {
      alerts,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
