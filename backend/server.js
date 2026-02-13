// ===================================================================
// Updated Server.js with Handlebars + ML Integration
// Complete server setup with views and routes
// ===================================================================
import dotenv from "dotenv";
dotenv.config();
import express from "express";
import path from "path";
import cors from "cors";
import { fileURLToPath } from "url";
import session from "express-session";
import { engine } from "express-handlebars";
import userRoutes from "./routes/user.routes.js";
import adminRoutes from "./routes/admin.routes.js";

const app = express();
const PORT = process.env.PORT || 8000;

// Get __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============ Session Setup ============
app.use(
  session({
    name: "kseb-session",
    secret: process.env.SESSION_SECRET || "super-secret-key",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false, // true if using HTTPS
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 2, // 2 hours
    },
  }),
);

// ============ Handlebars Setup ============
app.engine(
  "hbs",
  engine({
    extname: ".hbs",
    defaultLayout: "main",
    layoutsDir: path.join(__dirname, "views/layouts"),
    partialsDir: path.join(__dirname, "views/partials"),
    helpers: {
      // Custom helper to convert to JSON
      json: function (context) {
        return JSON.stringify(context);
      },
      // Helper to compare values
      eq: function (a, b) {
        return a === b;
      },
      // Helper to check if greater than
      gt: function (a, b) {
        return a > b;
      },
      // Helper to convert to lowercase
      toLowerCase: function (str) {
        return str ? str.toLowerCase() : "";
      },
      eq: function (a, b) {
        return a === b;
      },
      getConfidencePercent: function (confidence) {
        const percentages = {
          high: 95,
          medium: 75,
          low: 50,
        };
        return percentages[confidence] || 50;
      },
      ifEquals: (a, b, options) => {
        return a === b ? options.fn(this) : options.inverse(this);
      },
      countSeverity: (alerts, level) => {
        return alerts.filter((alert) => alert.severity === level).length;
      }, // Count items by a specific property value
      countBy: function (array, property, value) {
        if (!Array.isArray(array)) return 0;
        return array.filter((item) => item[property] === value).length;
      },

      // Format date/timestamp
      formatDate: function (timestamp) {
        if (!timestamp) return "";
        const date = new Date(timestamp);
        return date.toLocaleString("en-IN", {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
      },

      // Check if array has items
      hasItems: function (array) {
        return Array.isArray(array) && array.length > 0;
      }, // Convert string to lowercase
      toLowerCase: function (str) {
        if (!str) return "";
        return str.toLowerCase();
      },
      // Get substring (for initials)
      substring: function (str, start, end) {
        if (!str) return "";
        return str.substring(start, end).toUpperCase();
      },
    },
  }),
);
app.set("view engine", "hbs");
app.set("views", path.join(__dirname, "views"));

// ============ Middleware ============
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files (CSS, JS, images)
app.use(express.static(path.join(__dirname, "public")));

// ============ Routes ============

// User dashboard routes (HBS views)
app.get("/", (req, res) => {
  res.render("landingpage", { layout: false });
});
app.get("/home", (req, res) => {
  res.render("home");
});
app.use("/user", userRoutes);

// Admin dashboard routes (HBS views)
app.use("/admin", adminRoutes);

// ============ Error Handling ============

// 404 handler
app.use((req, res) => {
  console.log("errorrr");
  res.status(404).render("404", {
    title: "Page Not Found",
    layout: false,
  });
});

// Global error handler
app.use((err, req, res, next) => {
  // Log error details
  console.error("❌ Server Error:", {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    timestamp: new Date().toISOString(),
  });

  res.status(500).render("500", {
    title: "Page Not Found",
    layout: false,
  });
});

// ============ Start Server ============
app.listen(PORT, () => {
  console.log("\n" + "=".repeat(60));
  console.log("🚀 KSEB Smart Meter Server Starting...");
  console.log("=".repeat(60));
  console.log(`\n📡 Server running on: http://localhost:${PORT}`);
});

export default app;
