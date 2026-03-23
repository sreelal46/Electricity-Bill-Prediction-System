// ===================================================================
// KSEB SMART METER - ESP32 Cloud Monitor
// ✓ FIXED: Phantom voltage readings when supply is OFF
// ✓ FIXED: Energy accumulation on idle/filtered loads
// ✓ IMPROVED: Voltage detection reliability
// ✓ ADDED: Bi-monthly KSEB tariff billing logic
// 
// WORKFLOW:
//   1. House owner registers on website
//   2. Admin approves and gets the USER_ID
//   3. Admin enters USER_ID below and flashes this to the device
//   4. Device sends all data tagged with USER_ID — nothing more
// ===================================================================

#include "driver/adc.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <time.h>

// ============ WiFi Configuration ============
const char* WIFI_SSID     = "FTTH-3529";
const char* WIFI_PASSWORD = "SRK17EE015";

// ============ Firebase Configuration ============
const char* FIREBASE_HOST = "kseb-smart-meter-30e6c-default-rtdb.asia-southeast1.firebasedatabase.app";
const char* FIREBASE_AUTH = "NLY7pwQS1YtAW0azpHBufhnxVbj8AkBbTwmHrz6a";

// ============================================================
// USER CONFIGURATION — Admin sets this before flashing
// ============================================================
const char* USER_ID           = "USER001";  // ← Change this per device before flashing
const char* USER_PHASE        = "SINGLE";   // ← "SINGLE" or "THREE"
const float USER_APPROVED_LOAD = 5.0;       // ← Approved load in kW

// ============ Alert Thresholds ============
const float DAILY_UNIT_THRESHOLD     = 30.0;
const float ILLEGAL_3PHASE_THRESHOLD = 7.0;

// ============ Upload Settings ============
unsigned long uploadInterval = 30000;
unsigned long lastUploadTime = 0;

// ============ Time Configuration ============
const char* NTP_SERVER         = "pool.ntp.org";
const long  GMT_OFFSET_SEC     = 19800;
const int   DAYLIGHT_OFFSET_SEC = 0;

// ============================================================
// SENSOR PINS & CALIBRATION
// ============================================================

#define VOLT_PIN 36
int   volt_offset = 1820;
float volt_calib  = 0.76;

#define CURR_PIN 34
const int curr_offset      = 2900;
float     curr_sensitivity = 139.0;

float smoothCurrent = 0.0;
float smoothVoltage = 0.0;
float alpha         = 0.2;

const float NOISE_FLOOR            = 0.10;
const float CONFIRMATION_THRESHOLD = 0.15;
const float DIRECT_ACCEPT          = 0.30;

const float VOLTAGE_THRESHOLD       = 150.0;
const float VOLTAGE_NOISE_THRESHOLD = 50.0;
const int   VOLTAGE_CONFIRM_SAMPLES = 3;

int  consecutiveVoltagePresent = 0;
int  consecutiveVoltageAbsent  = 0;
bool supplyIsOn                = false;

int  consecutiveHighReadings = 0;
int  consecutiveLowReadings  = 0;
const int CONFIRMATION_SAMPLES = 5;

bool powerIsValid = false;

// ============================================================
// ENERGY TRACKING
// ============================================================

float totalEnergyWh = 0.0;
float dailyEnergyWh = 0.0;

// Bi-monthly: KSEB Kerala bills every 2 months
// Cycles: JAN-FEB, MAR-APR, MAY-JUN, JUL-AUG, SEP-OCT, NOV-DEC
float month1EnergyWh = 0.0;   // First month of billing cycle (e.g. JAN)
float month2EnergyWh = 0.0;   // Second month of billing cycle (e.g. FEB)

unsigned long lastEnergyUpdate  = 0;
int lastDay              = -1;
int lastMonth            = -1;
int billingCycleMonth    = -1;  // tm_mon of first month in current cycle

bool dailyAlertSent        = false;
bool illegalUsageAlertSent = false;

// Daily statistics
float         dailyPeakPower    = 0.0;
float         dailyAvgPower     = 0.0;
float         dailyMinPower     = 99999.0;
unsigned long dailyPowerSamples = 0;
float         dailyPowerSum     = 0.0;

