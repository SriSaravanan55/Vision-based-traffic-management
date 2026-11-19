"""SQLite persistence, safe schema migration, session lifecycle, and SDG 11 analytics."""

import datetime
import json
import os
import sqlite3
import uuid
from typing import Dict, List, Any, Optional, Mapping
from .config import (
    LANES,
    DB_PATH,
    FIXED_TIMER_GREEN,
    REAL_WORLD_JUNCTIONS,
    PRIORITY_WEIGHTS,
    MAX_WAITING_TIME,
    SIMULATION_MODE,
    QUEUE_ESTIMATION_METHOD,
    SCENARIO_PRESETS,
)

ACTIVE_SESSION_SENTINEL = "ACTIVE"


def _utc_now_iso() -> str:
    return (
        datetime.datetime.now(datetime.timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def _connect(db_path: str = DB_PATH) -> sqlite3.Connection:
    parent = os.path.dirname(db_path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    conn = sqlite3.connect(db_path, timeout=10.0)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
    except sqlite3.Error:
        pass
    return conn


def _ensure_column(
    conn: sqlite3.Connection, table: str, column: str, definition: str
) -> None:
    cols = {str(r["name"]) for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in cols:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def init_db(db_path: str = DB_PATH) -> None:
    """Initialize SQLite tables and run safe idempotent migrations on existing DBs."""
    with _connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                session_id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                junction_id TEXT NOT NULL DEFAULT 'JCT-01',
                status TEXT NOT NULL DEFAULT 'active',
                note TEXT DEFAULT ''
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS app_state (
                key TEXT PRIMARY KEY,
                value TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS cycles (
                ts TEXT NOT NULL,
                lane TEXT NOT NULL,
                vehicle_total INTEGER NOT NULL,
                weighted_score REAL NOT NULL,
                density_level TEXT NOT NULL,
                density_share REAL NOT NULL,
                green_seconds INTEGER NOT NULL,
                mode TEXT NOT NULL,
                session_id TEXT NOT NULL DEFAULT 'legacy-session',
                junction_id TEXT NOT NULL DEFAULT 'JCT-01'
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS emergency_events (
                ts TEXT NOT NULL,
                lane TEXT NOT NULL,
                session_id TEXT NOT NULL DEFAULT 'legacy-session',
                junction_id TEXT NOT NULL DEFAULT 'JCT-01'
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS system_events (
                ts TEXT NOT NULL,
                event_type TEXT NOT NULL,
                road TEXT NOT NULL,
                detail TEXT NOT NULL,
                status TEXT NOT NULL,
                session_id TEXT NOT NULL DEFAULT 'legacy-session',
                junction_id TEXT NOT NULL DEFAULT 'JCT-01'
            )
            """
        )

        # Idempotent column migrations for legacy databases created before Phase 1
        _ensure_column(conn, "cycles", "session_id", "TEXT NOT NULL DEFAULT 'legacy-session'")
        _ensure_column(conn, "cycles", "junction_id", "TEXT NOT NULL DEFAULT 'JCT-01'")
        _ensure_column(conn, "emergency_events", "session_id", "TEXT NOT NULL DEFAULT 'legacy-session'")
        _ensure_column(conn, "emergency_events", "junction_id", "TEXT NOT NULL DEFAULT 'JCT-01'")
        _ensure_column(conn, "system_events", "session_id", "TEXT NOT NULL DEFAULT 'legacy-session'")
        _ensure_column(conn, "system_events", "junction_id", "TEXT NOT NULL DEFAULT 'JCT-01'")

        # Indexes for fast session & chronological queries
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_cycles_session_ts ON cycles(session_id, ts)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_emergency_session_ts ON emergency_events(session_id, ts)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_system_events_session_ts ON system_events(session_id, ts)"
        )

        # Ensure an active session exists without discarding legacy records
        active_row = conn.execute(
            "SELECT value FROM app_state WHERE key = 'active_session_id'"
        ).fetchone()
        if not active_row or not active_row["value"]:
            existing_cycles = conn.execute("SELECT COUNT(*) AS c FROM cycles").fetchone()["c"]
            if existing_cycles > 0:
                legacy_sid = "legacy-session"
                conn.execute(
                    """
                    INSERT OR IGNORE INTO sessions (session_id, created_at, junction_id, status, note)
                    VALUES (?, ?, 'JCT-01', 'active', 'Migrated pre-Phase 1 historical session')
                    """,
                    (legacy_sid, _utc_now_iso()),
                )
                active_sid = legacy_sid
            else:
                active_sid = f"sess-{uuid.uuid4().hex[:10]}"
                conn.execute(
                    """
                    INSERT OR IGNORE INTO sessions (session_id, created_at, junction_id, status, note)
                    VALUES (?, ?, 'JCT-01', 'active', 'Initial active session')
                    """,
                    (active_sid, _utc_now_iso()),
                )
            conn.execute(
                "INSERT OR REPLACE INTO app_state (key, value) VALUES ('active_session_id', ?)",
                (active_sid,),
            )

        conn.commit()


def get_app_state(key: str, default: Optional[str] = None, db_path: str = DB_PATH) -> Optional[str]:
    init_db(db_path)
    with _connect(db_path) as conn:
        row = conn.execute("SELECT value FROM app_state WHERE key = ?", (key,)).fetchone()
        return str(row["value"]) if row and row["value"] is not None else default


def set_app_state(key: str, value: Optional[str], db_path: str = DB_PATH) -> None:
    init_db(db_path)
    with _connect(db_path) as conn:
        if value is None:
            conn.execute("DELETE FROM app_state WHERE key = ?", (key,))
        else:
            conn.execute(
                "INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)",
                (key, str(value)),
            )
        conn.commit()


def get_active_session_id(db_path: str = DB_PATH) -> str:
    init_db(db_path)
    sid = get_app_state("active_session_id", db_path=db_path)
    return sid or "legacy-session"


def get_last_active_green_lane(db_path: str = DB_PATH) -> Optional[str]:
    lane = get_app_state("last_active_green_lane", db_path=db_path)
    return lane if lane in LANES else None


def set_last_active_green_lane(lane: Optional[str], db_path: str = DB_PATH) -> None:
    set_app_state(
        "last_active_green_lane",
        lane if lane in LANES else None,
        db_path=db_path,
    )


def reset_active_session(
    junction_id: str = "JCT-01", note: str = "Operator session reset", db_path: str = DB_PATH
) -> str:
    """Archive previous active sessions and start a fresh empty active experiment session.

    Historical cycles in prior sessions remain preserved in SQLite for audit reporting.
    """
    init_db(db_path)
    new_sid = f"sess-{datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:6]}"
    with _connect(db_path) as conn:
        conn.execute("UPDATE sessions SET status = 'archived' WHERE status = 'active'")
        conn.execute(
            """
            INSERT INTO sessions (session_id, created_at, junction_id, status, note)
            VALUES (?, ?, ?, 'active', ?)
            """,
            (new_sid, _utc_now_iso(), junction_id, note),
        )
        conn.execute(
            "INSERT OR REPLACE INTO app_state (key, value) VALUES ('active_session_id', ?)",
            (new_sid,),
        )
        conn.execute("DELETE FROM app_state WHERE key = 'last_active_green_lane'")
        conn.commit()
    return new_sid


def merge_legacy_db(legacy_db_path: str, target_db_path: str = DB_PATH) -> Dict[str, int]:
    """Safely merge any missing rows from a legacy SQLite DB into the canonical DB without duplicates."""
    init_db(target_db_path)
    if not os.path.exists(legacy_db_path):
        return {"cycles_added": 0, "emergency_events_added": 0, "system_events_added": 0}

    src = sqlite3.connect(legacy_db_path, timeout=10.0)
    src.row_factory = sqlite3.Row
    counts = {"cycles_added": 0, "emergency_events_added": 0, "system_events_added": 0}

    try:
        with _connect(target_db_path) as dst:
            existing_cycles = {
                (str(r["ts"]), str(r["lane"]))
                for r in dst.execute("SELECT ts, lane FROM cycles").fetchall()
            }
            for r in src.execute(
                "SELECT ts, lane, vehicle_total, weighted_score, density_level, density_share, green_seconds, mode FROM cycles"
            ).fetchall():
                key = (str(r["ts"]), str(r["lane"]))
                if key not in existing_cycles:
                    dst.execute(
                        """
                        INSERT INTO cycles (
                            ts, lane, vehicle_total, weighted_score,
                            density_level, density_share, green_seconds, mode,
                            session_id, junction_id
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'legacy-session', 'JCT-01')
                        """,
                        (
                            str(r["ts"]),
                            str(r["lane"]),
                            int(r["vehicle_total"]),
                            float(r["weighted_score"]),
                            str(r["density_level"]),
                            float(r["density_share"]),
                            int(r["green_seconds"]),
                            str(r["mode"]),
                        ),
                    )
                    existing_cycles.add(key)
                    counts["cycles_added"] += 1

            existing_em = {
                (str(r["ts"]), str(r["lane"]))
                for r in dst.execute("SELECT ts, lane FROM emergency_events").fetchall()
            }
            for r in src.execute("SELECT ts, lane FROM emergency_events").fetchall():
                key = (str(r["ts"]), str(r["lane"]))
                if key not in existing_em:
                    dst.execute(
                        """
                        INSERT INTO emergency_events (ts, lane, session_id, junction_id)
                        VALUES (?, ?, 'legacy-session', 'JCT-01')
                        """,
                        key,
                    )
                    existing_em.add(key)
                    counts["emergency_events_added"] += 1

            existing_sys = {
                (str(r["ts"]), str(r["event_type"]), str(r["road"]), str(r["detail"]))
                for r in dst.execute(
                    "SELECT ts, event_type, road, detail FROM system_events"
                ).fetchall()
            }
            for r in src.execute(
                "SELECT ts, event_type, road, detail, status FROM system_events"
            ).fetchall():
                key = (str(r["ts"]), str(r["event_type"]), str(r["road"]), str(r["detail"]))
                if key not in existing_sys:
                    dst.execute(
                        """
                        INSERT INTO system_events (ts, event_type, road, detail, status, session_id, junction_id)
                        VALUES (?, ?, ?, ?, ?, 'legacy-session', 'JCT-01')
                        """,
                        (
                            str(r["ts"]),
                            str(r["event_type"]),
                            str(r["road"]),
                            str(r["detail"]),
                            str(r["status"]),
                        ),
                    )
                    existing_sys.add(key)
                    counts["system_events_added"] += 1

            dst.commit()
    finally:
        src.close()

    return counts


def _resolve_session_id(
    session_id: Optional[str], db_path: str = DB_PATH
) -> Optional[str]:
    if session_id is None or str(session_id).upper() == "ALL":
        return None
    if str(session_id).upper() == ACTIVE_SESSION_SENTINEL:
        return get_active_session_id(db_path)
    return str(session_id)


def log_cycle(
    ts: str,
    summary_or_lane: Any,
    signal_plan_or_total: Any = None,
    weighted_score: Optional[float] = None,
    density_level: Optional[str] = None,
    density_share: Optional[float] = None,
    green_seconds: Optional[int] = None,
    mode: Optional[str] = None,
    db_path: str = DB_PATH,
    session_id: Optional[str] = ACTIVE_SESSION_SENTINEL,
    junction_id: str = "JCT-01",
) -> None:
    """Log cycle data to `cycles` table under the active (or explicit) session."""
    init_db(db_path)
    sid = _resolve_session_id(session_id, db_path) or get_active_session_id(db_path)
    rows_to_insert = []

    if isinstance(summary_or_lane, Mapping) and isinstance(signal_plan_or_total, Mapping):
        summary = summary_or_lane
        signal_plan = signal_plan_or_total
        for lane in LANES:
            s_data = summary.get(lane, {})
            p_data = signal_plan.get(lane, {})
            rows_to_insert.append(
                (
                    str(ts),
                    str(lane),
                    int(s_data.get("vehicle_total", 0)),
                    float(s_data.get("weighted_score", 0.0)),
                    str(s_data.get("density_level", "Low")),
                    float(s_data.get("density_share", 0.25)),
                    int(p_data.get("green_seconds", 15)),
                    str(p_data.get("mode", "normal")),
                    sid,
                    str(junction_id or "JCT-01"),
                )
            )
    else:
        rows_to_insert.append(
            (
                str(ts),
                str(summary_or_lane),
                int(signal_plan_or_total or 0),
                float(weighted_score or 0.0),
                str(density_level or "Low"),
                float(density_share or 0.0),
                int(green_seconds or 0),
                str(mode or "normal"),
                sid,
                str(junction_id or "JCT-01"),
            )
        )

    with _connect(db_path) as conn:
        conn.executemany(
            """
            INSERT INTO cycles (
                ts, lane, vehicle_total, weighted_score,
                density_level, density_share, green_seconds, mode,
                session_id, junction_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            rows_to_insert,
        )
        conn.commit()


def log_emergency(
    ts: str,
    lane: str,
    db_path: str = DB_PATH,
    session_id: Optional[str] = ACTIVE_SESSION_SENTINEL,
    junction_id: str = "JCT-01",
) -> None:
    """Log an emergency vehicle preemption event to `emergency_events`."""
    init_db(db_path)
    sid = _resolve_session_id(session_id, db_path) or get_active_session_id(db_path)
    with _connect(db_path) as conn:
        conn.execute(
            "INSERT INTO emergency_events (ts, lane, session_id, junction_id) VALUES (?, ?, ?, ?)",
            (str(ts), str(lane), sid, str(junction_id or "JCT-01")),
        )
        conn.commit()


def total_cycles(
    db_path: str = DB_PATH, session_id: Optional[str] = ACTIVE_SESSION_SENTINEL
) -> int:
    """Return total number of distinct intersection cycles logged (for active session by default, or all when session_id=None)."""
    init_db(db_path)
    sid = _resolve_session_id(session_id, db_path)
    with _connect(db_path) as conn:
        if sid is None:
            row = conn.execute("SELECT COUNT(DISTINCT ts) AS cnt FROM cycles").fetchone()
        else:
            row = conn.execute(
                "SELECT COUNT(DISTINCT ts) AS cnt FROM cycles WHERE session_id = ?",
                (sid,),
            ).fetchone()
        return int(row["cnt"]) if row else 0


def avg_green_time_by_lane(
    db_path: str = DB_PATH, session_id: Optional[str] = ACTIVE_SESSION_SENTINEL
) -> Dict[str, float]:
    init_db(db_path)
    sid = _resolve_session_id(session_id, db_path)
    result: Dict[str, float] = {lane: 0.0 for lane in LANES}
    with _connect(db_path) as conn:
        if sid is None:
            rows = conn.execute(
                "SELECT lane, AVG(green_seconds) AS avg_green FROM cycles GROUP BY lane"
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT lane, AVG(green_seconds) AS avg_green FROM cycles WHERE session_id = ? GROUP BY lane",
                (sid,),
            ).fetchall()
        for row in rows:
            lane_name = str(row["lane"])
            if lane_name in result and row["avg_green"] is not None:
                result[lane_name] = round(float(row["avg_green"]), 2)
    return result


def busiest_lane_counts(
    db_path: str = DB_PATH, session_id: Optional[str] = ACTIVE_SESSION_SENTINEL
) -> Dict[str, int]:
    init_db(db_path)
    sid = _resolve_session_id(session_id, db_path)
    counts: Dict[str, int] = {lane: 0 for lane in LANES}
    with _connect(db_path) as conn:
        if sid is None:
            rows = conn.execute(
                "SELECT ts, lane, weighted_score FROM cycles ORDER BY ts ASC"
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT ts, lane, weighted_score FROM cycles WHERE session_id = ? ORDER BY ts ASC",
                (sid,),
            ).fetchall()

    by_ts: Dict[str, List[sqlite3.Row]] = {}
    for row in rows:
        by_ts.setdefault(str(row["ts"]), []).append(row)

    for _, cycle_rows in by_ts.items():
        if not cycle_rows:
            continue
        winner = max(cycle_rows, key=lambda r: (float(r["weighted_score"]), str(r["lane"])))
        lane_name = str(winner["lane"])
        if lane_name in counts:
            counts[lane_name] += 1

    return counts


def emergency_event_log(
    limit: int = 20,
    db_path: str = DB_PATH,
    session_id: Optional[str] = ACTIVE_SESSION_SENTINEL,
) -> List[Dict[str, str]]:
    init_db(db_path)
    sid = _resolve_session_id(session_id, db_path)
    with _connect(db_path) as conn:
        if sid is None:
            rows = conn.execute(
                "SELECT ts, lane, junction_id FROM emergency_events ORDER BY rowid DESC LIMIT ?",
                (int(limit),),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT ts, lane, junction_id FROM emergency_events WHERE session_id = ? ORDER BY rowid DESC LIMIT ?",
                (sid, int(limit)),
            ).fetchall()
    return [
        {"ts": str(r["ts"]), "lane": str(r["lane"]), "junction_id": str(r["junction_id"])}
        for r in rows
    ]


def waiting_time_comparison(
    db_path: str = DB_PATH, session_id: Optional[str] = ACTIVE_SESSION_SENTINEL
) -> Dict[str, Any]:
    """Compare Fixed-Timer Baseline vs Adaptive Signal Control waiting times."""
    init_db(db_path)
    sid = _resolve_session_id(session_id, db_path)
    with _connect(db_path) as conn:
        if sid is None:
            rows = conn.execute(
                "SELECT ts, lane, vehicle_total, green_seconds, mode FROM cycles ORDER BY ts ASC"
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT ts, lane, vehicle_total, green_seconds, mode FROM cycles WHERE session_id = ? ORDER BY ts ASC",
                (sid,),
            ).fetchall()

    by_ts: Dict[str, List[sqlite3.Row]] = {}
    for row in rows:
        by_ts.setdefault(str(row["ts"]), []).append(row)

    lane_wait_sums: Dict[str, float] = {lane: 0.0 for lane in LANES}
    lane_fixed_sums: Dict[str, float] = {lane: 0.0 for lane in LANES}
    lane_active_cycles: Dict[str, int] = {lane: 0 for lane in LANES}

    total_vehicle_adaptive_wait = 0.0
    total_vehicle_fixed_wait = 0.0
    total_vehicles_observed = 0

    fixed_cycle_total = 4 * FIXED_TIMER_GREEN
    fixed_red_per_lane = 3 * FIXED_TIMER_GREEN
    fixed_effective_wait = fixed_red_per_lane * (1.0 - 0.5 * (FIXED_TIMER_GREEN / fixed_cycle_total))

    for _, c_rows in by_ts.items():
        cycle_green_total = sum(int(r["green_seconds"]) for r in c_rows)
        if cycle_green_total <= 0:
            cycle_green_total = 1

        for r in c_rows:
            lane = str(r["lane"])
            veh = int(r["vehicle_total"])
            g_sec = int(r["green_seconds"])

            if veh <= 0:
                continue

            red_seconds = max(0, cycle_green_total - g_sec)
            green_ratio = g_sec / cycle_green_total
            adaptive_wait = red_seconds * (1.0 - 0.5 * green_ratio)

            lane_wait_sums[lane] = lane_wait_sums.get(lane, 0.0) + adaptive_wait
            lane_fixed_sums[lane] = lane_fixed_sums.get(lane, 0.0) + fixed_effective_wait
            lane_active_cycles[lane] = lane_active_cycles.get(lane, 0) + 1

            total_vehicle_adaptive_wait += adaptive_wait * veh
            total_vehicle_fixed_wait += fixed_effective_wait * veh
            total_vehicles_observed += veh

    per_lane_avg_wait: Dict[str, Dict[str, float]] = {}
    for lane in LANES:
        cnt = lane_active_cycles[lane]
        ad_avg = round(lane_wait_sums[lane] / cnt, 2) if cnt > 0 else 0.0
        fx_avg = round(lane_fixed_sums[lane] / cnt, 2) if cnt > 0 else 0.0
        red_pct = round(((fx_avg - ad_avg) / fx_avg) * 100.0, 1) if fx_avg > 0 else 0.0
        per_lane_avg_wait[lane] = {
            "fixed_wait_seconds": fx_avg,
            "adaptive_wait_seconds": ad_avg,
            "reduction_pct": red_pct,
        }

    if total_vehicles_observed > 0:
        avg_adaptive_per_veh = round(total_vehicle_adaptive_wait / total_vehicles_observed, 2)
        avg_fixed_per_veh = round(total_vehicle_fixed_wait / total_vehicles_observed, 2)
        overall_reduction_pct = (
            round(((avg_fixed_per_veh - avg_adaptive_per_veh) / avg_fixed_per_veh) * 100.0, 2)
            if avg_fixed_per_veh > 0
            else 0.0
        )
        total_saved_vehicle_seconds = max(0.0, total_vehicle_fixed_wait - total_vehicle_adaptive_wait)
        fuel_saved_liters = round((total_saved_vehicle_seconds / 3600.0) * 0.95, 2)
        co2_saved_kg = round(fuel_saved_liters * 2.35, 2)
    else:
        avg_adaptive_per_veh = 0.0
        avg_fixed_per_veh = 0.0
        overall_reduction_pct = 0.0
        fuel_saved_liters = 0.0
        co2_saved_kg = 0.0

    return {
        "fixed_baseline_wait_s": avg_fixed_per_veh,
        "adaptive_wait_s": avg_adaptive_per_veh,
        "wait_reduction_s": round(avg_fixed_per_veh - avg_adaptive_per_veh, 2),
        "wait_reduction_pct": overall_reduction_pct,
        "total_vehicles_evaluated": total_vehicles_observed,
        "fuel_saved_liters": fuel_saved_liters,
        "co2_saved_kg": co2_saved_kg,
        "per_lane": per_lane_avg_wait,
    }


def recent_cycles_summary(
    limit: int = 12,
    db_path: str = DB_PATH,
    session_id: Optional[str] = ACTIVE_SESSION_SENTINEL,
) -> List[Dict[str, Any]]:
    init_db(db_path)
    sid = _resolve_session_id(session_id, db_path)
    with _connect(db_path) as conn:
        if sid is None:
            rows = conn.execute(
                """
                SELECT ts, lane, vehicle_total, weighted_score,
                       density_level, density_share, green_seconds, mode, junction_id
                FROM cycles
                ORDER BY ts DESC
                LIMIT ?
                """,
                (int(limit * 4),),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT ts, lane, vehicle_total, weighted_score,
                       density_level, density_share, green_seconds, mode, junction_id
                FROM cycles
                WHERE session_id = ?
                ORDER BY ts DESC
                LIMIT ?
                """,
                (sid, int(limit * 4)),
            ).fetchall()

    grouped: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        ts = str(r["ts"])
        if ts not in grouped:
            grouped[ts] = {"ts": ts, "junction_id": str(r["junction_id"]), "lanes": {}}
        grouped[ts]["lanes"][str(r["lane"])] = {
            "vehicle_total": int(r["vehicle_total"]),
            "weighted_score": float(r["weighted_score"]),
            "density_level": str(r["density_level"]),
            "density_share": float(r["density_share"]),
            "green_seconds": int(r["green_seconds"]),
            "mode": str(r["mode"]),
        }
    return list(grouped.values())[:limit]


def lane_score_series(
    limit: int = 40,
    db_path: str = DB_PATH,
    session_id: Optional[str] = ACTIVE_SESSION_SENTINEL,
) -> Dict[str, List[float]]:
    init_db(db_path)
    sid = _resolve_session_id(session_id, db_path)
    series: Dict[str, List[float]] = {lane: [] for lane in LANES}
    with _connect(db_path) as conn:
        if sid is None:
            rows = conn.execute(
                "SELECT ts, lane, weighted_score FROM cycles ORDER BY ts ASC"
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT ts, lane, weighted_score FROM cycles WHERE session_id = ? ORDER BY ts ASC",
                (sid,),
            ).fetchall()
    for r in rows:
        ln = str(r["lane"])
        if ln in series:
            series[ln].append(float(r["weighted_score"]))
    for ln in LANES:
        series[ln] = series[ln][-limit:]
    return series


def log_system_event(
    ts: str,
    event_type: str,
    road: str,
    detail: str,
    status: str = "Verified",
    db_path: str = DB_PATH,
    session_id: Optional[str] = ACTIVE_SESSION_SENTINEL,
    junction_id: str = "JCT-01",
) -> None:
    init_db(db_path)
    sid = _resolve_session_id(session_id, db_path) or get_active_session_id(db_path)
    with _connect(db_path) as conn:
        conn.execute(
            """
            INSERT INTO system_events (ts, event_type, road, detail, status, session_id, junction_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (str(ts), str(event_type), str(road), str(detail), str(status), sid, str(junction_id or "JCT-01")),
        )
        conn.commit()


def recent_system_events(
    limit: int = 20,
    db_path: str = DB_PATH,
    session_id: Optional[str] = ACTIVE_SESSION_SENTINEL,
) -> List[Dict[str, str]]:
    init_db(db_path)
    sid = _resolve_session_id(session_id, db_path)
    with _connect(db_path) as conn:
        if sid is None:
            rows = conn.execute(
                "SELECT ts, event_type, road, detail, status, junction_id FROM system_events ORDER BY rowid DESC LIMIT ?",
                (int(limit),),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT ts, event_type, road, detail, status, junction_id FROM system_events WHERE session_id = ? ORDER BY rowid DESC LIMIT ?",
                (sid, int(limit)),
            ).fetchall()
    return [
        {
            "ts": str(r["ts"]),
            "event_type": str(r["event_type"]),
            "road": str(r["road"]),
            "detail": str(r["detail"]),
            "status": str(r["status"]),
            "junction_id": str(r["junction_id"]),
        }
        for r in rows
    ]


def build_full_summary(
    db_path: str = DB_PATH,
    session_id: Optional[str] = ACTIVE_SESSION_SENTINEL,
    hw_status: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Unified summary builder used identically by /api/sqlite/summary, execute-cycle, run-demo-batch, and reset."""
    from .predictor import forecast_lanes_from_history
    from .hardware_controller import HardwareSignalController, GPIO_PIN_MAP

    init_db(db_path)
    active_sid = get_active_session_id(db_path)
    last_green = get_last_active_green_lane(db_path)

    if hw_status is None:
        hw = HardwareSignalController(initial_active_green=last_green)
        hardware_block = {
            "controller_instance_id": hw.controller_instance_id,
            "active_green_lane": hw.active_green_lane,
            "simulation_mode": hw.simulation_mode,
            "hardware_mode": not hw.simulation_mode,
            "interlock_ok": True,
            "gpio_pin_map": GPIO_PIN_MAP,
            "pin_states": hw.get_pin_telemetry(),
        }
    else:
        hardware_block = {
            "controller_instance_id": hw_status.get("controller_instance_id"),
            "active_green_lane": hw_status.get("active_green_lane"),
            "simulation_mode": hw_status.get("simulation_mode", SIMULATION_MODE),
            "hardware_mode": hw_status.get("hardware_mode", not SIMULATION_MODE),
            "interlock_ok": hw_status.get("interlock_ok", True),
            "gpio_pin_map": hw_status.get("gpio_pin_map", GPIO_PIN_MAP),
            "pin_states": hw_status.get("pin_states", {}),
            "transition_steps": hw_status.get("transition_steps", []),
        }

    score_history = lane_score_series(limit=40, db_path=db_path, session_id=session_id)
    predictions = forecast_lanes_from_history(score_history)

    return {
        "db_path": db_path,
        "active_session_id": active_sid,
        "last_active_green_lane": last_green,
        "total_cycles": total_cycles(db_path, session_id=session_id),
        "historical_total_cycles": total_cycles(db_path, session_id=None),
        "avg_green_time_by_lane": avg_green_time_by_lane(db_path, session_id=session_id),
        "busiest_lane_counts": busiest_lane_counts(db_path, session_id=session_id),
        "emergency_events": emergency_event_log(limit=25, db_path=db_path, session_id=session_id),
        "system_events": recent_system_events(limit=25, db_path=db_path, session_id=session_id),
        "waiting_time_comparison": waiting_time_comparison(db_path, session_id=session_id),
        "predictions": predictions,
        "hardware": hardware_block,
        "priority_config": {
            "weights": PRIORITY_WEIGHTS,
            "max_waiting_time": MAX_WAITING_TIME,
            "queue_estimation_method": QUEUE_ESTIMATION_METHOD,
        },
        "recent_cycles": recent_cycles_summary(limit=12, db_path=db_path, session_id=session_id),
        "junctions": REAL_WORLD_JUNCTIONS,
        "presets": SCENARIO_PRESETS,
    }


def export_json(
    out_path: str = "data/session_export.json",
    db_path: str = DB_PATH,
    session_id: Optional[str] = ACTIVE_SESSION_SENTINEL,
) -> Dict[str, Any]:
    """Export aggregated session telemetry, ML predictions, and recent events to a JSON file."""
    payload = build_full_summary(db_path=db_path, session_id=session_id)
    parent = os.path.dirname(out_path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    return payload
