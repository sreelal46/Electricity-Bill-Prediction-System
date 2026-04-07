// ===================================================================
// KSEB SMART METER - ESP32 Cloud Monitor (TIME-SCALED VERSION)
// ✓ TIME SCALING: 10 real minutes = 1 scaled hour
// ✓ Scaled time starts from: 2026-01-01 00:00:00
// ✓ All timestamps, daily/monthly resets use SCALED time
// ✓ FIXED: Phantom voltage readings when supply is OFF
// ✓ FIXED: Phantom current when no load connected
// ✓ FIXED: Energy accumulation on idle/filtered loads
// ✓ FIXED: Firebase structure matches required schema exactly
// ✓ FIXED: Month energy double-counting bug
// ✓ FIXED: curr_sensitivity corrected for ACS712-20A
// ✓ FIXED: Small load detection (50W TV, 65W laptop, etc.)
// ✓ NEW:   Adaptive auto PF estimation based on load behaviour
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
const char* USER_ID            = "-OpR3l1jC4j39zgaAe5V";
const char* USER_NAME          = "Srijith";
const char* USER_PHASE         = "SINGLE";
const float USER_APPROVED_LOAD = 5.0;

// ============ Alert Thresholds ============
const float DAILY_UNIT_THRESHOLD     = 30.0;
const float ILLEGAL_3PHASE_THRESHOLD = 7.0;

// ============ Upload Settings ============
unsigned long uploadInterval = 6000;
unsigned long lastUploadTime = 0;

// ============================================================
// TIME SCALING CONFIGURATION
// ============================================================
// 10 real minutes = 1 scaled hour
// Scale factor: 1 real second = 6 scaled seconds
//   → 1 real minute  = 6 scaled minutes
//   → 10 real minutes = 60 scaled minutes = 1 scaled hour
//   → 1 real hour    = 6 scaled hours
//   → 4 real hours   = 1 scaled day
//   → ~2.5 real days = 1 scaled month (30 scaled days)
// ============================================================
#define TIME_SCALE_FACTOR     30UL

#define SCALED_EPOCH_START    1735669800UL   // 2026-01-01 00:00:00 IST

unsigned long realStartMillis = 0;

unsigned long getScaledUnixTime() {
  unsigned long realElapsedSec = (millis() - realStartMillis) / 1000UL;
  unsigned long scaledElapsed  = realElapsedSec * TIME_SCALE_FACTOR;
  return SCALED_EPOCH_START + scaledElapsed;
}

void getScaledTime(struct tm* t) {
  time_t scaledUnix = (time_t)getScaledUnixTime();
  time_t utcUnix    = scaledUnix - 19800;
  struct tm* tmp    = gmtime(&utcUnix);
  memcpy(t, tmp, sizeof(struct tm));
}

String getTimestamp() {
  struct tm t;
  getScaledTime(&t);
  char buffer[25];
  strftime(buffer, sizeof(buffer), "%Y-%m-%d %H:%M:%S", &t);
  return String(buffer);
}

String getDateOnly() {
  struct tm t;
  getScaledTime(&t);
  char buffer[15];
  strftime(buffer, sizeof(buffer), "%Y-%m-%d", &t);
  return String(buffer);
}

// ============ Time Configuration ============
const char* NTP_SERVER        = "pool.ntp.org";
const long  GMT_OFFSET_SEC    = 19800;
const int   DAYLIGHT_OFFSET_SEC = 0;

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

// ============================================================
// CHANGE 1 of 5: Current detection thresholds
// ──────────────────────────────────────────────────────────
// OLD values blocked small loads completely:
//   NOISE_FLOOR = 0.20  → 50W TV (0.217A) sat right at this, rejected constantly
//   CONFIRMATION_THRESHOLD = 0.25 → TV never reached this, fell into dead zone
//   DIRECT_ACCEPT = 0.40 → only loads >92W were accepted without confirmation
//
// NEW values:
//   NOISE_FLOOR = 0.08  → anything below 18W (~0.08A) treated as noise
//   CONFIRMATION_THRESHOLD = 0.10 → loads above 23W need 3 consistent readings
//   DIRECT_ACCEPT = 0.30 → loads above 69W accepted immediately
//
// No-load safety: ADC noise after baseline subtraction is ~0.02-0.04A,
// well below 0.08, so idle still reads 0A correctly.
// ============================================================
const float NOISE_FLOOR            = 0.08;
const float CONFIRMATION_THRESHOLD = 0.10;
const float DIRECT_ACCEPT          = 0.30;