// Hour-wise consumption
float hourlyEnergy[24] = {0};

bool wifiConnected = false;

// ============================================================
// KSEB BI-MONTHLY TARIFF SLABS (Kerala)
// Calculated on COMBINED 2-month units
//   0 – 100  units  →  ₹3.00 / unit
// 101 – 200  units  →  ₹3.50 / unit
// 201 – 400  units  →  ₹5.00 / unit
// 400+       units  →  ₹7.00 / unit
// Fixed charge      →  ₹50.00
// ============================================================

float calculateBiMonthlyBill(float totalUnits) {
  float amount = 0.0;
  if (totalUnits <= 100) {
    amount = totalUnits * 3.00;
  } else if (totalUnits <= 200) {
    amount = (100 * 3.00) + ((totalUnits - 100) * 3.50);
  } else if (totalUnits <= 400) {
    amount = (100 * 3.00) + (100 * 3.50) + ((totalUnits - 200) * 5.00);
  } else {
    amount = (100 * 3.00) + (100 * 3.50) + (200 * 5.00) + ((totalUnits - 400) * 7.00);
  }
  amount += 50.0;  // Fixed charge
  return amount;
}

void getSlabBreakdown(float totalUnits,
                      float &s1u, float &s1a,
                      float &s2u, float &s2a,
                      float &s3u, float &s3a,
                      float &s4u, float &s4a) {
  s1u = min(totalUnits, 100.0f);              s1a = s1u * 3.00;
  s2u = max(0.0f, min(totalUnits - 100, 100.0f)); s2a = s2u * 3.50;
  s3u = max(0.0f, min(totalUnits - 200, 200.0f)); s3a = s3u * 5.00;
  s4u = max(0.0f, totalUnits - 400);          s4a = s4u * 7.00;
}

// ============================================================
// SETUP
// ============================================================

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n╔════════════════════════════════════════╗");
  Serial.println("║     KSEB SMART METER SYSTEM           ║");
  Serial.println("║  ✓ Bi-Monthly KSEB Tariff Billing     ║");
  Serial.println("╚════════════════════════════════════════╝\n");

  Serial.print("Device User ID: "); Serial.println(USER_ID);

  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);

  Serial.println("⚙️  Calibrating sensors...");
  calibrateOffsets();

  connectWiFi();

  if (wifiConnected) {
    syncTime();
  }

  Serial.println("\n✓ System ready!");
  lastEnergyUpdate = millis();
  delay(1000);
}

// ============================================================
// WiFi & TIME
// ============================================================

void connectWiFi() {
  Serial.print("📡 Connecting to WiFi");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500); Serial.print("."); attempts++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    wifiConnected = true;
    Serial.println(" ✓");
    Serial.print("   IP: "); Serial.println(WiFi.localIP());
  } else {
    wifiConnected = false;
    Serial.println(" ✗ WiFi Failed! Running offline.");
  }
}

void syncTime() {
  Serial.print("🕒 Syncing time");
  configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC, NTP_SERVER);
  struct tm timeinfo;
  int attempts = 0;
  while (!getLocalTime(&timeinfo) && attempts < 5) {
    Serial.print("."); delay(500); attempts++;
  }
  if (attempts < 5) {
    Serial.println(" ✓");
    lastDay   = timeinfo.tm_mday;
    lastMonth = timeinfo.tm_mon;
    // Set billing cycle: even tm_mon (0,2,4...) = first month of cycle
    if (billingCycleMonth == -1) {
      billingCycleMonth = (timeinfo.tm_mon % 2 == 0)
                          ? timeinfo.tm_mon
                          : timeinfo.tm_mon - 1;
    }
  } else {
    Serial.println(" ✗");
  }
}

// ============================================================
// SENSOR CALIBRATION
// ============================================================

