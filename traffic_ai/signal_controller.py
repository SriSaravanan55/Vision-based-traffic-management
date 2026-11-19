"""Adaptive traffic signal controller and emergency preemption logic."""

from typing import Dict, Mapping, Optional, Any, List
from .config import (
    LANES,
    MIN_GREEN,
    MAX_GREEN,
    K,
    EMERGENCY_GREEN,
    PRIORITY_WEIGHTS,
    MAX_WAITING_TIME,
    STARVATION_PRIORITY_BOOST,
    EMERGENCY_PRIORITY_BOOST,
    YELLOW_TRANSITION_SECONDS,
    ALL_RED_CLEARANCE_SECONDS,
    SIMULATION_MODE,
)


def clamp(value: float, low: float, high: float) -> float:
    """Clamp numeric value to [low, high]."""
    return max(low, min(high, value))


def compute_green_seconds(density_share: float) -> int:
    """Calculate green signal duration from density share.

    Formula:
        Green time = clamp(MIN_GREEN + K * density_share, MIN_GREEN, MAX_GREEN)
        with MIN_GREEN=15, MAX_GREEN=45, K=30, rounded to whole seconds.
    """
    share = max(0.0, float(density_share))
    raw_green = MIN_GREEN + K * share
    clamped = clamp(raw_green, float(MIN_GREEN), float(MAX_GREEN))
    return int(round(clamped))


def detect_emergency_lane(summary: Mapping[str, Mapping[str, Any]]) -> Optional[str]:
    """Inspect lane summary for any emergency vehicles (ambulance, fire_truck, police_vehicle)."""
    candidates = []
    for lane in LANES:
        lane_data = summary.get(lane, {})
        raw = lane_data.get("raw_counts", {})
        em_count = (
            int(raw.get("ambulance", 0))
            + int(raw.get("fire_truck", 0))
            + int(raw.get("police_vehicle", 0))
        )
        if em_count > 0:
            candidates.append((em_count, float(lane_data.get("weighted_score", 0.0)), lane))

    if not candidates:
        return None

    candidates.sort(key=lambda item: (item[0], item[1]), reverse=True)
    return candidates[0][2]


def calculate_priority(
    lane_metrics: Mapping[str, Any],
    predicted_score: float = 0.0,
    weights: Optional[Mapping[str, float]] = None,
    max_waiting_threshold: float = float(MAX_WAITING_TIME),
) -> Dict[str, Any]:
    """Calculate multi-factor adaptive priority score for a single approach."""
    w = dict(PRIORITY_WEIGHTS)
    if weights:
        w.update(weights)

    score = float(lane_metrics.get("weighted_score", 0.0))
    queue_m = float(lane_metrics.get("queue_length_meters", lane_metrics.get("queue_meters", 0.0)))
    avg_wait = float(lane_metrics.get("average_waiting_time", 0.0))
    max_wait = float(lane_metrics.get("maximum_waiting_time", avg_wait))
    ped_cnt = int(lane_metrics.get("pedestrian_count", 0))
    raw = lane_metrics.get("raw_counts", {})
    em_cnt = (
        int(raw.get("ambulance", 0))
        + int(raw.get("fire_truck", 0))
        + int(raw.get("police_vehicle", 0))
    )

    norm_density = min(100.0, (score / 35.0) * 100.0)
    norm_queue = min(100.0, (queue_m / 90.0) * 100.0)
    norm_waiting = min(100.0, (max_wait / max(1.0, max_waiting_threshold)) * 100.0)
    norm_pred = min(100.0, (max(0.0, float(predicted_score)) / 35.0) * 100.0)
    norm_ped = min(100.0, (ped_cnt / 15.0) * 100.0)

    base_priority = (
        w["density_weight"] * norm_density
        + w["queue_weight"] * norm_queue
        + w["waiting_weight"] * norm_waiting
        + w["prediction_weight"] * norm_pred
        + w["pedestrian_weight"] * norm_ped
    )

    starvation_flagged = max_wait > max_waiting_threshold
    starvation_boost = STARVATION_PRIORITY_BOOST if starvation_flagged else 0.0
    emergency_boost = EMERGENCY_PRIORITY_BOOST if em_cnt > 0 else 0.0

    total_priority = round(base_priority + starvation_boost + emergency_boost, 2)

    return {
        "priority_score": total_priority,
        "base_priority": round(base_priority, 2),
        "starvation_flagged": starvation_flagged,
        "starvation_boost": starvation_boost,
        "emergency_present": em_cnt > 0,
    }


def validate_no_conflicting_greens(signal_states: Mapping[str, str]) -> bool:
    """Safety validator: ensure at most ONE approach has an active GREEN hardware signal at any instant."""
    green_lanes = [ln for ln, st in signal_states.items() if str(st).upper() == "GREEN"]
    return len(green_lanes) <= 1


