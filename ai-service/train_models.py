import json
import pandas as pd
import numpy as np
import os
import joblib

from sklearn.ensemble import RandomForestRegressor, IsolationForest

# Load Firebase data
with open("data/firebase_export.json") as f:
    raw = json.load(f)

rows = []

for user_id, user_data in raw.items():
    for key, day in user_data.items():
        if "date" in day and "total_units" in day:
            rows.append({
                "date": day["date"],
                "units": day["total_units"]
            })

df = pd.DataFrame(rows)

df["date"] = pd.to_datetime(df["date"])
df = df.sort_values("date")

# Feature Engineering
df["day_of_week"] = df["date"].dt.dayofweek
df["is_weekend"] = df["day_of_week"].apply(lambda x: 1 if x >= 5 else 0)
df["avg_last_3"] = df["units"].rolling(3).mean()
df["avg_last_7"] = df["units"].rolling(7).mean()
df["trend"] = df["avg_last_3"] - df["avg_last_7"]

df = df.dropna()

X = df[[
    "units",
    "avg_last_3",
    "avg_last_7",
    "trend",
    "day_of_week",
    "is_weekend"
]]

y = df["units"]

# Train Random Forest
rf = RandomForestRegressor(n_estimators=100)
rf.fit(X, y)

# Train Anomaly Model
iso = IsolationForest(contamination=0.05)
iso.fit(df[["units"]])

# Save models
os.makedirs("models", exist_ok=True)

joblib.dump(rf, "models/rf_model.pkl")
joblib.dump(iso, "models/anomaly_model.pkl")

print("✅ Models trained and saved successfully")