void calibrateOffsets() {
  long sumV = 0;
  for (int i = 0; i < 1000; i++) { sumV += analogRead(VOLT_PIN); delayMicroseconds(50); }
  volt_offset = sumV / 1000;

  long sumC = 0;
  for (int i = 0; i < 2000; i++) { sumC += analogRead(CURR_PIN); delayMicroseconds(50); }
  int calibrated_curr_offset = sumC / 2000;

  Serial.print("  V-offset: ");  Serial.print(volt_offset);
  Serial.print(" | I-offset: "); Serial.println(calibrated_curr_offset);
  if (abs(calibrated_curr_offset - curr_offset) > 100)
    Serial.println("  ⚠️  WARNING: Current sensor offset differs significantly!");
}

// ============================================================
// VOLTAGE MEASUREMENT
// ============================================================

float measureVoltage() {
  long sumVolt = 0;
  const int samples = 1000;
  for (int i = 0; i < samples; i++) {
    int centered = analogRead(VOLT_PIN) - volt_offset;
    sumVolt += (long)centered * centered;
    delayMicroseconds(50);
  }
  float voltage = sqrt((float)sumVolt / samples) * volt_calib;
  return (voltage < VOLTAGE_NOISE_THRESHOLD) ? 0.0 : voltage;
}

bool checkSupplyState(float voltage) {
  if (voltage >= VOLTAGE_THRESHOLD) {
    consecutiveVoltagePresent++;
    consecutiveVoltageAbsent = 0;
    if (consecutiveVoltagePresent >= VOLTAGE_CONFIRM_SAMPLES) {
      if (!supplyIsOn) Serial.println("\n✓ AC SUPPLY DETECTED");
      supplyIsOn = true; return true;
    }
  } else {
    consecutiveVoltageAbsent++;
    consecutiveVoltagePresent = 0;
    if (consecutiveVoltageAbsent >= VOLTAGE_CONFIRM_SAMPLES) {
      if (supplyIsOn) {
        Serial.println("\n✗ AC SUPPLY LOST");
        smoothCurrent = 0.0;
        consecutiveHighReadings = 0;
        consecutiveLowReadings  = 0;
      }
      supplyIsOn = false; return false;
    }
  }
  return supplyIsOn;
}

// ============================================================
// CURRENT MEASUREMENT
// ============================================================

float measureCurrentRaw() {
  long sumCurr = 0;
  const int samples = 1000;
  for (int i = 0; i < samples; i++) {
    int centered = analogRead(CURR_PIN) - curr_offset;
    sumCurr += (long)centered * centered;
    delayMicroseconds(50);
  }
  float current = sqrt((float)sumCurr / samples) / curr_sensitivity;
  return (current < 0.08) ? 0.0 : current;
}

float smartFilter(float rawCurrent) {
  if (rawCurrent < NOISE_FLOOR) {
    consecutiveHighReadings = 0; consecutiveLowReadings++; return 0.0;
  }
  if (rawCurrent >= DIRECT_ACCEPT) {
    consecutiveHighReadings++; consecutiveLowReadings = 0; return rawCurrent;
  }
  if (rawCurrent >= CONFIRMATION_THRESHOLD) {
    consecutiveHighReadings++; consecutiveLowReadings = 0;
    return (consecutiveHighReadings >= CONFIRMATION_SAMPLES) ? rawCurrent : 0.0;
  }
  consecutiveLowReadings++;
  if (consecutiveHighReadings > 8) return rawCurrent;
  if (smoothCurrent > 0.15 && consecutiveHighReadings > 5) return rawCurrent;
  return 0.0;
}

// ============================================================
// LIVE READING UPLOAD
// ============================================================

