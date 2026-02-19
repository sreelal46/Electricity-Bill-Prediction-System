// Get data from data attributes
const dataContainer = document.getElementById("chartData");
const weekTrend = JSON.parse(dataContainer.getAttribute("data-week") || "[]");
const _10dayTrend = JSON.parse(
  dataContainer.getAttribute("data-10days") || "[]",
);
const _2WeekTrend = JSON.parse(
  dataContainer.getAttribute("data-2weeks") || "[]",
);
const monthTrend = JSON.parse(dataContainer.getAttribute("data-month") || "[]");
const todayReadings = JSON.parse(
  dataContainer.getAttribute("data-today") || "[]",
);

console.log("📊 Trend Data:", {
  week: weekTrend.length,
  _10days: _10dayTrend.length,
  _2weeks: _2WeekTrend.length,
  month: monthTrend.length,
  today: todayReadings.length,
});

let currentChart = null;
let currentPeriod = "month";

// Check which datasets have data
const hasData = {
  today: todayReadings && todayReadings.length > 0,
  week: weekTrend && weekTrend.length > 0,
  "10days": _10dayTrend && _10dayTrend.length > 0,
  "2weeks": _2WeekTrend && _2WeekTrend.length > 0,
  month: monthTrend && monthTrend.length > 0,
};

const hasAnyData = Object.values(hasData).some((v) => v);

// Format date to show simple format based on period
function formatDateLabel(dateStr, index, totalDays) {
  const date = new Date(dateStr);
  const dayNum = date.getDate();
  const month = date.toLocaleDateString("en-US", { month: "short" });
  const dayName = date.toLocaleDateString("en-US", { weekday: "short" });

  // For week or short periods, show day name
  if (totalDays <= 7) {
    return dayName;
  }
  // For longer periods, show date number and month
  else {
    return `${dayNum} ${month}`;
  }
}

// Format hour labels for today view (00:00, 01:00, etc.)
function formatHourLabel(hour) {
  return `${hour.toString().padStart(2, "0")}:00`;
}

// Show empty state in chart
function showChartEmptyState(message = "No data available for this period") {
  const container = document.getElementById("chartContainer");
  const canvas = document.getElementById("trendChart");

  // Hide canvas
  canvas.style.display = "none";

  // Create or update empty state
  let emptyState = container.querySelector(".chart-empty-state");
  if (!emptyState) {
    emptyState = document.createElement("div");
    emptyState.className = "chart-empty-state";
    container.appendChild(emptyState);
  }

  emptyState.innerHTML = `
      <i data-lucide="bar-chart-3"></i>
      <h3>No Data Available</h3>
      <p>${message}</p>
    `;

  // Reinitialize icons
  if (typeof lucide !== "undefined") {
    lucide.createIcons();
  }
}

// Hide empty state and show chart
function hideChartEmptyState() {
  const container = document.getElementById("chartContainer");
  const canvas = document.getElementById("trendChart");
  const emptyState = container.querySelector(".chart-empty-state");

  canvas.style.display = "block";
  if (emptyState) {
    emptyState.remove();
  }
}

// Calculate statistics for daily data
function calculateDailyStats(data) {
  if (!data || data.length === 0) {
    return { avg: 0, max: 0, min: 0, total: 0 };
  }

  const values = data.map((d) => d.total_units);
  const total = values.reduce((sum, val) => sum + val, 0);
  const avg = total / values.length;
  const max = Math.max(...values);
  const min = Math.min(...values);

  return { avg, max, min, total };
}

// Calculate statistics for hourly data (today)
function calculateHourlyStats(readings) {
  if (!readings || readings.length === 0) {
    return { avg: 0, max: 0, min: 0, total: 0 };
  }

  const powers = readings.map((r) => r.power / 1000); // Convert W to kW
  const total = readings[readings.length - 1]?.daily_units || 0;
  const avg = powers.reduce((sum, val) => sum + val, 0) / powers.length;
  const max = Math.max(...powers);
  const min = Math.min(...powers);

  return { avg, max, min, total };
}

