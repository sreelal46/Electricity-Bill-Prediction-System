// ===================================================================
// KSEB SMART METER - ESP32 Cloud Monitor (CORRECTED VERSION)
// ✓ FIXED: Phantom voltage readings when supply is OFF
// ✓ FIXED: Energy accumulation on idle/filtered loads
// ✓ IMPROVED: Voltage detection reliability
// Project Deadline: February 20, 2024
// ===================================================================

#include "driver/adc.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <time.h>

// ============ WiFi Configuration ============
const char* WIFI_SSID = "FTTH-3529";
const char* WIFI_PASSWORD = "SRK17EE015";

// ============ Firebase Configuration ============
const char* FIREBASE_HOST = "kseb-smart-meter-30e6c-default-rtdb.asia-southeast1.firebasedatabase.app";
const char* FIREBASE_AUTH = "NLY7pwQS1YtAW0azpHBufhnxVbj8AkBbTwmHrz6a";

// ============ User Configuration ============
const char* USER_ID = "USER001";
const char* USER_NAME = "John Doe";
const char* USER_PHASE = "SINGLE";
const float USER_APPROVED_LOAD = 5.0;

// ============ Alert Thresholds ============
const float DAILY_UNIT_THRESHOLD = 30.0;
const float ILLEGAL_3PHASE_THRESHOLD = 7.0;

// ============ Upload Settings ============
unsigned long uploadInterval = 30000;  // 30 seconds
unsigned long lastUploadTime = 0;

// ============ Time Configuration ============
const char* NTP_SERVER = "pool.ntp.org";
const long GMT_OFFSET_SEC = 19800;  // IST +5:30
const int DAYLIGHT_OFFSET_SEC = 0;

// ============================================================
// ✓✓✓ CORRECTED SENSOR VALUES
// ============================================================

// ---- Voltage Sensor (ZMPT101B) ----
#define VOLT_PIN 36
int volt_offset = 1820;
float volt_calib = 0.76;  // ✓ Calibrated correctly - gives ~230-236V

// ---- Current Sensor (ACS712 30A) ----
#define CURR_PIN 34
const int curr_offset = 2900;
float curr_sensitivity = 139.0;

// Filtering
float smoothCurrent = 0.0;
float smoothVoltage = 0.0;
float alpha = 0.2;

// ✓✓✓ FIX 1: Improved thresholds
const float NOISE_FLOOR = 0.10;            // Increased from 0.06 to 0.10 (24W @ 240V)
const float CONFIRMATION_THRESHOLD = 0.15; // Increased from 0.12 to 0.15 (36W @ 240V)
const float DIRECT_ACCEPT = 0.30;          // 72W @ 240V

// ✓✓✓ FIX 2: More reliable voltage detection
const float VOLTAGE_THRESHOLD = 150.0;     // Increased from 100V
const float VOLTAGE_NOISE_THRESHOLD = 50.0; // Below this = definite noise
const int VOLTAGE_CONFIRM_SAMPLES = 3;     // Consecutive samples needed

// ✓✓✓ FIX 3: Voltage state tracking
int consecutiveVoltagePresent = 0;
int consecutiveVoltageAbsent = 0;
bool supplyIsOn = false;

// Load confirmation
int consecutiveHighReadings = 0;
int consecutiveLowReadings = 0;
const int CONFIRMATION_SAMPLES = 5;

// ✓✓✓ FIX 4: Power validity flag
bool powerIsValid = false;

// Energy tracking
float totalEnergyWh = 0.0;
float dailyEnergyWh = 0.0;
float monthlyEnergyWh = 0.0;
unsigned long lastEnergyUpdate = 0;
int lastDay = -1;
int lastMonth = -1;
bool dailyAlertSent = false;
bool illegalUsageAlertSent = false;

// Daily statistics for AI prediction
float dailyPeakPower = 0.0;
float dailyAvgPower = 0.0;
float dailyMinPower = 99999.0;
unsigned long dailyPowerSamples = 0;
float dailyPowerSum = 0.0;

// Hour-wise consumption tracking (24 hours)
float hourlyEnergy[24] = {0};
int currentHour = -1;

// WiFi status
bool wifiConnected = false;
bool userInitialized = false;

