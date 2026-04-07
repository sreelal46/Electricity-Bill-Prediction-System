// ===================================================================
// KSEB SMART METER - ESP32 Real-Time Cloud Monitor
// ✓ REAL TIME: All timestamps use actual NTP time (IST)
// ✓ Upload interval: 10 seconds
// ✓ FIXED: Firebase not sending — improved HTTP handling & logging
// ✓ FIXED: Phantom voltage readings when supply is OFF
// ✓ FIXED: Phantom current when no load connected
// ✓ FIXED: Energy accumulation on idle/filtered loads
// ✓ FIXED: Month energy double-counting bug
// ✓ FIXED: curr_sensitivity corrected for ACS712-20A
// ✓ Small load detection (50W TV, 65W laptop, etc.)
// ✓ Adaptive auto PF estimation based on load behaviour
// ===================================================================

#include "driver/adc.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <time.h>

float current_noise_baseline = 0.0;

// ============ WiFi Configuration ============
const char* WIFI_SSID     = "FTTH-3529";
const char* WIFI_PASSWORD = "SRK17EE015";

// ============ Firebase Configuration ============
const char* FIREBASE_HOST = "kseb-smart-meter-30e6c-default-rtdb.asia-southeast1.firebasedatabase.app";
const char* FIREBASE_AUTH = "NLY7pwQS1YtAW0azpHBufhnxVbj8AkBbTwmHrz6a";

// ============ User Configuration ============
const char* USER_ID            = "-OpbGh37W1lC9e0ScMwt";
const char* USER_NAME          = "jithu";
const char* USER_PHASE         = "SINGLE";
const float USER_APPROVED_LOAD = 5.0;

// ============ Alert Thresholds ============
const float DAILY_UNIT_THRESHOLD     = 30.0;
const float ILLEGAL_3PHASE_THRESHOLD = 7.0;

// ============ Upload Settings ============
unsigned long uploadInterval = 10000;  // 10 seconds real time
unsigned long lastUploadTime = 0;

// ============ Time Configuration (Real IST) ============
const char* NTP_SERVER        = "pool.ntp.org";
const char* NTP_SERVER2       = "time.google.com";
const long  GMT_OFFSET_SEC    = 19800;   // IST = UTC+5:30
const int   DAYLIGHT_OFFSET_SEC = 0;

bool timeInitialized = false;

// Returns real IST timestamp string
String getTimestamp() {
  if (!timeInitialized) return "NOT_SYNCED";
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo, 2000)) return "TIME_ERROR";
  char buffer[25];
  strftime(buffer, sizeof(buffer), "%Y-%m-%d %H:%M:%S", &timeinfo);
  return String(buffer);
}

String getDateOnly() {
  if (!timeInitialized) return "NOT_SYNCED";
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo, 2000)) return "DATE_ERROR";
  char buffer[15];
  strftime(buffer, sizeof(buffer), "%Y-%m-%d", &timeinfo);
  return String(buffer);
}

bool getLocalTimeIST(struct tm* t) {
  return getLocalTime(t, 2000);
}

// ---- Voltage Sensor (ZMPT101B) ----
#define VOLT_PIN    36
int   volt_offset = 1820;
float volt_calib  = 0.76;

// ---- Current Sensor (ACS712 20A) ----
#define CURR_PIN         34
int   curr_offset      = 2900;
float curr_sensitivity = 124.0;

// Filtering
float smoothCurrent = 0.0;
float smoothVoltage = 0.0;
float alpha         = 0.2;

// Current detection thresholds
const float NOISE_FLOOR            = 0.08;
const float CONFIRMATION_THRESHOLD = 0.10;
const float DIRECT_ACCEPT          = 0.30;

// Voltage detection
const float VOLTAGE_THRESHOLD       = 150.0;
const float VOLTAGE_NOISE_THRESHOLD = 50.0;
const int   VOLTAGE_CONFIRM_SAMPLES = 3;

// Voltage state tracking
int  consecutiveVoltagePresent = 0;
int  consecutiveVoltageAbsent  = 0;
bool supplyIsOn                = false;

// Load confirmation
int  consecutiveHighReadings = 0;
int  consecutiveLowReadings  = 0;

bool powerIsValid = false;

// ============================================================
// ADAPTIVE PF ESTIMATION
// ============================================================
#define PF_HISTORY_SIZE   10
float  currentHistory[PF_HISTORY_SIZE] = {0};
int    pfHistoryIndex   = 0;
float  measuredPF       = 0.85f;
float  displayPF        = 0.85f;
String currentLoadType  = "UNKNOWN";
unsigned long lastPFCheckTime = 0;