void uploadToFirebase(float voltage, float current, float power,
                      float energy, float dailyEnergy,
                      float m1Energy, float m2Energy) {

  if (!wifiConnected) { Serial.println("⚠️  Offline - skip"); return; }

  HTTPClient http; WiFiClientSecure client;
  client.setInsecure(); client.setTimeout(8000);

  float biMonthlyUnits = (m1Energy + m2Energy) / 1000.0;
  float runningBill    = calculateBiMonthlyBill(biMonthlyUnits);

  StaticJsonDocument<600> doc;
  doc["user_id"]             = USER_ID;
  doc["timestamp"]           = getTimestamp();
  doc["voltage"]             = round(voltage * 100) / 100.0;
  doc["current"]             = round(current * 1000) / 1000.0;
  doc["power"]               = round(power * 100) / 100.0;
  doc["total_energy_wh"]     = round(energy * 100) / 100.0;
  doc["daily_energy_wh"]     = round(dailyEnergy * 100) / 100.0;
  doc["daily_units"]         = round(dailyEnergy / 10.0) / 100.0;
  doc["month1_units"]        = round(m1Energy / 10.0) / 100.0;
  doc["month2_units"]        = round(m2Energy / 10.0) / 100.0;
  doc["bimonthly_units"]     = round(biMonthlyUnits * 100) / 100.0;
  doc["running_bill_rupees"] = round(runningBill * 100) / 100.0;
  doc["supply_status"]       = supplyIsOn ? "ON" : "OFF";

  String js;
  serializeJson(doc, js);

  String url = "https://" + String(FIREBASE_HOST) +
               "/readings/" + String(USER_ID) +
               ".json?auth=" + String(FIREBASE_AUTH);

  http.begin(client, url);
  http.addHeader("Content-Type", "application/json");
  int httpCode = http.POST(js);

  Serial.print("\n📤 Upload: ");
  if (httpCode == 200 || httpCode == 201) {
    Serial.println("✓ Success");
    updateLatestReading(voltage, current, power, energy,
                        dailyEnergy, m1Energy, m2Energy, runningBill);
  } else {
    Serial.print("✗ Failed HTTP "); Serial.println(httpCode);
  }
  http.end();
  checkAlerts(power, dailyEnergy);
}

void updateLatestReading(float voltage, float current, float power,
                         float energy, float dailyEnergy,
                         float m1Energy, float m2Energy, float runningBill) {
  HTTPClient http; WiFiClientSecure client;
  client.setInsecure(); client.setTimeout(5000);

  float biMonthlyUnits = (m1Energy + m2Energy) / 1000.0;

  StaticJsonDocument<600> doc;
  doc["user_id"]             = USER_ID;
  doc["timestamp"]           = getTimestamp();
  doc["voltage"]             = round(voltage * 100) / 100.0;
  doc["current"]             = round(current * 1000) / 1000.0;
  doc["power"]               = round(power * 100) / 100.0;
  doc["total_energy_wh"]     = round(energy * 100) / 100.0;
  doc["daily_energy_wh"]     = round(dailyEnergy * 100) / 100.0;
  doc["daily_units"]         = round(dailyEnergy / 10.0) / 100.0;
  doc["month1_units"]        = round(m1Energy / 10.0) / 100.0;
  doc["month2_units"]        = round(m2Energy / 10.0) / 100.0;
  doc["bimonthly_units"]     = round(biMonthlyUnits * 100) / 100.0;
  doc["running_bill_rupees"] = round(runningBill * 100) / 100.0;
  doc["supply_status"]       = supplyIsOn ? "ON" : "OFF";

  String js; serializeJson(doc, js);

  String url = "https://" + String(FIREBASE_HOST) +
               "/latest_readings/" + String(USER_ID) +
               ".json?auth=" + String(FIREBASE_AUTH);
  http.begin(client, url);
  http.addHeader("Content-Type", "application/json");
  http.PUT(js);
  http.end();
}

// ============================================================
// DAILY SUMMARY UPLOAD
// ============================================================