def build_safe_transition_sequence(
    from_lane: Optional[str], to_lane: str, is_emergency: bool = False, green_seconds: Optional[int] = None
) -> List[Dict[str, Any]]:
    """Construct fail-safe signal transition steps: GREEN -> YELLOW -> ALL_RED -> NEXT GREEN."""
    target_green = int(green_seconds if green_seconds is not None else (EMERGENCY_GREEN if is_emergency else MIN_GREEN))
    if from_lane is None or from_lane == to_lane:
        return [{"lane": to_lane, "state": "GREEN", "duration_s": target_green, "note": "Maintain active green"}]

    return [
        {
            "lane": from_lane,
            "state": "YELLOW",
            "duration_s": YELLOW_TRANSITION_SECONDS,
            "note": f"Clearance amber on {from_lane.upper()}",
        },
        {
            "lane": "all",
            "state": "RED",
            "duration_s": ALL_RED_CLEARANCE_SECONDS,
            "note": "All-Red conflict box safety buffer",
        },
        {
            "lane": to_lane,
            "state": "GREEN",
            "duration_s": target_green,
            "note": (
                f"Emergency priority GREEN on {to_lane.upper()}"
                if is_emergency
                else f"Adaptive GREEN granted to {to_lane.upper()}"
            ),
        },
    ]


def compute_signal_plan(
    summary: Mapping[str, Mapping[str, Any]],
    emergency_lane: Optional[str] = None,
    predictions: Optional[Mapping[str, float]] = None,
    previous_green_lane: Optional[str] = None,
    forced_active_lane: Optional[str] = None,
) -> Dict[str, Dict[str, Any]]:
    """Compute the signal plan for all lanes given lane density summary."""
    active_emergency = emergency_lane
    if active_emergency is None:
        active_emergency = detect_emergency_lane(summary)

    priorities: Dict[str, Dict[str, Any]] = {}
    for lane in LANES:
        lane_info = summary.get(lane, {})
        pred_score = float((predictions or {}).get(lane, lane_info.get("weighted_score", 0.0)))
        priorities[lane] = calculate_priority(lane_info, predicted_score=pred_score)

    plan: Dict[str, Dict[str, Any]] = {}

    if active_emergency is not None and active_emergency in LANES:
        transitions = build_safe_transition_sequence(
            previous_green_lane,
            active_emergency,
            is_emergency=True,
            green_seconds=EMERGENCY_GREEN,
        )
        for lane in LANES:
            p_meta = priorities[lane]
            if lane == active_emergency:
                plan[lane] = {
                    "green_seconds": int(EMERGENCY_GREEN),
                    "mode": "emergency",
                    "priority_score": p_meta["priority_score"],
                    "starvation_flagged": p_meta["starvation_flagged"],
                    "active_phase_signal": "GREEN",
                    "control_mode": "SIMULATION" if SIMULATION_MODE else "HARDWARE",
                    "transition_steps": transitions,
                }
            else:
                plan[lane] = {
                    "green_seconds": 0,
                    "mode": "hold",
                    "priority_score": p_meta["priority_score"],
                    "starvation_flagged": p_meta["starvation_flagged"],
                    "active_phase_signal": "RED",
                    "control_mode": "SIMULATION" if SIMULATION_MODE else "HARDWARE",
                    "transition_steps": transitions,
                }
        return plan

    if forced_active_lane in LANES:
        highest_priority_lane = str(forced_active_lane)
    else:
        highest_priority_lane = max(
            LANES,
            key=lambda ln: (
                priorities[ln]["priority_score"],
                float(summary.get(ln, {}).get("weighted_score", 0.0)),
            ),
        )

    green_by_lane: Dict[str, int] = {}
    for lane in LANES:
        lane_info = summary.get(lane, {})
        share = float(lane_info.get("density_share", 1.0 / len(LANES)))
        p_meta = priorities[lane]
        base_green = compute_green_seconds(share)
        if p_meta["starvation_flagged"]:
            base_green = int(clamp(base_green + 5, float(MIN_GREEN), float(MAX_GREEN)))
        green_by_lane[lane] = base_green

    transitions = build_safe_transition_sequence(
        previous_green_lane,
        highest_priority_lane,
        is_emergency=False,
        green_seconds=green_by_lane[highest_priority_lane],
    )

    for lane in LANES:
        p_meta = priorities[lane]
        plan[lane] = {
            "green_seconds": green_by_lane[lane],
            "mode": "normal",
            "priority_score": p_meta["priority_score"],
            "starvation_flagged": p_meta["starvation_flagged"],
            "active_phase_signal": "GREEN" if lane == highest_priority_lane else "RED",
            "control_mode": "SIMULATION" if SIMULATION_MODE else "HARDWARE",
            "transition_steps": transitions,
        }

    return plan