// Update stats display
function updateStats(data, isToday = false) {
  const stats = isToday
    ? calculateHourlyStats(data)
    : calculateDailyStats(data);

  document.getElementById("avgDaily").textContent = stats.avg.toFixed(2);
  document.getElementById("peakDay").textContent = stats.max.toFixed(2);
  document.getElementById("lowestDay").textContent = stats.min.toFixed(2);
  document.getElementById("totalConsumption").textContent =
    stats.total.toFixed(2);

  // Update labels for today view
  if (isToday) {
    document.getElementById("avgUnit").textContent = "kW";
    document.getElementById("peakUnit").textContent = "kW";
    document.getElementById("lowestUnit").textContent = "kW";
    document.getElementById("totalUnit").textContent = "kWh";
    document.getElementById("peakLabel").textContent = "Peak Load";
    document.getElementById("lowestLabel").textContent = "Min Load";
  } else {
    document.getElementById("avgUnit").textContent = "kWh";
    document.getElementById("peakUnit").textContent = "kWh";
    document.getElementById("lowestUnit").textContent = "kWh";
    document.getElementById("totalUnit").textContent = "kWh";
    document.getElementById("peakLabel").textContent = "Peak Day";
    document.getElementById("lowestLabel").textContent = "Lowest Day";
  }
}

// Create hourly load profile chart (for Today view)
function createHourlyChart(readings) {
  if (!readings || readings.length === 0) {
    showChartEmptyState("No readings available for today");
    updateStats([], true);
    return;
  }

  hideChartEmptyState();
  const ctx = document.getElementById("trendChart").getContext("2d");

  // Sort readings by timestamp
  const sortedReadings = [...readings].sort(
    (a, b) => new Date(a.timestamp) - new Date(b.timestamp),
  );

  // Extract power values (convert W to kW)
  const powerData = sortedReadings.map((r) => r.power / 1000);
  const labels = sortedReadings.map((r) => {
    const time = r.timestamp.split(" ")[1];
    return time ? time.substring(0, 5) : "";
  });

  // Destroy existing chart if it exists
  if (currentChart) {
    currentChart.destroy();
  }

  currentChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Power (kW)",
          data: powerData,
          borderColor: "rgba(16, 185, 129, 0.8)",
          backgroundColor: "rgba(16, 185, 129, 0.1)",
          borderWidth: 2.5,
          fill: true,
          tension: 0.4,
          pointRadius: 4,
          pointBackgroundColor: "rgba(16, 185, 129, 1)",
          pointBorderColor: "#fff",
          pointBorderWidth: 2,
          pointHoverRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          enabled: true,
          backgroundColor: "rgba(15, 23, 42, 0.95)",
          titleColor: "#fff",
          bodyColor: "#cbd5e1",
          titleFont: {
            size: 13,
            weight: "600",
            family: "DM Sans",
          },
          bodyFont: {
            size: 12,
            family: "JetBrains Mono",
          },
          padding: 10,
          displayColors: false,
          callbacks: {
            title: function (context) {
              return context[0].label;
            },
            label: function (context) {
              return `${context.parsed.y.toFixed(2)} kW`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: {
            display: false,
            drawBorder: false,
          },
          ticks: {
            color: "#94a3b8",
            font: {
              size: 10,
              family: "DM Sans",
              weight: "400",
            },
            maxRotation: 0,
            minRotation: 0,
            autoSkip: true,
            maxTicksLimit: 12,
          },
        },
        y: {
          beginAtZero: true,
          border: {
            display: false,
          },
          grid: {
            color: "rgba(148, 163, 184, 0.08)",
            drawBorder: false,
            lineWidth: 1,
          },
          ticks: {
            color: "#94a3b8",
            font: {
              size: 11,
              family: "DM Sans",
              weight: "400",
            },
            callback: function (value) {
              return value.toFixed(1) + " kW";
            },
            padding: 8,
          },
        },
      },
    },
  });

  updateStats(readings, true);
}