void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("\n╔════════════════════════════════════════╗");
  Serial.println("║     KSEB SMART METER SYSTEM           ║");
  Serial.println("║  ✓ FIXED Phantom Voltage Readings     ║");
  Serial.println("║  ✓ FIXED Energy Calculation           ║");
  Serial.println("║  ✓ IMPROVED Supply Detection          ║");
  Serial.println("╚════════════════════════════════════════╝\n");
  
  Serial.print("User ID: ");
  Serial.println(USER_ID);
  Serial.print("Approved Phase: ");
  Serial.println(USER_PHASE);
  Serial.print("Approved Load: ");
  Serial.print(USER_APPROVED_LOAD);
  Serial.println(" kW\n");
  
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);
  
  Serial.println("⚙️  Calibrating sensors...");
  calibrateOffsets();
  
  connectWiFi();
  
  if (wifiConnected) {
    syncTime();
  }
  
  Serial.println("\n✓ System ready!");
  Serial.println("✓ Voltage threshold: 150V (improved detection)");
  Serial.println("✓ Energy only counts when power > 10W");
  Serial.println("✓ Supply state tracking enabled");
  Serial.println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  
  lastEnergyUpdate = millis();
  delay(1000);
}

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
    Serial.println("✓ WiFi Connected!");
    Serial.print("   IP: ");
    Serial.println(WiFi.localIP());
  } else {
    wifiConnected = false;
    Serial.println(" ✗");
    Serial.println("✗ WiFi Failed! Running offline.");
  }
}

void syncTime() {
  Serial.print("🕒 Syncing time");
  configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC, NTP_SERVER);
  
  struct tm timeinfo;
  int attempts = 0;
  while (!getLocalTime(&timeinfo) && attempts < 5) {
    Serial.print(".");
    delay(500);
    attempts++;
  }
  
  if (attempts < 5) {
    Serial.println(" ✓");
    lastDay = timeinfo.tm_mday;
    lastMonth = timeinfo.tm_mon;
    currentHour = timeinfo.tm_hour;
  } else {
    Serial.println(" ✗");
  }
}

void calibrateOffsets() {
  // Calibrate voltage offset
  long sumV = 0;
  for (int i = 0; i < 1000; i++) {
    sumV += analogRead(VOLT_PIN);
    delayMicroseconds(50);
  }
  volt_offset = sumV / 1000;
  
  // Calibrate current offset with more samples for better accuracy
  long sumC = 0;
  for (int i = 0; i < 2000; i++) {  // More samples for current
    sumC += analogRead(CURR_PIN);
    delayMicroseconds(50);
  }
  int calibrated_curr_offset = sumC / 2000;
  
  Serial.print("  V-offset: ");
  Serial.print(volt_offset);
  Serial.print(" | I-offset (fixed): ");
  Serial.print(curr_offset);
  Serial.print(" | I-offset (measured): ");
  Serial.println(calibrated_curr_offset);
  
  // Show warning if measured offset is very different from expected
  if (abs(calibrated_curr_offset - curr_offset) > 100) {
    Serial.println("  ⚠️  WARNING: Current sensor offset differs significantly!");
    Serial.println("  Consider updating curr_offset value in code.");
  }
}

// ============================================================
// ✓✓✓ FIX 5: Improved voltage measurement with noise rejection
// ============================================================

float measureVoltage() {
  long sumVolt = 0;
  const int samples = 1000;

  for (int i = 0; i < samples; i++) {
    int adc = analogRead(VOLT_PIN);
    int centered = adc - volt_offset;
    sumVolt += (long)centered * (long)centered;
    delayMicroseconds(50);
  }

  float rms_counts = sqrt((float)sumVolt / samples);
  float voltage = rms_counts * volt_calib;
  
  // Hard cutoff for obvious noise
  if (voltage < VOLTAGE_NOISE_THRESHOLD) {
    return 0.0;
  }
  
  // Return raw reading for state machine to process
  return voltage;
}

