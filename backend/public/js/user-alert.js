// ========================================
// COUNT ALERTS BY SEVERITY
// ========================================
const alertsDataElement = document.getElementById("alertsData");
const alerts = JSON.parse(alertsDataElement.dataset.alerts || "[]");

console.log("📊 Alerts Data:", alerts);

// Count each severity level
const highCount = alerts.filter((a) => a.severity === "HIGH").length;
const mediumCount = alerts.filter((a) => a.severity === "MEDIUM").length;
const lowCount = alerts.filter((a) => a.severity === "LOW").length;

// Update the counts in the UI
document.getElementById("criticalCount").textContent = highCount;
document.getElementById("warningCount").textContent = mediumCount;
document.getElementById("lowCount").textContent = lowCount;

// ========================================
// UPDATE STATUS INDICATOR
// ========================================
const statusIndicator = document.getElementById("statusIndicator");
const statusText = document.getElementById("statusText");

if (alerts.length === 0) {
  // No alerts - system healthy
  statusIndicator.classList.add("healthy");
  statusText.textContent = "All Systems Operational";
} else if (highCount > 0) {
  // Critical alerts present
  statusIndicator.classList.add("critical");
  statusText.textContent = `Critical: ${highCount} Alert${highCount > 1 ? "s" : ""} Require Attention`;
} else if (mediumCount > 0) {
  // Warnings present
  statusIndicator.classList.add("warning");
  statusText.textContent = `Warning: ${mediumCount} Alert${mediumCount > 1 ? "s" : ""} Detected`;
} else {
  // Only low priority alerts
  statusIndicator.classList.add("healthy");
  statusText.textContent = `Info: ${lowCount} Notification${lowCount > 1 ? "s" : ""}`;
}

// ========================================
// INITIALIZE LUCIDE ICONS
// ========================================
lucide.createIcons();