float estimateLoadPF() {
  unsigned long now = millis();
  if (now - lastPFCheckTime < 5000) return measuredPF;
  lastPFCheckTime = now;

  currentHistory[pfHistoryIndex % PF_HISTORY_SIZE] = smoothCurrent;
  pfHistoryIndex++;

  if (pfHistoryIndex < 5) return measuredPF;

  float sum = 0.0f, sumSq = 0.0f;
  int   count = min(pfHistoryIndex, PF_HISTORY_SIZE);

  for (int i = 0; i < count; i++) {
    sum   += currentHistory[i];
    sumSq += currentHistory[i] * currentHistory[i];
  }

  float mean     = sum / count;
  float variance = (sumSq / count) - (mean * mean);
  if (variance < 0) variance = 0;
  float stdDev    = sqrt(variance);
  float cvPercent = (mean > 0.1f) ? (stdDev / mean) * 100.0f : 0.0f;

  float  newPF;
  String loadType;

  if (mean < 0.15f) {
    newPF    = 0.65f; loadType = "STANDBY";
  } else if (cvPercent < 3.0f && mean >= 2.0f) {
    newPF    = 1.0f;  loadType = "RESISTIVE (heater/iron/sandwich maker)";
  } else if (cvPercent < 3.0f && mean >= 0.5f && mean < 2.0f) {
    newPF    = 0.75f; loadType = "SMALL RESISTIVE / LED DRIVER";
  } else if (cvPercent < 3.0f && mean < 0.5f) {
    newPF    = 0.65f; loadType = "ELECTRONICS / CHARGER";
  } else if (cvPercent >= 3.0f && cvPercent < 8.0f) {
    newPF    = 0.80f; loadType = "MOTOR LOAD (fan/fridge/pump)";
  } else {
    newPF    = 0.85f; loadType = "MIXED HOME LOADS";
  }

  measuredPF      = (0.2f * newPF) + (0.8f * measuredPF);
  displayPF       = measuredPF;
  currentLoadType = loadType;

  Serial.println("\n── Auto PF Detection ──────────────────────");
  Serial.print("   Avg Current : "); Serial.print(mean, 3);      Serial.println(" A");
  Serial.print("   Std Dev     : "); Serial.print(stdDev, 4);    Serial.println(" A");
  Serial.print("   CV          : "); Serial.print(cvPercent, 1); Serial.println(" %");
  Serial.print("   Load Type   : "); Serial.println(loadType);
  Serial.print("   Est. PF     : "); Serial.println(measuredPF, 3);
  Serial.print("   Time (IST)  : "); Serial.println(getTimestamp());
  Serial.println("────────────────────────────────────────────");

  return measuredPF;
}

// ============================================================
// Energy tracking
// ============================================================
float totalEnergyWh = 0.0;
float dailyEnergyWh = 0.0;

int   cycleMonthIndex = 0;
float month1EnergyWh  = 0.0;
float month2EnergyWh  = 0.0;

float runningBillRupees = 0.0;

unsigned long lastEnergyUpdate = 0;
int  lastDay   = -1;
int  lastMonth = -1;
bool dailyAlertSent        = false;
bool illegalUsageAlertSent = false;

float         dailyPeakPower    = 0.0;
float         dailyAvgPower     = 0.0;
float         dailyMinPower     = 99999.0;
unsigned long dailyPowerSamples = 0;
float         dailyPowerSum     = 0.0;

float hourlyEnergy[24] = {0};
int   currentHour = -1;

bool wifiConnected   = false;

// ============================================================
// BILLING HELPERS
// ============================================================
int getCycleStartMonth(int month1based) {
  if (month1based % 2 == 1) return month1based;
  return month1based - 1;
}

int getCycleMonthIndex(int month1based) {
  return (month1based % 2 == 0) ? 1 : 0;
}

String getBillPeriodString(int cycleStartMonth1based, int year) {
  const char* names[] = {"JAN","FEB","MAR","APR","MAY","JUN",
                         "JUL","AUG","SEP","OCT","NOV","DEC"};
  int m1 = cycleStartMonth1based - 1;
  int m2 = m1 + 1;
  if (m2 > 11) m2 = 0;
  char buf[20];
  snprintf(buf, sizeof(buf), "%s-%s %d", names[m1], names[m2], year);
  return String(buf);
}

String getMonthString(int month1based, int year) {
  const char* names[] = {"JAN","FEB","MAR","APR","MAY","JUN",
                         "JUL","AUG","SEP","OCT","NOV","DEC"};
  char buf[12];
  snprintf(buf, sizeof(buf), "%s %d", names[month1based - 1], year);
  return String(buf);
}

float calculateBiMonthlyBill(float units) {
  float amount = 0.0;
  if      (units <= 100) amount = units * 3.00f;
  else if (units <= 200) amount = (100 * 3.00f) + ((units - 100) * 3.50f);
  else if (units <= 400) amount = (100 * 3.00f) + (100 * 3.50f) + ((units - 200) * 5.00f);
  else                   amount = (100 * 3.00f) + (100 * 3.50f) + (200 * 5.00f) + ((units - 400) * 7.00f);
  amount += 50.0f;
  return amount;
}

float calculateMonthlyBill(float units) {
  return calculateBiMonthlyBill(units);
}