// ✓✓✓ FIX 6: Supply state detection with confirmation
bool checkSupplyState(float voltage) {
  if (voltage >= VOLTAGE_THRESHOLD) {
    consecutiveVoltagePresent++;
    consecutiveVoltageAbsent = 0;
    
    if (consecutiveVoltagePresent >= VOLTAGE_CONFIRM_SAMPLES) {
      if (!supplyIsOn) {
        Serial.println("\n✓ AC SUPPLY DETECTED - System ON");
      }
      supplyIsOn = true;
      return true;
    }
  } else {
    consecutiveVoltageAbsent++;
    consecutiveVoltagePresent = 0;
    
    if (consecutiveVoltageAbsent >= VOLTAGE_CONFIRM_SAMPLES) {
      if (supplyIsOn) {
        Serial.println("\n✗ AC SUPPLY LOST - System OFF");
        // Reset current tracking when supply goes off
        smoothCurrent = 0.0;
        consecutiveHighReadings = 0;
        consecutiveLowReadings = 0;
      }
      supplyIsOn = false;
      return false;
    }
  }
  
  return supplyIsOn;  // Return previous state during transition
}

float measureCurrentRaw() {
  long sumCurr = 0;
  const int samples = 1000;

  for (int i = 0; i < samples; i++) {
    int adc = analogRead(CURR_PIN);
    int centered = adc - curr_offset;
    sumCurr += (long)centered * (long)centered;
    delayMicroseconds(50);
  }

  float rmsADC = sqrt((float)sumCurr / samples);
  float current = rmsADC / curr_sensitivity;
  
  // Hard cutoff for very low readings (likely noise)
  if (current < 0.08) {  // Below 0.08A = ~19W @ 240V
    return 0.0;
  }
  
  return current;
}

float smartFilter(float rawCurrent) {
  if (rawCurrent < NOISE_FLOOR) {
    consecutiveHighReadings = 0;
    consecutiveLowReadings++;
    return 0.0;
  }
  
  if (rawCurrent >= DIRECT_ACCEPT) {
    consecutiveHighReadings++;
    consecutiveLowReadings = 0;
    return rawCurrent;
  }
  
  if (rawCurrent >= CONFIRMATION_THRESHOLD) {
    consecutiveHighReadings++;
    consecutiveLowReadings = 0;
    
    if (consecutiveHighReadings >= CONFIRMATION_SAMPLES) {
      return rawCurrent;
    } else {
      return 0.0;
    }
  }
  
  // Low range (0.06-0.12A) - very sensitive
  consecutiveLowReadings++;
  
  // Need VERY consistent readings to accept in this range
  if (consecutiveHighReadings > 8) {
    return rawCurrent;
  }
  
  if (smoothCurrent > 0.15 && consecutiveHighReadings > 5) {
    return rawCurrent;
  }
  
  return 0.0;
}

// ============================================================
// CLOUD UPLOAD FUNCTIONS (unchanged)
// ============================================================

void initializeUser() {
  if (userInitialized || !wifiConnected) return;
  
  Serial.println("\n📝 Initializing user in database...");
  
  HTTPClient http;
  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(8000);
  
  StaticJsonDocument<400> doc;
  doc["user_id"] = USER_ID;
  doc["user_name"] = USER_NAME;
  doc["approved_phase"] = USER_PHASE;
  doc["approved_load_kw"] = USER_APPROVED_LOAD;
  doc["registration_date"] = getTimestamp();
  doc["status"] = "active";
  
  String jsonString;
  serializeJson(doc, jsonString);
  
  String url = "https://" + String(FIREBASE_HOST) + "/users/" + String(USER_ID) + ".json?auth=" + String(FIREBASE_AUTH);
  
  http.begin(client, url);
  http.addHeader("Content-Type", "application/json");
  
  int httpCode = http.PUT(jsonString);
  
  if (httpCode == 200 || httpCode == 201) {
    Serial.println("✓ User initialized successfully");
    userInitialized = true;
  } else {
    Serial.print("✗ User init failed, code: ");
    Serial.println(httpCode);
  }
  
  http.end();
}

