"""Main end-to-end orchestration pipeline for the AI-Based Smart Traffic Management System.

Usage:
    python -m traffic_ai.pipeline --demo [--cycles N]
"""

import argparse
import datetime
import random
from typing import Dict, Optional, Any
from .config import LANES, DB_PATH
from .density import summarize_lanes
from .signal_controller import compute_signal_plan, detect_emergency_lane
from .mqtt_bridge import MqttBridge
from .simulator import IntersectionSimulator
from .storage import (
    init_db,
    log_cycle,
    log_emergency,
    lane_score_series,
    log_system_event,
    get_active_session_id,
    get_last_active_green_lane,
    set_last_active_green_lane,
    ACTIVE_SESSION_SENTINEL,
)
from .predictor import forecast_lanes_from_history
from .hardware_controller import HardwareSignalController


def generate_synthetic_counts(cycle: int, rng: Optional[random.Random] = None) -> Dict[str, Dict[str, int]]:
    """Generate realistic synthetic intersection counts per lane."""
    r = rng or random
    if cycle == 1:
        return {
            "north": {
                "motorcycle": 4,
                "car": 5,
                "bus": 1,
                "truck": 0,
                "ambulance": 0,
                "fire_truck": 0,
            },
            "south": {
                "motorcycle": 2,
                "car": 2,
                "bus": 0,
                "truck": 1,
                "ambulance": 0,
                "fire_truck": 0,
            },
            "east": {
                "motorcycle": 0,
                "car": 20,
                "bus": 0,
                "truck": 3,
                "ambulance": 0,
                "fire_truck": 0,
            },
            "west": {
                "motorcycle": 0,
                "car": 2,
                "bus": 0,
                "truck": 0,
                "ambulance": 0,
                "fire_truck": 0,
            },
        }

    counts: Dict[str, Dict[str, int]] = {}
    rush_lane = LANES[(cycle - 1) % len(LANES)]

    for lane in LANES:
        if lane == rush_lane:
            counts[lane] = {
                "motorcycle": r.randint(4, 12),
                "car": r.randint(12, 22),
                "bus": r.randint(1, 3),
                "truck": r.randint(1, 4),
                "ambulance": 0,
                "fire_truck": 0,
            }
        else:
            counts[lane] = {
                "motorcycle": r.randint(0, 6),
                "car": r.randint(1, 8),
                "bus": r.randint(0, 1),
                "truck": r.randint(0, 2),
                "ambulance": 0,
                "fire_truck": 0,
            }

    if cycle % 4 == 0:
        em_lane = LANES[(cycle // 4 - 1) % len(LANES)]
        em_type = "ambulance" if (cycle // 4) % 2 == 1 else "fire_truck"
        counts[em_lane][em_type] = 1

    return counts


def _execute_cycle(
    cycle: int,
    lane_counts: Dict[str, Dict[str, int]],
    mqtt_bridge: MqttBridge,
    simulator: IntersectionSimulator,
    hw_controller: Optional[HardwareSignalController] = None,
    persist: bool = True,
    db_path: str = DB_PATH,
    realtime: bool = True,
    max_sim_seconds: Optional[float] = 1.0,
    session_id: Optional[str] = ACTIVE_SESSION_SENTINEL,
    junction_id: str = "JCT-01",
) -> Dict[str, Any]:
    """Process one intersection cycle through density -> signal plan -> hardware -> MQTT -> simulator -> SQLite."""
    ts = (
        datetime.datetime.now(datetime.timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )

    summary = summarize_lanes(lane_counts)
    emergency_lane = detect_emergency_lane(summary)

    score_series = (
        lane_score_series(limit=24, db_path=db_path, session_id=session_id)
        if persist
        else {ln: [] for ln in LANES}
    )
    pred_report = forecast_lanes_from_history(score_series)
    pred_scores = {
        ln: float(pred_report["lanes"][ln]["predicted_score"])
        for ln in LANES
    }

    if hw_controller is None:
        prev_green = get_last_active_green_lane(db_path) if persist else None
        hw_controller = HardwareSignalController(initial_active_green=prev_green)
    else:
        prev_green = hw_controller.active_green_lane

    signal_plan = compute_signal_plan(
        summary,
        emergency_lane=emergency_lane,
        predictions=pred_scores,
        previous_green_lane=prev_green,
    )

    active_green_lane = next(
        (ln for ln in LANES if signal_plan[ln].get("active_phase_signal") == "GREEN"),
        emergency_lane or "north",
    )
    hw_status = hw_controller.transition_to_lane(
        active_green_lane,
        duration_seconds=int(signal_plan[active_green_lane]["green_seconds"]),
        mode="EMERGENCY" if emergency_lane else "ADAPTIVE",
        sleep_transitions=False,
    )
    if persist:
        set_last_active_green_lane(active_green_lane, db_path=db_path)

    mqtt_bridge.publish_lane_counts(summary, ts=ts)
    mqtt_bridge.publish_signal_state(
        summary, signal_plan, emergency_lane=emergency_lane, cycle=cycle, ts=ts
    )
    mqtt_bridge.publish_emergency(emergency_lane=emergency_lane, cycle=cycle, ts=ts)

    if persist:
        log_cycle(
            ts,
            summary,
            signal_plan,
            db_path=db_path,
            session_id=session_id,
            junction_id=junction_id,
        )
        if emergency_lane is not None:
            log_emergency(
                ts,
                emergency_lane,
                db_path=db_path,
                session_id=session_id,
                junction_id=junction_id,
            )
            log_system_event(
                ts,
                event_type="Emergency Preemption",
                road=emergency_lane.capitalize(),
                detail="Immediate 25s GREEN granted via safe YELLOW->ALL_RED clearance",
                status="Active Override",
                db_path=db_path,
                session_id=session_id,
                junction_id=junction_id,
            )
        for ln in LANES:
            if signal_plan[ln].get("starvation_flagged"):
                log_system_event(
                    ts,
                    event_type="Starvation Protection",
                    road=ln.capitalize(),
                    detail=f"Max wait {summary[ln]['maximum_waiting_time']}s > 90s; priority boost +35 applied",
                    status="Fairness Boost",
                    db_path=db_path,
                    session_id=session_id,
                    junction_id=junction_id,
                )

    em_banner = f" [EMERGENCY PREEMPTION -> {emergency_lane.upper()} 25s]" if emergency_lane else ""
    print(f"\n--- Cycle {cycle:02d} @ {ts}{em_banner} ---")
    for lane in LANES:
        s = summary[lane]
        p = signal_plan[lane]
        print(
            f"  {lane.upper():5s} | veh={s['vehicle_total']:2d} | "
            f"score={s['weighted_score']:5.1f} ({s['density_level']:9s}) | "
            f"share={s['density_share']*100:5.1f}% | "
            f"prio={p['priority_score']:5.1f} | "
            f"green={p['green_seconds']:2d}s [{p['mode'].upper()}]"
        )

    simulator.run_cycle_countdown(
        summary=summary,
        signal_plan=signal_plan,
        cycle=cycle,
        emergency_lane=emergency_lane,
        realtime=realtime,
        max_sim_seconds=max_sim_seconds,
    )

    return {
        "ts": ts,
        "cycle": cycle,
        "summary": summary,
        "signal_plan": signal_plan,
        "emergency_lane": emergency_lane,
        "hardware_status": hw_status,
    }


def run_demo(
    cycles: Optional[int] = 8,
    persist: bool = True,
    db_path: str = DB_PATH,
    realtime: bool = True,
    max_sim_seconds: Optional[float] = 1.0,
    seed: int = 42,
    junction_id: str = "JCT-01",
) -> list[Dict[str, Any]]:
    """Run synthetic traffic demo mode without requiring ultralytics or OpenCV."""
    active_sid = None
    prev_green = None
    if persist:
        init_db(db_path)
        active_sid = get_active_session_id(db_path)
        prev_green = get_last_active_green_lane(db_path)

    mqtt_bridge = MqttBridge()
    mqtt_bridge.connect()
    simulator = IntersectionSimulator()
    hw_controller = HardwareSignalController(initial_active_green=prev_green)
    rng = random.Random(seed)
    history: list[Dict[str, Any]] = []

    cycle = 1
    try:
        while simulator.running:
            if cycles is not None and cycle > cycles:
                break
            lane_counts = generate_synthetic_counts(cycle, rng=rng)
            result = _execute_cycle(
                cycle=cycle,
                lane_counts=lane_counts,
                mqtt_bridge=mqtt_bridge,
                simulator=simulator,
                hw_controller=hw_controller,
                persist=persist,
                db_path=db_path,
                realtime=realtime,
                max_sim_seconds=max_sim_seconds,
                session_id=active_sid or ACTIVE_SESSION_SENTINEL,
                junction_id=junction_id,
            )
            history.append(result)
            cycle += 1
    except KeyboardInterrupt:
        print("\n[Pipeline] Interrupted by user.")
    finally:
        simulator.close()
        mqtt_bridge.close()

    return history


def run_video(
    video_sources: Dict[str, str],
    cycles: Optional[int] = None,
    persist: bool = True,
    db_path: str = DB_PATH,
    realtime: bool = True,
    max_sim_seconds: Optional[float] = 2.0,
    junction_id: str = "JCT-01",
) -> list[Dict[str, Any]]:
    """Run real YOLOv8 + ByteTrack detection across 4 lane video feeds."""
    import cv2
    from .detector import VehicleDetector

    active_sid = None
    prev_green = None
    if persist:
        init_db(db_path)
        active_sid = get_active_session_id(db_path)
        prev_green = get_last_active_green_lane(db_path)

    detector = VehicleDetector()
    mqtt_bridge = MqttBridge()
    mqtt_bridge.connect()
    simulator = IntersectionSimulator()
    hw_controller = HardwareSignalController(initial_active_green=prev_green)

    captures: Dict[str, Any] = {}
    for lane in LANES:
        src_path = video_sources.get(lane)
        if not src_path:
            raise ValueError(f"Missing video path for lane '{lane}'.")
        cap = cv2.VideoCapture(src_path)
        if not cap.isOpened():
            raise RuntimeError(f"Could not open video file for lane '{lane}': {src_path}")
        captures[lane] = cap

    history: list[Dict[str, Any]] = []
    cycle = 1

    try:
        while simulator.running:
            if cycles is not None and cycle > cycles:
                break

            lane_counts: Dict[str, Dict[str, int]] = {}
            for lane in LANES:
                cap = captures[lane]
                ok, frame = cap.read()
                if not ok or frame is None:
                    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    detector.reset_track_memory(lane)
                    ok, frame = cap.read()

                if ok and frame is not None:
                    counts_by_class, _, _ = detector.process_frame(frame, lane)
                    lane_counts[lane] = counts_by_class
                else:
                    lane_counts[lane] = detector.get_in_frame_counts(lane)

            result = _execute_cycle(
                cycle=cycle,
                lane_counts=lane_counts,
                mqtt_bridge=mqtt_bridge,
                simulator=simulator,
                hw_controller=hw_controller,
                persist=persist,
                db_path=db_path,
                realtime=realtime,
                max_sim_seconds=max_sim_seconds,
                session_id=active_sid or ACTIVE_SESSION_SENTINEL,
                junction_id=junction_id,
            )
            history.append(result)
            cycle += 1
    except KeyboardInterrupt:
        print("\n[Pipeline] Video pipeline stopped by user.")
    finally:
        for cap in captures.values():
            try:
                cap.release()
            except Exception:
                pass
        simulator.close()
        mqtt_bridge.close()

    return history


def main() -> None:
    parser = argparse.ArgumentParser(
        description="AI-Based Smart Traffic Management System Pipeline"
    )
    parser.add_argument(
        "--demo",
        action="store_true",
        help="Run synthetic traffic simulation without requiring YOLO/OpenCV",
    )
    parser.add_argument(
        "--cycles",
        type=int,
        default=8,
        help="Number of signal cycles to execute (default: 8, use 0 for infinite)",
    )
    parser.add_argument(
        "--no-persist",
        action="store_true",
        help="Disable SQLite database logging for this run",
    )
    parser.add_argument(
        "--sim-seconds",
        type=float,
        default=1.0,
        help="Real-time countdown seconds per cycle in demo mode (default: 1.0s at 30 FPS)",
    )
    parser.add_argument("--junction", type=str, default="JCT-01", help="Canonical junction ID (JCT-01..JCT-04)")
    parser.add_argument("--north", type=str, default="videos/north.mp4", help="North lane video path")
    parser.add_argument("--south", type=str, default="videos/south.mp4", help="South lane video path")
    parser.add_argument("--east", type=str, default="videos/east.mp4", help="East lane video path")
    parser.add_argument("--west", type=str, default="videos/west.mp4", help="West lane video path")

    args = parser.parse_args()
    max_cycles = None if args.cycles <= 0 else args.cycles
    persist = not args.no_persist

    if args.demo:
        run_demo(
            cycles=max_cycles,
            persist=persist,
            realtime=True,
            max_sim_seconds=args.sim_seconds,
            junction_id=args.junction,
        )
    else:
        sources = {
            "north": args.north,
            "south": args.south,
            "east": args.east,
            "west": args.west,
        }
        run_video(
            video_sources=sources,
            cycles=max_cycles,
            persist=persist,
            realtime=True,
            max_sim_seconds=args.sim_seconds,
            junction_id=args.junction,
        )


if __name__ == "__main__":
    main()
