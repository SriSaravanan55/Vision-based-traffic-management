import React, { useState } from 'react';

const CODE_ARTIFACTS: Record<string, { path: string; description: string; content: string }> = {
  structure: {
    path: 'traffic_ai/ + src/ (Unified Project Architecture)',
    description: 'Single-source-of-truth root layout: React 19 UI (/src), Python AI engine (/traffic_ai), canonical SQLite DB (/data/traffic_history.db), and Raspberry Pi edge module.',
    content: `/ (Repository Root)
  package.json, server.ts, index.html, vite.config.ts
  requirements.txt, reports.py, Dockerfile, docker-compose.yml, README.md
  mosquitto/mosquitto.conf
  data/
    traffic_history.db          # Canonical SQLite database (WAL + sessions + app_state)
    session_export.json         # Latest SDG 11 JSON export
  traffic_ai/                   # Persistent Python AI & Signal Engine (:8000)
    __init__.py, api_server.py, engine_service.py, config.py, density.py,
    signal_controller.py, predictor.py, hardware_controller.py,
    detector.py, mqtt_bridge.py, simulator.py, storage.py, pipeline.py
  raspberry_pi/
    __init__.py, config.py
  src/                          # Canonical React 19 / Vite 8 Operations Console
    App.tsx, main.tsx, index.css, PipelineInspectorModal.tsx
    services/trafficApi.ts, mqttClient.js
    styles/theme.css, console.css
    components/
      DashboardApp.jsx, TopBar.jsx, ControlBar.jsx, CameraFeedMatrix.jsx,
      IntersectionSchematic.jsx, AdaptiveIntelligencePanel.jsx, EventLog.jsx

# Quick Start (Express Gateway :3000 + Auto-Managed Python Engine :8000):
npm install && npm run build && npm start

# Or launch persistent Python API service separately:
python3 -u -m traffic_ai.api_server
python3 reports.py --all --export data/session_export.json`,
  },
  config_density: {
    path: 'traffic_ai/config.py & density.py',
    description: 'Canonical PCE weights, meter-based queue estimation, density thresholds, and vehicle metrics.',
    content: `# traffic_ai/config.py
LANES = ("north", "south", "east", "west")
VEHICLE_WEIGHTS = {
    "bicycle": 0.3, "motorcycle": 0.5, "car": 1.0,
    "bus": 2.0, "truck": 2.0, "ambulance": 5.0,
    "fire_truck": 5.0, "police_vehicle": 5.0,
}
MIN_GREEN, MAX_GREEN, K, EMERGENCY_GREEN = 15, 45, 30, 25
MAX_WAITING_TIME = 90
YELLOW_TRANSITION_SECONDS = 3
ALL_RED_CLEARANCE_SECONDS = 2

# traffic_ai/density.py
def weighted_score(counts):
    return round(sum(int(counts.get(k, 0)) * w for k, w in VEHICLE_WEIGHTS.items()), 4)

def classify_density(score):
    if score <= 8: return "Low"
    if score <= 18: return "Medium"
    if score <= 30: return "High"
    return "Very High"`,
  },
  signal_controller: {
    path: 'traffic_ai/signal_controller.py',
    description: '5-factor priority engine, starvation prevention (>90s), YELLOW->ALL_RED intergreen safety, and 25s emergency preemption.',
    content: `def calculate_priority(lane_metrics, predicted_score=0.0):
    # Base priority = 0.35*Density + 0.25*Queue + 0.20*Wait + 0.10*Prediction + 0.10*Pedestrian
    # +35.0 Starvation Boost when maximum_waiting_time > 90s
    # +100.0 Emergency Boost when ambulance / fire_truck / police_vehicle detected
    ...

def build_safe_transition_sequence(from_lane, to_lane, is_emergency=False, green_seconds=None):
    # Enforces YELLOW (3s) -> ALL_RED (2s) -> target GREEN
    ...`,
  },
  detector: {
    path: 'traffic_ai/detector.py',
    description: 'YOLOv8 + ByteTrack (persist=True, conf=0.5, tracker="bytetrack.yaml") with lazy imports and stationary object tracking.',
    content: `class VehicleDetector:
    def process_frame(self, frame, lane):
        model = self._ensure_model()  # Lazy-loads ultralytics.YOLO(YOLO_MODEL_PATH)
        results = model.track(
            frame, persist=True, conf=0.5, tracker="bytetrack.yaml", verbose=False
        )
        # Counts COCO vehicle classes + pedestrians + custom emergency classes
        # Tracks persistent ByteTrack IDs without double counting
        return counts_in_frame, emergency_present, annotated_frame`,
  },
  docker: {
    path: 'docker-compose.yml & mosquitto/mosquitto.conf',
    description: 'Mosquitto (1883 MQTT + 9001 WebSockets), headless traffic_ai pipeline, and production Node + React Ops Console.',
    content: `# mosquitto/mosquitto.conf
listener 1883 0.0.0.0
protocol mqtt
allow_anonymous true

listener 9001 0.0.0.0
protocol websockets
allow_anonymous true

# docker-compose.yml
# - mosquitto (ports 1883, 9001)
# - pipeline (python -m traffic_ai.pipeline --demo --cycles 0 --sim-seconds 4, ./data:/app/data)
# - app (unified React 19 + Express/Python SQLite Bridge on port 3000)`,
  },
};

export default function PipelineInspectorModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<string>('structure');

  if (!isOpen) return null;

  const current = CODE_ARTIFACTS[activeTab] || CODE_ARTIFACTS.structure;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'var(--bg-overlay)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        zIndex: 50,
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Python Pipeline and Setup Documentation"
    >
      <div
        className="ops-panel"
        style={{
          width: '100%',
          maxWidth: '920px',
          maxHeight: '86vh',
          overflow: 'hidden',
          border: '1px solid var(--accent-cyan)',
        }}
      >
        <div className="ops-panel-header">
          <div>
            <h2 className="ops-panel-title">
              UNIFIED PYTHON PIPELINE, DOCKER &amp; ARCHITECTURE INSPECTOR
            </h2>
            <div className="ops-panel-subtitle" style={{ marginTop: '3px' }}>
              Canonical modules located in `traffic_ai/`, `src/`, `raspberry_pi/`, and `data/traffic_history.db`
            </div>
          </div>
          <button type="button" className="ops-btn active" onClick={onClose}>
            Close [ESC]
          </button>
        </div>

        <div className="ops-control-group" style={{ marginBottom: '12px' }}>
          {Object.entries(CODE_ARTIFACTS).map(([key, item]) => (
            <button
              key={key}
              type="button"
              className={`ops-btn ${activeTab === key ? 'active' : ''}`}
              onClick={() => setActiveTab(key)}
            >
              {item.path.split(' ')[0]}
            </button>
          ))}
        </div>

        <div
          style={{
            fontSize: '0.78rem',
            color: 'var(--text-secondary)',
            marginBottom: '8px',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {current.description}
        </div>

        <pre
          className="font-mono-tabular"
          style={{
            margin: 0,
            padding: '14px',
            backgroundColor: 'var(--bg-inset)',
            border: '1px solid var(--grid-line)',
            color: 'var(--text-primary)',
            fontSize: '0.76rem',
            lineHeight: 1.5,
            overflow: 'auto',
            flex: 1,
          }}
        >
          {current.content}
        </pre>
      </div>
    </div>
  );
}