void uploadDailySummary(String date) {
  if (!wifiConnected) return;
  Serial.println("\n📊 Uploading daily summary...");

  HTTPClient http; WiFiClientSecure client;
  client.setInsecure(); client.setTimeout(8000);

  struct tm timeinfo;
  getLocalTime(&timeinfo);
  String monthRole = (timeinfo.tm_mon % 2 == 0) ? "month1" : "month2";

  float dailyUnits = dailyEnergyWh / 1000.0;

  DynamicJsonDocument doc(1024);
  doc["user_id"]         = USER_ID;
  doc["date"]            = date;
  doc["timestamp"]       = getTimestamp();
  doc["month_role"]      = monthRole;   // "month1" or "month2" in billing cycle
  doc["daily_units"]     = round(dailyUnits * 100) / 100.0;
  doc["daily_energy_wh"] = round(dailyEnergyWh * 100) / 100.0;
  doc["peak_power_w"]    = round(dailyPeakPower * 100) / 100.0;
  doc["avg_power_w"]     = round(dailyAvgPower * 100) / 100.0;

  JsonArray hourly = doc.createNestedArray("hourly_consumption_wh");
  for (int i = 0; i < 24; i++) hourly.add(round(hourlyEnergy[i] * 100) / 100.0);

  String js; serializeJson(doc, js);

  String url = "https://" + String(FIREBASE_HOST) +
               "/daily_data/" + String(USER_ID) +
               ".json?auth=" + String(FIREBASE_AUTH);
  http.begin(client, url);
  http.addHeader("Content-Type", "application/json");
  int httpCode = http.POST(js);

  if (httpCode == 200 || httpCode == 201) {
    Serial.print("✓ Daily summary | Units: "); Serial.println(dailyUnits);
  } else {
    Serial.print("✗ Daily summary failed: "); Serial.println(httpCode);
  }
  http.end();
}

// ============================================================
// BI-MONTHLY BILL — generated at end of 2nd month in cycle
// ============================================================

void sendBiMonthlyBillToAdmin() {
  if (!wifiConnected) return;
  Serial.println("\n💵 Generating bi-monthly bill...");

  HTTPClient http; WiFiClientSecure client;
  client.setInsecure(); client.setTimeout(8000);

  float m1Units    = month1EnergyWh / 1000.0;
  float m2Units    = month2EnergyWh / 1000.0;
  float totalUnits = m1Units + m2Units;
  float billAmount = calculateBiMonthlyBill(totalUnits);

  float s1u, s1a, s2u, s2a, s3u, s3a, s4u, s4a;
  getSlabBreakdown(totalUnits, s1u, s1a, s2u, s2a, s3u, s3a, s4u, s4a);

  struct tm timeinfo;
  getLocalTime(&timeinfo);
  int cycleYear = timeinfo.tm_year + 1900;

  const char* monthNames[] = {"JAN","FEB","MAR","APR","MAY","JUN",
                               "JUL","AUG","SEP","OCT","NOV","DEC"};
  int m1Idx = billingCycleMonth;
  int m2Idx = billingCycleMonth + 1;

  String billPeriod = String(monthNames[m1Idx]) + "-" +
                      String(monthNames[m2Idx]) + " " + String(cycleYear);

  // Due date = 15th of the month AFTER billing ends
  int dueMonthNum = m2Idx + 2;
  int dueYear     = cycleYear;
  if (dueMonthNum > 12) { dueMonthNum -= 12; dueYear++; }
  char dueDateStr[15];
  snprintf(dueDateStr, sizeof(dueDateStr), "%04d-%02d-15", dueYear, dueMonthNum);

  // Period from/to
  char periodFrom[15], periodTo[15];
  snprintf(periodFrom, sizeof(periodFrom), "%04d-%02d-01", cycleYear, m1Idx + 1);
  int lastDayM2 = 30;
  if (m2Idx == 0 || m2Idx == 2 || m2Idx == 4 ||
      m2Idx == 6 || m2Idx == 7 || m2Idx == 9 || m2Idx == 11) lastDayM2 = 31;
  else if (m2Idx == 1) lastDayM2 = 28;
  snprintf(periodTo, sizeof(periodTo), "%04d-%02d-%02d", cycleYear, m2Idx + 1, lastDayM2);

  DynamicJsonDocument doc(1024);
  doc["user_id"]              = USER_ID;
  doc["approved_phase"]       = USER_PHASE;
  doc["approved_load_kw"]     = USER_APPROVED_LOAD;

  // Bill period
  doc["bill_period"]          = billPeriod;          // "JAN-FEB 2024"
  doc["bill_period_from"]     = String(periodFrom);  // "2024-01-01"
  doc["bill_period_to"]       = String(periodTo);    // "2024-02-29"
  doc["bill_generated_date"]  = getDateOnly();
  doc["due_date"]             = String(dueDateStr);  // "2024-03-15"

  // Consumption
  doc["month1_units"]         = round(m1Units * 100) / 100.0;
  doc["month2_units"]         = round(m2Units * 100) / 100.0;
  doc["total_units"]          = round(totalUnits * 100) / 100.0;

  // Slab-wise breakdown
  JsonObject slabs = doc.createNestedObject("slab_breakdown");
  slabs["slab1_units"]  = round(s1u * 100) / 100.0;
  slabs["slab1_rate"]   = 3.00;
  slabs["slab1_amount"] = round(s1a * 100) / 100.0;
  slabs["slab2_units"]  = round(s2u * 100) / 100.0;
  slabs["slab2_rate"]   = 3.50;
  slabs["slab2_amount"] = round(s2a * 100) / 100.0;
  slabs["slab3_units"]  = round(s3u * 100) / 100.0;
  slabs["slab3_rate"]   = 5.00;
  slabs["slab3_amount"] = round(s3a * 100) / 100.0;
  slabs["slab4_units"]  = round(s4u * 100) / 100.0;
  slabs["slab4_rate"]   = 7.00;
  slabs["slab4_amount"] = round(s4a * 100) / 100.0;
  slabs["fixed_charge"] = 50.00;

  // Totals
  doc["total_bill_rupees"]    = round(billAmount * 100) / 100.0;
  doc["peak_demand_kw"]       = round(dailyPeakPower / 10.0) / 100.0;

  // Payment status (admin fills these later)
  doc["status"]               = "pending_approval";
  doc["payment_status"]       = "unpaid";
  doc["payment_date"]         = "";
  doc["payment_method"]       = "";

  String js; serializeJson(doc, js);

  String url = "https://" + String(FIREBASE_HOST) +
               "/monthly_bills/" + String(USER_ID) +
               ".json?auth=" + String(FIREBASE_AUTH);
  http.begin(client, url);
  http.addHeader("Content-Type", "application/json");
  int httpCode = http.POST(js);

  if (httpCode == 200 || httpCode == 201) {
    Serial.println("✓ Bi-monthly bill uploaded!");
    Serial.print("   Period : "); Serial.println(billPeriod);
    Serial.print("   Units  : "); Serial.print(totalUnits); Serial.println(" kWh");
    Serial.print("   Bill   : ₹"); Serial.println(billAmount);
    Serial.print("   Due    : "); Serial.println(dueDateStr);
  } else {
    Serial.print("✗ Bill upload failed: "); Serial.println(httpCode);
  }
  http.end();
}

