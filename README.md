# ⚡ Electricity Bill Prediction System

A smart electricity consumption prediction system using Machine Learning to forecast daily, weekly, and monthly electricity usage and bills for Kerala, India.

---

## 📋 Table of Contents

- [Features](#features)
- [System Architecture](#system-architecture)
- [Tech Stack](#tech-stack)
- [Installation](#installation)
- [API Endpoints](#api-endpoints)
- [How It Works](#how-it-works)
- [Data Requirements](#data-requirements)
- [Prediction Types](#prediction-types)
- [Confidence Levels](#confidence-levels)
- [Kerala Bill Calculation](#kerala-bill-calculation)
- [Usage Examples](#usage-examples)
- [Troubleshooting](#troubleshooting)

---

## ✨ Features

- 🔮 **3 Prediction Types**: Daily, Weekly (7 days), and Monthly (30 days)
- 📊 **Smart Confidence System**: Automatic quality assessment based on available data
- 🚨 **Anomaly Detection**: Identifies unusual consumption patterns
- 💰 **Bill Estimation**: Calculates predicted bills using Kerala electricity rates
- 📈 **Flexible Data Requirements**: Works with as little as 3 days of data
- 🎯 **Accurate Forecasting**: Uses Random Forest ML model with rolling averages

---

## 🏗️ System Architecture

```
┌─────────────┐      ┌──────────────┐      ┌─────────────┐
│   Frontend  │ ───> │   Node.js    │ ───> │   Flask     │
│   (Client)  │      │  Controller  │      │  ML Server  │
└─────────────┘      └──────────────┘      └─────────────┘
                            │                      │
                            ↓                      ↓
                     ┌──────────────┐      ┌─────────────┐
                     │   Firebase   │      │  ML Models  │
                     │   Database   │      │  (pkl files)│
                     └──────────────┘      └─────────────┘
```

---

## 🛠️ Tech Stack

### Backend (Flask - Python)

- **Flask**: Web framework
- **scikit-learn**: Machine Learning
- **pandas**: Data processing
- **numpy**: Numerical computations
- **joblib**: Model serialization

### Controller (Node.js)

- **Express.js**: Web framework
- **Firebase Admin SDK**: Database
- **Axios**: HTTP client

### Machine Learning Models

- **Random Forest Regressor**: Main prediction model
- **Isolation Forest**: Anomaly detection

---

## 📦 Installation

### Prerequisites

- Python 3.8+
- Node.js 14+
- Firebase project setup

### 1. Clone Repository

```bash
git clone <your-repo-url>
cd electricity-prediction
```

### 2. Setup Python Environment

```bash
# Create virtual environment
python -m venv venv

# Activate virtual environment
# On Windows:
venv\Scripts\activate
# On macOS/Linux:
source venv/bin/activate

# Install dependencies
pip install flask joblib numpy pandas scikit-learn --break-system-packages
```

### 3. Setup Node.js

```bash
# Install dependencies
npm install express firebase-admin axios
```

### 4. Add ML Models

Place your trained models in the `models/` directory:

```
models/
├── rf_model.pkl          # Random Forest model
└── anomaly_model.pkl     # Isolation Forest model
```

### 5. Configure Firebase

Create `config/firebase.js`:

```javascript
import admin from "firebase-admin";
import serviceAccount from "./serviceAccountKey.json";

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://your-project.firebaseio.com",
});

const db = admin.database();
export default db;
```

---

## 🚀 Running the Application

### Start Flask Server (Port 5000)

```bash
python app.py
```

### Start Node.js Server (Your Port)

```bash
node server.js  # or npm start
```

---

## 📡 API Endpoints

### 1. Daily Prediction

```
GET /api/predict/daily/:userId
```

### 2. Weekly Prediction

```
GET /api/predict/weekly/:userId
```

### 3. Monthly Prediction

```
GET /api/predict/monthly/:userId
```

---

## ⚙️ How It Works

### 1. **Data Collection**

The system fetches historical electricity consumption data from Firebase:

```javascript
{
  "date": "2025-02-10",
  "total_units": 12.5
}
```

### 2. **Feature Engineering**

The Flask server creates these features:

- `day_of_week`: 0-6 (Monday-Sunday)
- `day_of_month`: 1-31
- `is_weekend`: 0 or 1
- `avg_last_3`: 3-day rolling average
- `avg_last_7`: 7-day rolling average
- `avg_last_14`: 14-day rolling average
- `avg_last_30`: 30-day rolling average
- `trend`: Short-term trend (3-day vs 7-day avg)
- `long_trend`: Long-term trend (7-day vs 14-day avg)

### 3. **Prediction**

- Random Forest model predicts next day's consumption
- For weekly/monthly: Iteratively predicts each day
- Updates rolling averages after each prediction

### 4. **Anomaly Detection**

- Isolation Forest checks if current consumption is unusual
- Returns `anomaly_detected: true/false`

### 5. **Bill Calculation**

Uses Kerala electricity rates (see below)

---

## 📊 Data Requirements

### Minimum Data Needed

| Prediction Type | Minimum Days | Recommended Days |
| --------------- | ------------ | ---------------- |
| Daily           | 3 days       | 30 days          |
| Weekly          | 7 days       | 30 days          |
| Monthly         | 14 days      | 60 days          |

### Smart Fallback Logic

The system intelligently handles limited data:

**Daily Prediction:**

```
≥30 days → Use 30 (HIGH confidence)
≥14 days → Use 14 (MEDIUM confidence)
≥7 days  → Use 7  (LOW confidence)
≥3 days  → Use 3  (VERY LOW confidence)
< 3 days → ERROR
```

**Weekly Prediction:**

```
≥30 days → Use 30 (HIGH confidence)
≥21 days → Use 21 (GOOD confidence)
≥14 days → Use 14 (MEDIUM confidence)
≥7 days  → Use ALL available (LOW confidence)
< 7 days → ERROR
```

**Monthly Prediction:**

```
≥60 days → Use 60 (HIGH confidence)
≥45 days → Use 45 (GOOD confidence)
≥30 days → Use 30 (MEDIUM confidence)
≥21 days → Use ALL available (LOW confidence)
≥14 days → Use ALL available (VERY LOW confidence)
< 14 days → ERROR
```

---

## 🎯 Prediction Types

### 1. Daily Prediction

**Input:** Historical consumption data  
**Output:**

```json
{
  "prediction_type": "daily",
  "next_day_units": 12.34,
  "predicted_2month_bill": 2468.0,
  "anomaly_detected": false,
  "confidence": "high",
  "data_days": 35,
  "warning": null
}
```

### 2. Weekly Prediction (7 Days)

**Output:**

```json
{
  "prediction_type": "weekly",
  "next_day_units": 12.34,
  "weekly_prediction": {
    "predictions": [
      {
        "day": 1,
        "date": "2025-02-13",
        "day_name": "Thursday",
        "predicted_units": 11.5
      }
      // ... 6 more days
    ],
    "total_weekly_units": 85.6,
    "avg_daily_units": 12.23,
    "start_date": "2025-02-13",
    "end_date": "2025-02-19"
  },
  "predicted_2month_bill": 2934.0,
  "anomaly_detected": false,
  "confidence": "high",
  "data_days": 30,
  "warning": null
}
```

### 3. Monthly Prediction (30 Days)

**Output:**

```json
{
  "prediction_type": "monthly",
  "next_day_units": 12.34,
  "monthly_prediction": {
    "daily_predictions": [
      // 30 daily predictions
    ],
    "weekly_summaries": [
      {
        "week": 1,
        "total_units": 85.6,
        "avg_daily_units": 12.23,
        "start_date": "2025-02-13",
        "end_date": "2025-02-19"
      }
      // ... 3 more weeks
    ],
    "total_monthly_units": 367.2,
    "avg_daily_units": 12.24,
    "start_date": "2025-02-13",
    "end_date": "2025-03-14"
  },
  "predicted_monthly_bill": 2458.4,
  "predicted_2month_bill": 2937.6,
  "anomaly_detected": false,
  "confidence": "medium",
  "data_days": 28,
  "warning": "Prediction accuracy may be reduced with less than 30 days of data"
}
```

---

## 🎚️ Confidence Levels

The system automatically assesses prediction quality:

| Confidence   | Data Days                                                       | Description                  | Action                  |
| ------------ | --------------------------------------------------------------- | ---------------------------- | ----------------------- |
| **HIGH**     | 30+ days                                                        | Excellent prediction quality | ✅ Use confidently      |
| **MEDIUM**   | 14-29 days                                                      | Good prediction quality      | ⚠️ Minor warning shown  |
| **LOW**      | 7-13 days (weekly)<br>3-13 days (daily)<br>14-29 days (monthly) | Acceptable but less accurate | ⚠️ Clear warning shown  |
| **VERY LOW** | 3-6 days (daily only)                                           | Minimal accuracy             | ⚠️ Strong warning shown |

### Confidence Response Fields

```json
{
  "confidence": "medium",
  "data_days": 28,
  "warning": "Prediction accuracy may be reduced with less than 30 days of data"
}
```

---

## 💰 Kerala Bill Calculation

The system uses Kerala State Electricity Board (KSEB) rates:

```python
def calculate_kerala_bill(units):
    if units <= 100:
        bill = units * 4
    elif units <= 200:
        bill = 100*4 + (units-100)*6
    elif units <= 300:
        bill = 100*4 + 100*6 + (units-200)*7
    else:
        bill = 100*4 + 100*6 + 100*7 + (units-300)*8
    return bill
```

### Rate Slabs

| Units Range | Rate (₹/unit) | Calculation            |
| ----------- | ------------- | ---------------------- |
| 0-100       | ₹4            | units × 4              |
| 101-200     | ₹6            | 400 + (units-100) × 6  |
| 201-300     | ₹7            | 1000 + (units-200) × 7 |
| 301+        | ₹8            | 1700 + (units-300) × 8 |

### Example Calculations

**Example 1:** 150 units

```
First 100 units: 100 × ₹4 = ₹400
Next 50 units:   50 × ₹6 = ₹300
Total: ₹700
```

**Example 2:** 367 units (monthly total)

```
First 100 units: 100 × ₹4 = ₹400
Next 100 units:  100 × ₹6 = ₹600
Next 100 units:  100 × ₹7 = ₹700
Remaining 67 units: 67 × ₹8 = ₹536
Total: ₹2,236
```

---

## 📝 Usage Examples

### Example 1: User with 35 Days of Data

**Request:**

```javascript
GET / api / predict / weekly / user123;
```

**Controller Logic:**

```javascript
// User has 35 days → Uses 30 days
daysUsed = 30;
```

**Flask Response:**

```json
{
  "prediction_type": "weekly",
  "next_day_units": 12.5,
  "weekly_prediction": {
    "total_weekly_units": 87.5,
    "avg_daily_units": 12.5
  },
  "predicted_2month_bill": 3000.0,
  "confidence": "high",
  "data_days": 30,
  "warning": null
}
```

### Example 2: User with 18 Days of Data

**Request:**

```javascript
GET / api / predict / monthly / user456;
```

**Controller Logic:**

```javascript
// User has 18 days → Uses ALL 18 days
daysUsed = 18;
```

**Flask Response:**

```json
{
  "prediction_type": "monthly",
  "confidence": "low",
  "data_days": 18,
  "warning": "Limited data (18 days). Predictions may be less accurate. Recommended: at least 14 days of data"
}
```

### Example 3: User with Only 5 Days of Data

**Request:**

```javascript
GET / api / predict / weekly / user789;
```

**Controller Response:**

```json
{
  "message": "Not enough data for weekly prediction (minimum 7 days required)",
  "availableDays": 5
}
```

---

## 🐛 Troubleshooting

### Common Issues

#### 1. **"Could not parse dates" Error**

**Problem:** Date format not recognized

**Solution:** Ensure dates are in one of these formats:

- `2025-02-12` (ISO format)
- `2025-02-12T10:30:00Z` (ISO8601 with time)

**Firebase Data Format:**

```javascript
{
  "date": "2025-02-12",  // ✅ Correct
  "total_units": 12.5
}
```

#### 2. **"Not enough data" Error**

**Problem:** Insufficient historical data

**Solution:** Collect more data based on prediction type:

- Daily: Minimum 3 days
- Weekly: Minimum 7 days
- Monthly: Minimum 14 days

#### 3. **Low Confidence Warnings**

**Problem:** Prediction quality is low due to limited data

**Solution:**

- Continue collecting data for better predictions
- Display warning to user
- Use predictions cautiously

#### 4. **Model File Not Found**

**Problem:** Missing `rf_model.pkl` or `anomaly_model.pkl`

**Solution:**

```bash
# Ensure files exist
ls models/
# Should show:
# rf_model.pkl
# anomaly_model.pkl
```

#### 5. **Connection Refused (Port 5000)**

**Problem:** Flask server not running

**Solution:**

```bash
# Start Flask server
python app.py

# Check if running
curl http://localhost:5000/
```

---

## 📈 Data Flow Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                    USER REQUEST                               │
│             "Predict my next week's bill"                     │
└────────────────────┬─────────────────────────────────────────┘
                     │
                     ↓
┌────────────────────────────────────────────────────────────────┐
│                  NODE.JS CONTROLLER                            │
│  1. Fetch user data from Firebase                             │
│  2. Check available days (e.g., 28 days)                      │
│  3. Apply fallback logic → Use all 28 days                    │
│  4. Sort by date (latest first)                               │
└────────────────────┬───────────────────────────────────────────┘
                     │
                     ↓ POST /predict
┌────────────────────────────────────────────────────────────────┐
│                    FLASK ML SERVER                             │
│  1. Parse dates (multiple strategies)                         │
│  2. Feature engineering:                                       │
│     - Rolling averages (3, 7, 14, 30 days)                   │
│     - Day of week, weekend flag                               │
│     - Trends (short & long term)                              │
│  3. Determine confidence level:                                │
│     28 days → "medium" confidence                             │
│  4. Anomaly detection                                          │
│  5. Random Forest prediction                                   │
│  6. Iterative weekly predictions (7 days)                     │
│  7. Calculate bill using Kerala rates                         │
└────────────────────┬───────────────────────────────────────────┘
                     │
                     ↓ JSON Response
┌────────────────────────────────────────────────────────────────┐
│                    RESPONSE TO CLIENT                          │
│  {                                                             │
│    "weekly_prediction": {...},                                │
│    "predicted_2month_bill": 2934.00,                          │
│    "confidence": "medium",                                     │
│    "data_days": 28,                                            │
│    "warning": "Prediction accuracy may be reduced..."         │
│  }                                                             │
└────────────────────────────────────────────────────────────────┘
```

---

## 🔒 Security Considerations

1. **API Rate Limiting**: Implement rate limiting on endpoints
2. **Input Validation**: Validate userId and data
3. **Firebase Rules**: Set appropriate database security rules
4. **CORS**: Configure CORS properly for production
5. **Environment Variables**: Use `.env` for sensitive data

---

## 🚀 Future Enhancements

- [ ] Real-time prediction updates
- [ ] Multiple ML models (LSTM, Prophet)
- [ ] Seasonal pattern detection
- [ ] User behavior analysis
- [ ] Mobile app integration
- [ ] Cost optimization suggestions
- [ ] Comparative analysis (vs neighbors)
- [ ] Carbon footprint calculation

## 🙏 Acknowledgments

- Kerala State Electricity Board (KSEB) for rate information
- scikit-learn community
- Firebase team

---

**Made with ❤️ for better electricity management**
