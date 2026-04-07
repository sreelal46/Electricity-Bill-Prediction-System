from flask import Flask, request, jsonify
import joblib
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
import traceback

app = Flask(__name__)

rf = joblib.load("models/rf_model.pkl")
iso = joblib.load("models/anomaly_model.pkl")


# ─────────────────────────────────────────
#  Kerala electricity bill calculator
# ─────────────────────────────────────────
def calculate_kerala_bill(units):
    bill = 0
    if units <= 100:
        bill = units * 4
    elif units <= 200:
        bill = 100 * 4 + (units - 100) * 6
    elif units <= 300:
        bill = 100 * 4 + 100 * 6 + (units - 200) * 7
    else:
        bill = 100 * 4 + 100 * 6 + 100 * 7 + (units - 300) * 8
    return round(bill, 2)


# ─────────────────────────────────────────
#  Robust date parser
#  Handles: ISO strings, plain YYYY-MM-DD,
#           Firebase ms timestamps (int/float),
#           timezone-aware strings
# ─────────────────────────────────────────
def parse_date_value(val):
    if val is None:
        return pd.NaT
    if isinstance(val, (int, float)):
        # Firebase stores timestamps in milliseconds
        return pd.Timestamp(val, unit="ms")
    s = str(val).strip()
    # Try most-to-least specific
    for fmt in ("%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ",
                "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            return pd.Timestamp(datetime.strptime(s, fmt))
        except ValueError:
            continue
    # Last resort: let pandas infer
    try:
        ts = pd.to_datetime(s, utc=True)
        return ts.tz_localize(None)
    except Exception:
        return pd.NaT


def build_dataframe(history):
    """
    Convert the raw history list into a clean, feature-engineered DataFrame.
    Raises ValueError with a clear message if something is wrong.
    """
    if not history or not isinstance(history, list):
        raise ValueError("history must be a non-empty list")

    df = pd.DataFrame(history)

    # ── Debug dump ──────────────────────────────────────────────────
    print(f"📋 Columns received  : {df.columns.tolist()}")
    print(f"📋 Sample row        : {df.iloc[0].to_dict()}")
    print(f"📋 Raw date samples  : {df['date'].head(5).tolist()}")
    # ────────────────────────────────────────────────────────────────

    # Validate required columns
    required = {"date", "daily_units"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(
            f"Missing required columns: {missing}. "
            f"Got: {df.columns.tolist()}"
        )

    # Alias daily_units → total_units so the rest of the code stays unchanged
    df["total_units"] = df["daily_units"]

    # Parse dates
    df["date"] = df["date"].apply(parse_date_value)

    invalid_dates = df["date"].isna().sum()
    if invalid_dates > 0:
        bad = df[df["date"].isna()].index.tolist()
        raise ValueError(f"{invalid_dates} date(s) could not be parsed. Indices: {bad}")

    # Ensure total_units is numeric
    df["total_units"] = pd.to_numeric(df["total_units"], errors="coerce")
    invalid_units = df["total_units"].isna().sum()
    if invalid_units > 0:
        df["total_units"] = df["total_units"].fillna(df["total_units"].median())
        print(f"⚠️  Filled {invalid_units} missing total_units with median")

    df = df.sort_values("date").reset_index(drop=True)
    print(f"📆 Date range: {df['date'].min().strftime('%Y-%m-%d')} → {df['date'].max().strftime('%Y-%m-%d')}")
    print(f"📈 Rows after parse : {len(df)}")

    # ── Feature engineering ─────────────────────────────────────────
    df["day_of_week"]  = df["date"].dt.dayofweek
    df["day_of_month"] = df["date"].dt.day
    df["is_weekend"]   = (df["day_of_week"] >= 5).astype(int)

    df["avg_last_3"]  = df["total_units"].rolling(3,  min_periods=1).mean()
    df["avg_last_7"]  = df["total_units"].rolling(7,  min_periods=1).mean()
    df["avg_last_14"] = df["total_units"].rolling(14, min_periods=1).mean()
    df["avg_last_30"] = df["total_units"].rolling(30, min_periods=1).mean()

    df["trend"]      = df["avg_last_3"] - df["avg_last_7"]
    df["long_trend"] = df["avg_last_7"] - df["avg_last_14"]

    return df


def build_features(units, avg3, avg7, trend, day_of_week, is_weekend):
    return np.array([[units, avg3, avg7, trend, day_of_week, is_weekend]])


def confidence_label(data_days):
    if data_days >= 30:
        return "high", None
    if data_days >= 14:
        return "medium", "Prediction accuracy may be reduced with less than 30 days of data"
    return "low", (
        f"Limited data ({data_days} days). Predictions may be less accurate. "
        "Recommended: at least 14 days of data"
    )


# ─────────────────────────────────────────
#  /predict  endpoint
# ─────────────────────────────────────────
@app.route("/predict", methods=["POST"])
def predict():
    try:
        data = request.get_json(force=True)
        if not data:
            return jsonify({"error": "No JSON body received"}), 400

        history         = data.get("history", [])
        prediction_type = data.get("prediction_type", "daily")

        print(f"\n{'='*60}")
        print(f"📊 Prediction Request : {prediction_type.upper()}")
        print(f"📦 Records received   : {len(history)}")
        print(f"{'='*60}")

        # ── Build & validate DataFrame ───────────────────────────────
        try:
            df = build_dataframe(history)
        except ValueError as ve:
            print(f"❌ DataFrame error: {ve}")
            return jsonify({"error": str(ve)}), 400

        data_days            = len(df)
        confidence, warning  = confidence_label(data_days)

        latest      = df.iloc[-1]
        latest_date = pd.Timestamp(latest["date"])

        print(f"🎯 Latest date  : {latest_date.strftime('%Y-%m-%d')}")
        print(f"🎯 Latest units : {latest['total_units']}")
        print(f"📊 Confidence   : {confidence.upper()}")
        if warning:
            print(f"⚠️  {warning}")

        # ── Anomaly detection ────────────────────────────────────────
        anomaly_flag = iso.predict([[latest["total_units"]]])[0] == -1

        # ── Next-day base prediction ─────────────────────────────────
        base_features  = build_features(
            latest["total_units"], latest["avg_last_3"], latest["avg_last_7"],
            latest["trend"], latest["day_of_week"], latest["is_weekend"]
        )
        next_day_units = float(rf.predict(base_features)[0])
        print(f"🔮 Next day: {round(next_day_units, 2)} units")

        # ── Common response fields ───────────────────────────────────
        common = {
            "next_day_units"     : round(next_day_units, 2),
            "anomaly_detected"   : bool(anomaly_flag),
            "confidence"         : confidence,
            "data_days"          : data_days,
            "warning"            : warning,
        }

        # ════════════════════════════════════════════════════════════
        #  DAILY
        # ════════════════════════════════════════════════════════════
        if prediction_type == "daily":
            predicted_60d_units = next_day_units * 60
            predicted_bill      = calculate_kerala_bill(predicted_60d_units)
            print(f"✅ Daily prediction done\n{'='*60}\n")
            return jsonify({
                "prediction_type"     : "daily",
                "predicted_2month_bill": predicted_bill,
                **common,
            })

        # ════════════════════════════════════════════════════════════
        #  WEEKLY  (7 days ahead)
        # ════════════════════════════════════════════════════════════
        elif prediction_type == "weekly":
            print("🔄 Generating 7-day predictions...")
            cur_units = latest["total_units"]
            cur_avg3  = latest["avg_last_3"]
            cur_avg7  = latest["avg_last_7"]
            cur_trend = latest["trend"]

            weekly_predictions = []
            for day in range(1, 8):
                next_date      = latest_date + pd.Timedelta(days=day)
                dow            = next_date.dayofweek
                is_wknd        = int(dow >= 5)
                feats          = build_features(cur_units, cur_avg3, cur_avg7, cur_trend, dow, is_wknd)
                day_pred       = float(rf.predict(feats)[0])

                weekly_predictions.append({
                    "day"            : day,
                    "date"           : next_date.strftime("%Y-%m-%d"),
                    "day_name"       : next_date.strftime("%A"),
                    "predicted_units": round(day_pred, 2),
                })

                cur_units = day_pred
                cur_avg3  = (cur_avg3 * 2 + day_pred) / 3
                cur_trend = cur_avg3 - cur_avg7

            weekly_total = sum(d["predicted_units"] for d in weekly_predictions)
            weekly_avg   = weekly_total / 7
            pred_60d     = weekly_avg * 60
            print(f"✅ Weekly done ({weekly_total:.2f} units)\n{'='*60}\n")

            return jsonify({
                "prediction_type": "weekly",
                "weekly_prediction": {
                    "predictions"      : weekly_predictions,
                    "total_weekly_units": round(weekly_total, 2),
                    "avg_daily_units"  : round(weekly_avg, 2),
                    "start_date"       : (latest_date + pd.Timedelta(days=1)).strftime("%Y-%m-%d"),
                    "end_date"         : (latest_date + pd.Timedelta(days=7)).strftime("%Y-%m-%d"),
                },
                "predicted_2month_bill": calculate_kerala_bill(pred_60d),
                **common,
            })

        # ════════════════════════════════════════════════════════════
        #  MONTHLY  (30 days ahead)
        # ════════════════════════════════════════════════════════════
        elif prediction_type == "monthly":
            print("🔄 Generating 30-day predictions...")
            cur_units = latest["total_units"]
            cur_avg3  = latest["avg_last_3"]
            cur_avg7  = latest["avg_last_7"]
            cur_trend = latest["trend"]

            monthly_predictions = []
            weekly_summaries    = []
            week_bucket         = []

            for day in range(1, 31):
                next_date  = latest_date + pd.Timedelta(days=day)
                dow        = next_date.dayofweek
                is_wknd    = int(dow >= 5)
                feats      = build_features(cur_units, cur_avg3, cur_avg7, cur_trend, dow, is_wknd)
                day_pred   = float(rf.predict(feats)[0])

                monthly_predictions.append({
                    "day"            : day,
                    "date"           : next_date.strftime("%Y-%m-%d"),
                    "day_name"       : next_date.strftime("%A"),
                    "predicted_units": round(day_pred, 2),
                })
                week_bucket.append(day_pred)

                if day % 7 == 0:
                    wk_num = day // 7
                    weekly_summaries.append({
                        "week"           : wk_num,
                        "total_units"    : round(sum(week_bucket), 2),
                        "avg_daily_units": round(sum(week_bucket) / 7, 2),
                        "start_date"     : (latest_date + pd.Timedelta(days=day - 6)).strftime("%Y-%m-%d"),
                        "end_date"       : next_date.strftime("%Y-%m-%d"),
                    })
                    week_bucket = []

                cur_units = day_pred
                cur_avg3  = (cur_avg3 * 2 + day_pred) / 3
                if day >= 7:
                    recent7   = [monthly_predictions[i]["predicted_units"] for i in range(max(0, day - 7), day)]
                    cur_avg7  = sum(recent7) / len(recent7)
                cur_trend = cur_avg3 - cur_avg7

            monthly_total = sum(d["predicted_units"] for d in monthly_predictions)
            monthly_avg   = monthly_total / 30
            pred_60d      = monthly_avg * 60

            print(f"✅ Monthly done ({monthly_total:.2f} units)\n{'='*60}\n")

            return jsonify({
                "prediction_type": "monthly",
                "monthly_prediction": {
                    "daily_predictions" : monthly_predictions,
                    "weekly_summaries"  : weekly_summaries,
                    "total_monthly_units": round(monthly_total, 2),
                    "avg_daily_units"   : round(monthly_avg, 2),
                    "start_date"        : (latest_date + pd.Timedelta(days=1)).strftime("%Y-%m-%d"),
                    "end_date"          : (latest_date + pd.Timedelta(days=30)).strftime("%Y-%m-%d"),
                },
                "predicted_monthly_bill" : calculate_kerala_bill(monthly_total),
                "predicted_2month_bill"  : calculate_kerala_bill(pred_60d),
                **common,
            })

        else:
            return jsonify({"error": "Invalid prediction_type. Use 'daily', 'weekly', or 'monthly'"}), 400

    except Exception as e:
        print(f"\n❌ UNHANDLED ERROR: {e}")
        traceback.print_exc()
        print(f"{'='*60}\n")
        return jsonify({
            "error"  : "Prediction failed",
            "details": str(e),
            "type"   : type(e).__name__,
        }), 500


if __name__ == "__main__":
    app.run(port=5000, debug=True)