// ============================================================
// ALERTS
// ============================================================

void checkAlerts(float power, float dailyEnergy) {
  float dailyUnits = dailyEnergy / 1000.0;
  float powerKW    = power / 1000.0;

  if (dailyUnits > DAILY_UNIT_THRESHOLD && !dailyAlertSent) {
    sendAlert("THRESHOLD_EXCEEDED",
              "Daily consumption exceeded " + String(DAILY_UNIT_THRESHOLD) + " units");
    dailyAlertSent = true;
    Serial.println("🚨 ALERT: Daily threshold exceeded!");
  }
  if (USER_PHASE == "SINGLE" && powerKW > ILLEGAL_3PHASE_THRESHOLD && !illegalUsageAlertSent) {
    sendAdminAlert("ILLEGAL_USAGE",
                   "Single-phase user exceeding 3-phase load: " + String(powerKW) + " kW");
    illegalUsageAlertSent = true;
    Serial.println("🚨 ADMIN ALERT: Possible illegal 3-phase usage!");
  }
  if (dailyUnits < DAILY_UNIT_THRESHOLD * 0.9)   dailyAlertSent = false;
  if (powerKW    < ILLEGAL_3PHASE_THRESHOLD * 0.9) illegalUsageAlertSent = false;
}

void sendAlert(String alertType, String message) {
  if (!wifiConnected) return;
  HTTPClient http; WiFiClientSecure client;
  client.setInsecure(); client.setTimeout(5000);
  StaticJsonDocument<300> doc;
  doc["user_id"] = USER_ID; doc["alert_type"] = alertType;
  doc["message"] = message; doc["timestamp"]  = getTimestamp();
  doc["status"]  = "unread";
  String js; serializeJson(doc, js);
  String url = "https://" + String(FIREBASE_HOST) + "/user_alerts/" + String(USER_ID) + ".json?auth=" + String(FIREBASE_AUTH);
  http.begin(client, url); http.addHeader("Content-Type","application/json");
  http.POST(js); http.end();
}