void fillSlabBreakdown(JsonObject& slabObj, float units) {
  float rem = units;
  float s1u = min(rem, 100.0f); rem -= s1u;
  float s2u = min(rem, 100.0f); rem -= s2u;
  float s3u = min(rem, 200.0f); rem -= s3u;
  float s4u = rem;

  slabObj["slab1_units"]  = round(s1u * 100) / 100.0f;
  slabObj["slab1_rate"]   = 3.00f;
  slabObj["slab1_amount"] = round(s1u * 3.00f * 100) / 100.0f;
  slabObj["slab2_units"]  = round(s2u * 100) / 100.0f;
  slabObj["slab2_rate"]   = 3.50f;
  slabObj["slab2_amount"] = round(s2u * 3.50f * 100) / 100.0f;
  slabObj["slab3_units"]  = round(s3u * 100) / 100.0f;
  slabObj["slab3_rate"]   = 5.00f;
  slabObj["slab3_amount"] = round(s3u * 5.00f * 100) / 100.0f;
  slabObj["slab4_units"]  = round(s4u * 100) / 100.0f;
  slabObj["slab4_rate"]   = 7.00f;
  slabObj["slab4_amount"] = round(s4u * 7.00f * 100) / 100.0f;
  slabObj["fixed_charge"] = 50.00f;
}

// ============================================================
// FIREBASE HTTP HELPER — single reusable function
// Fixes the main reason data wasn't uploading:
//   - Uses a shared WiFiClientSecure with longer timeout
//   - Logs exact HTTP response code always
//   - Returns true/false for caller to check
// ============================================================
bool firebasePUT(const String& path, const String& jsonBody) {
  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(10);  // 10 second TCP timeout

  HTTPClient http;
  String url = "https://" + String(FIREBASE_HOST) + path + "?auth=" + String(FIREBASE_AUTH);

  if (!http.begin(client, url)) {
    Serial.println("  ✗ http.begin() failed for: " + path);
    return false;
  }

  http.addHeader("Content-Type", "application/json");
  http.setTimeout(8000);  // 8s HTTP timeout

  int code = http.PUT(jsonBody);
  bool ok = (code == 200 || code == 204);

  Serial.print("  PUT "); Serial.print(path);
  Serial.print(" → HTTP "); Serial.print(code);
  Serial.println(ok ? " ✓" : " ✗");

  if (!ok && code > 0) {
    Serial.print("  Response: "); Serial.println(http.getString().substring(0, 100));
  }

  http.end();
  return ok;
}

bool firebasePOST(const String& path, const String& jsonBody) {
  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(10);

  HTTPClient http;
  String url = "https://" + String(FIREBASE_HOST) + path + "?auth=" + String(FIREBASE_AUTH);

  if (!http.begin(client, url)) {
    Serial.println("  ✗ http.begin() failed for: " + path);
    return false;
  }

  http.addHeader("Content-Type", "application/json");
  http.setTimeout(8000);

  int code = http.POST(jsonBody);
  bool ok = (code == 200 || code == 201);

  Serial.print("  POST "); Serial.print(path);
  Serial.print(" → HTTP "); Serial.print(code);
  Serial.println(ok ? " ✓" : " ✗");

  if (!ok && code > 0) {
    Serial.print("  Response: "); Serial.println(http.getString().substring(0, 100));
  }

  http.end();
  return ok;
}

// ============================================================
// SETUP
// ============================================================
void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n╔════════════════════════════════════════╗");
  Serial.println("║   KSEB SMART METER - REAL TIME         ║");
  Serial.println("║  ✓ Real IST timestamps via NTP         ║");
  Serial.println("║  ✓ Upload every 10 seconds             ║");
  Serial.println("║  ✓ ACS712-20A sensitivity = 124        ║");
  Serial.println("║  ✓ Adaptive Auto PF Estimation         ║");
  Serial.println("║  ✓ Small load detection enabled        ║");
  Serial.println("╚════════════════════════════════════════╝\n");

  Serial.print("User ID: ");        Serial.println(USER_ID);
  Serial.print("Approved Phase: "); Serial.println(USER_PHASE);
  Serial.print("Approved Load: ");  Serial.print(USER_APPROVED_LOAD); Serial.println(" kW");

  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);

  Serial.println("⚙️  Calibrating sensors...");
  calibrateOffsets();

  connectWiFi();

  if (wifiConnected) {
    Serial.println("🕐 Syncing time via NTP...");
    configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC, NTP_SERVER, NTP_SERVER2);

    // Wait up to 10 seconds for NTP sync
    struct tm timeinfo;
    int retries = 0;
    while (!getLocalTime(&timeinfo, 1000) && retries < 10) {
      Serial.print(".");
      retries++;
      delay(1000);
    }

    if (getLocalTime(&timeinfo, 2000)) {
      timeInitialized = true;
      Serial.println("\n✓ Time synced!");
      Serial.print("  Current IST: "); Serial.println(getTimestamp());
    } else {
      Serial.println("\n✗ NTP sync failed — timestamps will show TIME_ERROR");
    }
  }

  // Initialize day/month tracking from real time
  {
    struct tm t;
    if (getLocalTimeIST(&t)) {
      lastDay     = t.tm_mday;
      lastMonth   = t.tm_mon;
      currentHour = t.tm_hour;

      int month1based = t.tm_mon + 1;
      cycleMonthIndex = getCycleMonthIndex(month1based);
      Serial.print("Current date: "); Serial.println(getDateOnly());
      Serial.print("Cycle month role: month"); Serial.println(cycleMonthIndex + 1);
    }
  }

  Serial.println("\n✓ System ready! Uploading every 10 seconds.");
  Serial.println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  lastEnergyUpdate = millis();
  lastUploadTime   = millis() - uploadInterval;  // Force first upload immediately
  delay(1000);
}

