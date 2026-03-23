// ===================================================================
// KSEB SMART METER — Monthly Records Upload Module
// 
// PURPOSE:
//   This file handles uploading individual monthly records to Firebase.
//   Each month is stored as a SEPARATE entry under /monthly_records/USER001/
//   This is DIFFERENT from the bi-monthly bill (which combines 2 months).
//
// FIREBASE STRUCTURE CREATED:
//
//   monthly_records/
//     USER001/
//       -record1: {
//           user_id         : "USER001"
//           month           : "JAN 2024"
//           bill_period_from: "2024-01-01"
//           bill_period_to  : "2024-01-31"
//           month_units     : 140.00          ← kWh that month only
//           total_bill      : 620.00          ← bill for that month only
//           due_date        : "2024-03-15"    ← shared with bi-monthly bill
//           payment_status  : "unpaid"
//           timestamp       : "2024-02-01 00:00:05"
//        }
//       -record2: {
//           user_id         : "USER001"
//           month           : "FEB 2024"
//           bill_period_from: "2024-02-01"
//           bill_period_to  : "2024-02-29"
//           month_units     : 160.00
//           total_bill      : 730.00
//           due_date        : "2024-03-15"
//           payment_status  : "unpaid"
//           timestamp       : "2024-02-01 00:00:06"
//        }
//       -record3: {                           ← next cycle starts
//           month           : "MAR 2024"
//           bill_period_from: "2024-03-01"
//           ...
//        }
//
// HOW IT WORKS:
//   - Called automatically at end of every bi-monthly cycle
//   - Both months uploaded separately in one go
//   - due_date is same for both (15th of month after cycle ends)
//   - payment_status starts as "unpaid" — admin updates it after payment
//
// NOTE:
//   This function is already included in kseb_smart_meter.ino
//   This file is just for reference / documentation
// ===================================================================

// Required includes (already in main file)
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// ============================================================
// uploadMonthlyRecord()
//
// Call this for EACH month at end of bi-monthly cycle.
// monthIdx  → 0=JAN, 1=FEB, 2=MAR ... 11=DEC  (tm_mon value)
// year      → full year e.g. 2024
// monthUnits → kWh consumed that month
// dueDateStr → due date string e.g. "2024-03-15"
// ============================================================

void uploadMonthlyRecord(int monthIdx, int year, float monthUnits, String dueDateStr) {
  if (!wifiConnected) return;
  Serial.println("\n📋 Uploading monthly record...");

  HTTPClient http; WiFiClientSecure client;
  client.setInsecure(); client.setTimeout(8000);

  // Build period from → 1st of the month
  char periodFrom[15], periodTo[15];
  snprintf(periodFrom, sizeof(periodFrom), "%04d-%02d-01", year, monthIdx + 1);

  // Build period to → last day of the month
  int lastDay = 30;
  if (monthIdx == 0 || monthIdx == 2 || monthIdx == 4 ||
      monthIdx == 6 || monthIdx == 7 || monthIdx == 9 || monthIdx == 11) lastDay = 31;
  else if (monthIdx == 1) lastDay = 28;
  snprintf(periodTo, sizeof(periodTo), "%04d-%02d-%02d", year, monthIdx + 1, lastDay);

  // Calculate bill for this month's units individually
  float monthBill = calculateBiMonthlyBill(monthUnits);

  const char* monthNames[] = {"JAN","FEB","MAR","APR","MAY","JUN",
                               "JUL","AUG","SEP","OCT","NOV","DEC"};

  StaticJsonDocument<400> doc;
  doc["user_id"]          = USER_ID;
  doc["month"]            = String(monthNames[monthIdx]) + " " + String(year);
  doc["bill_period_from"] = String(periodFrom);
  doc["bill_period_to"]   = String(periodTo);
  doc["month_units"]      = round(monthUnits * 100) / 100.0;
  doc["total_bill"]       = round(monthBill * 100) / 100.0;
  doc["due_date"]         = dueDateStr;
  doc["payment_status"]   = "unpaid";
  doc["timestamp"]        = getTimestamp();

  String js; serializeJson(doc, js);

  // POST creates a new unique entry each time (not overwrite)
  String url = "https://" + String(FIREBASE_HOST) +
               "/monthly_records/" + String(USER_ID) +
               ".json?auth=" + String(FIREBASE_AUTH);

  http.begin(client, url);
  http.addHeader("Content-Type", "application/json");
  int httpCode = http.POST(js);

  if (httpCode == 200 || httpCode == 201) {
    Serial.print("✓ Monthly record | ");
    Serial.print(monthNames[monthIdx]); Serial.print(" "); Serial.print(year);
    Serial.print(" | Units: "); Serial.print(monthUnits);
    Serial.print(" | Bill: ₹"); Serial.println(monthBill);
  } else {
    Serial.print("✗ Monthly record failed: "); Serial.println(httpCode);
  }
  http.end();
}

// ============================================================
// HOW THIS IS CALLED in sendBiMonthlyBillToAdmin():
//
//   // At end of JAN-FEB cycle:
//   uploadMonthlyRecord(0, 2024, 140.0, "2024-03-15");  // JAN
//   uploadMonthlyRecord(1, 2024, 160.0, "2024-03-15");  // FEB
//
//   // At end of MAR-APR cycle:
//   uploadMonthlyRecord(2, 2024, 155.0, "2024-05-15");  // MAR
//   uploadMonthlyRecord(3, 2024, 170.0, "2024-05-15");  // APR
// ============================================================