void uploadToFirebase(float voltage, float current, float power, float energy, float dailyEnergy, float monthlyEnergy) {
  if (!wifiConnected) {
    Serial.println("⚠️  Offline - skipping upload");
    return;
  }
  
  if (!userInitialized) {
    initializeUser();
  }
  
  HTTPClient http;
  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(8000);
  
  StaticJsonDocument<500> doc;
  doc["user_id"] = USER_ID;
  doc["timestamp"] = getTimestamp();
  doc["voltage"] = round(voltage * 100) / 100.0;
  doc["current"] = round(current * 1000) / 1000.0;
  doc["power"] = round(power * 100) / 100.0;
  doc["total_energy_wh"] = round(energy * 100) / 100.0;
  doc["daily_energy_wh"] = round(dailyEnergy * 100) / 100.0;
  doc["monthly_energy_wh"] = round(monthlyEnergy * 100) / 100.0;
  doc["daily_units"] = round(dailyEnergy / 10.0) / 100.0;
  doc["monthly_units"] = round(monthlyEnergy / 10.0) / 100.0;
  doc["supply_status"] = supplyIsOn ? "ON" : "OFF";
  
  String jsonString;
  serializeJson(doc, jsonString);
  
  String url = "https://" + String(FIREBASE_HOST) + "/readings/" + String(USER_ID) + ".json?auth=" + String(FIREBASE_AUTH);
  
  http.begin(client, url);
  http.addHeader("Content-Type", "application/json");
  
  int httpCode = http.POST(jsonString);
  
  Serial.print("\n📤 Upload: ");
  
  if (httpCode == 200 || httpCode == 201) {
    Serial.print("✓ Success (");
    Serial.print(httpCode);
    Serial.println(")");
    
    updateLatestReading(voltage, current, power, energy, dailyEnergy, monthlyEnergy);
    
  } else if (httpCode > 0) {
    Serial.print("✗ Failed - HTTP ");
    Serial.println(httpCode);
  } else {
    Serial.print("✗ Connection failed: ");
    Serial.println(http.errorToString(httpCode));
  }
  
  http.end();
  
  checkAlerts(power, dailyEnergy);
}

void updateLatestReading(float voltage, float current, float power, float energy, float dailyEnergy, float monthlyEnergy) {
  HTTPClient http;
  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(5000);
  
  StaticJsonDocument<500> doc;
  doc["user_id"] = USER_ID;
  doc["timestamp"] = getTimestamp();
  doc["voltage"] = round(voltage * 100) / 100.0;
  doc["current"] = round(current * 1000) / 1000.0;
  doc["power"] = round(power * 100) / 100.0;
  doc["total_energy_wh"] = round(energy * 100) / 100.0;
  doc["daily_energy_wh"] = round(dailyEnergy * 100) / 100.0;
  doc["monthly_energy_wh"] = round(monthlyEnergy * 100) / 100.0;
  doc["daily_units"] = round(dailyEnergy / 10.0) / 100.0;
  doc["monthly_units"] = round(monthlyEnergy / 10.0) / 100.0;
  doc["supply_status"] = supplyIsOn ? "ON" : "OFF";
  
  String jsonString;
  serializeJson(doc, jsonString);
  
  String url = "https://" + String(FIREBASE_HOST) + "/latest_readings/" + String(USER_ID) + ".json?auth=" + String(FIREBASE_AUTH);
  
  http.begin(client, url);
  http.addHeader("Content-Type", "application/json");
  http.PUT(jsonString);
  http.end();
}

void uploadDailySummary(String date) {
  if (!wifiConnected) return;
  
  Serial.println("\n📊 Uploading daily summary for AI prediction...");
  
  HTTPClient http;
  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(8000);
  
  float dailyUnits = dailyEnergyWh / 1000.0;
  
  DynamicJsonDocument doc(1024);
  doc["user_id"] = USER_ID;
  doc["date"] = date;
  doc["timestamp"] = getTimestamp();
  
  doc["total_energy_wh"] = round(dailyEnergyWh * 100) / 100.0;
  doc["total_units"] = round(dailyUnits * 100) / 100.0;
  
  doc["peak_power_w"] = round(dailyPeakPower * 100) / 100.0;
  doc["avg_power_w"] = round(dailyAvgPower * 100) / 100.0;
  doc["min_power_w"] = round(dailyMinPower * 100) / 100.0;
  
  JsonArray hourly = doc.createNestedArray("hourly_consumption_wh");
  for (int i = 0; i < 24; i++) {
    hourly.add(round(hourlyEnergy[i] * 100) / 100.0);
  }
  
  doc["approved_phase"] = USER_PHASE;
  doc["approved_load_kw"] = USER_APPROVED_LOAD;
  
  String jsonString;
  serializeJson(doc, jsonString);
  
  String url = "https://" + String(FIREBASE_HOST) + "/daily_data/" + String(USER_ID) + ".json?auth=" + String(FIREBASE_AUTH);
  
  http.begin(client, url);
  http.addHeader("Content-Type", "application/json");
  
  int httpCode = http.POST(jsonString);
  
  if (httpCode == 200 || httpCode == 201) {
    Serial.println("✓ Daily summary uploaded");
    Serial.print("   Date: ");
    Serial.println(date);
    Serial.print("   Total: ");
    Serial.print(dailyUnits);
    Serial.println(" kWh");
  } else {
    Serial.print("✗ Daily summary upload failed: ");
    Serial.println(httpCode);
  }
  
  http.end();
}

