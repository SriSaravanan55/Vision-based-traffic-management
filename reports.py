"""Session analytics and SDG 11 waiting-time comparison report generator.

Usage:
    python reports.py [--export data/session_export.json]
"""

import argparse
from typing import Optional
from traffic_ai.config import LANES, DB_PATH
from traffic_ai.storage import (
    ACTIVE_SESSION_SENTINEL,
    get_active_session_id,
    total_cycles,
    avg_green_time_by_lane,
    busiest_lane_counts,
    emergency_event_log,
    waiting_time_comparison,
    lane_score_series,
    export_json,
)
from traffic_ai.predictor import forecast_lanes_from_history


def print_report(
    db_path: str = DB_PATH,
    export_path: Optional[str] = None,
    all_sessions: bool = False,
) -> None:
    sid = None if all_sessions else ACTIVE_SESSION_SENTINEL
    active_sid = get_active_session_id(db_path)
    cycles_count = total_cycles(db_path, session_id=sid)
    historical_count = total_cycles(db_path, session_id=None)
    avg_green = avg_green_time_by_lane(db_path, session_id=sid)
    busiest = busiest_lane_counts(db_path, session_id=sid)
    emergencies = emergency_event_log(limit=10, db_path=db_path, session_id=sid)
    wait_stats = waiting_time_comparison(db_path, session_id=sid)

    print("=" * 72)
    print(" AI-BASED SMART TRAFFIC MANAGEMENT SYSTEM — SESSION TELEMETRY REPORT")
    print("=" * 72)
    print(f" Database Path           : {db_path}")
    print(f" Scope                   : {'ALL HISTORICAL SESSIONS' if all_sessions else f'ACTIVE SESSION ({active_sid})'}")
    print(f" Cycles in Scope         : {cycles_count} (Historical Total: {historical_count})")
    print("-" * 72)

    if cycles_count == 0:
        print(" No traffic cycles recorded in this scope. Run `python -m traffic_ai.pipeline --demo` first.")
        print("=" * 72)
        return

    print(" 1. AVERAGE GREEN TIME & BUSIEST LANE FREQUENCY")
    print(f"    {'LANE':<10} | {'AVG GREEN (s)':>14} | {'BUSIEST CYCLES':>16} | {'SHARE (%)':>10}")
    print("    " + "-" * 58)
    for lane in LANES:
        b_cnt = busiest.get(lane, 0)
        b_pct = (b_cnt / cycles_count * 100.0) if cycles_count > 0 else 0.0
        print(
            f"    {lane.upper():<10} | {avg_green.get(lane, 0.0):>13.2f}s | "
            f"{b_cnt:>16d} | {b_pct:>9.1f}%"
        )

    print("-" * 72)
    print(" 2. SDG 11 WAITING-TIME COMPARISON (FIXED-TIMER 30s vs ADAPTIVE AI)")
    print(
        f"    Total Queued Vehicles Evaluated : {wait_stats['total_vehicles_evaluated']}"
    )
    print(
        f"    Fixed-Timer Baseline Avg Wait   : {wait_stats['fixed_baseline_wait_s']:.2f}s / vehicle"
    )
    print(
        f"    Adaptive Signal Avg Wait        : {wait_stats['adaptive_wait_s']:.2f}s / vehicle"
    )
    print(
        f"    Net Waiting-Time Reduction      : {wait_stats['wait_reduction_s']:.2f}s "
        f"({wait_stats['wait_reduction_pct']:.2f}% reduction)"
    )
    print(
        f"    Estimated Idle Fuel Saved       : {wait_stats.get('fuel_saved_liters', 0.0):.2f} Liters"
    )
    print(
        f"    Estimated CO2 Emissions Avoided : {wait_stats.get('co2_saved_kg', 0.0):.2f} kg CO2"
    )
    print("\n    Per-Lane Red-Phase Waiting Time While Vehicles Present:")
    print(
        f"    {'LANE':<10} | {'FIXED WAIT (s)':>15} | {'ADAPTIVE WAIT (s)':>18} | {'REDUCTION':>11}"
    )
    print("    " + "-" * 62)
    for lane in LANES:
        lw = wait_stats["per_lane"].get(lane, {})
        print(
            f"    {lane.upper():<10} | {lw.get('fixed_wait_seconds', 0.0):>14.2f}s | "
            f"{lw.get('adaptive_wait_seconds', 0.0):>17.2f}s | "
            f"{lw.get('reduction_pct', 0.0):>9.1f}%"
        )

    print("-" * 72)
    print(f" 3. RECENT EMERGENCY PREEMPTION EVENTS ({len(emergencies)} shown)")
    if not emergencies:
        print("    None recorded.")
    else:
        for ev in emergencies:
            print(f"    - [{ev['ts']}] Emergency green preemption on {ev['lane'].upper()} (25s)")

    pred_report = forecast_lanes_from_history(
        lane_score_series(limit=40, db_path=db_path, session_id=sid)
    )
    print("-" * 72)
    print(" 4. 5-MINUTE ML TRAFFIC PREDICTION & BACKTEST METRICS")
    print(f"    Model             : {pred_report['model']}")
    print(f"    Evaluated Samples : {pred_report['evaluated_samples']} rolling one-step-ahead forecasts")
    print(f"    Measured MAE      : {pred_report['mae']:.2f} weighted score units")
    print(f"    Measured RMSE     : {pred_report['rmse']:.2f} weighted score units")
    for lane in LANES:
        lp = pred_report["lanes"][lane]
        print(
            f"    - {lane.upper():<6} -> Next 5m Score: {lp['predicted_score']:5.2f} "
            f"({lp['predicted_code']:<9}) | Lane MAE: {lp['lane_mae']:.2f}"
        )

    if export_path:
        export_json(out_path=export_path, db_path=db_path, session_id=sid)
        print("-" * 72)
        print(f" Exported JSON summary to: {export_path}")

    print("=" * 72)


def main() -> None:
    parser = argparse.ArgumentParser(description="Print session traffic report from SQLite")
    parser.add_argument("--db", type=str, default=DB_PATH, help="SQLite DB file path")
    parser.add_argument(
        "--all",
        action="store_true",
        help="Include all historical experiment sessions instead of only the active session",
    )
    parser.add_argument(
        "--export",
        type=str,
        default=None,
        help="Optional path to export JSON summary (e.g., data/session_export.json)",
    )
    args = parser.parse_args()
    print_report(db_path=args.db, export_path=args.export, all_sessions=args.all)


if __name__ == "__main__":
    main()
