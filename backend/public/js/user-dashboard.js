// ========================================
// PARSE DATA FROM SERVER
// ========================================
const dataElement = document.getElementById("dashboardData");
const dailyTrend = JSON.parse(dataElement.dataset.daily || "[]");
const latestReading = JSON.parse(dataElement.dataset.latest || "null");
const todayReadings = JSON.parse(dataElement.dataset.today || "[]");

console.log("📊 Dashboard Data:", { dailyTrend, latestReading, todayReadings });

const hasData =
  dailyTrend.length > 0 || latestReading !== null || todayReadings.length > 0;

// ========================================
// UPDATE STATUS INDICATOR
// ========================================
const statusIndicator = document.getElementById("statusIndicator");
const statusText = document.getElementById("statusText");

if (!hasData) {
  statusIndicator.classList.add("offline");
  statusText.textContent = "No Data Available";
}

// ========================================
// UPDATE LAST UPDATED TIME
// ========================================
function updateLastUpdatedTime() {
  if (!hasData) {
    document.getElementById("lastUpdate").textContent = "Never";
    return;
  }
  const now = new Date();
  const timeStr = now.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  document.getElementById("lastUpdate").textContent = timeStr;
}
updateLastUpdatedTime();
if (hasData) setInterval(updateLastUpdatedTime, 1000);