// ============================================================
void connectWiFi() {
  Serial.print("📡 Connecting to WiFi");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    wifiConnected = true;
    Serial.println(" ✓");
    Serial.print("  IP: "); Serial.println(WiFi.localIP());
  } else {
    wifiConnected = false;
    Serial.println(" ✗ WiFi Failed! Running offline.");
  }
}

// ============================================================
void calibrateOffsets() {
  long sumV = 0;
  for (int i = 0; i < 1000; i++) { sumV += analogRead(VOLT_PIN); delayMicroseconds(50); }
  volt_offset = sumV / 1000;

  long sumC = 0;
  for (int i = 0; i < 2000; i++) { sumC += analogRead(CURR_PIN); delayMicroseconds(50); }
  curr_offset = sumC / 2000;

  long sumNoise = 0;
  for (int i = 0; i < 2000; i++) {
    int adc      = analogRead(CURR_PIN);
    int centered = adc - curr_offset;
    sumNoise    += (long)centered * (long)centered;
    delayMicroseconds(50);
  }
  float noiseRMS = sqrt((float)sumNoise / 2000);
  current_noise_baseline = (noiseRMS / curr_sensitivity) * 1.1f;

  Serial.print("  V-offset: ");        Serial.print(volt_offset);
  Serial.print(" | I-offset: ");       Serial.print(curr_offset);
  Serial.print(" | Noise baseline: "); Serial.print(current_noise_baseline, 4);
  Serial.println(" A");
}

// ============================================================
// VOLTAGE MEASUREMENT
// ============================================================
float measureVoltage() {
  long sumVolt = 0;
  const int samples = 1000;
  for (int i = 0; i < samples; i++) {
    int adc     = analogRead(VOLT_PIN);
    int centered = adc - volt_offset;
    sumVolt    += (long)centered * (long)centered;
    delayMicroseconds(50);
  }
  float rms_counts = sqrt((float)sumVolt / samples);
  float voltage    = rms_counts * volt_calib;
  if (voltage < VOLTAGE_NOISE_THRESHOLD) return 0.0f;
  return voltage;
}