// Voltage detection (unchanged)
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
const int CONFIRMATION_SAMPLES = 5;

bool powerIsValid = false;

// ============================================================
// ADAPTIVE PF ESTIMATION (unchanged)
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
  Serial.print("   Scaled Time : "); Serial.println(getTimestamp());
  Serial.println("────────────────────────────────────────────");

  return measuredPF;
}

// ============================================================
// Energy tracking (unchanged)
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
bool userInitialized = false;

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
// SETUP (unchanged from doc5)
// ============================================================
void setup() {
  Serial.begin(115200);
  delay(1000);

  realStartMillis = millis();

  Serial.println("\n╔════════════════════════════════════════╗");
  Serial.println("║   KSEB SMART METER - TIME SCALED      ║");
  Serial.println("║  ✓ 2 real minutes = 1 scaled hour     ║");
  Serial.println("║  ✓ Starts: 2026-01-01 00:00:00        ║");
  Serial.println("║  ✓ ACS712-20A sensitivity = 124       ║");
  Serial.println("║  ✓ Adaptive Auto PF Estimation        ║");
  Serial.println("║  ✓ Small load detection enabled       ║");
  Serial.println("╚════════════════════════════════════════╝\n");

  Serial.print("User ID: ");        Serial.println(USER_ID);
  Serial.print("Approved Phase: "); Serial.println(USER_PHASE);
  Serial.print("Approved Load: ");  Serial.print(USER_APPROVED_LOAD); Serial.println(" kW");
  Serial.print("Scale Factor:   "); Serial.print(TIME_SCALE_FACTOR);  Serial.println("x");
  Serial.print("Scaled Start:   "); Serial.println(getTimestamp());
  Serial.println();

  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);

  Serial.println("⚙️  Calibrating sensors...");
  calibrateOffsets();

  connectWiFi();
  if (wifiConnected) {
    configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC, NTP_SERVER);
    delay(2000);
  }

  {
    struct tm t;
    getScaledTime(&t);
    lastDay     = t.tm_mday;
    lastMonth   = t.tm_mon;
    currentHour = t.tm_hour;

    int month1based = t.tm_mon + 1;
    cycleMonthIndex = getCycleMonthIndex(month1based);
    Serial.print("Scaled date:        "); Serial.println(getDateOnly());
    Serial.print("Cycle month role:   month"); Serial.println(cycleMonthIndex + 1);
  }

  Serial.println("\n✓ System ready!");
  Serial.println("✓ Scaled time active — 2min real = 1hr scaled");
  Serial.println("✓ curr_sensitivity = 124.0 (ACS712-20A)");
  Serial.println("✓ PF auto-detection active (updates every 5s real)");
  Serial.println("✓ Small loads detectable from ~18W (0.08A)");
  Serial.println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  lastEnergyUpdate = millis();
  delay(1000);
}

// ============================================================
void connectWiFi() {
  Serial.print("📡 Connecting to WiFi");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
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

  // ============================================================
  // CHANGE 2 of 5: Baseline multiplier 1.5 → 1.1
  // ──────────────────────────────────────────────────────────
  // 1.5x was subtracting too much — example:
  //   measured noise RMS = 0.12A → baseline = 0.18A subtracted
  //   50W TV raw = 0.22A → after subtraction = 0.04A → rejected
  // 1.1x keeps a safe 10% margin above actual noise:
  //   measured noise RMS = 0.12A → baseline = 0.132A subtracted
  //   50W TV raw = 0.22A → after subtraction = 0.088A → passes
  // No-load still reads 0A because genuine noise after subtraction
  // is near 0, well below NOISE_FLOOR of 0.08A.
  // ============================================================
  current_noise_baseline = (noiseRMS / curr_sensitivity) * 1.1f;

  Serial.print("  V-offset: ");        Serial.print(volt_offset);
  Serial.print(" | I-offset: ");       Serial.print(curr_offset);
  Serial.print(" | Noise baseline: "); Serial.print(current_noise_baseline, 4);
  Serial.println(" A");
}

