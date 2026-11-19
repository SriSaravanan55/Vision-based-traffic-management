# AI-Based Smart Traffic Management System

An end-to-end adaptive traffic signal control platform combining an authoritative **Python computer-vision, priority, & simulation engine** (`traffic_ai/`) with a unified **React 19 + Vite 8 Traffic Operations Console** (`src/`) backed by an **Express + Python SQLite API bridge** (`server.ts`) and optional **Raspberry Pi GPIO / MQTT** hardware integration (`raspberry_pi/`).

Aligned with **UN Sustainable Development Goal 11 (Sustainable Cities and Communities)**, the system replaces rigid fixed-timer phases with 5-factor demand-responsive green times, starvation protection, intergreen `YELLOW -> ALL_RED` clearance, and immediate emergency vehicle preemption.

---

## 1. Unified Repository Architecture

```text
/
├── package.json                 # Unified Vite + Express build & startup scripts
├── server.ts                    # Express server + Python traffic_ai SQLite bridge
├── index.html                   # Root React 19 entry HTML
├── requirements.txt             # Python dependencies (paho-mqtt, pygame, ultralytics, opencv)
├── reports.py                   # CLI SQLite & SDG 11 report exporter
├── Dockerfile                   # Headless Python pipeline container
├── docker-compose.yml           # Mosquitto MQTT broker + traffic_ai pipeline
├── mosquitto/mosquitto.conf     # TCP 1883 + WebSockets 9001 config
├── data/
│   └── traffic_history.db       # Single canonical SQLite DB (WAL + sessions + app_state)
├── traffic_ai/                  # Authoritative Python AI & Signal Control Package
│   ├── config.py                # Constants, PCE weights, canonical junctions (JCT-01..JCT-04)
│   ├── density.py               # PCE scoring, meter queue estimation, occupancy, waiting time
│   ├── signal_controller.py     # 5-factor priority, starvation fairness, transitions, emergency
│   ├── predictor.py             # Rolling OLS 5-minute traffic demand regression + MAE/RMSE
│   ├── hardware_controller.py   # Single-green GPIO interlock + BCM pin mapping
│   ├── detector.py              # Lazy-loaded YOLOv8 + ByteTrack + stationary tracker
│   ├── mqtt_bridge.py           # Resilient paho-mqtt 2.x publisher
│   ├── simulator.py             # Pygame 4-way intersection simulation
│   ├── storage.py               # SQLite persistence, sessions, legacy migration, SDG 11 summary
│   └── pipeline.py              # CLI runner (--demo, --cycles, --junction, video feeds)
├── raspberry_pi/                # Optional edge GPIO configuration module
│   ├── __init__.py
│   └── config.py
└── src/                         # Canonical React 19 Traffic Operations Console
    ├── App.tsx
    ├── index.css
    ├── PipelineInspectorModal.tsx
    ├── styles/                  # Institutional Navy & Government Light themes
    ├── services/                # Pure API client (trafficApi.ts) & MQTT WebSocket client
    └── components/              # DashboardApp, TopBar, ControlBar, CameraFeedMatrix,
                                 # IntersectionSchematic, AdaptiveIntelligencePanel, EventLog
```

---

## 2. Running the Unified Application

### A. Full-Stack Web Console + Python API Bridge (Recommended)
```bash
npm install
npm run build
npm start
```
Open `http://localhost:3000`.
For development with live middleware:
```bash
npm run dev
```

### B. Python AI Pipeline CLI & SQLite Reports
```bash
# Run synthetic demo cycles into canonical data/traffic_history.db
python3 -m traffic_ai.pipeline --demo --cycles 8 --junction JCT-01

# Print active session report (or --all for full historical archive)
python3 reports.py --all --export data/session_export.json
```

### C. Optional Docker Mosquitto + Pipeline
```bash
docker compose up --build -d
```