bool checkSupplyState(float voltage) {
  if (voltage >= VOLTAGE_THRESHOLD) {
    consecutiveVoltagePresent++;
    consecutiveVoltageAbsent = 0;
    if (consecutiveVoltagePresent >= VOLTAGE_CONFIRM_SAMPLES) {
      if (!supplyIsOn) Serial.println("\n✓ AC SUPPLY DETECTED - System ON");
      supplyIsOn = true;
      return true;
    }
  } else {
    consecutiveVoltageAbsent++;
    consecutiveVoltagePresent = 0;
    if (consecutiveVoltageAbsent >= VOLTAGE_CONFIRM_SAMPLES) {
      if (supplyIsOn) {
        Serial.println("\n✗ AC SUPPLY LOST - System OFF");
        smoothCurrent           = 0.0f;
        consecutiveHighReadings = 0;
        consecutiveLowReadings  = 0;
        pfHistoryIndex          = 0;
        measuredPF              = 0.85f;
        currentLoadType         = "UNKNOWN";
      }
      supplyIsOn = false;
      return false;
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
    int adc     = analogRead(CURR_PIN);
    int centered = adc - curr_offset;
    sumCurr    += (long)centered * (long)centered;
    delayMicroseconds(50);
  }
  float rmsADC  = sqrt((float)sumCurr / samples);
  float current = (rmsADC / curr_sensitivity) - current_noise_baseline;
  if (current < 0) current = 0.0f;
  if (current < 0.05f) return 0.0f;
  return current;
}

float smartFilter(float rawCurrent) {
  if (rawCurrent < NOISE_FLOOR) {
    consecutiveHighReadings = 0;
    consecutiveLowReadings++;
    return 0.0f;
  }
  if (rawCurrent >= DIRECT_ACCEPT) {
    consecutiveHighReadings++;
    consecutiveLowReadings = 0;
    return rawCurrent;
  }
  if (rawCurrent >= CONFIRMATION_THRESHOLD) {
    consecutiveHighReadings++;
    consecutiveLowReadings = 0;
    if (consecutiveHighReadings >= 3) return rawCurrent;
    return 0.0f;
  }
  consecutiveLowReadings++;
  if (consecutiveHighReadings > 8) return rawCurrent;
  if (smoothCurrent > 0.10f && consecutiveHighReadings > 3) return rawCurrent;
  return 0.0f;
}

// ============================================================
// MONTHLY SNAPSHOT HELPER
// ============================================================
void getMonthlySnapshot(float& m1u, float& m2u, float& bimonthly, float& runBill) {
  m1u       = round((month1EnergyWh / 1000.0f) * 100) / 100.0f;
  m2u       = round((month2EnergyWh / 1000.0f) * 100) / 100.0f;
  bimonthly = round((m1u + m2u) * 100) / 100.0f;

  float thisMonthWh    = (cycleMonthIndex == 0) ? month1EnergyWh : month2EnergyWh;
  float thisMonthUnits = thisMonthWh / 1000.0f;
  runBill              = round(calculateMonthlyBill(thisMonthUnits) * 100) / 100.0f;
  runningBillRupees    = runBill;
}

// ============================================================
// CLOUD UPLOAD — Main reading (PUT to latest_readings, POST to readings)
// ============================================================
void uploadToFirebase(float voltage, float current, float power, float energy, float dailyEnergy) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("⚠️  WiFi disconnected — skipping upload");
    wifiConnected = false;
    return;
  }
  wifiConnected = true;

  float m1u, m2u, bimonthly, runBill;
  getMonthlySnapshot(m1u, m2u, bimonthly, runBill);

  float dailyUnits = round((dailyEnergy / 1000.0f) * 1000) / 1000.0f;

  StaticJsonDocument<900> doc;
  doc["user_id"]             = USER_ID;
  doc["timestamp"]           = getTimestamp();
  doc["voltage"]             = round(voltage  * 100) / 100.0f;
  doc["current"]             = round(current  * 1000) / 1000.0f;
  doc["power"]               = round(power    * 100) / 100.0f;
  doc["power_factor"]        = round(displayPF * 1000) / 1000.0f;
  doc["load_type"]           = currentLoadType;
  doc["total_energy_wh"]     = round(energy   * 100) / 100.0f;
  doc["daily_energy_wh"]     = round(dailyEnergy * 100) / 100.0f;
  doc["daily_units"]         = dailyUnits;
  doc["month1_units"]        = m1u;
  doc["month2_units"]        = m2u;
  doc["bimonthly_units"]     = bimonthly;
  doc["running_bill_rupees"] = runBill;
  doc["supply_status"]       = supplyIsOn ? "ON" : "OFF";

  String jsonString;
  serializeJson(doc, jsonString);

  Serial.println("\n📤 Uploading to Firebase...");

  // PUT to latest_readings (overwrites, fast)
  String latestPath = "/latest_readings/" + String(USER_ID) + ".json";
  firebasePUT(latestPath, jsonString);

  // POST to readings (appends new entry)
  String readingsPath = "/readings/" + String(USER_ID) + ".json";
  firebasePOST(readingsPath, jsonString);

  checkAlerts(power, dailyEnergy);
}

void uploadDailySummary(String date) {
  if (WiFi.status() != WL_CONNECTED) return;
  Serial.println("\n📊 Uploading daily summary...");

  float dailyUnits = round((dailyEnergyWh / 1000.0f) * 100) / 100.0f;

  struct tm t;
  getLocalTimeIST(&t);
  int month1based = t.tm_mon + 1;
  String monthRole = (getCycleMonthIndex(month1based) == 0) ? "month1" : "month2";

  DynamicJsonDocument doc(1024);
  doc["user_id"]         = USER_ID;
  doc["date"]            = date;
  doc["timestamp"]       = getTimestamp();
  doc["month_role"]      = monthRole;
  doc["daily_units"]     = dailyUnits;
  doc["daily_energy_wh"] = round(dailyEnergyWh * 100) / 100.0f;
  doc["peak_power_w"]    = round(dailyPeakPower * 100) / 100.0f;
  doc["avg_power_w"]     = round(dailyAvgPower  * 100) / 100.0f;

  JsonArray hourly = doc.createNestedArray("hourly_consumption_wh");
  for (int i = 0; i < 24; i++) hourly.add(round(hourlyEnergy[i] * 100) / 100.0f);

  doc["approved_phase"]   = USER_PHASE;
  doc["approved_load_kw"] = USER_APPROVED_LOAD;

  String js;
  serializeJson(doc, js);

  String path = "/daily_data/" + String(USER_ID) + ".json";
  if (firebasePOST(path, js)) {
    Serial.print("✓ Daily summary: "); Serial.print(date);
    Serial.print(" | "); Serial.print(dailyUnits); Serial.print(" kWh | role: ");
    Serial.println(monthRole);
  }
}

