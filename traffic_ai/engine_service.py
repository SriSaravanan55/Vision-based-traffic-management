"""Persistent stateful Python Traffic AI Engine service and request validation."""

import datetime
import logging
import os
import random
import sqlite3
import threading
import time
from typing import Any, Dict, List, Mapping, Optional

from .config import (
    ALL_RED_CLEARANCE_SECONDS,
    DB_PATH,
    EMERGENCY_GREEN,
    EMERGENCY_PRIORITY_BOOST,
    FIXED_TIMER_GREEN,
    K,
    LANES,
    MAX_APPROACH_CAPACITY_METERS,
    MAX_GREEN,
    MAX_WAITING_TIME,
    MIN_GREEN,
    PRIORITY_WEIGHTS,
    REAL_WORLD_JUNCTIONS,
    SCENARIO_PRESETS,
    SIMULATION_MODE,
    STARVATION_PRIORITY_BOOST,
    TRAFFIC_LIVE_VIDEO_FEEDS,
    VEHICLE_LENGTH_METERS,
    VEHICLE_WEIGHTS,
    YELLOW_TRANSITION_SECONDS,
)
from .density import summarize_lanes
from .detector import VehicleDetector
from .hardware_controller import GPIO_PIN_MAP, HardwareSignalController
from .mqtt_bridge import MqttBridge
from .pipeline import generate_synthetic_counts
from .predictor import forecast_lanes_from_history
from .signal_controller import compute_signal_plan, detect_emergency_lane
from .storage import (
    ACTIVE_SESSION_SENTINEL,
    build_full_summary,
    emergency_event_log,
    export_json,
    get_active_session_id,
    get_app_state,
    get_last_active_green_lane,
    init_db,
    lane_score_series,
    log_cycle,
    log_emergency,
    log_system_event,
    recent_cycles_summary,
    recent_system_events,
    reset_active_session,
    set_app_state,
    set_last_active_green_lane,
    total_cycles,
)

logger = logging.getLogger("traffic_ai.engine_service")


class ValidationError(ValueError):
    """Raised when incoming API payload or query parameters fail schema validation."""

    def __init__(self, message: str, code: str = "VALIDATION_ERROR", details: Optional[Any] = None) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.details = details


def _is_valid_int(val: Any) -> bool:
    return isinstance(val, int) and not isinstance(val, bool)


def _is_valid_number(val: Any) -> bool:
    return isinstance(val, (int, float)) and not isinstance(val, bool)