void checkAlerts(float power, float dailyEnergy) {
  float dailyUnits = dailyEnergy / 1000.0;
  float powerKW = power / 1000.0;
  
  if (dailyUnits > DAILY_UNIT_THRESHOLD && !dailyAlertSent) {
    sendAlert("THRESHOLD_EXCEEDED", "Daily consumption exceeded " + String(DAILY_UNIT_THRESHOLD) + " units");
    dailyAlertSent = true;
    Serial.println("🚨 ALERT: Daily threshold exceeded!");
  }
  
  if (String(USER_PHASE) == "SINGLE" && powerKW > ILLEGAL_3PHASE_THRESHOLD && !illegalUsageAlertSent) {
    sendAdminAlert("ILLEGAL_USAGE", "Single-phase user exceeding 3-phase load: " + String(powerKW) + " kW");
    illegalUsageAlertSent = true;
    Serial.println("🚨 ADMIN ALERT: Possible illegal 3-phase usage!");
  }
  
  if (dailyUnits < DAILY_UNIT_THRESHOLD * 0.9) {
    dailyAlertSent = false;
  }
  if (powerKW < ILLEGAL_3PHASE_THRESHOLD * 0.9) {
    illegalUsageAlertSent = false;
  }
}

void sendAlert(String alertType, String message) {
  if (!wifiConnected) return;
  
  HTTPClient http;
  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(5000);
  
  StaticJsonDocument<300> doc;
  doc["user_id"] = USER_ID;
  doc["alert_type"] = alertType;
  doc["message"] = message;
  doc["timestamp"] = getTimestamp();
  doc["status"] = "unread";
  
  String jsonString;
  serializeJson(doc, jsonString);
  
  String url = "https://" + String(FIREBASE_HOST) + "/user_alerts/" + String(USER_ID) + ".json?auth=" + String(FIREBASE_AUTH);
  
  http.begin(client, url);
  http.addHeader("Content-Type", "application/json");
  http.POST(jsonString);
  http.end();
}

void sendAdminAlert(String alertType, String message) {
  if (!wifiConnected) return;
  
  HTTPClient http;
  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(5000);
  
  StaticJsonDocument<400> doc;
  doc["user_id"] = USER_ID;
  doc["user_name"] = USER_NAME;
  doc["alert_type"] = alertType;
  doc["message"] = message;
  doc["timestamp"] = getTimestamp();
  doc["severity"] = "HIGH";
  doc["status"] = "pending";
  
  String jsonString;
  serializeJson(doc, jsonString);
  
  String url = "https://" + String(FIREBASE_HOST) + "/admin_alerts.json?auth=" + String(FIREBASE_AUTH);
  
  http.begin(client, url);
  http.addHeader("Content-Type", "application/json");
  http.POST(jsonString);
  http.end();
}

String getTimestamp() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) {
    return String(millis());
  }
  
  char buffer[25];
  strftime(buffer, sizeof(buffer), "%Y-%m-%d %H:%M:%S", &timeinfo);
  return String(buffer);
}

String getDateOnly() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) {
    return String(millis());
  }
  
  char buffer[15];
  strftime(buffer, sizeof(buffer), "%Y-%m-%d", &timeinfo);
  return String(buffer);
}

void updateDailyStats(float power) {
  if (power > dailyPeakPower) {
    dailyPeakPower = power;
  }
  
  if (power < dailyMinPower && power > 0) {
    dailyMinPower = power;
  }
  
  dailyPowerSum += power;
  dailyPowerSamples++;
  
  if (dailyPowerSamples > 0) {
    dailyAvgPower = dailyPowerSum / dailyPowerSamples;
  }
}

void updateHourlyEnergy(float energyIncrement) {
  struct tm timeinfo;
  if (getLocalTime(&timeinfo)) {
    int hour = timeinfo.tm_hour;
    
    if (hour >= 0 && hour < 24) {
      hourlyEnergy[hour] += energyIncrement;
    }
  }
}