void uploadRunningBill(String date, float dailyUnits) {
  if (WiFi.status() != WL_CONNECTED) return;

  float thisMonthWh        = (cycleMonthIndex == 0) ? month1EnergyWh : month2EnergyWh;
  float thisMonthUnits     = thisMonthWh / 1000.0f;
  float runningMonthlyBill = round(calculateMonthlyBill(thisMonthUnits) * 100) / 100.0f;
  float dailyBill          = round(calculateMonthlyBill(dailyUnits) * 100) / 100.0f;

  StaticJsonDocument<300> doc;
  doc["user_id"]              = USER_ID;
  doc["date"]                 = date;
  doc["timestamp"]            = getTimestamp();
  doc["daily_units"]          = round(dailyUnits * 100) / 100.0f;
  doc["daily_bill"]           = dailyBill;
  doc["running_monthly_bill"] = runningMonthlyBill;

  String js;
  serializeJson(doc, js);

  String path = "/running_bills/" + String(USER_ID) + ".json";
  firebasePOST(path, js);
  Serial.print("💰 Daily: ₹"); Serial.print(dailyBill);
  Serial.print(" | Monthly so far: ₹"); Serial.println(runningMonthlyBill);
}

void uploadMonthlyRecord(int month1based, int year, float monthUnits) {
  if (WiFi.status() != WL_CONNECTED) return;

  float totalBill = round(calculateMonthlyBill(monthUnits) * 100) / 100.0f;

  int dueMonth = (month1based % 2 == 0) ? month1based + 1 : month1based + 2;
  int dueYear  = year;
  if (dueMonth > 12) { dueMonth -= 12; dueYear++; }

  int lastDayOfMonth = 31;
  if (month1based == 2) lastDayOfMonth = (year % 4 == 0) ? 29 : 28;
  else if (month1based == 4 || month1based == 6 ||
           month1based == 9 || month1based == 11) lastDayOfMonth = 30;

  char periodFrom[12], periodTo[12], dueDate[12];
  snprintf(periodFrom, sizeof(periodFrom), "%04d-%02d-01",   year, month1based);
  snprintf(periodTo,   sizeof(periodTo),   "%04d-%02d-%02d", year, month1based, lastDayOfMonth);
  snprintf(dueDate,    sizeof(dueDate),    "%04d-%02d-15",   dueYear, dueMonth);

  StaticJsonDocument<400> doc;
  doc["user_id"]          = USER_ID;
  doc["month"]            = getMonthString(month1based, year);
  doc["bill_period_from"] = periodFrom;
  doc["bill_period_to"]   = periodTo;
  doc["month_units"]      = round(monthUnits * 100) / 100.0f;
  doc["total_bill"]       = totalBill;
  doc["due_date"]         = dueDate;
  doc["payment_status"]   = "unpaid";
  doc["timestamp"]        = getTimestamp();

  String js;
  serializeJson(doc, js);

  String path = "/monthly_records/" + String(USER_ID) + ".json";
  if (firebasePOST(path, js)) {
    Serial.print("📅 Monthly: "); Serial.print(getMonthString(month1based, year));
    Serial.print(" | ₹"); Serial.println(totalBill);
  }
}

void uploadBiMonthlyBill(int cycleStartMonth1based, int year) {
  if (WiFi.status() != WL_CONNECTED) return;

  float m1units    = round((month1EnergyWh / 1000.0f) * 100) / 100.0f;
  float m2units    = round((month2EnergyWh / 1000.0f) * 100) / 100.0f;
  float totalUnits = m1units + m2units;
  float totalBill  = round(calculateBiMonthlyBill(totalUnits) * 100) / 100.0f;

  int cycleEndMonth1based = cycleStartMonth1based + 1;
  int cycleEndYear        = year;
  if (cycleEndMonth1based > 12) { cycleEndMonth1based = 1; cycleEndYear++; }

  int dueMonth = cycleEndMonth1based + 1;
  int dueYear  = cycleEndYear;
  if (dueMonth > 12) { dueMonth = 1; dueYear++; }

  int lastDayEnd = 31;
  if (cycleEndMonth1based == 2) lastDayEnd = (cycleEndYear % 4 == 0) ? 29 : 28;
  else if (cycleEndMonth1based == 4 || cycleEndMonth1based == 6 ||
           cycleEndMonth1based == 9 || cycleEndMonth1based == 11) lastDayEnd = 30;

  char periodFrom[12], periodTo[12], dueDate[12], genDate[12];
  snprintf(periodFrom, sizeof(periodFrom), "%04d-%02d-01",   year,         cycleStartMonth1based);
  snprintf(periodTo,   sizeof(periodTo),   "%04d-%02d-%02d", cycleEndYear, cycleEndMonth1based, lastDayEnd);
  snprintf(dueDate,    sizeof(dueDate),    "%04d-%02d-15",   dueYear,      dueMonth);
  snprintf(genDate,    sizeof(genDate),    "%04d-%02d-01",   dueYear,      (dueMonth - 1 > 0) ? dueMonth - 1 : 12);

  float peakDemandKW = round((dailyPeakPower / 1000.0f) * 100) / 100.0f;

  DynamicJsonDocument doc(1024);
  doc["user_id"]             = USER_ID;
  doc["approved_phase"]      = USER_PHASE;
  doc["approved_load_kw"]    = USER_APPROVED_LOAD;
  doc["bill_period"]         = getBillPeriodString(cycleStartMonth1based, year);
  doc["bill_period_from"]    = periodFrom;
  doc["bill_period_to"]      = periodTo;
  doc["bill_generated_date"] = genDate;
  doc["due_date"]            = dueDate;
  doc["month1_units"]        = m1units;
  doc["month2_units"]        = m2units;
  doc["total_units"]         = round(totalUnits * 100) / 100.0f;

  JsonObject slabBreakdown = doc.createNestedObject("slab_breakdown");
  fillSlabBreakdown(slabBreakdown, totalUnits);

  doc["total_bill_rupees"] = totalBill;
  doc["peak_demand_kw"]    = peakDemandKW;
  doc["status"]            = "pending_approval";
  doc["payment_status"]    = "unpaid";
  doc["payment_date"]      = "";
  doc["payment_method"]    = "";

  String js;
  serializeJson(doc, js);

  String path = "/monthly_bills/" + String(USER_ID) + ".json";
  if (firebasePOST(path, js)) {
    Serial.println("💵 Bi-monthly bill uploaded");
    Serial.print("   Period: "); Serial.println(getBillPeriodString(cycleStartMonth1based, year));
    Serial.print("   Total:  ₹"); Serial.println(totalBill);
  }
}

