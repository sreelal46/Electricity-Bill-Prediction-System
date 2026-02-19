// ========================================
// PARSE DATA FROM SERVER
// ========================================
const dataElement = document.getElementById("dashboardData");
const dailyTrend = JSON.parse(dataElement.dataset.daily || "[]");
const latestReading = JSON.parse(dataElement.dataset.latest || "null");
const todayReadings = JSON.parse(dataElement.dataset.today || "[]");

console.log("📊 Dashboard Data:", { dailyTrend, latestReading, todayReadings });

// Check if we have any data
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
if (hasData) {
  setInterval(updateLastUpdatedTime, 1000);
}

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
          <div class="empty-state-icon">
            <i data-lucide="${msg.icon}"></i>
          </div>
          <h3>${msg.title}</h3>
          <p>${msg.description}</p>
          <div class="empty-state-actions">
            <button class="empty-state-btn" onclick="location.reload()">
              <i data-lucide="refresh-cw"></i>
              Refresh Page
            </button>
          </div>
        </div>
      `;

  // Re-initialize icons for the new elements
  lucide.createIcons();
}

// ========================================
// POPULATE KPI CARDS
// ========================================
if (todayReadings.length > 0) {
  const latestToday = todayReadings[todayReadings.length - 1];
  const firstToday = todayReadings[0];

  // Current Power
  const currentPowerKW = (latestToday.power / 1000).toFixed(2);
  document.getElementById("currentPower").innerHTML =
    `${currentPowerKW} <span class="kpi-unit">kW</span>`;

  // Today's Units
  const todayUnits = latestToday.daily_units.toFixed(2);
  document.getElementById("todayUnits").innerHTML =
    `${todayUnits} <span class="kpi-unit">kWh</span>`;

  // Calculate change from yesterday (using daily trend)
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

  // Peak Demand
  const peakPower = Math.max(...todayReadings.map((r) => r.power));
  const peakReading = todayReadings.find((r) => r.power === peakPower);
  document.getElementById("peak").innerHTML =
    `${(peakPower / 1000).toFixed(2)} <span class="kpi-unit">kW</span>`;
  if (peakReading) {
    const peakTime = peakReading.timestamp.split(" ")[1].substring(0, 5);
    document.getElementById("peakTime").textContent = `at ${peakTime}`;
  }

  // Monthly Total
  const monthlyUnits = latestToday.monthly_units.toFixed(2);
  document.getElementById("consumption").innerHTML =
    `${monthlyUnits} <span class="kpi-unit">kWh</span>`;

  // Estimate monthly trend
  const dayOfMonth = new Date().getDate();
  const projectedMonthly = (
    (latestToday.monthly_units / dayOfMonth) *
    30
  ).toFixed(0);
  document.getElementById("monthlyChange").textContent =
    `~${projectedMonthly} kWh projected`;
  document.getElementById("monthlyChange").className = "kpi-change neutral";
} else if (latestReading) {
  // Fallback to latest reading
  document.getElementById("currentPower").innerHTML =
    `${(latestReading.power / 1000).toFixed(2)} <span class="kpi-unit">kW</span>`;
  document.getElementById("todayUnits").innerHTML =
    `${latestReading.daily_units.toFixed(2)} <span class="kpi-unit">kWh</span>`;
  document.getElementById("peak").innerHTML =
    `${(latestReading.power / 1000).toFixed(2)} <span class="kpi-unit">kW</span>`;
  document.getElementById("consumption").innerHTML =
    `${(latestReading.total_energy_wh / 1000).toFixed(2)} <span class="kpi-unit">kWh</span>`;

  document.getElementById("todayChange").textContent = "Limited data available";
  document.getElementById("peakTime").textContent = "Current reading";
  document.getElementById("monthlyChange").textContent =
    "Limited data available";
} else {
  // No data available - show placeholder
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

  const labels = last7.map((d) => {
    const date = new Date(d.date);
    return date.toLocaleDateString("en-IN", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  });

  const values = last7.map((d) => d.total_units || d.daily_units || 0);
  const avgValue = values.reduce((a, b) => a + b, 0) / values.length;

  new Chart(document.getElementById("dailyChart"), {
    type: "bar",
    data: {
      labels: labels,
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
          backgroundColor: "rgba(255, 255, 255, 0.98)",
          titleColor: "#0f172a",
          bodyColor: "#0f172a",
          borderColor: "rgba(148, 163, 184, 0.3)",
          borderWidth: 1,
          padding: 12,
          displayColors: false,
          callbacks: {
            label: function (context) {
              return `Energy: ${context.parsed.y.toFixed(2)} kWh`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false, color: "rgba(148, 163, 184, 0.1)" },
          ticks: { color: "#94a3b8", font: { size: 11 } },
        },
        y: {
          beginAtZero: true,
          grid: { color: "rgba(148, 163, 184, 0.1)" },
          ticks: {
            color: "#94a3b8",
            font: { size: 11 },
            callback: (value) => value.toFixed(1) + " kWh",
          },
        },
      },
      animation: {
        duration: 1000,
        easing: "easeOutQuart",
      },
    },
  });
} else {
  // Show empty state for daily chart
  const container = document.getElementById("dailyChartContainer");
  createEmptyState(container, "chart");
}

// ========================================
// TODAY'S LOAD PROFILE CHART
// ========================================
if (todayReadings.length > 0) {
  const timeLabels = todayReadings.map((r) => {
    const time = r.timestamp.split(" ")[1];
    return time.substring(0, 5);
  });

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
          backgroundColor: "rgba(255, 255, 255, 0.98)",
          titleColor: "#0f172a",
          bodyColor: "#0f172a",
          borderColor: "rgba(148, 163, 184, 0.3)",
          borderWidth: 1,
          padding: 12,
          displayColors: false,
          callbacks: {
            label: function (context) {
              return `Power: ${context.parsed.y.toFixed(0)} W (${(context.parsed.y / 1000).toFixed(2)} kW)`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { color: "rgba(148, 163, 184, 0.1)" },
          ticks: {
            color: "#94a3b8",
            maxTicksLimit: 8,
            font: { size: 11 },
          },
        },
        y: {
          beginAtZero: true,
          grid: { color: "rgba(148, 163, 184, 0.1)" },
          ticks: {
            color: "#94a3b8",
            font: { size: 11 },
            callback: (value) => (value / 1000).toFixed(1) + " kW",
          },
        },
      },
      interaction: {
        mode: "nearest",
        axis: "x",
        intersect: false,
      },
      animation: {
        duration: 1500,
        easing: "easeOutQuart",
      },
    },
  });
} else {
  // Show empty state for load chart
  const container = document.getElementById("loadChartContainer");
  createEmptyState(container, "chart");
}

// ========================================
// POPULATE READINGS TABLE
// ========================================
if (todayReadings.length > 0) {
  const tbody = document.getElementById("readingsTable");
  tbody.innerHTML = "";

  const recentReadings = todayReadings.slice(-10).reverse();

  recentReadings.forEach((reading, index) => {
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

  // Search functionality
  const searchBox = document.getElementById("searchBox");
  searchBox.addEventListener("input", (e) => {
    const searchTerm = e.target.value.toLowerCase();
    const rows = tbody.querySelectorAll("tr");

    rows.forEach((row) => {
      const text = row.textContent.toLowerCase();
      row.style.display = text.includes(searchTerm) ? "" : "none";
    });
  });
} else {
  // Show empty state for table
  document.getElementById("readingsTable").innerHTML = `
        <tr>
          <td colspan="5" style="padding: 0;">
            <div class="empty-state">
              <div class="empty-state-icon">
                <i data-lucide="inbox"></i>
              </div>
              <h3>No Readings Available</h3>
              <p>Energy readings will appear here once your smart meter starts sending data.</p>
            </div>
          </td>
        </tr>
      `;

  // Disable search box
  document.getElementById("searchBox").disabled = true;
  document.getElementById("searchBox").placeholder = "No data to search";
}

// ========================================
// INITIALIZE LUCIDE ICONS
// ========================================
lucide.createIcons();
