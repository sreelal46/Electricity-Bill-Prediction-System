from flask import Flask, request, jsonify
import joblib
import numpy as np
import pandas as pd
from datetime import datetime, timedelta

app = Flask(__name__)

rf = joblib.load("models/rf_model.pkl")
iso = joblib.load("models/anomaly_model.pkl")

def calculate_kerala_bill(units):
    bill = 0
    if units <= 100:
        bill = units * 4
    elif units <= 200:
        bill = 100*4 + (units-100)*6
    elif units <= 300:
        bill = 100*4 + 100*6 + (units-200)*7
    else:
        bill = 100*4 + 100*6 + 100*7 + (units-300)*8
    return round(bill, 2)

@app.route("/predict", methods=["POST"])
def predict():
    try:
        data = request.json
        history = data["history"]
        prediction_type = data.get("prediction_type", "daily")
        
        print(f"\n{'='*60}")
        print(f"📊 Prediction Request: {prediction_type.upper()}")
        print(f"📦 Received {len(history)} days of data")
        print(f"{'='*60}")

        df = pd.DataFrame(history)
        
        # Debug: Print sample dates before parsing
        print(f"📅 Sample dates (raw): {df['date'].head(3).tolist()}")
        
        # Try multiple parsing strategies
        try:
            # Strategy 1: Try ISO8601 first
            df["date"] = pd.to_datetime(df["date"], format='ISO8601')
            print("✅ Parsed dates using ISO8601 format")
        except Exception as e1:
            print(f"⚠️ ISO8601 failed: {str(e1)[:100]}")
            try:
                # Strategy 2: Try explicit YYYY-MM-DD format
                df["date"] = pd.to_datetime(df["date"], format='%Y-%m-%d')
                print("✅ Parsed dates using YYYY-MM-DD format")
            except Exception as e2:
                print(f"⚠️ YYYY-MM-DD failed: {str(e2)[:100]}")
                try:
                    # Strategy 3: Let pandas infer
                    df["date"] = pd.to_datetime(df["date"])
                    print("✅ Parsed dates using pandas inference")
                except Exception as e3:
                    print(f"❌ All date parsing strategies failed")
                    return jsonify({
                        "error": "Could not parse dates",
                        "details": str(e3)
                    }), 400
        
        # Check for any invalid dates
        if df["date"].isna().any():
            invalid_indices = df[df["date"].isna()].index.tolist()
            print(f"❌ Invalid dates at indices: {invalid_indices}")
            return jsonify({
                "error": f"Invalid dates found at positions: {invalid_indices}"
            }), 400
        
        df = df.sort_values("date").reset_index(drop=True)
        
        print(f"📆 Date range: {df['date'].min().strftime('%Y-%m-%d')} to {df['date'].max().strftime('%Y-%m-%d')}")
        print(f"📈 Total days after parsing: {len(df)}")

        # Feature engineering
        df["day_of_week"] = df["date"].dt.dayofweek
        df["day_of_month"] = df["date"].dt.day
        df["is_weekend"] = df["day_of_week"].apply(lambda x: 1 if x >= 5 else 0)
        df["avg_last_3"] = df["total_units"].rolling(3).mean()
        df["avg_last_7"] = df["total_units"].rolling(7).mean()
        df["avg_last_14"] = df["total_units"].rolling(14).mean()
        df["avg_last_30"] = df["total_units"].rolling(30).mean()
        
        # Fill NaN values
        df["avg_last_3"] = df["avg_last_3"].fillna(df["total_units"])
        df["avg_last_7"] = df["avg_last_7"].fillna(df["total_units"])
        df["avg_last_14"] = df["avg_last_14"].fillna(df["total_units"])
        df["avg_last_30"] = df["avg_last_30"].fillna(df["total_units"])
        
        df["trend"] = df["avg_last_3"] - df["avg_last_7"]
        df["long_trend"] = df["avg_last_7"] - df["avg_last_14"]

        latest = df.iloc[-1]
        latest_date = pd.Timestamp(latest["date"])
        
        print(f"🎯 Latest date: {latest_date.strftime('%Y-%m-%d')}")
        print(f"🎯 Latest units: {latest['total_units']}")

        # Anomaly detection
        anomaly = iso.predict([[latest["total_units"]]])[0]
        anomaly_flag = True if anomaly == -1 else False

        # Base prediction for next day
        features = np.array([[
            latest["total_units"],
            latest["avg_last_3"],
            latest["avg_last_7"],
            latest["trend"],
            latest["day_of_week"],
            latest["is_weekend"]
        ]])
        next_day_units = rf.predict(features)[0]
        
        print(f"🔮 Next day prediction: {round(float(next_day_units), 2)} units")

        # Determine prediction confidence based on data availability
        data_days = len(df)
        if data_days >= 30:
            confidence = "high"
            warning = None
        elif data_days >= 14:
            confidence = "medium"
            warning = "Prediction accuracy may be reduced with less than 30 days of data"
        else:
            confidence = "low"
            warning = f"Limited data ({data_days} days). Predictions may be less accurate. Recommended: at least 14 days of data"
        
        print(f"📊 Data days: {data_days} | Confidence: {confidence.upper()}")
        if warning:
            print(f"⚠️  {warning}")

        # DAILY PREDICTION
        if prediction_type == "daily":
            predicted_60_days_units = next_day_units * 60
            predicted_bill = calculate_kerala_bill(predicted_60_days_units)
            
            print(f"✅ Daily prediction completed")
            print(f"{'='*60}\n")
            
            return jsonify({
                "prediction_type": "daily",
                "next_day_units": round(float(next_day_units), 2),
                "predicted_2month_bill": predicted_bill,
                "anomaly_detected": anomaly_flag,
                "confidence": confidence,
                "data_days": data_days,
                "warning": warning
            })

        # WEEKLY PREDICTION (7 days ahead)
        elif prediction_type == "weekly":
            print(f"🔄 Generating 7-day predictions...")
            weekly_predictions = []
            current_units = latest["total_units"]
            current_avg_3 = latest["avg_last_3"]
            current_avg_7 = latest["avg_last_7"]
            current_trend = latest["trend"]
            
            for day in range(1, 8):
                next_date = latest_date + pd.Timedelta(days=day)
                next_day_of_week = next_date.dayofweek
                next_is_weekend = 1 if next_day_of_week >= 5 else 0
                
                pred_features = np.array([[
                    current_units,
                    current_avg_3,
                    current_avg_7,
                    current_trend,
                    next_day_of_week,
                    next_is_weekend
                ]])
                
                day_prediction = rf.predict(pred_features)[0]
                weekly_predictions.append({
                    "day": day,
                    "date": next_date.strftime("%Y-%m-%d"),
                    "day_name": next_date.strftime("%A"),
                    "predicted_units": round(float(day_prediction), 2)
                })
                
                current_units = day_prediction
                current_avg_3 = (current_avg_3 * 2 + day_prediction) / 3
                current_trend = current_avg_3 - current_avg_7
            
            weekly_total_units = sum([d["predicted_units"] for d in weekly_predictions])
            weekly_avg_daily = weekly_total_units / 7
            
            predicted_60_days_units = weekly_avg_daily * 60
            predicted_bill = calculate_kerala_bill(predicted_60_days_units)
            
            print(f"✅ Weekly prediction completed ({weekly_total_units:.2f} units total)")
            print(f"{'='*60}\n")
            
            return jsonify({
                "prediction_type": "weekly",
                "next_day_units": round(float(next_day_units), 2),
                "weekly_prediction": {
                    "predictions": weekly_predictions,
                    "total_weekly_units": round(float(weekly_total_units), 2),
                    "avg_daily_units": round(float(weekly_avg_daily), 2),
                    "start_date": (latest_date + pd.Timedelta(days=1)).strftime("%Y-%m-%d"),
                    "end_date": (latest_date + pd.Timedelta(days=7)).strftime("%Y-%m-%d")
                },
                "predicted_2month_bill": predicted_bill,
                "anomaly_detected": anomaly_flag,
                "confidence": confidence,
                "data_days": data_days,
                "warning": warning
            })

        # MONTHLY PREDICTION (30 days ahead)
        elif prediction_type == "monthly":
            print(f"🔄 Generating 30-day predictions...")
            monthly_predictions = []
            weekly_summaries = []
            
            current_units = latest["total_units"]
            current_avg_3 = latest["avg_last_3"]
            current_avg_7 = latest["avg_last_7"]
            current_trend = latest["trend"]
            
            week_units = []
            
            for day in range(1, 31):
                next_date = latest_date + pd.Timedelta(days=day)
                next_day_of_week = next_date.dayofweek
                next_is_weekend = 1 if next_day_of_week >= 5 else 0
                
                pred_features = np.array([[
                    current_units,
                    current_avg_3,
                    current_avg_7,
                    current_trend,
                    next_day_of_week,
                    next_is_weekend
                ]])
                
                day_prediction = rf.predict(pred_features)[0]
                
                monthly_predictions.append({
                    "day": day,
                    "date": next_date.strftime("%Y-%m-%d"),
                    "day_name": next_date.strftime("%A"),
                    "predicted_units": round(float(day_prediction), 2)
                })
                
                week_units.append(day_prediction)
                
                if day % 7 == 0:
                    week_num = day // 7
                    weekly_summaries.append({
                        "week": week_num,
                        "total_units": round(float(sum(week_units)), 2),
                        "avg_daily_units": round(float(sum(week_units) / 7), 2),
                        "start_date": (latest_date + pd.Timedelta(days=day-6)).strftime("%Y-%m-%d"),
                        "end_date": next_date.strftime("%Y-%m-%d")
                    })
                    week_units = []
                
                current_units = day_prediction
                current_avg_3 = (current_avg_3 * 2 + day_prediction) / 3
                if day >= 7:
                    recent_7 = [monthly_predictions[i]["predicted_units"] for i in range(max(0, day-7), day)]
                    current_avg_7 = sum(recent_7) / len(recent_7)
                current_trend = current_avg_3 - current_avg_7
            
            monthly_total_units = sum([d["predicted_units"] for d in monthly_predictions])
            monthly_avg_daily = monthly_total_units / 30
            
            predicted_60_days_units = monthly_avg_daily * 60
            predicted_bill = calculate_kerala_bill(predicted_60_days_units)
            
            print(f"✅ Monthly prediction completed ({monthly_total_units:.2f} units total)")
            print(f"{'='*60}\n")
            
            return jsonify({
                "prediction_type": "monthly",
                "next_day_units": round(float(next_day_units), 2),
                "monthly_prediction": {
                    "daily_predictions": monthly_predictions,
                    "weekly_summaries": weekly_summaries,
                    "total_monthly_units": round(float(monthly_total_units), 2),
                    "avg_daily_units": round(float(monthly_avg_daily), 2),
                    "start_date": (latest_date + pd.Timedelta(days=1)).strftime("%Y-%m-%d"),
                    "end_date": (latest_date + pd.Timedelta(days=30)).strftime("%Y-%m-%d")
                },
                "predicted_monthly_bill": calculate_kerala_bill(monthly_total_units),
                "predicted_2month_bill": predicted_bill,
                "anomaly_detected": anomaly_flag,
                "confidence": confidence,
                "data_days": data_days,
                "warning": warning
            })
        
        else:
            return jsonify({"error": "Invalid prediction_type. Use 'daily', 'weekly', or 'monthly'"}), 400
            
    except Exception as e:
        print(f"\n❌ ERROR: {str(e)}")
        print(f"Error type: {type(e).__name__}")
        import traceback
        traceback.print_exc()
        print(f"{'='*60}\n")
        return jsonify({
            "error": "Prediction failed",
            "details": str(e),
            "type": type(e).__name__
        }), 500

if __name__ == "__main__":
    app.run(port=5000, debug=True)