void checkAlerts(float power, float dailyEnergy) {
  float dailyUnits = dailyEnergy / 1000.0f;
  float powerKW    = power / 1000.0f;

  if (dailyUnits > DAILY_UNIT_THRESHOLD && !dailyAlertSent) {
    sendAlert("THRESHOLD_EXCEEDED",
              "Daily consumption exceeded " + String(DAILY_UNIT_THRESHOLD) + " units");
    dailyAlertSent = true;
    Serial.println("🚨 ALERT: Daily threshold exceeded!");
  }
  if (String(USER_PHASE) == "SINGLE" && powerKW > ILLEGAL_3PHASE_THRESHOLD
      && !illegalUsageAlertSent) {
    sendAdminAlert("ILLEGAL_USAGE",
                   "Single-phase user exceeding 3-phase load: " + String(powerKW) + " kW");
    illegalUsageAlertSent = true;
    Serial.println("🚨 ADMIN ALERT: Possible illegal 3-phase usage!");
  }
  if (dailyUnits < DAILY_UNIT_THRESHOLD * 0.9f)    dailyAlertSent = false;
  if (powerKW    < ILLEGAL_3PHASE_THRESHOLD * 0.9f) illegalUsageAlertSent = false;
}

void sendAlert(String alertType, String message) {
  StaticJsonDocument<300> doc;
  doc["user_id"]    = USER_ID;
  doc["alert_type"] = alertType;
  doc["message"]    = message;
  doc["timestamp"]  = getTimestamp();
  doc["status"]     = "unread";
  String js; serializeJson(doc, js);
  firebasePOST("/user_alerts/" + String(USER_ID) + ".json", js);
}

void sendAdminAlert(String alertType, String message) {
  StaticJsonDocument<400> doc;
  doc["user_id"]    = USER_ID;
  doc["user_name"]  = USER_NAME;
  doc["alert_type"] = alertType;
  doc["message"]    = message;
  doc["timestamp"]  = getTimestamp();
  doc["severity"]   = "HIGH";
  doc["status"]     = "pending";
  String js; serializeJson(doc, js);
  firebasePOST("/admin_alerts.json", js);
}

void updateDailyStats(float power) {
  if (power > dailyPeakPower) dailyPeakPower = power;
  if (power < dailyMinPower && power > 0) dailyMinPower = power;
  dailyPowerSum += power;
  dailyPowerSamples++;
  if (dailyPowerSamples > 0) dailyAvgPower = dailyPowerSum / dailyPowerSamples;
}

void updateHourlyEnergy(float energyIncrement) {
  struct tm t;
  if (getLocalTimeIST(&t)) {
    int hour = t.tm_hour;
    if (hour >= 0 && hour < 24) hourlyEnergy[hour] += energyIncrement;
  }
}

