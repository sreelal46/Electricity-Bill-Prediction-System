import db from "../config/firebase.js";

export const loginPage = async (req, res) => {
  res.status(200).render("admin/login", { layout: false });
};

export const dashboardController = async (req, res, next) => {
  try {
    // 1️⃣ Get all users
    const usersSnap = await db.ref("users").once("value");

    if (!usersSnap.exists()) {
      return res.send("<h1>No users found</h1>");
    }

    const users = [];
    usersSnap.forEach((child) => {
      users.push({ id: child.key, ...child.val() });
    });
    // 2️⃣ Count total users
    const totalUsers = users.length;

    const snapshot = await db.ref("admin_alerts").once("value");
    const alerts = [];

    snapshot.forEach((alert) => {
      alerts.push({
        id: alert.key,
        ...alert.val(),
      });
    });
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

    // res.json(users);
    res.render("admin/admin-users", {
      title: "All Users",
      users,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const latestReadingController = async (req, res, next) => {
  const { userId } = req.params;
  try {
    const snapshot = await db.ref(`latest_readings/${userId}`).once("value");

    if (!snapshot.exists()) {
      return res.status(404).json({ message: "No readings found" });
    }

    const latest = snapshot.val();
    // res.json(latest);
    res.render("admin/user-readings", {
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
    const snapshot = await db.ref(`daily_data/${userId}`).once("value");

    if (!snapshot.exists()) return res.json([]);

    const data = [];
    snapshot.forEach((day) => {
      data.push({ date: day.key, ...day.val() });
    });
    res.render("admin/user-daily-summary", { summaries: data });
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

    res.render("admin/alerts", {
      alerts: alerts || [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
