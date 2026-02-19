// ========================================
// PARSE DATA FROM BACKEND
// ========================================
const forecastDataElement = document.getElementById("forecastData");

if (!forecastDataElement) {
  console.error("Forecast data element not found");
}

const availableDays = parseInt(
  forecastDataElement.dataset.availableDays || "0",
);
const daily = JSON.parse(forecastDataElement.dataset.daily || "{}");
const weekly = JSON.parse(forecastDataElement.dataset.weekly || "{}");
const monthly = JSON.parse(forecastDataElement.dataset.monthly || "{}");

console.log("📊 Forecast Data:", { availableDays, daily, weekly, monthly });

// ========================================
// UPDATE STATUS INDICATOR
// ========================================
const statusIndicator = document.getElementById("statusIndicator");
const statusText = document.getElementById("statusText");

// Check if we have valid prediction data
const hasValidData =
  daily.prediction && weekly.prediction && monthly.prediction;

if (!hasValidData) {
  if (statusIndicator) {
    statusIndicator.classList.add("offline");
  }
  if (statusText) {
    statusText.textContent = "Insufficient data for predictions";
  }
}

// ========================================
// CREATE CHART EMPTY STATE
// ========================================
function createChartEmptyState(containerId) {
  const container = document.getElementById(containerId);
  if (container) {
    container.innerHTML = `
        <div class="chart-empty-state">
          <i data-lucide="bar-chart-3"></i>
          <p>No prediction data</p>
        </div>
      `;
    lucide.createIcons();
  }
}

// ========================================
// RENDER CHARTS OR EMPTY STATES
// ========================================
if (hasValidData) {
  // ========================================
  // DAILY CHART (Sparkline)
  // ========================================
  try {
    const dailyValue = daily.prediction.next_day_units;
    const dailyTrend = [
      dailyValue * 0.92,
      dailyValue * 0.95,
      dailyValue * 0.9,
      dailyValue * 0.98,
      dailyValue * 0.96,
      dailyValue * 1.02,
      dailyValue,
    ];

    new Chart(document.getElementById("dailyChart"), {
      type: "line",
      data: {
        labels: Array(7).fill(""),
        datasets: [
          {
            data: dailyTrend,
            borderColor: "#6366f1",
            backgroundColor: "rgba(99, 102, 241, 0.1)",
            borderWidth: 2,
            tension: 0.4,
            fill: true,
            pointRadius: 0,
            pointHoverRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: { display: false },
          y: { display: false },
        },
      },
    });
  } catch (error) {
    console.error("Error rendering daily chart:", error);
    createChartEmptyState("dailyChartContainer");
  }

  // ========================================
  // WEEKLY CHART (Sparkline)
  // ========================================
  try {
    const weeklyPredictions = weekly.prediction.weekly_prediction.predictions;
    const weeklyData = weeklyPredictions.map((p) => p.predicted_units);
    const weeklyLabels = weeklyPredictions.map((p) =>
      p.day_name.substring(0, 3),
    );

    new Chart(document.getElementById("weeklyChart"), {
      type: "line",
      data: {
        labels: weeklyLabels,
        datasets: [
          {
            data: weeklyData,
            borderColor: "#3b82f6",
            backgroundColor: "rgba(59, 130, 246, 0.1)",
            borderWidth: 2,
            tension: 0.4,
            fill: true,
            pointRadius: 3,
            pointBackgroundColor: "#3b82f6",
            pointBorderColor: "#fff",
            pointBorderWidth: 1,
            pointHoverRadius: 5,
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
            padding: 8,
            displayColors: false,
            callbacks: {
              label: (context) => `${context.parsed.y.toFixed(2)} kWh`,
            },
          },
        },
        scales: {
          x: { display: false },
          y: { display: false },
        },
      },
    });
  } catch (error) {
    console.error("Error rendering weekly chart:", error);
    createChartEmptyState("weeklyChartContainer");
  }

  // ========================================
  // MONTHLY CHART (Weekly Summaries)
  // ========================================
  try {
    const weeklySummaries =
      monthly.prediction.monthly_prediction.weekly_summaries;
    const monthlyData = weeklySummaries.map((w) => w.avg_daily_units);
    const monthlyLabels = weeklySummaries.map((w) => `W${w.week}`);

    new Chart(document.getElementById("monthlyChart"), {
      type: "line",
      data: {
        labels: monthlyLabels,
        datasets: [
          {
            data: monthlyData,
            borderColor: "#10b981",
            backgroundColor: "rgba(16, 185, 129, 0.1)",
            borderWidth: 2,
            tension: 0.4,
            fill: true,
            pointRadius: 4,
            pointBackgroundColor: "#10b981",
            pointBorderColor: "#fff",
            pointBorderWidth: 1,
            pointHoverRadius: 6,
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
            padding: 8,
            displayColors: false,
            callbacks: {
              label: (context) => `${context.parsed.y.toFixed(2)} kWh/day`,
            },
          },
        },
        scales: {
          x: { display: false },
          y: { display: false },
        },
      },
    });
  } catch (error) {
    console.error("Error rendering monthly chart:", error);
    createChartEmptyState("monthlyChartContainer");
  }
} else {
  // Show empty states for all charts
  console.warn("Missing prediction data - showing empty states");
  createChartEmptyState("dailyChartContainer");
  createChartEmptyState("weeklyChartContainer");
  createChartEmptyState("monthlyChartContainer");

  // Show empty state in table if no weekly predictions
  const tableBody = document.getElementById("weeklyTableBody");
  if (
    tableBody &&
    (!weekly.prediction || !weekly.prediction.weekly_prediction)
  ) {
    tableBody.innerHTML = `
        <tr>
          <td colspan="3" style="text-align: center; padding: 2rem; color: var(--text-secondary);">
            <i data-lucide="inbox" style="width: 32px; height: 32px; margin-bottom: 0.5rem; opacity: 0.5;"></i><br>
            No weekly predictions available
          </td>
        </tr>
      `;
    lucide.createIcons();
  }

  // Show empty state in weekly summaries if no monthly predictions
  const summariesGrid = document.getElementById("weeklySummariesGrid");
  if (
    summariesGrid &&
    (!monthly.prediction || !monthly.prediction.monthly_prediction)
  ) {
    summariesGrid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 2rem; color: var(--text-secondary);">
          <i data-lucide="inbox" style="width: 32px; height: 32px; margin-bottom: 0.5rem; opacity: 0.5;"></i><br>
          No monthly summaries available
        </div>
      `;
    lucide.createIcons();
  }
}

// ========================================
// INITIALIZE LUCIDE ICONS
// ========================================
lucide.createIcons();