// ============================================================
// DAILY / MONTHLY RESET (uses real IST time)
// ============================================================
void checkDailyReset() {
  if (!timeInitialized) return;

  struct tm t;
  if (!getLocalTimeIST(&t)) return;

  if (t.tm_mday != lastDay && lastDay != -1) {
    Serial.println("\n╔════════════════════════════════════════╗");
    Serial.println("║    📅 NEW DAY DETECTED (IST)           ║");
    Serial.println("╚════════════════════════════════════════╝");
    Serial.print("Date now: "); Serial.println(getDateOnly());
    Serial.print("Previous day energy: "); Serial.print(dailyEnergyWh / 1000.0f); Serial.println(" kWh");

    String yesterday = getDateOnly();
    uploadDailySummary(yesterday);
    uploadRunningBill(yesterday, dailyEnergyWh / 1000.0f);

    dailyEnergyWh     = 0.0f;
    dailyAlertSent    = false;
    dailyPeakPower    = 0.0f;
    dailyAvgPower     = 0.0f;
    dailyMinPower     = 99999.0f;
    dailyPowerSamples = 0;
    dailyPowerSum     = 0.0f;
    for (int i = 0; i < 24; i++) hourlyEnergy[i] = 0.0f;

    lastDay = t.tm_mday;
    Serial.println("✓ Daily reset complete\n");
  } else if (lastDay == -1) {
    lastDay = t.tm_mday;
  }

  if (t.tm_mon != lastMonth && lastMonth != -1) {
    int prevMonth1based = lastMonth + 1;
    int prevYear        = t.tm_year + 1900;

    Serial.println("\n📆 NEW MONTH DETECTED");
    Serial.print("Month ended: "); Serial.println(getMonthString(prevMonth1based, prevYear));

    float endedMonthUnits = (cycleMonthIndex == 0)
                          ? month1EnergyWh / 1000.0f
                          : month2EnergyWh / 1000.0f;
    uploadMonthlyRecord(prevMonth1based, prevYear, endedMonthUnits);

    if (getCycleMonthIndex(prevMonth1based) == 1) {
      int cycleStart = getCycleStartMonth(prevMonth1based);
      uploadBiMonthlyBill(cycleStart, prevYear);
      month1EnergyWh = 0.0f;
      month2EnergyWh = 0.0f;
      Serial.println("✓ Bi-monthly cycle reset");
    }

    cycleMonthIndex = 1 - cycleMonthIndex;
    lastMonth       = t.tm_mon;
    Serial.println("✓ Monthly reset complete\n");
  } else if (lastMonth == -1) {
    lastMonth = t.tm_mon;
  }
}

// ============================================================
// MAIN LOOP
// ============================================================
void loop() {
  float Vrms = measureVoltage();
  bool currentSupplyState = checkSupplyState(Vrms);

  if (currentSupplyState) {
    smoothVoltage = (alpha * Vrms) + ((1.0f - alpha) * smoothVoltage);
  } else {
    smoothVoltage = 0.0f;
    smoothCurrent = 0.0f;
    powerIsValid  = false;
  }

  delay(10);

  float rawCurrent = 0.0f;
  if (currentSupplyState) {
    rawCurrent = measureCurrentRaw();
    float filteredCurrent = smartFilter(rawCurrent);

    if (filteredCurrent > 0) {
      if (abs(filteredCurrent - smoothCurrent) > 2.0f)
        smoothCurrent = (0.5f * filteredCurrent) + (0.5f * smoothCurrent);
      else
        smoothCurrent = (alpha * filteredCurrent) + ((1.0f - alpha) * smoothCurrent);
    } else {
      if (consecutiveLowReadings > 7) {
        smoothCurrent *= 0.7f;
        if (smoothCurrent < 0.05f) smoothCurrent = 0.0f;
      } else {
        smoothCurrent *= 0.95f;
      }
    }
  }

  float powerFactor   = estimateLoadPF();
  float apparentPower = smoothVoltage * smoothCurrent;
  float realPower     = apparentPower * powerFactor;

  const float MIN_POWER_FOR_ENERGY = 5.0f;
  powerIsValid = (realPower >= MIN_POWER_FOR_ENERGY) && currentSupplyState;

  unsigned long currentMillis = millis();
  float deltaTime = (currentMillis - lastEnergyUpdate) / 3600000.0f;

  if (powerIsValid) {
    float energyIncrement = realPower * deltaTime;
    totalEnergyWh += energyIncrement;
    dailyEnergyWh += energyIncrement;
    if (cycleMonthIndex == 0) month1EnergyWh += energyIncrement;
    else                       month2EnergyWh += energyIncrement;
    updateDailyStats(realPower);
    updateHourlyEnergy(energyIncrement);
  }

  lastEnergyUpdate = currentMillis;
  checkDailyReset();

  // Serial monitor output
  Serial.print(getTimestamp());
  Serial.print(" | V:");      Serial.print(smoothVoltage, 1);
  Serial.print("V I:");       Serial.print(smoothCurrent, 3);
  Serial.print("A P:");       Serial.print(realPower, 1);
  Serial.print("W PF:");      Serial.print(powerFactor, 2);
  Serial.print(" | Day:");    Serial.print(dailyEnergyWh / 1000.0f, 4);
  Serial.print("kWh Bill:₹"); Serial.print(runningBillRupees, 2);

  if (!currentSupplyState) {
    Serial.print(" [SUPPLY OFF]");
  } else if (smoothCurrent > 0.05f) {
    Serial.print(" [");
    if      (smoothCurrent < 0.5f) Serial.print("TINY");
    else if (smoothCurrent < 2.0f) Serial.print("MEDIUM");
    else                           Serial.print("LARGE");
    Serial.print(powerIsValid ? " ✓]" : " ✗]");
  } else {
    Serial.print(" [IDLE]");
  }
  Serial.println();

  // Upload every 10 seconds
  if (currentMillis - lastUploadTime >= uploadInterval) {
    uploadToFirebase(smoothVoltage, smoothCurrent, realPower,
                     totalEnergyWh, dailyEnergyWh);
    lastUploadTime = currentMillis;
  }

  delay(500);
}
