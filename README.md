# AI-Based Smart Traffic Management System

An end-to-end adaptive traffic signal control platform combining a **persistent Python Traffic AI Engine HTTP service** (`traffic_ai/api_server.py` on port `8000`) with a unified **React 19 + Vite 8 Traffic Operations Console** (`src/`) routed through a **Node.js Express API Gateway** (`server.ts` on port `3000`), backed by **SQLite** (`data/traffic_history.db`) and optional **Raspberry Pi GPIO / MQTT** hardware integration (`raspberry_pi/`).

Aligned with **UN Sustainable Development Goal 11 (Sustainable Cities and Communities)**, the system replaces rigid fixed-timer phases with 5-factor demand-responsive green times, starvation protection, intergreen `YELLOW -> ALL_RED` clearance, and immediate emergency vehicle preemption.

---

## 1. Phase 2 Runtime Architecture

```text
React 19 Frontend (Vite / Static Dist)
        │  HTTP /api/*
        ▼
Node.js Express API Gateway (server.ts · Port 3000)
        │  Pre-flight /health check + HTTP JSON proxy
        ▼
Persistent Python Traffic AI Service (traffic_ai.api_server · Port 8000)
        │  Single in-memory TrafficEngineService (controller, phase, session, detector, tracker)
        ▼
Traffic AI Core (density, signal_controller, hardware_controller, predictor) ──► SQLite (data/traffic_history.db)
```

---

## 2. Project Folder Structure

```text
/
├── package.json                 # Build, lint, dev, start & python:api scripts
├── server.ts                    # Express API Gateway + Python service lifecycle manager
├── index.html                   # Root React 19 entry HTML
├── .env.example                 # Environment variables (PYTHON_API_URL, PORT, MQTT)
├── requirements.txt             # Optional CV/MQTT/Simulation packages
├── reports.py                   # CLI SQLite & SDG 11 report exporter
├── Dockerfile                   # Persistent Python API service container (port 8000)
├── docker-compose.yml           # Mosquitto MQTT broker + Persistent Python API service
├── mosquitto/mosquitto.conf     # TCP 1883 + WebSockets 9001 config
├── data/
│   └── traffic_history.db       # Canonical SQLite database (WAL + sessions + app_state)
├── traffic_ai/                  # Authoritative Python AI & Persistent Service Package
│   ├── api_server.py            # Long-running Python HTTP API server (localhost:8000)
│   ├── engine_service.py        # Persistent TrafficEngineService & schema validation
│   ├── config.py                # Constants, PCE weights, canonical junctions (JCT-01..JCT-04)
│   ├── density.py               # PCE scoring, meter queue estimation, occupancy, waiting time
│   ├── signal_controller.py     # 5-factor priority, starvation fairness, transitions, emergency
│   ├── predictor.py             # Rolling OLS 5-minute traffic demand regression + MAE/RMSE
│   ├── hardware_controller.py   # Persistent single-green GPIO interlock + BCM pin mapping
│   ├── detector.py              # Lazy-loaded YOLOv8 + ByteTrack + stationary tracker
│   ├── mqtt_bridge.py           # Resilient paho-mqtt 2.x publisher
│   ├── simulator.py             # Pygame 4-way intersection simulation
│   ├── storage.py               # SQLite persistence, sessions, legacy migration, SDG 11 summary
│   └── pipeline.py              # CLI runner (--demo, --cycles, --junction, video feeds)
├── raspberry_pi/                # Optional edge GPIO configuration module
│   ├── __init__.py
│   └── config.py
└── src/                         # Canonical React 19 Traffic Operations Console
```

---

## 3. Startup & Deployment Modes

### A. Unified Single-Command Startup (Recommended)
Express automatically starts and health-checks `python3 -u -m traffic_ai.api_server` on `127.0.0.1:8000`, forwards `/api/*` requests, and cleanly shuts down the Python child on exit (`SIGINT`/`SIGTERM`):

```bash
# Development mode (Express + Vite HMR-disabled + Persistent Python Service)
npm run dev

# Production build & startup
npm install
npm run build
npm start
```
Open `http://localhost:3000`.

### B. Separate Two-Process Startup (Independent Containers / Hosts)
If deploying Python separately (or debugging Python independently):

```bash
# Terminal 1: Start Persistent Python Service on port 8000
npm run python:api
# or: python3 -u -m traffic_ai.api_server

# Terminal 2: Start Express Gateway without auto-spawning Python
AUTO_START_PYTHON=false PYTHON_API_URL=http://127.0.0.1:8000 npm start
```

### C. Python CLI & Docker Compose
```bash
# CLI demo cycles & SQLite reporting
python3 -m traffic_ai.pipeline --demo --cycles 8 --junction JCT-01
python3 reports.py --all --export data/session_export.json

# Docker Compose (Mosquitto + Persistent Python API on :8000)
docker compose up --build -d
```

---

## 4. Python & Express API Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/health` (Python) / `/api/health` (Express) | Liveness + SQLite connectivity + persistent controller ID & phase |
| `GET` | `/api/config` | Canonical constants, junctions (`JCT-01`..`JCT-04`), scenario presets, GPIO pins |
| `GET` | `/api/traffic/status` | Persistent engine snapshot (`controller_instance_id`, `current_phase`, detector state, SQLite summary) |
| `GET` | `/api/sqlite/summary` | Unified active session SQLite metrics, SDG 11 comparison & 5-min OLS predictions |
| `GET` | `/api/traffic/history` | Recent cycles, emergency events, system events & session list (`?limit=&session_id=&junction_id=`) |
| `POST` | `/api/pipeline/execute-cycle` | Validate counts, evaluate 5-factor priority, enforce `GREEN -> YELLOW (3s) -> ALL_RED (2s) -> GREEN`, persist cycle |
| `POST` | `/api/pipeline/run-demo-batch` | Run N synthetic cycles (`1..100`) on the persistent engine and export JSON report |
| `POST` | `/api/pipeline/reset` | Start a new active experiment session while preserving historical SQLite audit logs |