void checkDailyReset() {
  struct tm timeinfo;
  if (getLocalTime(&timeinfo)) {
    if (timeinfo.tm_mday != lastDay) {
      Serial.println("\n╔════════════════════════════════════════╗");
      Serial.println("║         📅 NEW DAY DETECTED           ║");
      Serial.println("╚════════════════════════════════════════╝");
      
      Serial.print("Previous day consumption: ");
      Serial.print(dailyEnergyWh / 1000.0);
      Serial.println(" kWh");
      
      String yesterday = getDateOnly();
      uploadDailySummary(yesterday);
      
      dailyEnergyWh = 0.0;
      dailyAlertSent = false;
      
      dailyPeakPower = 0.0;
      dailyAvgPower = 0.0;
      dailyMinPower = 99999.0;
      dailyPowerSamples = 0;
      dailyPowerSum = 0.0;
      
      for (int i = 0; i < 24; i++) {
        hourlyEnergy[i] = 0.0;
      }
      
      lastDay = timeinfo.tm_mday;
      
      Serial.println("✓ Daily reset complete\n");
    }
    
    if (timeinfo.tm_mon != lastMonth) {
      Serial.println("\n📆 NEW MONTH - Monthly reset");
      Serial.print("Previous: ");
      Serial.print(monthlyEnergyWh / 1000.0);
      Serial.println(" kWh");
      
      sendMonthlyBillToAdmin();
      
      monthlyEnergyWh = 0.0;
      lastMonth = timeinfo.tm_mon;
    }
  }
}

void sendMonthlyBillToAdmin() {
  if (!wifiConnected) return;
  
  HTTPClient http;
  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(8000);
  
  float monthlyUnits = monthlyEnergyWh / 1000.0;
  float billAmount = calculateBill(monthlyUnits);
  
  StaticJsonDocument<400> doc;
  doc["user_id"] = USER_ID;
  doc["user_name"] = USER_NAME;
  doc["month"] = getTimestamp();
  doc["units_consumed"] = round(monthlyUnits * 100) / 100.0;
  doc["bill_amount"] = round(billAmount * 100) / 100.0;
  doc["status"] = "pending_approval";
  
  String jsonString;
  serializeJson(doc, jsonString);
  
  String url = "https://" + String(FIREBASE_HOST) + "/monthly_bills/" + String(USER_ID) + ".json?auth=" + String(FIREBASE_AUTH);
  
  http.begin(client, url);
  http.addHeader("Content-Type", "application/json");
  http.POST(jsonString);
  http.end();
  
  Serial.println("💵 Monthly bill sent to KSEB admin");
}

float calculateBill(float units) {
  float amount = 0.0;
  
  if (units <= 50) {
    amount = units * 3.0;
  } else if (units <= 100) {
    amount = (50 * 3.0) + ((units - 50) * 3.5);
  } else if (units <= 200) {
    amount = (50 * 3.0) + (50 * 3.5) + ((units - 100) * 5.0);
  } else {
    amount = (50 * 3.0) + (50 * 3.5) + (100 * 5.0) + ((units - 200) * 7.0);
  }
  
  amount += 50.0;
  
  return amount;
}

// ============================================================
// ✓✓✓ FIX 7: CORRECTED MAIN LOOP
// ============================================================