// Create daily bar chart
function createDailyChart(data) {
  if (!data || data.length === 0) {
    showChartEmptyState("No data available for this period");
    updateStats([], false);
    return;
  }

  hideChartEmptyState();
  const ctx = document.getElementById("trendChart").getContext("2d");

  // Adjust bar thickness based on number of days
  let barThickness = 45;
  if (data.length > 20) {
    barThickness = 30; // Thinner bars for month view
  } else if (data.length > 14) {
    barThickness = 35; // Medium bars for 2 weeks
  }

  // Create colors array - alternating blue and red
  const backgroundColors = data.map((item, index) => {
    if (index % 2 === 0) {
      return "rgba(99, 102, 241, 0.85)"; // Blue
    } else {
      return "rgba(239, 68, 68, 0.85)"; // Red
    }
  });

  const hoverColors = data.map((item, index) => {
    if (index % 2 === 0) {
      return "rgba(99, 102, 241, 1)"; // Blue
    } else {
      return "rgba(239, 68, 68, 1)"; // Red
    }
  });

  // Destroy existing chart if it exists
  if (currentChart) {
    currentChart.destroy();
  }

  currentChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: data.map((d, index) =>
        formatDateLabel(d.date, index, data.length),
      ),
      datasets: [
        {
          label: "Daily Consumption (kWh)",
          data: data.map((d) => d.total_units),
          backgroundColor: backgroundColors,
          hoverBackgroundColor: hoverColors,
          borderRadius: {
            topLeft: 6,
            topRight: 6,
            bottomLeft: 0,
            bottomRight: 0,
          },
          borderSkipped: false,
          barThickness: barThickness,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          enabled: true,
          backgroundColor: "rgba(15, 23, 42, 0.95)",
          titleColor: "#fff",
          bodyColor: "#cbd5e1",
          titleFont: {
            size: 13,
            weight: "600",
            family: "DM Sans",
          },
          bodyFont: {
            size: 12,
            family: "JetBrains Mono",
          },
          padding: 10,
          displayColors: false,
          callbacks: {
            title: function (context) {
              return context[0].label;
            },
            label: function (context) {
              return `${context.parsed.y.toFixed(2)} kWh`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: {
            display: false,
            drawBorder: false,
          },
          ticks: {
            color: "#94a3b8",
            font: {
              size: 10,
              family: "DM Sans",
              weight: "400",
            },
            maxRotation: 0,
            minRotation: 0,
            autoSkip: true,
            maxTicksLimit: data.length > 20 ? 15 : data.length,
          },
        },
        y: {
          beginAtZero: true,
          border: {
            display: false,
          },
          grid: {
            color: "rgba(148, 163, 184, 0.08)",
            drawBorder: false,
            lineWidth: 1,
          },
          ticks: {
            color: "#94a3b8",
            font: {
              size: 11,
              family: "DM Sans",
              weight: "400",
            },
            callback: function (value) {
              return value.toFixed(1) + " kWh";
            },
            padding: 8,
          },
        },
      },
    },
  });

  updateStats(data, false);
}

// Change period
function changePeriod(period) {
  currentPeriod = period;

  // Update active button
  document.querySelectorAll(".period-btn").forEach((btn) => {
    btn.classList.remove("active");
    if (btn.getAttribute("data-period") === period) {
      btn.classList.add("active");
    }
  });

  let data, title, subtitle;

  switch (period) {
    case "today":
      data = todayReadings;
      title = "Today's Load Profile";
      subtitle = "Hourly power consumption for today";
      createHourlyChart(data);
      break;
    case "week":
      data = weekTrend;
      title = "7-Day Energy Trend";
      subtitle = "Daily energy usage over the last 7 days";
      createDailyChart(data);
      break;
    case "10days":
      data = _10dayTrend;
      title = "10-Day Energy Trend";
      subtitle = "Daily energy usage over the last 10 days";
      createDailyChart(data);
      break;
    case "2weeks":
      data = _2WeekTrend;
      title = "2-Week Energy Trend";
      subtitle = "Daily energy usage over the last 2 weeks";
      createDailyChart(data);
      break;
    case "month":
      data = monthTrend;
      title = "Monthly Energy Trend";
      subtitle = "Daily energy usage over the last 30 days";
      createDailyChart(data);
      break;
  }

  document.getElementById("cardTitle").textContent = title;
  document.getElementById("pageSubtitle").textContent = subtitle;
}

// Initialize when DOM is loaded
document.addEventListener("DOMContentLoaded", function () {
  // Disable buttons for periods without data
  document.querySelectorAll(".period-btn").forEach((btn) => {
    const period = btn.getAttribute("data-period");
    if (!hasData[period]) {
      btn.disabled = true;
      btn.title = "No data available for this period";
    }
  });

  // Find first available period with data
  let initialPeriod = "month";
  const periodPriority = ["today", "week", "10days", "2weeks", "month"];
  for (const period of periodPriority) {
    if (hasData[period]) {
      initialPeriod = period;
      break;
    }
  }

  // Check if we have any data at all
  if (!hasAnyData) {
    console.warn("⚠️ No trend data available");
    showChartEmptyState(
      "No energy consumption data available. Start using your smart meter to see trends here.",
    );
    updateStats([], false);
  } else {
    console.log(`✅ Initializing with ${initialPeriod} view`);
    changePeriod(initialPeriod);
  }

  // Add event listeners to period buttons
  document.querySelectorAll(".period-btn").forEach((btn) => {
    btn.addEventListener("click", function () {
      if (!this.disabled) {
        const period = this.getAttribute("data-period");
        changePeriod(period);
      }
    });
  });

  // Initialize Lucide icons
  if (typeof lucide !== "undefined") {
    lucide.createIcons();
  }
});