def _utc_now_iso() -> str:
    return (
        datetime.datetime.now(datetime.timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


class TrafficEngineService:
    """Long-running stateful engine maintaining controller, detector, session, and phase state."""

    def __init__(self, db_path: str = DB_PATH) -> None:
        self.db_path = db_path
        self.started_at = time.monotonic()
        self.lock = threading.RLock()

        init_db(self.db_path)
        self.active_session_id: str = get_active_session_id(self.db_path)

        stored_junction = get_app_state("active_junction_id", default="JCT-01", db_path=self.db_path)
        self.active_junction_id: str = (
            stored_junction if stored_junction in REAL_WORLD_JUNCTIONS else "JCT-01"
        )
        if stored_junction != self.active_junction_id:
            set_app_state("active_junction_id", self.active_junction_id, db_path=self.db_path)

        persisted_green = get_last_active_green_lane(self.db_path)
        self.hw_controller = HardwareSignalController(initial_active_green=persisted_green)

        # Lazy detector initialized once on startup (model weights remain unloaded in software mode)
        self.detector = VehicleDetector()

        # Optional resilient MQTT bridge (connects in background thread so offline broker never delays API server startup)
        self.mqtt_bridge = MqttBridge()
        threading.Thread(target=self.mqtt_bridge.connect, daemon=True, name="mqtt-connect-worker").start()

        self.current_phase: Dict[str, Any] = {
            "stage": "GREEN" if self.hw_controller.active_green_lane else "STANDBY",
            "active_green_lane": self.hw_controller.active_green_lane,
            "previous_green_lane": None,
            "green_seconds": 0,
            "mode": "ADAPTIVE" if self.hw_controller.active_green_lane else "STANDBY",
            "transition_steps": [],
            "updated_at": _utc_now_iso(),
        }
        self.last_cycle_result: Optional[Dict[str, Any]] = None

        logger.info(
            "TrafficEngineService initialized: controller=%s, session=%s, junction=%s, active_green=%s",
            self.hw_controller.controller_instance_id,
            self.active_session_id,
            self.active_junction_id,
            self.hw_controller.active_green_lane,
        )

    def _validate_junction_id(self, raw_junction: Any, default_to_active: bool = True) -> str:
        if raw_junction is None or raw_junction == "":
            return self.active_junction_id if default_to_active else "JCT-01"
        jct = str(raw_junction)
        if jct not in REAL_WORLD_JUNCTIONS:
            raise ValidationError(
                f"Invalid junction_id '{jct}'. Allowed junctions: {list(REAL_WORLD_JUNCTIONS.keys())}",
                code="INVALID_JUNCTION",
                details={"allowed_junctions": list(REAL_WORLD_JUNCTIONS.keys()), "received": jct},
            )
        return jct

    def _validate_lane(self, raw_lane: Any, field_name: str, allow_none: bool = True) -> Optional[str]:
        if raw_lane is None or raw_lane == "":
            if allow_none:
                return None
            raise ValidationError(f"Field '{field_name}' cannot be empty.", code="INVALID_LANE")
        if not isinstance(raw_lane, str) or raw_lane not in LANES:
            raise ValidationError(
                f"Invalid lane '{raw_lane}' in '{field_name}'. Allowed lanes: {list(LANES)}",
                code="INVALID_LANE",
                details={"field": field_name, "allowed_lanes": list(LANES), "received": raw_lane},
            )
        return raw_lane

    def _validate_lane_counts(self, raw_counts: Any) -> Dict[str, Dict[str, int]]:
        if not isinstance(raw_counts, Mapping):
            raise ValidationError(
                "Field 'lane_counts' must be a JSON object mapping approach lanes to vehicle class counts.",
                code="INVALID_LANE_COUNTS",
            )

        validated: Dict[str, Dict[str, int]] = {}
        for lane_key, counts_obj in raw_counts.items():
            if lane_key not in LANES:
                raise ValidationError(
                    f"Invalid lane '{lane_key}' in 'lane_counts'. Allowed lanes: {list(LANES)}",
                    code="INVALID_LANE",
                    details={"field": "lane_counts", "allowed_lanes": list(LANES), "received": lane_key},
                )
            if not isinstance(counts_obj, Mapping):
                raise ValidationError(
                    f"Counts for lane '{lane_key}' must be an object mapping vehicle types to integers.",
                    code="INVALID_VEHICLE_COUNT",
                )
            lane_clean: Dict[str, int] = {k: 0 for k in VEHICLE_WEIGHTS}
            for cls_name, cnt_val in counts_obj.items():
                if cls_name not in VEHICLE_WEIGHTS:
                    raise ValidationError(
                        f"Unsupported vehicle class '{cls_name}' in lane '{lane_key}'. Allowed classes: {list(VEHICLE_WEIGHTS.keys())}",
                        code="INVALID_VEHICLE_CLASS",
                        details={"lane": lane_key, "allowed_classes": list(VEHICLE_WEIGHTS.keys()), "received": cls_name},
                    )
                if not _is_valid_int(cnt_val) or cnt_val < 0 or cnt_val > 10000:
                    raise ValidationError(
                        f"Invalid vehicle count '{cnt_val}' for '{lane_key}.{cls_name}'. Must be an integer between 0 and 10000.",
                        code="INVALID_VEHICLE_COUNT",
                        details={"lane": lane_key, "vehicle_class": cls_name, "received": cnt_val},
                    )
                lane_clean[cls_name] = int(cnt_val)
            validated[lane_key] = lane_clean

        for ln in LANES:
            if ln not in validated:
                validated[ln] = {k: 0 for k in VEHICLE_WEIGHTS}
        return validated

    def _validate_pedestrian_counts(self, raw_ped: Any) -> Dict[str, int]:
        if raw_ped is None:
            return {}
        if not isinstance(raw_ped, Mapping):
            raise ValidationError("Field 'pedestrian_counts' must be an object.", code="INVALID_PEDESTRIAN_COUNTS")
        out: Dict[str, int] = {}
        for ln, val in raw_ped.items():
            if ln not in LANES:
                raise ValidationError(
                    f"Invalid lane '{ln}' in 'pedestrian_counts'. Allowed lanes: {list(LANES)}",
                    code="INVALID_LANE",
                )
            if not _is_valid_int(val) or val < 0 or val > 5000:
                raise ValidationError(
                    f"Invalid pedestrian count '{val}' for '{ln}'. Must be an integer between 0 and 5000.",
                    code="INVALID_PEDESTRIAN_COUNT",
                )
            out[ln] = int(val)
        return out

    def _validate_prior_waiting(self, raw_wait: Any) -> Dict[str, float]:
        if raw_wait is None:
            return {}
        if not isinstance(raw_wait, Mapping):
            raise ValidationError("Field 'prior_waiting' must be an object.", code="INVALID_PRIOR_WAITING")
        out: Dict[str, float] = {}
        for ln, val in raw_wait.items():
            if ln not in LANES:
                raise ValidationError(
                    f"Invalid lane '{ln}' in 'prior_waiting'. Allowed lanes: {list(LANES)}",
                    code="INVALID_LANE",
                )
            if not _is_valid_number(val) or float(val) < 0 or float(val) > 86400:
                raise ValidationError(
                    f"Invalid waiting time '{val}' for '{ln}'. Must be a number between 0 and 86400 seconds.",
                    code="INVALID_WAITING_TIME",
                )
            out[ln] = float(val)
        return out

    def _detector_snapshot(self) -> Dict[str, Any]:
        return {
            "initialized": True,
            "model_loaded": self.detector._model is not None,
            "model_path": self.detector.model_path,
            "tracker": self.detector.tracker,
            "active_track_ids_by_lane": {
                ln: len(self.detector._seen_track_ids.get(ln, set())) for ln in LANES
            },
        }

    def get_health(self) -> Dict[str, Any]:
        with self.lock:
            db_ok = False
            try:
                with sqlite3.connect(self.db_path, timeout=3.0) as conn:
                    conn.execute("SELECT 1").fetchone()
                    db_ok = True
            except Exception as exc:
                logger.exception("Health check database probe failed: %s", exc)
                db_ok = False

            return {
                "ok": db_ok,
                "status": "healthy" if db_ok else "degraded",
                "service": "traffic-ai-engine",
                "port": int(os.getenv("PYTHON_API_PORT", "8000")),
                "uptime_seconds": round(time.monotonic() - self.started_at, 2),
                "db_connected": db_ok,
                "db_path": self.db_path,
                "controller_instance_id": self.hw_controller.controller_instance_id,
                "active_session_id": self.active_session_id,
                "active_junction_id": self.active_junction_id,
                "active_green_lane": self.hw_controller.active_green_lane,
                "current_phase": self.current_phase["stage"],
                "detector_state": self._detector_snapshot(),
            }

    def get_config(self) -> Dict[str, Any]:
        return {
            "lanes": list(LANES),
            "vehicle_weights": VEHICLE_WEIGHTS,
            "vehicle_length_meters": VEHICLE_LENGTH_METERS,
            "priority_weights": PRIORITY_WEIGHTS,
            "timing": {
                "min_green": MIN_GREEN,
                "max_green": MAX_GREEN,
                "k": K,
                "emergency_green": EMERGENCY_GREEN,
                "fixed_timer_green": FIXED_TIMER_GREEN,
                "max_waiting_time": MAX_WAITING_TIME,
                "starvation_priority_boost": STARVATION_PRIORITY_BOOST,
                "emergency_priority_boost": EMERGENCY_PRIORITY_BOOST,
                "yellow_transition_seconds": YELLOW_TRANSITION_SECONDS,
                "all_red_clearance_seconds": ALL_RED_CLEARANCE_SECONDS,
                "max_approach_capacity_meters": MAX_APPROACH_CAPACITY_METERS,
            },
            "simulation_mode": SIMULATION_MODE,
            "gpio_pin_map": GPIO_PIN_MAP,
            "junctions": REAL_WORLD_JUNCTIONS,
            "presets": SCENARIO_PRESETS,
            "video_feeds": TRAFFIC_LIVE_VIDEO_FEEDS,
        }

    def get_sqlite_summary(self) -> Dict[str, Any]:
        with self.lock:
            hw_status = self.hw_controller.get_status()
            return build_full_summary(
                db_path=self.db_path,
                session_id=ACTIVE_SESSION_SENTINEL,
                hw_status=hw_status,
            )

    def get_status(self) -> Dict[str, Any]:
        with self.lock:
            hw_status = self.hw_controller.get_status()
            summary = build_full_summary(
                db_path=self.db_path,
                session_id=ACTIVE_SESSION_SENTINEL,
                hw_status=hw_status,
            )
            return {
                "service_uptime_seconds": round(time.monotonic() - self.started_at, 2),
                "controller_instance_id": self.hw_controller.controller_instance_id,
                "active_junction_id": self.active_junction_id,
                "active_session_id": self.active_session_id,
                "last_active_green_lane": self.hw_controller.active_green_lane,
                "current_phase": dict(self.current_phase),
                "hardware_status": hw_status,
                "detector_state": self._detector_snapshot(),
                "last_cycle": self.last_cycle_result,
                "sqlite_summary": summary,
            }

    def execute_cycle(self, payload: Mapping[str, Any]) -> Dict[str, Any]:
        if not isinstance(payload, Mapping):
            raise ValidationError("Request body must be a JSON object.", code="INVALID_JSON")

        lane_counts = self._validate_lane_counts(payload.get("lane_counts"))
        pedestrian_counts = self._validate_pedestrian_counts(payload.get("pedestrian_counts"))
        prior_waiting = self._validate_prior_waiting(payload.get("prior_waiting"))
        forced_em = self._validate_lane(payload.get("emergency_lane"), "emergency_lane", allow_none=True)
        forced_active = self._validate_lane(payload.get("forced_active_lane"), "forced_active_lane", allow_none=True)
        junction_id = self._validate_junction_id(payload.get("junction_id"), default_to_active=True)

        persist_raw = payload.get("persist", True)
        if not isinstance(persist_raw, bool):
            raise ValidationError("Field 'persist' must be a boolean.", code="INVALID_PERSIST_FLAG")
        persist = bool(persist_raw)

        with self.lock:
            if junction_id != self.active_junction_id:
                self.active_junction_id = junction_id
                set_app_state("active_junction_id", junction_id, db_path=self.db_path)

            prev_green = self.hw_controller.active_green_lane
            scores = lane_score_series(limit=40, db_path=self.db_path, session_id=ACTIVE_SESSION_SENTINEL)
            predictions = forecast_lanes_from_history(scores)
            pred_scores = {ln: float(predictions["lanes"][ln]["predicted_score"]) for ln in LANES}

            ts = _utc_now_iso()
            summary = summarize_lanes(
                lane_counts,
                prior_waiting=prior_waiting,
                pedestrian_counts=pedestrian_counts,
            )
            active_em = forced_em if forced_em in LANES else detect_emergency_lane(summary)

            plan = compute_signal_plan(
                summary,
                emergency_lane=active_em,
                predictions=pred_scores,
                previous_green_lane=prev_green,
                forced_active_lane=forced_active,
            )

            active_green = next(
                (ln for ln in LANES if plan[ln].get("active_phase_signal") == "GREEN"),
                active_em or "north",
            )
            allocated_green = int(plan[active_green]["green_seconds"])
            mode_str = "EMERGENCY" if active_em else "ADAPTIVE"

            # Execute transition through the single persistent HardwareSignalController
            hw_status = self.hw_controller.transition_to_lane(
                active_green,
                allocated_green,
                mode=mode_str,
                sleep_transitions=False,
            )
            set_last_active_green_lane(active_green, db_path=self.db_path)

            if persist:
                log_cycle(
                    ts,
                    summary,
                    plan,
                    db_path=self.db_path,
                    session_id=self.active_session_id,
                    junction_id=self.active_junction_id,
                )
                if active_em:
                    log_emergency(
                        ts,
                        active_em,
                        db_path=self.db_path,
                        session_id=self.active_session_id,
                        junction_id=self.active_junction_id,
                    )
                    log_system_event(
                        ts,
                        "Emergency Preemption",
                        active_em.capitalize(),
                        "Immediate 25s GREEN via YELLOW->ALL_RED clearance",
                        "Active Override",
                        db_path=self.db_path,
                        session_id=self.active_session_id,
                        junction_id=self.active_junction_id,
                    )
                for ln in LANES:
                    if plan[ln].get("starvation_flagged"):
                        log_system_event(
                            ts,
                            "Starvation Protection",
                            ln.capitalize(),
                            f"Max wait {summary[ln]['maximum_waiting_time']}s > 90s; priority boost +35 applied",
                            "Fairness Boost",
                            db_path=self.db_path,
                            session_id=self.active_session_id,
                            junction_id=self.active_junction_id,
                        )

            lanes_out = {ln: {**summary[ln], **plan[ln]} for ln in LANES}
            sqlite_summary = build_full_summary(
                db_path=self.db_path,
                session_id=ACTIVE_SESSION_SENTINEL,
                hw_status=hw_status,
            )
            cycle_num = int(sqlite_summary["total_cycles"] or 1)

            # Optional MQTT publish without letting unreachable broker break request
            try:
                self.mqtt_bridge.publish_lane_counts(summary, ts=ts)
                self.mqtt_bridge.publish_signal_state(
                    summary, plan, emergency_lane=active_em, cycle=cycle_num, ts=ts
                )
                self.mqtt_bridge.publish_emergency(emergency_lane=active_em, cycle=cycle_num, ts=ts)
            except Exception as mqtt_exc:
                logger.warning("Optional MQTT publish skipped: %s", mqtt_exc)

            self.current_phase = {
                "stage": "GREEN",
                "active_green_lane": active_green,
                "previous_green_lane": prev_green,
                "green_seconds": allocated_green,
                "mode": mode_str,
                "transition_steps": hw_status.get("transition_steps", []),
                "executed_phases": hw_status.get("executed_phases", []),
                "updated_at": ts,
            }

            result = {
                "ts": ts,
                "cycle": cycle_num,
                "historical_cycles": sqlite_summary["historical_total_cycles"],
                "active_session_id": self.active_session_id,
                "junction_id": self.active_junction_id,
                "controller_instance_id": self.hw_controller.controller_instance_id,
                "emergency_lane": active_em,
                "active_green_lane": active_green,
                "previous_green_lane": prev_green,
                "transition_steps": hw_status.get("transition_steps", []),
                "executed_phases": hw_status.get("executed_phases", []),
                "lanes": lanes_out,
                "hardware_status": hw_status,
                "detector_state": self._detector_snapshot(),
                "sqlite_summary": sqlite_summary,
            }
            self.last_cycle_result = {
                "ts": ts,
                "cycle": cycle_num,
                "junction_id": self.active_junction_id,
                "active_green_lane": active_green,
                "previous_green_lane": prev_green,
                "emergency_lane": active_em,
                "transition_steps": hw_status.get("transition_steps", []),
            }
            return result

    def run_demo_batch(self, payload: Optional[Mapping[str, Any]] = None) -> Dict[str, Any]:
        body = payload or {}
        if not isinstance(body, Mapping):
            raise ValidationError("Request body must be a JSON object.", code="INVALID_JSON")

        raw_cycles = body.get("cycles", 4)
        if not _is_valid_int(raw_cycles) or raw_cycles < 1 or raw_cycles > 100:
            raise ValidationError(
                f"Field 'cycles' must be an integer between 1 and 100 (received {raw_cycles!r}).",
                code="INVALID_CYCLES_COUNT",
            )
        cycles = int(raw_cycles)
        junction_id = self._validate_junction_id(body.get("junction_id"), default_to_active=True)

        seed_raw = body.get("seed", 42)
        if not _is_valid_int(seed_raw):
            raise ValidationError("Field 'seed' must be an integer.", code="INVALID_SEED")
        rng = random.Random(int(seed_raw))

        with self.lock:
            start_offset = total_cycles(self.db_path, session_id=ACTIVE_SESSION_SENTINEL)
            batch_results: List[Dict[str, Any]] = []
            lines: List[str] = []

            for i in range(1, cycles + 1):
                synthetic_counts = generate_synthetic_counts(start_offset + i, rng=rng)
                res = self.execute_cycle(
                    {
                        "lane_counts": synthetic_counts,
                        "junction_id": junction_id,
                        "persist": True,
                    }
                )
                batch_results.append(res)
                lines.append(
                    f"Cycle {res['cycle']:02d}: GREEN={res['active_green_lane'].upper()} "
                    f"({res['lanes'][res['active_green_lane']]['green_seconds']}s) "
                    f"EM={res['emergency_lane'] or 'NONE'}"
                )

            export_json(
                out_path=os.path.join(os.path.dirname(self.db_path) or "data", "session_export.json"),
                db_path=self.db_path,
                session_id=ACTIVE_SESSION_SENTINEL,
            )
            final_summary = self.get_sqlite_summary()

            return {
                "ok": True,
                "cycles_executed": cycles,
                "junction_id": junction_id,
                "controller_instance_id": self.hw_controller.controller_instance_id,
                "pipeline_output": "\n".join(lines),
                "results": batch_results,
                "sqlite_summary": final_summary,
            }

    def reset_session(self, payload: Optional[Mapping[str, Any]] = None) -> Dict[str, Any]:
        body = payload or {}
        if not isinstance(body, Mapping):
            raise ValidationError("Request body must be a JSON object.", code="INVALID_JSON")

        junction_id = self._validate_junction_id(body.get("junction_id"), default_to_active=True)
        note = str(body.get("note") or "Operator experiment session reset")[:240]

        with self.lock:
            new_sid = reset_active_session(junction_id=junction_id, note=note, db_path=self.db_path)
            self.active_session_id = new_sid
            self.active_junction_id = junction_id
            set_app_state("active_junction_id", junction_id, db_path=self.db_path)

            # Reset fail-safe state on the SAME persistent controller and clear detector track memory
            self.hw_controller.fail_safe_all_red(
                reason="Operator session reset", preserve_active_green=False
            )
            self.detector.reset_track_memory()

            self.current_phase = {
                "stage": "STANDBY",
                "active_green_lane": None,
                "previous_green_lane": None,
                "green_seconds": 0,
                "mode": "STANDBY",
                "transition_steps": [],
                "executed_phases": [],
                "updated_at": _utc_now_iso(),
            }
            self.last_cycle_result = None

            summary = self.get_sqlite_summary()
            logger.info(
                "Active session reset to %s (junction=%s, controller=%s)",
                new_sid,
                junction_id,
                self.hw_controller.controller_instance_id,
            )
            return {
                "active_session_id": new_sid,
                "junction_id": junction_id,
                "controller_instance_id": self.hw_controller.controller_instance_id,
                "sqlite_summary": summary,
            }

    def get_history(
        self,
        limit: int = 25,
        session_id: str = ACTIVE_SESSION_SENTINEL,
        junction_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        if not _is_valid_int(limit) or limit < 1 or limit > 200:
            raise ValidationError(
                f"Query parameter 'limit' must be an integer between 1 and 200 (received {limit!r}).",
                code="INVALID_LIMIT",
            )
        if junction_id is not None and junction_id != "":
            self._validate_junction_id(junction_id, default_to_active=False)

        with self.lock:
            resolved_scope = None if str(session_id).upper() == "ALL" else session_id
            cycles = recent_cycles_summary(limit=limit, db_path=self.db_path, session_id=resolved_scope)
            if junction_id:
                cycles = [c for c in cycles if c.get("junction_id") == junction_id]

            emergencies = emergency_event_log(limit=limit, db_path=self.db_path, session_id=resolved_scope)
            sys_events = recent_system_events(limit=limit, db_path=self.db_path, session_id=resolved_scope)
            if junction_id:
                emergencies = [e for e in emergencies if e.get("junction_id") == junction_id]
                sys_events = [e for e in sys_events if e.get("junction_id") == junction_id]

            with sqlite3.connect(self.db_path, timeout=10.0) as conn:
                conn.row_factory = sqlite3.Row
                sess_rows = conn.execute(
                    "SELECT session_id, created_at, junction_id, status, note FROM sessions ORDER BY created_at DESC LIMIT 25"
                ).fetchall()
                sessions = [
                    {
                        "session_id": str(r["session_id"]),
                        "created_at": str(r["created_at"]),
                        "junction_id": str(r["junction_id"]),
                        "status": str(r["status"]),
                        "note": str(r["note"] or ""),
                    }
                    for r in sess_rows
                ]

            return {
                "scope": "ALL" if resolved_scope is None else self.active_session_id if str(session_id).upper() == ACTIVE_SESSION_SENTINEL else str(session_id),
                "active_session_id": self.active_session_id,
                "active_junction_id": self.active_junction_id,
                "session_cycles": total_cycles(self.db_path, session_id=ACTIVE_SESSION_SENTINEL),
                "historical_total_cycles": total_cycles(self.db_path, session_id=None),
                "recent_cycles": cycles,
                "emergency_events": emergencies,
                "system_events": sys_events,
                "sessions": sessions,
            }

    def shutdown(self) -> None:
        with self.lock:
            logger.info("Shutting down TrafficEngineService (controller=%s)", self.hw_controller.controller_instance_id)
            try:
                self.hw_controller.close()
            except Exception as exc:
                logger.warning("Error closing hardware controller: %s", exc)
            try:
                if self.mqtt_bridge is not None:
                    self.mqtt_bridge.close()
            except Exception as exc:
                logger.warning("Error closing MQTT bridge: %s", exc)