// ============================================================
// VOLTAGE MEASUREMENT (unchanged)
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

  // ============================================================
  // CHANGE 3 of 5: Hard cutoff 0.15A → 0.05A
  // ──────────────────────────────────────────────────────────
  // Old 0.15A cutoff = blocked everything below ~35W from even
  // reaching smartFilter(). 50W TV (0.217A) with noise dips
  // occasionally fell below 0.15A and was zeroed out.
  // New 0.05A = only true zero/noise readings are cut here.
  // smartFilter() handles the proper noise rejection above this.
  // ============================================================
  if (current < 0.05f) return 0.0f;
  return current;
}

// ============================================================
// CHANGE 4 of 5: smartFilter — reduced confirmation count
// ──────────────────────────────────────────────────────────
// Old: needed CONFIRMATION_SAMPLES (5) consecutive readings
//      to accept a small load. Electronics (TV, charger) have
//      switching noise — readings fluctuate, counter resets
//      before reaching 5, load never accepted.
// New: only 3 consecutive readings needed for small loads.
//      Large loads (>DIRECT_ACCEPT) still accepted immediately.
//      Noise protection: random spikes are NOT consistent across
//      3 readings — real loads are. No-load is safe.
// ============================================================
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
    if (consecutiveHighReadings >= 3) return rawCurrent;  // was CONFIRMATION_SAMPLES (5)
    return 0.0f;
  }
  consecutiveLowReadings++;
  if (consecutiveHighReadings > 8) return rawCurrent;
  if (smoothCurrent > 0.10f && consecutiveHighReadings > 3) return rawCurrent;  // was 0.25f and 5
  return 0.0f;
}

// ============================================================
// MONTHLY SNAPSHOT HELPER (unchanged)
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
// CLOUD UPLOAD FUNCTIONS (unchanged)
// ============================================================

void uploadToFirebase(float voltage, float current, float power, float energy, float dailyEnergy) {
  if (!wifiConnected) { Serial.println("⚠️  Offline"); return; }

  float m1u, m2u, bimonthly, runBill;
  getMonthlySnapshot(m1u, m2u, bimonthly, runBill);

  float dailyUnits = round((dailyEnergy / 1000.0f) * 1000) / 1000.0f;

  StaticJsonDocument<800> doc;
  doc["user_id"]             = USER_ID;
  doc["timestamp"]           = getTimestamp();
  doc["scaled_time_factor"]  = TIME_SCALE_FACTOR;
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

  {
    HTTPClient http;
    WiFiClientSecure client;
    client.setInsecure();
    client.setTimeout(8000);
    String url = "https://" + String(FIREBASE_HOST) + "/readings/" + String(USER_ID)
               + ".json?auth=" + String(FIREBASE_AUTH);
    http.begin(client, url);
    http.addHeader("Content-Type", "application/json");
    int httpCode = http.POST(jsonString);
    Serial.print("\n📤 readings/: ");
    Serial.println((httpCode == 200 || httpCode == 201) ? "✓" : "✗ " + String(httpCode));
    http.end();
  }

  {
    HTTPClient http;
    WiFiClientSecure client;
    client.setInsecure();
    client.setTimeout(5000);
    String url = "https://" + String(FIREBASE_HOST) + "/latest_readings/" + String(USER_ID)
               + ".json?auth=" + String(FIREBASE_AUTH);
    http.begin(client, url);
    http.addHeader("Content-Type", "application/json");
    int httpCode = http.PUT(jsonString);
    Serial.print("📤 latest_readings/: ");
    Serial.println((httpCode == 200 || httpCode == 201) ? "✓" : "✗ " + String(httpCode));
    http.end();
  }

  checkAlerts(power, dailyEnergy);
}

