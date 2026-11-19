"""Lightweight ML Traffic Prediction Engine (Ordinary Least Squares Linear Regression)."""

import math
from typing import Dict, List, Any
from .config import LANES
from .density import classify_density, classify_density_code


def _fit_ols_trend(series: List[float]) -> float:
    """Fit simple Ordinary Least Squares (OLS) linear regression y = a + b*t and forecast t = n."""
    n = len(series)
    if n == 0:
        return 8.0
    if n == 1:
        return max(0.0, float(series[0]))

    window = [float(v) for v in series[-12:]]
    m = len(window)
    mean_t = (m - 1) / 2.0
    mean_y = sum(window) / m

    num = sum((i - mean_t) * (window[i] - mean_y) for i in range(m))
    den = sum((i - mean_t) ** 2 for i in range(m))
    slope = (num / den) if den > 0 else 0.0
    intercept = mean_y - slope * mean_t

    forecast = intercept + slope * m
    blended = 0.70 * forecast + 0.30 * window[-1]
    return round(max(0.0, min(60.0, blended)), 2)


def forecast_lanes_from_history(
    lane_score_series: Dict[str, List[float]]
) -> Dict[str, Any]:
    """Forecast next 5-minute traffic score and level per approach, plus actual MAE and RMSE."""
    predictions: Dict[str, Dict[str, Any]] = {}
    abs_errors: List[float] = []
    sq_errors: List[float] = []

    for lane in LANES:
        history = [float(x) for x in lane_score_series.get(lane, [])]
        pred_score = _fit_ols_trend(history)
        pred_level = classify_density(pred_score)
        pred_code = classify_density_code(pred_score)

        lane_abs_err: List[float] = []
        for idx in range(2, len(history)):
            prefix = history[:idx]
            actual = history[idx]
            hat = _fit_ols_trend(prefix)
            err = abs(actual - hat)
            lane_abs_err.append(err)
            abs_errors.append(err)
            sq_errors.append((actual - hat) ** 2)

        lane_mae = round(sum(lane_abs_err) / len(lane_abs_err), 2) if lane_abs_err else 0.0
        predictions[lane] = {
            "lane": lane,
            "predicted_score": pred_score,
            "predicted_level": pred_level,
            "predicted_code": pred_code,
            "samples_used": len(history),
            "lane_mae": lane_mae,
        }

    overall_mae = round(sum(abs_errors) / len(abs_errors), 2) if abs_errors else 0.0
    overall_rmse = (
        round(math.sqrt(sum(sq_errors) / len(sq_errors)), 2) if sq_errors else 0.0
    )

    return {
        "model": "OLS Linear Trend Regression (Rolling 12-Cycle Window)",
        "horizon": "Next 5 Minutes",
        "mae": overall_mae,
        "rmse": overall_rmse,
        "evaluated_samples": len(abs_errors),
        "lanes": predictions,
    }