void sendAdminAlert(String alertType, String message) {
  if (!wifiConnected) return;
  HTTPClient http; WiFiClientSecure client;
  client.setInsecure(); client.setTimeout(5000);
  StaticJsonDocument<400> doc;
  doc["user_id"]   = USER_ID;
  doc["alert_type"]= alertType; doc["message"]    = message;
  doc["timestamp"] = getTimestamp(); doc["severity"] = "HIGH";
  doc["status"]    = "pending";
  String js; serializeJson(doc, js);
  String url = "https://" + String(FIREBASE_HOST) + "/admin_alerts.json?auth=" + String(FIREBASE_AUTH);
  http.begin(client, url); http.addHeader("Content-Type","application/json");
  http.POST(js); http.end();
}

// ============================================================
// TIME HELPERS
// ============================================================

String getTimestamp() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) return String(millis());
  char buffer[25];
  strftime(buffer, sizeof(buffer), "%Y-%m-%d %H:%M:%S", &timeinfo);
  return String(buffer);
}

String getDateOnly() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) return String(millis());
  char buffer[15];
  strftime(buffer, sizeof(buffer), "%Y-%m-%d", &timeinfo);
  return String(buffer);
}

// ============================================================
// DAILY STATS
// ============================================================

void updateDailyStats(float power) {
  if (power > dailyPeakPower) dailyPeakPower = power;
  if (power < dailyMinPower && power > 0) dailyMinPower = power;
  dailyPowerSum += power; dailyPowerSamples++;
  if (dailyPowerSamples > 0) dailyAvgPower = dailyPowerSum / dailyPowerSamples;
}

void updateHourlyEnergy(float energyIncrement) {
  struct tm timeinfo;
  if (getLocalTime(&timeinfo)) {
    int hour = timeinfo.tm_hour;
    if (hour >= 0 && hour < 24) hourlyEnergy[hour] += energyIncrement;
  }
}

// ============================================================
// DAILY & BI-MONTHLY RESET
// ============================================================

void checkDailyReset() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) return;

  // ---- Daily reset at midnight ----
  if (timeinfo.tm_mday != lastDay) {
    Serial.println("\n╔══════════════════════════════╗");
    Serial.println("║    📅 NEW DAY DETECTED       ║");
    Serial.println("╚══════════════════════════════╝");
    Serial.print("Yesterday: "); Serial.print(dailyEnergyWh / 1000.0); Serial.println(" kWh");

    uploadDailySummary(getDateOnly());

    // Accumulate into correct month slot of billing cycle
    if (timeinfo.tm_mon % 2 == 0) {
      month1EnergyWh += dailyEnergyWh;   // e.g. JAN, MAR, MAY...
    } else {
      month2EnergyWh += dailyEnergyWh;   // e.g. FEB, APR, JUN...
    }

    // Reset daily counters
    dailyEnergyWh     = 0.0;
    dailyAlertSent    = false;
    dailyPeakPower    = 0.0;
    dailyAvgPower     = 0.0;
    dailyMinPower     = 99999.0;
    dailyPowerSamples = 0;
    dailyPowerSum     = 0.0;
    for (int i = 0; i < 24; i++) hourlyEnergy[i] = 0.0;

    lastDay = timeinfo.tm_mday;
    Serial.println("✓ Daily reset complete");
  }

  // ---- Bi-monthly billing trigger ----
  // When a new even month starts (0,2,4,6,8,10) = end of previous billing cycle
  if (timeinfo.tm_mon != lastMonth) {
    bool isEndOfBillingCycle = (timeinfo.tm_mon % 2 == 0);

    if (isEndOfBillingCycle) {
      Serial.println("\n╔══════════════════════════════╗");
      Serial.println("║  📆 BI-MONTHLY CYCLE END     ║");
      Serial.println("╚══════════════════════════════╝");

      sendBiMonthlyBillToAdmin();

      // Reset bi-monthly accumulators for new cycle
      month1EnergyWh   = 0.0;
      month2EnergyWh   = 0.0;
      billingCycleMonth = timeinfo.tm_mon;

      Serial.println("✓ Bi-monthly reset complete");
    }
    lastMonth = timeinfo.tm_mon;
  }
}

