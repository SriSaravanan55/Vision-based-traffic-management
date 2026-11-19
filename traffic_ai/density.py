"""Lane density scoring, classification, and share calculation."""

from typing import Dict, Mapping, Any, Optional
from .config import (
    LANES,
    VEHICLE_WEIGHTS,
    DENSITY_THRESHOLDS,
    VEHICLE_LENGTH_METERS,
    QUEUE_ESTIMATION_METHOD,
    MAX_APPROACH_CAPACITY_METERS,
)


def weighted_score(counts: Mapping[str, int]) -> float:
    """Compute weighted density score for a single lane from vehicle class counts.

    Formula:
        weighted_score(lane) = sum(count[type] * weight[type])
    """
    score = 0.0
    for vehicle_type, weight in VEHICLE_WEIGHTS.items():
        count = int(counts.get(vehicle_type, 0))
        if count > 0:
            score += count * weight
    return round(score, 4)


def classify_density(score: float) -> str:
    """Map weighted density score to categorical density level.

    Thresholds (configurable via DENSITY_THRESHOLDS):
        <= 8: Low
        <= 18: Medium
        <= 30: High
        else: Very High
    """
    if score <= DENSITY_THRESHOLDS["Low"]:
        return "Low"
    if score <= DENSITY_THRESHOLDS["Medium"]:
        return "Medium"
    if score <= DENSITY_THRESHOLDS["High"]:
        return "High"
    return "Very High"


def classify_density_code(score: float) -> str:
    """Return uppercase enum code ('LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH')."""
    return classify_density(score).upper().replace(" ", "_")


def estimate_queue_length(counts: Mapping[str, int], sub_lanes: int = 2) -> float:
    """Estimate physical queue length in meters (meter-estimated from vehicle class lengths + headways)."""
    linear_meters = sum(
        max(0, int(counts.get(v_type, 0))) * float(VEHICLE_LENGTH_METERS.get(v_type, 5.0))
        for v_type in VEHICLE_WEIGHTS.keys()
    )
    return round(linear_meters / max(1, int(sub_lanes)), 1)


def estimate_waiting_times(
    vehicle_total: int,
    queue_length_meters: float,
    prior_max_wait: float = 0.0,
) -> Dict[str, float]:
    """Estimate average_waiting_time and maximum_waiting_time (seconds) for queued vehicles."""
    if vehicle_total <= 0 and prior_max_wait <= 0:
        return {"average_waiting_time": 0.0, "maximum_waiting_time": 0.0}
    base_avg = min(95.0, round(10.0 + vehicle_total * 0.95 + queue_length_meters * 0.15, 1))
    est_max = max(
        round(prior_max_wait, 1),
        min(180.0, round(base_avg * 1.45 + 6.0, 1)),
    )
    return {
        "average_waiting_time": base_avg,
        "maximum_waiting_time": est_max,
    }


def compute_density_shares(scores: Mapping[str, float]) -> Dict[str, float]:
    """Compute proportional density share per lane across all lanes.

    Formula:
        density_share(lane) = score(lane) / sum(all lane scores)
        If the total score is 0, split evenly across all lanes.
    """
    lanes = list(scores.keys()) if scores else list(LANES)
    total_score = sum(max(0.0, float(scores.get(lane, 0.0))) for lane in lanes)
    n_lanes = len(lanes) if lanes else 4

    if total_score <= 0.0:
        even_share = 1.0 / n_lanes
        return {lane: even_share for lane in lanes}

    return {
        lane: max(0.0, float(scores.get(lane, 0.0))) / total_score
        for lane in lanes
    }


def summarize_lanes(
    lane_counts: Mapping[str, Mapping[str, int]],
    prior_waiting: Optional[Mapping[str, float]] = None,
    pedestrian_counts: Optional[Mapping[str, int]] = None,
) -> Dict[str, Dict[str, Any]]:
    """Summarize raw vehicle counts, queue length, occupancy, and waiting times for all 4 lanes."""
    normalized_counts: Dict[str, Dict[str, int]] = {}
    scores: Dict[str, float] = {}

    for lane in LANES:
        raw = lane_counts.get(lane, {})
        clean_raw = {
            v_type: max(0, int(raw.get(v_type, 0)))
            for v_type in VEHICLE_WEIGHTS.keys()
        }
        normalized_counts[lane] = clean_raw
        scores[lane] = weighted_score(clean_raw)

    shares = compute_density_shares(scores)
    summary: Dict[str, Dict[str, Any]] = {}

    for lane in LANES:
        raw = normalized_counts[lane]
        score = scores[lane]
        veh_total = int(sum(raw.values()))
        q_meters = estimate_queue_length(raw, sub_lanes=2)
        occupancy_pct = round(min(100.0, (q_meters / MAX_APPROACH_CAPACITY_METERS) * 100.0), 1)
        prev_wait = float((prior_waiting or {}).get(lane, 0.0))
        wait_info = estimate_waiting_times(veh_total, q_meters, prior_max_wait=prev_wait)
        ped_cnt = int((pedestrian_counts or {}).get(lane, int(raw.get("pedestrian", 0)) if "pedestrian" in lane_counts.get(lane, {}) else 0))
        ped_wait = round(min(90.0, ped_cnt * 6.5), 1) if ped_cnt > 0 else 0.0

        summary[lane] = {
            "raw_counts": raw,
            "vehicle_total": veh_total,
            "weighted_score": round(score, 2),
            "density_level": classify_density(score),
            "density_code": classify_density_code(score),
            "density_share": round(shares[lane], 4),
            "queue_length_meters": q_meters,
            "queue_meters": q_meters,
            "queue_estimation_method": QUEUE_ESTIMATION_METHOD,
            "road_occupancy_pct": occupancy_pct,
            "average_waiting_time": wait_info["average_waiting_time"],
            "maximum_waiting_time": wait_info["maximum_waiting_time"],
            "pedestrian_count": ped_cnt,
            "pedestrian_waiting_time": ped_wait,
        }

    return summary