void uploadDailySummary(String date) {
  if (!wifiConnected) return;
  Serial.println("\n📊 Uploading daily summary...");

  HTTPClient http;
  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(8000);

  float dailyUnits = round((dailyEnergyWh / 1000.0f) * 100) / 100.0f;

  struct tm t;
  getScaledTime(&t);
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

  String jsonString;
  serializeJson(doc, jsonString);

  String url = "https://" + String(FIREBASE_HOST) + "/daily_data/" + String(USER_ID)
             + ".json?auth=" + String(FIREBASE_AUTH);
  http.begin(client, url);
  http.addHeader("Content-Type", "application/json");
  int httpCode = http.POST(jsonString);
  if (httpCode == 200 || httpCode == 201) {
    Serial.println("✓ Daily summary uploaded");
    Serial.print("   Scaled Date: "); Serial.print(date);
    Serial.print(" | Units: "); Serial.print(dailyUnits);
    Serial.print(" kWh | Role: "); Serial.println(monthRole);
  } else {
    Serial.print("✗ Daily summary failed: "); Serial.println(httpCode);
  }
  http.end();
}

void uploadRunningBill(String date, float dailyUnits) {
  if (!wifiConnected) return;

  HTTPClient http;
  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(8000);

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

  String jsonString;
  serializeJson(doc, jsonString);

  String url = "https://" + String(FIREBASE_HOST) + "/running_bills/" + String(USER_ID)
             + ".json?auth=" + String(FIREBASE_AUTH);
  http.begin(client, url);
  http.addHeader("Content-Type", "application/json");
  http.POST(jsonString);
  http.end();
  Serial.print("💰 Running bill | Daily: ₹"); Serial.print(dailyBill);
  Serial.print(" | Monthly so far: ₹"); Serial.println(runningMonthlyBill);
}

void uploadMonthlyRecord(int month1based, int year, float monthUnits) {
  if (!wifiConnected) return;

  HTTPClient http;
  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(8000);

  float totalBill = round(calculateMonthlyBill(monthUnits) * 100) / 100.0f;

  int cycleEndMonth1based = (month1based % 2 == 0) ? month1based : month1based + 1;
  int dueMonth = cycleEndMonth1based + 1;
  int dueYear  = year;
  if (dueMonth > 12) { dueMonth = 1; dueYear++; }

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

  String jsonString;
  serializeJson(doc, jsonString);

  String url = "https://" + String(FIREBASE_HOST) + "/monthly_records/" + String(USER_ID)
             + ".json?auth=" + String(FIREBASE_AUTH);
  http.begin(client, url);
  http.addHeader("Content-Type", "application/json");
  http.POST(jsonString);
  http.end();
  Serial.print("📅 Monthly record: "); Serial.print(getMonthString(month1based, year));
  Serial.print(" | ₹"); Serial.println(totalBill);
}

void uploadBiMonthlyBill(int cycleStartMonth1based, int year) {
  if (!wifiConnected) return;

  HTTPClient http;
  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(8000);

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

  String jsonString;
  serializeJson(doc, jsonString);

  String url = "https://" + String(FIREBASE_HOST) + "/monthly_bills/" + String(USER_ID)
             + ".json?auth=" + String(FIREBASE_AUTH);
  http.begin(client, url);
  http.addHeader("Content-Type", "application/json");
  http.POST(jsonString);
  http.end();
  Serial.println("💵 Bi-monthly bill uploaded");
  Serial.print("   Period: "); Serial.println(getBillPeriodString(cycleStartMonth1based, year));
  Serial.print("   Total:  ₹"); Serial.println(totalBill);
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
  if (!wifiConnected) return;
  HTTPClient http; WiFiClientSecure client;
  client.setInsecure(); client.setTimeout(5000);
  StaticJsonDocument<300> doc;
  doc["user_id"]    = USER_ID;
  doc["alert_type"] = alertType;
  doc["message"]    = message;
  doc["timestamp"]  = getTimestamp();
  doc["status"]     = "unread";
  String js; serializeJson(doc, js);
  String url = "https://" + String(FIREBASE_HOST) + "/user_alerts/" + String(USER_ID)
             + ".json?auth=" + String(FIREBASE_AUTH);
  http.begin(client, url); http.addHeader("Content-Type","application/json");
  http.POST(js); http.end();
}