// ============================================================
// MAIN LOOP
// ============================================================

void loop() {
  // Measure voltage & check supply state
  float Vrms             = measureVoltage();
  bool  currentSupplyState = checkSupplyState(Vrms);

  if (currentSupplyState) {
    smoothVoltage = (alpha * Vrms) + ((1.0 - alpha) * smoothVoltage);
  } else {
    smoothVoltage = 0.0;
    smoothCurrent = 0.0;
    powerIsValid  = false;
  }
  delay(10);

  // Measure current only if supply is ON
  float rawCurrent = 0.0;
  if (currentSupplyState) {
    rawCurrent = measureCurrentRaw();
    float filteredCurrent = smartFilter(rawCurrent);

    if (filteredCurrent > 0) {
      if (abs(filteredCurrent - smoothCurrent) > 2.0)
        smoothCurrent = (0.5 * filteredCurrent) + (0.5 * smoothCurrent);
      else
        smoothCurrent = (alpha * filteredCurrent) + ((1.0 - alpha) * smoothCurrent);
    } else {
      if (consecutiveLowReadings > 7) {
        smoothCurrent *= 0.7;
        if (smoothCurrent < 0.04) smoothCurrent = 0.0;
      } else {
        smoothCurrent *= 0.95;
      }
    }
  }

  // Power calculation
  float apparentPower = smoothVoltage * smoothCurrent;
  float powerFactor;
  if      (smoothCurrent < 0.3) powerFactor = 0.60;
  else if (smoothCurrent < 1.0) powerFactor = 0.75;
  else                          powerFactor = 0.90;
  float realPower = apparentPower * powerFactor;

  const float MIN_POWER_FOR_ENERGY = 20.0;
  powerIsValid = (realPower >= MIN_POWER_FOR_ENERGY) && currentSupplyState;

  // Energy accumulation
  unsigned long currentMillis = millis();
  float deltaTime = (currentMillis - lastEnergyUpdate) / 3600000.0;

  if (powerIsValid) {
    float energyIncrement = realPower * deltaTime;
    totalEnergyWh += energyIncrement;
    dailyEnergyWh += energyIncrement;
    updateDailyStats(realPower);
    updateHourlyEnergy(energyIncrement);
  }

  lastEnergyUpdate = currentMillis;
  checkDailyReset();

  // Serial display
  float biMonthlyUnits = (month1EnergyWh + month2EnergyWh) / 1000.0;
  float runningBill    = calculateBiMonthlyBill(biMonthlyUnits);

  Serial.print(getTimestamp());
  Serial.print(" | V:"); Serial.print(smoothVoltage, 1);
  Serial.print("V I:");  Serial.print(smoothCurrent, 3);
  Serial.print("A P:");  Serial.print(realPower, 1);
  Serial.print("W | Daily:"); Serial.print(dailyEnergyWh / 1000.0, 3);
  Serial.print("kWh | M1:"); Serial.print(month1EnergyWh / 1000.0, 2);
  Serial.print("kWh M2:");   Serial.print(month2EnergyWh / 1000.0, 2);
  Serial.print("kWh | Bill:₹"); Serial.print(runningBill, 2);
  if (!currentSupplyState) Serial.print(" [SUPPLY OFF]");
  Serial.println();

  // Cloud upload every 30 seconds
  if (wifiConnected && (currentMillis - lastUploadTime >= uploadInterval)) {
    uploadToFirebase(smoothVoltage, smoothCurrent, realPower,
                     totalEnergyWh, dailyEnergyWh,
                     month1EnergyWh, month2EnergyWh);
    lastUploadTime = currentMillis;
  }

  delay(500);
}