// ========================================
// CREATE EMPTY STATE
// ========================================
function createEmptyState(container, type = "chart") {
  const messages = {
    chart: {
      icon: "bar-chart-3",
      title: "No Chart Data Available",
      description:
        "Start monitoring your energy usage to see visualizations here.",
    },
    table: {
      icon: "inbox",
      title: "No Readings Available",
      description:
        "Energy readings will appear here once your smart meter starts sending data.",
    },
  };
  const msg = messages[type];
  container.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-icon"><i data-lucide="${msg.icon}"></i></div>
      <h3>${msg.title}</h3>
      <p>${msg.description}</p>
      <div class="empty-state-actions">
        <button class="empty-state-btn" onclick="location.reload()">
          <i data-lucide="refresh-cw"></i> Refresh Page
        </button>
      </div>
    </div>
  `;
  lucide.createIcons();
}

// ========================================
// POPULATE KPI CARDS
// ========================================
if (todayReadings.length > 0) {
  const latestToday = todayReadings[todayReadings.length - 1];

  const currentPowerKW = (latestToday.power / 1000).toFixed(2);
  document.getElementById("currentPower").innerHTML =
    `${currentPowerKW} <span class="kpi-unit">kW</span>`;

  const todayUnits = latestToday.daily_units.toFixed(2);
  document.getElementById("todayUnits").innerHTML =
    `${todayUnits} <span class="kpi-unit">kWh</span>`;

  if (dailyTrend.length >= 2) {
    const yesterday = dailyTrend[dailyTrend.length - 2].total_units || 0;
    const today = parseFloat(todayUnits);
    const change = (((today - yesterday) / yesterday) * 100).toFixed(1);
    const changeEl = document.getElementById("todayChange");
    if (change > 0) {
      changeEl.textContent = `↑ ${change}% vs yesterday`;
      changeEl.className = "kpi-change negative";
    } else {
      changeEl.textContent = `↓ ${Math.abs(change)}% vs yesterday`;
      changeEl.className = "kpi-change positive";
    }
  } else {
    document.getElementById("todayChange").textContent = "No comparison data";
  }

  const peakPower = Math.max(...todayReadings.map((r) => r.power));
  const peakReading = todayReadings.find((r) => r.power === peakPower);
  document.getElementById("peak").innerHTML =
    `${(peakPower / 1000).toFixed(2)} <span class="kpi-unit">kW</span>`;
  if (peakReading) {
    const peakTime = peakReading.timestamp.split(" ")[1].substring(0, 5);
    document.getElementById("peakTime").textContent = `at ${peakTime}`;
  }

  const monthlyUnits = latestToday.monthly_units.toFixed(2);
  document.getElementById("consumption").innerHTML =
    `${monthlyUnits} <span class="kpi-unit">kWh</span>`;

  const dayOfMonth = new Date().getDate();
  const projectedMonthly = (
    (latestToday.monthly_units / dayOfMonth) *
    30
  ).toFixed(0);
  document.getElementById("monthlyChange").textContent =
    `~${projectedMonthly} kWh projected`;
  document.getElementById("monthlyChange").className = "kpi-change neutral";
} else if (latestReading) {
  console.log("📋 latestReading fields:", latestReading);

  const power = latestReading.power ?? latestReading.active_power ?? 0;
  const dailyUnits =
    latestReading.daily_units ??
    latestReading.energy_today ??
    latestReading.daily_energy ??
    0;
  const monthlyUnits =
    latestReading.monthly_units ??
    latestReading.energy_month ??
    latestReading.monthly_energy ??
    0;
  const totalEnergy =
    latestReading.total_energy_wh ??
    latestReading.total_energy ??
    monthlyUnits * 1000 ??
    0;

  document.getElementById("currentPower").innerHTML =
    `${(power / 1000).toFixed(2)} <span class="kpi-unit">kW</span>`;
  document.getElementById("todayUnits").innerHTML =
    `${dailyUnits.toFixed(2)} <span class="kpi-unit">kWh</span>`;
  document.getElementById("peak").innerHTML =
    `${(power / 1000).toFixed(2)} <span class="kpi-unit">kW</span>`;
  document.getElementById("consumption").innerHTML =
    `${(totalEnergy / 1000).toFixed(2)} <span class="kpi-unit">kWh</span>`;

  document.getElementById("todayChange").textContent = "Limited data available";
  document.getElementById("peakTime").textContent = "Current reading";
  document.getElementById("monthlyChange").textContent =
    "Limited data available";
} else {
  document.getElementById("currentPower").innerHTML =
    `-- <span class="kpi-unit">kW</span>`;
  document.getElementById("todayUnits").innerHTML =
    `-- <span class="kpi-unit">kWh</span>`;
  document.getElementById("peak").innerHTML =
    `-- <span class="kpi-unit">kW</span>`;
  document.getElementById("consumption").innerHTML =
    `-- <span class="kpi-unit">kWh</span>`;

  document.getElementById("powerChange").textContent = "No data available";
  document.getElementById("todayChange").textContent = "No data available";
  document.getElementById("peakTime").textContent = "No data available";
  document.getElementById("monthlyChange").textContent = "No data available";
}

// ========================================
// DAILY TREND CHART
// ========================================
if (dailyTrend.length > 0) {
  dailyTrend.sort((a, b) => new Date(a.date) - new Date(b.date));
  const last7 = dailyTrend.slice(-7);
  const labels = last7.map((d) =>
    new Date(d.date).toLocaleDateString("en-IN", {
      weekday: "short",
      month: "short",
      day: "numeric",
    }),
  );
  const values = last7.map((d) => d.total_units || d.daily_units || 0);
  const avgValue = values.reduce((a, b) => a + b, 0) / values.length;

  new Chart(document.getElementById("dailyChart"), {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Energy (kWh)",
          data: values,
          backgroundColor: values.map((v) =>
            v > avgValue ? "rgba(239, 68, 68, 0.8)" : "rgba(59, 130, 246, 0.8)",
          ),
          borderColor: values.map((v) =>
            v > avgValue ? "rgba(239, 68, 68, 1)" : "rgba(59, 130, 246, 1)",
          ),
          borderWidth: 2,
          borderRadius: 8,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "rgba(255,255,255,0.98)",
          titleColor: "#0f172a",
          bodyColor: "#0f172a",
          borderColor: "rgba(148,163,184,0.3)",
          borderWidth: 1,
          padding: 12,
          displayColors: false,
          callbacks: {
            label: (ctx) => `Energy: ${ctx.parsed.y.toFixed(2)} kWh`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: "#94a3b8", font: { size: 11 } },
        },
        y: {
          beginAtZero: true,
          grid: { color: "rgba(148,163,184,0.1)" },
          ticks: {
            color: "#94a3b8",
            font: { size: 11 },
            callback: (v) => v.toFixed(1) + " kWh",
          },
        },
      },
      animation: { duration: 1000, easing: "easeOutQuart" },
    },
  });
} else {
  createEmptyState(document.getElementById("dailyChartContainer"), "chart");
}

// ========================================
// TODAY'S LOAD PROFILE CHART
// ========================================
if (todayReadings.length > 0) {
  const timeLabels = todayReadings.map((r) =>
    r.timestamp.split(" ")[1].substring(0, 5),
  );
  const powerValues = todayReadings.map((r) => r.power);

  new Chart(document.getElementById("loadChart"), {
    type: "line",
    data: {
      labels: timeLabels,
      datasets: [
        {
          label: "Power (W)",
          data: powerValues,
          borderColor: "rgba(16, 185, 129, 1)",
          backgroundColor: function (context) {
            const ctx = context.chart.ctx;
            const gradient = ctx.createLinearGradient(0, 0, 0, 300);
            gradient.addColorStop(0, "rgba(16, 185, 129, 0.3)");
            gradient.addColorStop(1, "rgba(16, 185, 129, 0)");
            return gradient;
          },
          tension: 0.4,
          fill: true,
          pointRadius: 4,
          pointHoverRadius: 8,
          pointBackgroundColor: "rgba(16, 185, 129, 1)",
          pointBorderColor: "#ffffff",
          pointBorderWidth: 2,
          borderWidth: 3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "rgba(255,255,255,0.98)",
          titleColor: "#0f172a",
          bodyColor: "#0f172a",
          borderColor: "rgba(148,163,184,0.3)",
          borderWidth: 1,
          padding: 12,
          displayColors: false,
          callbacks: {
            label: (ctx) =>
              `Power: ${ctx.parsed.y.toFixed(0)} W (${(ctx.parsed.y / 1000).toFixed(2)} kW)`,
          },
        },
      },
      scales: {
        x: {
          grid: { color: "rgba(148,163,184,0.1)" },
          ticks: { color: "#94a3b8", maxTicksLimit: 8, font: { size: 11 } },
        },
        y: {
          beginAtZero: true,
          grid: { color: "rgba(148,163,184,0.1)" },
          ticks: {
            color: "#94a3b8",
            font: { size: 11 },
            callback: (v) => (v / 1000).toFixed(1) + " kW",
          },
        },
      },
      interaction: { mode: "nearest", axis: "x", intersect: false },
      animation: { duration: 1500, easing: "easeOutQuart" },
    },
  });
} else {
  createEmptyState(document.getElementById("loadChartContainer"), "chart");
}

// ========================================
// POPULATE READINGS TABLE
// ========================================
if (todayReadings.length > 0) {
  const tbody = document.getElementById("readingsTable");
  tbody.innerHTML = "";
  todayReadings
    .slice(-10)
    .reverse()
    .forEach((reading, index) => {
      const row = document.createElement("tr");
      row.style.animationDelay = `${index * 0.05}s`;
      const time = reading.timestamp.split(" ")[1].substring(0, 5);
      row.innerHTML = `
      <td><span class="time-badge">${time}</span></td>
      <td>${reading.voltage.toFixed(1)}</td>
      <td>${reading.current.toFixed(2)}</td>
      <td>${reading.power.toFixed(0)}</td>
      <td>${reading.daily_units.toFixed(2)}</td>
    `;
      tbody.appendChild(row);
    });
} else {
  document.getElementById("readingsTable").innerHTML = `
    <tr><td colspan="5" style="padding:0;">
      <div class="empty-state">
        <div class="empty-state-icon"><i data-lucide="inbox"></i></div>
        <h3>No Readings Available</h3>
        <p>Energy readings will appear here once your smart meter starts sending data.</p>
      </div>
    </td></tr>
  `;
}

// ========================================
// INITIALIZE LUCIDE ICONS
// ========================================
lucide.createIcons();

// ========================================
// THRESHOLD / USAGE LIMIT FEATURE
// ========================================

let currentThreshold = null;
let alertDismissed = false;

// --- DOM refs ---
const thresholdDisplay = document.getElementById("thresholdDisplay");
const thresholdAlert = document.getElementById("thresholdAlert");
const alertTitle = document.getElementById("alertTitle");
const alertBody = document.getElementById("alertBody");
const alertDismissBtn = document.getElementById("alertDismiss");
const openModalBtn = document.getElementById("openThresholdModal");
const modalOverlay = document.getElementById("thresholdModalOverlay");
const thresholdInput = document.getElementById("thresholdInput");
const saveBtn = document.getElementById("saveThreshold");
const cancelBtn = document.getElementById("cancelThreshold");

// Read server-rendered threshold from data-amount="{{amount}}" on dashboardData div
const serverAmount = parseFloat(
  document.getElementById("dashboardData")?.dataset?.amount || "0",
);
if (!isNaN(serverAmount) && serverAmount > 0) {
  currentThreshold = serverAmount;
}

// --- Render threshold display ---
function renderThresholdDisplay() {
  if (thresholdDisplay) {
    if (currentThreshold !== null) {
      thresholdDisplay.textContent = `${currentThreshold.toFixed(1)} INR`;
      thresholdDisplay.classList.remove("not-set");
    } else {
      thresholdDisplay.textContent = "Not set";
      thresholdDisplay.classList.add("not-set");
    }
  }
}

// --- Check threshold and show alert ---
function checkThreshold() {
  if (currentThreshold === null) {
    thresholdAlert.classList.remove("visible");
    const card = document.getElementById("consumption")?.closest(".kpi-card");
    if (card) card.classList.remove("warning-highlight", "danger-highlight");
    return;
  }

  const monthlyEl = document.getElementById("consumption");
  if (!monthlyEl) return;

  const monthlyVal = parseFloat(monthlyEl.textContent.replace(/[^\d.]/g, ""));
  if (isNaN(monthlyVal)) return;

  const pct = (monthlyVal / currentThreshold) * 100;
  const monthlyCard = monthlyEl.closest(".kpi-card");

  if (pct >= 100) {
    if (!alertDismissed) {
      alertTitle.textContent = "⚡ Usage Limit Exceeded!";
      alertBody.textContent = `Monthly consumption (${monthlyVal.toFixed(2)} kWh) has crossed your limit of ${currentThreshold.toFixed(1)} INR.`;
      thresholdAlert.classList.add("visible");
    }
    if (monthlyCard) {
      monthlyCard.classList.remove("warning-highlight");
      monthlyCard.classList.add("danger-highlight");
    }
  } else if (pct >= 80) {
    if (!alertDismissed) {
      alertTitle.textContent = "⚠️ Approaching Usage Limit";
      alertBody.textContent = `Monthly consumption is at ${pct.toFixed(0)}% of your ${currentThreshold.toFixed(1)} INR limit (${monthlyVal.toFixed(2)} kWh used).`;
      thresholdAlert.classList.add("visible");
    }
    if (monthlyCard) {
      monthlyCard.classList.remove("danger-highlight");
      monthlyCard.classList.add("warning-highlight");
    }
  } else {
    thresholdAlert.classList.remove("visible");
    if (monthlyCard)
      monthlyCard.classList.remove("warning-highlight", "danger-highlight");
  }
}

// --- Toast helper ---
function showToast(message, color = "var(--accent-yellow)") {
  const toast = document.createElement("div");
  toast.style.cssText = `
    position:fixed; bottom:1.5rem; right:1.5rem; z-index:2000;
    background:var(--bg-card); border:1px solid var(--border);
    border-left:3px solid ${color};
    padding:0.75rem 1.25rem; border-radius:10px;
    font-size:0.85rem; color:var(--text-secondary);
    box-shadow:0 8px 24px rgba(0,0,0,0.15);
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

// --- Open modal ---
openModalBtn.addEventListener("click", () => {
  thresholdInput.value = currentThreshold !== null ? currentThreshold : "";
  modalOverlay.classList.add("open");
  setTimeout(() => thresholdInput.focus(), 150);
});

// --- Close modal ---
function closeModal() {
  modalOverlay.classList.remove("open");
}

cancelBtn.addEventListener("click", closeModal);
modalOverlay.addEventListener("click", (e) => {
  if (e.target === modalOverlay) closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && modalOverlay.classList.contains("open"))
    closeModal();
});

