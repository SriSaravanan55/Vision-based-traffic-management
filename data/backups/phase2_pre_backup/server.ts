import express from 'express';
import { createServer as createViteServer } from 'vite';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execFileAsync = promisify(execFile);

const PORT = Number(process.env.PORT || 3000);
const WORKSPACE_ROOT = process.cwd();
const DB_PATH = process.env.TRAFFIC_DB_PATH
  ? path.resolve(WORKSPACE_ROOT, process.env.TRAFFIC_DB_PATH)
  : path.join(WORKSPACE_ROOT, 'data', 'traffic_history.db');

async function runPythonScript(pythonCode: string, args: string[] = []) {
  const { stdout, stderr } = await execFileAsync(
    'python3',
    ['-c', pythonCode, ...args],
    {
      cwd: WORKSPACE_ROOT,
      env: {
        ...process.env,
        TRAFFIC_DB_PATH: DB_PATH,
        SDL_VIDEODRIVER: 'dummy',
      },
      timeout: 15000,
    }
  );
  return { stdout, stderr };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // 0. Canonical System Configuration Endpoint (Single Source of Truth from traffic_ai.config)
  app.get('/api/config', async (_req, res) => {
    try {
      const script = `
import json
from traffic_ai.config import (
    LANES, VEHICLE_WEIGHTS, VEHICLE_LENGTH_METERS, PRIORITY_WEIGHTS,
    MIN_GREEN, MAX_GREEN, K, EMERGENCY_GREEN, FIXED_TIMER_GREEN,
    MAX_WAITING_TIME, STARVATION_PRIORITY_BOOST, EMERGENCY_PRIORITY_BOOST,
    YELLOW_TRANSITION_SECONDS, ALL_RED_CLEARANCE_SECONDS,
    MAX_APPROACH_CAPACITY_METERS, REAL_WORLD_JUNCTIONS,
    SCENARIO_PRESETS, TRAFFIC_LIVE_VIDEO_FEEDS, SIMULATION_MODE
)
from traffic_ai.hardware_controller import GPIO_PIN_MAP

print(json.dumps({
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
}))
`;
      const { stdout } = await runPythonScript(script);
      const data = JSON.parse(stdout.trim());
      res.json({ ok: true, data });
    } catch (error: any) {
      res.status(500).json({
        ok: false,
        error: error?.message || 'Failed to load canonical Python configuration',
      });
    }
  });

  // 1. Live SQLite Telemetry, ML Predictions, Hardware GPIO Status & SDG 11 Report Endpoint
  app.get('/api/sqlite/summary', async (_req, res) => {
    try {
      const script = `
import json
from traffic_ai.config import DB_PATH
from traffic_ai.storage import build_full_summary, ACTIVE_SESSION_SENTINEL

print(json.dumps(build_full_summary(db_path=DB_PATH, session_id=ACTIVE_SESSION_SENTINEL)))
`;
      const { stdout } = await runPythonScript(script);
      const data = JSON.parse(stdout.trim());
      res.json({ ok: true, data });
    } catch (error: any) {
      res.status(500).json({
        ok: false,
        error: error?.message || 'Failed to query Python SQLite database',
      });
    }
  });

  // 2. Execute a real cycle through Python traffic_ai.density + signal_controller + predictor + storage
  app.post('/api/pipeline/execute-cycle', async (req, res) => {
    try {
      const {
        lane_counts = {},
        pedestrian_counts = {},
        prior_waiting = {},
        emergency_lane = null,
        forced_active_lane = null,
        junction_id = 'JCT-01',
        persist = true,
      } = req.body || {};

      const inputJson = JSON.stringify({
        lane_counts,
        pedestrian_counts,
        prior_waiting,
        emergency_lane,
        forced_active_lane,
        junction_id,
        persist,
      });

      const script = `
import sys, json, datetime
from traffic_ai.density import summarize_lanes
from traffic_ai.signal_controller import compute_signal_plan, detect_emergency_lane
from traffic_ai.predictor import forecast_lanes_from_history
from traffic_ai.hardware_controller import HardwareSignalController
from traffic_ai.storage import (
    init_db, log_cycle, log_emergency, total_cycles,
    lane_score_series, log_system_event, build_full_summary,
    get_active_session_id, get_last_active_green_lane,
    set_last_active_green_lane, ACTIVE_SESSION_SENTINEL
)
from traffic_ai.config import LANES, DB_PATH, REAL_WORLD_JUNCTIONS

req = json.loads(sys.argv[1])
lane_counts = req.get("lane_counts", {})
pedestrian_counts = req.get("pedestrian_counts", {})
prior_waiting = req.get("prior_waiting", {})
forced_em = req.get("emergency_lane")
forced_active = req.get("forced_active_lane")
junction_id = str(req.get("junction_id") or "JCT-01")
if junction_id not in REAL_WORLD_JUNCTIONS:
    junction_id = "JCT-01"
persist = bool(req.get("persist", True))

init_db(DB_PATH)
active_sid = get_active_session_id(DB_PATH)
prev_green = get_last_active_green_lane(DB_PATH)

scores = lane_score_series(limit=40, db_path=DB_PATH, session_id=ACTIVE_SESSION_SENTINEL)
predictions = forecast_lanes_from_history(scores)
pred_scores = {ln: predictions["lanes"][ln]["predicted_score"] for ln in LANES}

ts = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
summary = summarize_lanes(lane_counts, prior_waiting=prior_waiting, pedestrian_counts=pedestrian_counts)
active_em = forced_em if forced_em in LANES else detect_emergency_lane(summary)

plan = compute_signal_plan(
    summary,
    emergency_lane=active_em,
    predictions=pred_scores,
    previous_green_lane=prev_green,
    forced_active_lane=forced_active if forced_active in LANES else None,
)

active_green = next((ln for ln in LANES if plan[ln].get("active_phase_signal") == "GREEN"), active_em or "north")
hw = HardwareSignalController(initial_active_green=prev_green)
hw_status = hw.transition_to_lane(
    active_green,
    int(plan[active_green]["green_seconds"]),
    mode="EMERGENCY" if active_em else "ADAPTIVE",
)
set_last_active_green_lane(active_green, db_path=DB_PATH)

if persist:
    log_cycle(ts, summary, plan, db_path=DB_PATH, session_id=active_sid, junction_id=junction_id)
    if active_em:
        log_emergency(ts, active_em, db_path=DB_PATH, session_id=active_sid, junction_id=junction_id)
        log_system_event(
            ts, "Emergency Preemption", active_em.capitalize(),
            "Immediate 25s GREEN via YELLOW->ALL_RED clearance",
            "Active Override", db_path=DB_PATH, session_id=active_sid, junction_id=junction_id
        )
    for ln in LANES:
        if plan[ln].get("starvation_flagged"):
            log_system_event(
                ts, "Starvation Protection", ln.capitalize(),
                f"Max wait {summary[ln]['maximum_waiting_time']}s > 90s; priority boost +35 applied",
                "Fairness Boost", db_path=DB_PATH, session_id=active_sid, junction_id=junction_id
            )

lanes_out = {}
for ln in LANES:
    lanes_out[ln] = {
        **summary[ln],
        **plan[ln],
    }

sqlite_summary = build_full_summary(db_path=DB_PATH, session_id=ACTIVE_SESSION_SENTINEL, hw_status=hw_status)

print(json.dumps({
    "ts": ts,
    "cycle": sqlite_summary["total_cycles"] or 1,
    "historical_cycles": sqlite_summary["historical_total_cycles"],
    "active_session_id": active_sid,
    "junction_id": junction_id,
    "emergency_lane": active_em,
    "active_green_lane": active_green,
    "previous_green_lane": prev_green,
    "transition_steps": hw_status.get("transition_steps", []),
    "lanes": lanes_out,
    "hardware_status": hw_status,
    "sqlite_summary": sqlite_summary,
}))
`;
      const { stdout } = await runPythonScript(script, [inputJson]);
      const result = JSON.parse(stdout.trim());
      res.json({ ok: true, result });
    } catch (error: any) {
      res.status(500).json({
        ok: false,
        error: error?.message || 'Python cycle execution failed',
      });
    }
  });

  // 3. Run multi-cycle Python CLI demo batch and return real CLI report + unified SQLite summary
  app.post('/api/pipeline/run-demo-batch', async (req, res) => {
    try {
      const cycles = Math.min(20, Math.max(1, Number(req.body?.cycles || 4)));
      const junctionId = String(req.body?.junction_id || 'JCT-01');

      const { stdout: pipeOut } = await execFileAsync(
        'python3',
        [
          '-m',
          'traffic_ai.pipeline',
          '--demo',
          '--cycles',
          String(cycles),
          '--sim-seconds',
          '0.02',
          '--junction',
          junctionId,
        ],
        {
          cwd: WORKSPACE_ROOT,
          env: {
            ...process.env,
            TRAFFIC_DB_PATH: DB_PATH,
            SDL_VIDEODRIVER: 'dummy',
          },
          timeout: 20000,
        }
      );

      const { stdout: repOut } = await execFileAsync(
        'python3',
        ['reports.py', '--export', 'data/session_export.json'],
        {
          cwd: WORKSPACE_ROOT,
          env: {
            ...process.env,
            TRAFFIC_DB_PATH: DB_PATH,
          },
          timeout: 10000,
        }
      );

      const summaryScript = `
import json
from traffic_ai.config import DB_PATH
from traffic_ai.storage import build_full_summary, ACTIVE_SESSION_SENTINEL

print(json.dumps(build_full_summary(db_path=DB_PATH, session_id=ACTIVE_SESSION_SENTINEL)))
`;
      const { stdout: sumOut } = await runPythonScript(summaryScript);
      const sqliteSummary = JSON.parse(sumOut.trim());

      res.json({
        ok: true,
        pipeline_output: pipeOut,
        report_output: repOut,
        sqlite_summary: sqliteSummary,
      });
    } catch (error: any) {
      res.status(500).json({
        ok: false,
        error: error?.message || 'Failed to run Python pipeline batch',
      });
    }
  });

  // 4. Reset active experiment session while preserving historical SQLite audit records
  app.post('/api/pipeline/reset', async (req, res) => {
    try {
      const junctionId = String(req.body?.junction_id || 'JCT-01');
      const note = String(req.body?.note || 'Operator experiment session reset');
      const inputJson = JSON.stringify({ junction_id: junctionId, note });

      const script = `
import sys, json
from traffic_ai.config import DB_PATH, REAL_WORLD_JUNCTIONS
from traffic_ai.storage import reset_active_session, build_full_summary, ACTIVE_SESSION_SENTINEL

req = json.loads(sys.argv[1])
jct = str(req.get("junction_id") or "JCT-01")
if jct not in REAL_WORLD_JUNCTIONS:
    jct = "JCT-01"
note = str(req.get("note") or "Operator experiment session reset")

new_sid = reset_active_session(junction_id=jct, note=note, db_path=DB_PATH)
summary = build_full_summary(db_path=DB_PATH, session_id=ACTIVE_SESSION_SENTINEL)

print(json.dumps({
    "active_session_id": new_sid,
    "sqlite_summary": summary,
}))
`;
      const { stdout } = await runPythonScript(script, [inputJson]);
      const data = JSON.parse(stdout.trim());
      res.json({ ok: true, ...data });
    } catch (error: any) {
      res.status(500).json({
        ok: false,
        error: error?.message || 'Failed to reset active experiment session',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(WORKSPACE_ROOT, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Traffic Ops Console + Python SQLite Bridge running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