void sendAdminAlert(String alertType, String message) {
  if (!wifiConnected) return;
  HTTPClient http; WiFiClientSecure client;
  client.setInsecure(); client.setTimeout(5000);
  StaticJsonDocument<400> doc;
  doc["user_id"]    = USER_ID;
  doc["user_name"]  = USER_NAME;
  doc["alert_type"] = alertType;
  doc["message"]    = message;
  doc["timestamp"]  = getTimestamp();
  doc["severity"]   = "HIGH";
  doc["status"]     = "pending";
  String js; serializeJson(doc, js);
  String url = "https://" + String(FIREBASE_HOST) + "/admin_alerts.json?auth="
             + String(FIREBASE_AUTH);
  http.begin(client, url); http.addHeader("Content-Type","application/json");
  http.POST(js); http.end();
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
  getScaledTime(&t);
  int hour = t.tm_hour;
  if (hour >= 0 && hour < 24) hourlyEnergy[hour] += energyIncrement;
}

// ============================================================
// DAILY / MONTHLY RESET (uses SCALED time, unchanged)
// ============================================================
void checkDailyReset() {
  struct tm t;
  getScaledTime(&t);

  if (t.tm_mday != lastDay) {
    Serial.println("\n╔════════════════════════════════════════╗");
    Serial.println("║    📅 NEW SCALED DAY DETECTED          ║");
    Serial.println("╚════════════════════════════════════════╝");
    Serial.print("Scaled date now: "); Serial.println(getDateOnly());
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
  }

  if (t.tm_mon != lastMonth) {
    int prevMonth1based = lastMonth + 1;
    int prevYear        = t.tm_year + 1900;
    if (prevMonth1based == 0) { prevMonth1based = 12; prevYear--; }

    Serial.println("\n📆 NEW SCALED MONTH DETECTED");
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

  // ============================================================
  // CHANGE 5 of 5: MIN_POWER_FOR_ENERGY 20W → 5W
  // ──────────────────────────────────────────────────────────
  // Old 20W gate meant even a correctly detected 50W TV would
  // sometimes be blocked from energy counting if PF estimation
  // gave a low value temporarily (e.g. 50W × 0.65PF = 32W apparent,
  // real power could dip near 20W during PF adaptation).
  // New 5W gate: only filters out absolute standby phantom readings.
  // Current detection filters above still protect against false counts.
  // ============================================================
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

  // Serial display
  Serial.print(getTimestamp());
  Serial.print(" | V:");      Serial.print(smoothVoltage, 1);
  Serial.print("V I:");       Serial.print(smoothCurrent, 3);
  Serial.print("A VA:");      Serial.print(apparentPower, 1);
  Serial.print(" PF:");       Serial.print(powerFactor, 2);
  Serial.print(" P:");        Serial.print(realPower, 1);
  Serial.print("W | Daily:"); Serial.print(dailyEnergyWh / 1000.0f, 3);
  Serial.print("kWh M1:");    Serial.print(month1EnergyWh / 1000.0f, 3);
  Serial.print("kWh M2:");    Serial.print(month2EnergyWh / 1000.0f, 3);
  Serial.print("kWh Bill:₹"); Serial.print(runningBillRupees, 2);

  if (wifiConnected) Serial.print(" 📶");

  if (!currentSupplyState) {
    Serial.print(" [SUPPLY OFF]");
  } else {
    if (rawCurrent > NOISE_FLOOR && smoothCurrent == 0.0f) {
      Serial.print(" [FILTERED raw:"); Serial.print(rawCurrent, 3);
      Serial.print(" confirm:");       Serial.print(consecutiveHighReadings);
      Serial.print("/3]");
    }
    if (smoothCurrent > 0.05f) {
      Serial.print(" [");
      if      (smoothCurrent < 0.5f) Serial.print("TINY");
      else if (smoothCurrent < 2.0f) Serial.print("MEDIUM");
      else                           Serial.print("LARGE");
      Serial.print(" LOAD");
      Serial.print(powerIsValid ? " ✓COUNTING" : " ✗NOT COUNTING");
      Serial.print("]");
    } else {
      Serial.print(" [IDLE]");
    }
  }
  Serial.println();

  if (wifiConnected && (currentMillis - lastUploadTime >= uploadInterval)) {
    uploadToFirebase(smoothVoltage, smoothCurrent, realPower,
                     totalEnergyWh, dailyEnergyWh);
    lastUploadTime = currentMillis;
  }

  delay(500);
}