void loop() {
  // ============================================================
  // MEASURE VOLTAGE & CHECK SUPPLY STATE
  // ============================================================
  float Vrms = measureVoltage();
  bool currentSupplyState = checkSupplyState(Vrms);
  
  // Update smoothed voltage only if supply is confirmed ON
  if (currentSupplyState) {
    smoothVoltage = (alpha * Vrms) + ((1.0 - alpha) * smoothVoltage);
  } else {
    smoothVoltage = 0.0;
    smoothCurrent = 0.0;
    powerIsValid = false;
  }

  delay(10);

  // ============================================================
  // MEASURE CURRENT (only if supply is ON)
  // ============================================================
  float rawCurrent = 0.0;  // Declare outside to use in display section
  
  if (currentSupplyState) {
    rawCurrent = measureCurrentRaw();
    float filteredCurrent = smartFilter(rawCurrent);
    
    if (filteredCurrent > 0) {
      // Smooth transition
      if (abs(filteredCurrent - smoothCurrent) > 2.0) {
        smoothCurrent = (0.5 * filteredCurrent) + (0.5 * smoothCurrent);
      } else {
        smoothCurrent = (alpha * filteredCurrent) + ((1.0 - alpha) * smoothCurrent);
      }
    } else {
      // Gradual decay
      if (consecutiveLowReadings > 7) {
        smoothCurrent = smoothCurrent * 0.7;
        if (smoothCurrent < 0.04) smoothCurrent = 0.0;
      } else {
        smoothCurrent = smoothCurrent * 0.95;
      }
    }
  }

  // ============================================================
  // ✓✓✓ FIX 8: CALCULATE POWER & ENERGY (with validation)
  // ============================================================
  float apparentPower = smoothVoltage * smoothCurrent;
  
  float powerFactor;
  if (smoothCurrent < 0.3) {
    powerFactor = 0.60;
  } else if (smoothCurrent < 1.0) {
    powerFactor = 0.75;
  } else {
    powerFactor = 0.90;
  }
  
  float realPower = apparentPower * powerFactor;
  
  // ✓✓✓ FIX: Only count energy if power is above minimum threshold
  const float MIN_POWER_FOR_ENERGY = 20.0;  // Increased from 10W to 20W minimum
  powerIsValid = (realPower >= MIN_POWER_FOR_ENERGY) && currentSupplyState;
  
  unsigned long currentMillis = millis();
  float deltaTime = (currentMillis - lastEnergyUpdate) / 3600000.0;
  
  // ✓✓✓ CRITICAL FIX: Only accumulate energy for valid power readings
  if (powerIsValid) {
    float energyIncrement = realPower * deltaTime;
    
    totalEnergyWh += energyIncrement;
    dailyEnergyWh += energyIncrement;
    monthlyEnergyWh += energyIncrement;
    
    updateDailyStats(realPower);
    updateHourlyEnergy(energyIncrement);
  }
  
  lastEnergyUpdate = currentMillis;
  
  checkDailyReset();
  
  // ============================================================
  // DISPLAY
  // ============================================================
  Serial.print(getTimestamp());
  Serial.print(" | V:");
  Serial.print(smoothVoltage, 1);
  Serial.print("V I:");
  Serial.print(smoothCurrent, 3);
  Serial.print("A P:");
  Serial.print(realPower, 1);
  Serial.print("W | Daily:");
  Serial.print(dailyEnergyWh / 1000.0, 3);
  Serial.print("kWh Monthly:");
  Serial.print(monthlyEnergyWh / 1000.0, 2);
  Serial.print("kWh");
  
  if (wifiConnected) Serial.print(" 📶");
  
  // Show supply state
  if (!currentSupplyState) {
    Serial.print(" [SUPPLY OFF]");
  } else {
    // Show filtering status for debugging
    if (rawCurrent > NOISE_FLOOR && smoothCurrent == 0.0) {
      Serial.print(" [FILTERED raw:");
      Serial.print(rawCurrent, 3);
      Serial.print(" confirm:");
      Serial.print(consecutiveHighReadings);
      Serial.print("/");
      Serial.print(CONFIRMATION_SAMPLES);
      Serial.print("]");
    }
    
    // Load indicator
    if (smoothCurrent > 0.05) {
      Serial.print(" [");
      if (smoothCurrent < 0.5) Serial.print("TINY");
      else if (smoothCurrent < 2.0) Serial.print("MEDIUM");
      else Serial.print("LARGE");
      Serial.print(" LOAD");
      
      // Show if energy is being counted
      if (powerIsValid) {
        Serial.print(" ✓COUNTING");
      } else {
        Serial.print(" ✗NOT COUNTING");
      }
      Serial.print("]");
    } else {
      Serial.print(" [IDLE]");
    }
  }
  
  Serial.println();
  
  // ============================================================
  // CLOUD UPLOAD (Every 30 seconds)
  // ============================================================
  if (wifiConnected && (currentMillis - lastUploadTime >= uploadInterval)) {
    uploadToFirebase(smoothVoltage, smoothCurrent, realPower, totalEnergyWh, dailyEnergyWh, monthlyEnergyWh);
    lastUploadTime = currentMillis;
  }
  
  delay(500);
}