// --- Save threshold ---
saveBtn.addEventListener("click", (e) => {
  e.stopPropagation();

  const val = parseFloat(thresholdInput.value);

  if (isNaN(val) || val <= 0) {
    thresholdInput.style.borderColor = "var(--accent-red)";
    thresholdInput.style.boxShadow = "0 0 0 3px rgba(239,68,68,0.2)";
    thresholdInput.focus();
    setTimeout(() => {
      thresholdInput.style.borderColor = "";
      thresholdInput.style.boxShadow = "";
    }, 1500);
    return;
  }

  currentThreshold = val;
  alertDismissed = false;
  renderThresholdDisplay();
  checkThreshold();
  closeModal();

  axios
    .post("/user/dashboard/usageLimit", { amount: val })
    .then((res) => {
      console.log("✅ Threshold saved to server:", res.data);
      showToast("✅ Usage limit saved!", "var(--accent-green)");
    })
    .catch((err) => {
      console.error("⚠️ Server sync failed:", err.message);
      showToast("⚠️ Server sync failed — limit set in session only.");
    });
});

// Enter key in input triggers save
thresholdInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") saveBtn.click();
});

// --- Dismiss alert ---
alertDismissBtn.addEventListener("click", () => {
  alertDismissed = true;
  thresholdAlert.classList.remove("visible");
});

// --- Init ---
renderThresholdDisplay();
checkThreshold();
