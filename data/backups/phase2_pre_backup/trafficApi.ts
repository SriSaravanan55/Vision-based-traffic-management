/**
 * Canonical Frontend API Client & UI Metadata Registry.
 * Python (`traffic_ai/`) is the single authoritative engine for density, priority,
 * signal planning, emergency preemption, OLS prediction, and SDG 11 analytics.
 */

export const LANES = ['north', 'south', 'east', 'west'] as const;
export type LaneName = (typeof LANES)[number];

export interface VehicleCounts {
  bicycle?: number;
  motorcycle?: number;
  car?: number;
  bus?: number;
  truck?: number;
  ambulance?: number;
  fire_truck?: number;
  police_vehicle?: number;
  [key: string]: number | undefined;
}

export const PRIORITY_WEIGHTS = {
  density_weight: 0.35,
  queue_weight: 0.25,
  waiting_weight: 0.2,
  prediction_weight: 0.1,
  pedestrian_weight: 0.1,
};

export const MAX_WAITING_TIME = 90;

export const GPIO_PIN_MAP: Record<LaneName, { RED: number; YELLOW: number; GREEN: number }> = {
  north: { RED: 17, YELLOW: 27, GREEN: 22 },
  south: { RED: 23, YELLOW: 24, GREEN: 25 },
  east: { RED: 5, YELLOW: 6, GREEN: 13 },
  west: { RED: 19, YELLOW: 26, GREEN: 21 },
};

export const REAL_WORLD_JUNCTIONS: Record<string, any> = {
  'JCT-01': {
    id: 'JCT-01',
    name: 'JCT-01 · 4-Way Arterial Hub',
    label: 'JCT-01 · 4-Way Arterial Hub',
    city: 'Metropolitan Sector 1',
    coordinates: '12.9716° N, 77.5946° E',
    controllerSpec: 'Adaptive ATCS · 4-Phase Isolated Control',
    approaches: {
      north: { road: 'North Arterial Boulevard', lanes: 3, speedKmh: 50 },
      south: { road: 'South Arterial Boulevard', lanes: 3, speedKmh: 50 },
      east: { road: 'East Commercial Avenue', lanes: 2, speedKmh: 40 },
      west: { road: 'West Commercial Avenue', lanes: 2, speedKmh: 40 },
    },
  },
  'JCT-02': {
    id: 'JCT-02',
    name: 'JCT-02 · Downtown Commercial Crossway',
    label: 'JCT-02 · Downtown Commercial Crossway',
    city: 'Central Commercial District',
    coordinates: '12.9780° N, 77.6010° E',
    controllerSpec: 'Pedestrian & Transit Coordinated ATCS',
    approaches: {
      north: { road: 'Main Market Street North', lanes: 2, speedKmh: 35 },
      south: { road: 'Main Market Street South', lanes: 2, speedKmh: 35 },
      east: { road: 'Cross Commercial Lane East', lanes: 2, speedKmh: 35 },
      west: { road: 'Cross Commercial Lane West', lanes: 2, speedKmh: 35 },
    },
  },
  'JCT-03': {
    id: 'JCT-03',
    name: 'JCT-03 · Outer Ring Road 4-Way Junction',
    label: 'JCT-03 · Outer Ring Road 4-Way Junction',
    city: 'Perimeter Expressway Hub',
    coordinates: '12.9352° N, 77.6245° E',
    controllerSpec: 'High-Throughput Express Traffic Control',
    approaches: {
      north: { road: 'Expressway Northbound', lanes: 3, speedKmh: 65 },
      south: { road: 'Expressway Southbound', lanes: 3, speedKmh: 65 },
      east: { road: 'Industrial Access Link East', lanes: 2, speedKmh: 45 },
      west: { road: 'Logistics Corridor West', lanes: 2, speedKmh: 45 },
    },
  },
  'JCT-04': {
    id: 'JCT-04',
    name: 'JCT-04 · Multi-Modal Freight Crossway',
    label: 'JCT-04 · Multi-Modal Freight Crossway',
    city: 'Metropolitan Sector 4',
    coordinates: '12.9177° N, 77.6238° E',
    controllerSpec: 'Freight & Transit Priority ATCS',
    approaches: {
      north: { road: 'North Freight Corridor', lanes: 3, speedKmh: 55 },
      south: { road: 'Elevated Expressway South', lanes: 3, speedKmh: 60 },
      east: { road: 'Outer Ring Road East', lanes: 2, speedKmh: 50 },
      west: { road: 'Arterial Bypass West', lanes: 2, speedKmh: 45 },
    },
  },
};

export const SCENARIO_PRESETS: Record<string, { id: string; label: string; counts?: Record<string, VehicleCounts> }> = {
  auto: {
    id: 'auto',
    label: 'Auto Diurnal Demand (Adaptive Cycling)',
  },
  acceptance_east: {
    id: 'acceptance_east',
    label: 'East Corridor Rush (20 Cars + 3 Trucks · Score 26 · Share 0.62)',
    counts: {
      north: { motorcycle: 4, car: 5, bus: 1, truck: 0, bicycle: 0, ambulance: 0, fire_truck: 0, police_vehicle: 0 },
      south: { motorcycle: 2, car: 2, bus: 0, truck: 1, bicycle: 0, ambulance: 0, fire_truck: 0, police_vehicle: 0 },
      east: { motorcycle: 0, car: 20, bus: 0, truck: 3, bicycle: 0, ambulance: 0, fire_truck: 0, police_vehicle: 0 },
      west: { motorcycle: 0, car: 2, bus: 0, truck: 0, bicycle: 0, ambulance: 0, fire_truck: 0, police_vehicle: 0 },
    },
  },
  morning_peak: {
    id: 'morning_peak',
    label: '09:00 AM Central Business District Commuter Surge',
    counts: {
      north: { motorcycle: 16, car: 18, bus: 3, truck: 1, bicycle: 1, ambulance: 0, fire_truck: 0, police_vehicle: 0 },
      south: { motorcycle: 6, car: 7, bus: 1, truck: 0, bicycle: 0, ambulance: 0, fire_truck: 0, police_vehicle: 0 },
      east: { motorcycle: 12, car: 14, bus: 2, truck: 1, bicycle: 1, ambulance: 0, fire_truck: 0, police_vehicle: 0 },
      west: { motorcycle: 4, car: 5, bus: 1, truck: 0, bicycle: 0, ambulance: 0, fire_truck: 0, police_vehicle: 0 },
    },
  },
  evening_corridor: {
    id: 'evening_corridor',
    label: '18:30 PM Institutional & Tech Corridor Outbound Wave',
    counts: {
      north: { motorcycle: 5, car: 6, bus: 1, truck: 0, bicycle: 1, ambulance: 0, fire_truck: 0, police_vehicle: 0 },
      south: { motorcycle: 22, car: 21, bus: 4, truck: 1, bicycle: 2, ambulance: 0, fire_truck: 0, police_vehicle: 0 },
      east: { motorcycle: 10, car: 11, bus: 2, truck: 1, bicycle: 0, ambulance: 0, fire_truck: 0, police_vehicle: 0 },
      west: { motorcycle: 4, car: 4, bus: 0, truck: 1, bicycle: 1, ambulance: 0, fire_truck: 0, police_vehicle: 0 },
    },
  },
  heavy_ns: {
    id: 'heavy_ns',
    label: '23:30 PM National Highway Freight & Container Surge',
    counts: {
      north: { motorcycle: 2, car: 6, bus: 1, truck: 9, bicycle: 0, ambulance: 0, fire_truck: 0, police_vehicle: 0 },
      south: { motorcycle: 1, car: 5, bus: 1, truck: 8, bicycle: 0, ambulance: 0, fire_truck: 0, police_vehicle: 0 },
      east: { motorcycle: 2, car: 3, bus: 0, truck: 1, bicycle: 0, ambulance: 0, fire_truck: 0, police_vehicle: 0 },
      west: { motorcycle: 1, car: 2, bus: 0, truck: 1, bicycle: 0, ambulance: 0, fire_truck: 0, police_vehicle: 0 },
    },
  },
};

export const TRAFFIC_LIVE_VIDEO_FEEDS = [
  {
    id: 'feed-01',
    title: 'Arterial 4-Way Junction Traffic CCTV',
    location: 'Primary Arterial Corridor · East Approach',
    streamType: 'live_stream',
    resolution: '1080p · 30 FPS',
    fps: 30,
    bitrate: '3.4 Mbps',
    sampleVideoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    defaultApproach: 'east' as LaneName,
    baseVehicleCounts: { car: 18, motorcycle: 12, bus: 3, truck: 2, bicycle: 1, ambulance: 0, fire_truck: 0, police_vehicle: 0 },
  },
  {
    id: 'feed-02',
    title: 'Downtown Commercial Crossway Live Stream',
    location: 'Central Business Corridor · North Approach',
    streamType: 'live_stream',
    resolution: '1080p · 30 FPS',
    fps: 30,
    bitrate: '4.1 Mbps',
    sampleVideoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
    defaultApproach: 'north' as LaneName,
    baseVehicleCounts: { car: 16, motorcycle: 18, bus: 4, truck: 3, bicycle: 0, ambulance: 0, fire_truck: 0, police_vehicle: 0 },
  },
  {
    id: 'feed-03',
    title: 'Expressway Inflow & Interchange CCTV',
    location: 'Outer Highway Junction · South Approach',
    streamType: 'live_stream',
    resolution: '1080p · 25 FPS',
    fps: 25,
    bitrate: '2.8 Mbps',
    sampleVideoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
    defaultApproach: 'south' as LaneName,
    baseVehicleCounts: { car: 22, motorcycle: 16, bus: 4, truck: 1, bicycle: 2, ambulance: 0, fire_truck: 0, police_vehicle: 0 },
  },
  {
    id: 'feed-04',
    title: 'Multi-Modal Transit Terminal Traffic Feed',
    location: 'Transit Terminal Crossway · West Approach',
    streamType: 'live_stream',
    resolution: '720p · 30 FPS',
    fps: 30,
    bitrate: '2.2 Mbps',
    sampleVideoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyBlazes.mp4',
    defaultApproach: 'west' as LaneName,
    baseVehicleCounts: { car: 14, motorcycle: 15, bus: 5, truck: 4, bicycle: 3, ambulance: 0, fire_truck: 0, police_vehicle: 0 },
  },
];

export const PROJECT_AUDIT_MATRIX = [
  {
    component: 'Frontend',
    existing: 'Unified Root React 19 + Vite 8 Traffic Ops Console (/src/)',
    status: 'Unified single source of truth; theme variables + Python API bridge',
    action: 'Unified & Upgraded',
  },
  {
    component: 'Backend',
    existing: 'Express + Python 3 Traffic Bridge (server.ts)',
    status: 'Canonical endpoints: /api/config, /api/sqlite/summary, execute-cycle, reset',
    action: 'Unified & Extended',
  },
  {
    component: 'AI Model',
    existing: 'Ultralytics YOLOv8 (yolov8n.pt) + ByteTrack (bytetrack.yaml)',
    status: 'Lazy-loaded in traffic_ai/detector.py for zero-crash simulation',
    action: 'Preserved',
  },
  {
    component: 'Vehicle Detection',
    existing: 'traffic_ai/detector.py (Car, Moto, Bus, Truck, Bicycle, Pedestrian, Emergency)',
    status: 'Authoritative Python detection & stationary vehicle tracking',
    action: 'Preserved',
  },
  {
    component: 'Traffic Density',
    existing: 'traffic_ai/density.py (PCE weighted_score, queue, occupancy, wait)',
    status: 'Single authoritative implementation (client duplication removed)',
    action: 'Consolidated',
  },
  {
    component: 'Signal Control',
    existing: 'traffic_ai/signal_controller.py (5-factor priority, starvation, transitions)',
    status: 'Unified with persistent active_green_lane state & single JS phase machine',
    action: 'Consolidated & Fixed',
  },
  {
    component: 'Database',
    existing: 'Canonical SQLite data/traffic_history.db (WAL + sessions + app_state)',
    status: 'Safe schema migration, legacy merge & non-destructive session reset',
    action: 'Unified & Migrated',
  },
  {
    component: 'MQTT',
    existing: 'paho-mqtt 2.x (traffic_ai/mqtt_bridge.py) + mqtt.js WebSockets',
    status: 'Resilient offline fallback & WebSocket live bridge',
    action: 'Preserved',
  },
  {
    component: 'Raspberry Pi',
    existing: 'traffic_ai/hardware_controller.py + raspberry_pi/config.py',
    status: 'Single-green interlock + dynamic GPIO telemetry panel',
    action: 'Unified & Wired',
  },
  {
    component: 'Prediction',
    existing: 'traffic_ai/predictor.py (Rolling OLS Linear Trend Regression)',
    status: 'Authoritative 5-minute forecast + MAE/RMSE backtest from SQLite',
    action: 'Consolidated',
  },
];

export const DEFAULT_BASELINE_COUNTS: Record<LaneName, VehicleCounts> = {
  north: { car: 12, motorcycle: 10, bus: 2, truck: 1, bicycle: 1, ambulance: 0, fire_truck: 0, police_vehicle: 0 },
  south: { car: 14, motorcycle: 12, bus: 2, truck: 2, bicycle: 0, ambulance: 0, fire_truck: 0, police_vehicle: 0 },
  east: { car: 18, motorcycle: 14, bus: 3, truck: 2, bicycle: 1, ambulance: 0, fire_truck: 0, police_vehicle: 0 },
  west: { car: 9, motorcycle: 8, bus: 1, truck: 1, bicycle: 2, ambulance: 0, fire_truck: 0, police_vehicle: 0 },
};

export function createInitialStandbyCycle() {
  const lanes: Record<string, any> = {};
  for (const ln of LANES) {
    lanes[ln] = {
      raw_counts: { ...DEFAULT_BASELINE_COUNTS[ln] },
      vehicle_total: 0,
      weighted_score: 0,
      density_level: 'Low',
      density_code: 'LOW',
      density_share: 0.25,
      queue_meters: 0,
      queue_length_meters: 0,
      queue_estimation_method: 'meter-estimated',
      road_occupancy_pct: 0,
      average_waiting_time: 0,
      maximum_waiting_time: 0,
      pedestrian_count: 0,
      pedestrian_waiting_time: 0,
      green_seconds: 15,
      mode: 'normal',
      priority_score: 0,
      starvation_flagged: false,
      active_phase_signal: ln === 'east' ? 'GREEN' : 'RED',
      control_mode: 'SIMULATION',
    };
  }
  return {
    ts: new Date().toISOString(),
    cycle: 0,
    emergency_lane: null as string | null,
    active_green_lane: 'east' as LaneName,
    transition_steps: [],
    lanes,
  };
}

export async function fetchSystemConfig() {
  const res = await fetch('/api/config');
  const json = await res.json();
  if (!res.ok || !json?.ok) {
    throw new Error(json?.error || `Config request failed (${res.status})`);
  }
  return json.data;
}

export async function fetchSqliteSummary() {
  const res = await fetch('/api/sqlite/summary');
  const json = await res.json();
  if (!res.ok || !json?.ok) {
    throw new Error(json?.error || `SQLite summary request failed (${res.status})`);
  }
  return json.data;
}

export async function executePythonCycle(payload: {
  lane_counts: Record<string, VehicleCounts>;
  pedestrian_counts?: Record<string, number>;
  prior_waiting?: Record<string, number>;
  emergency_lane?: string | null;
  forced_active_lane?: string | null;
  junction_id?: string;
  persist?: boolean;
}) {
  const res = await fetch('/api/pipeline/execute-cycle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!res.ok || !json?.ok) {
    throw new Error(json?.error || `Cycle execution failed (${res.status})`);
  }
  return json.result;
}

export async function runPythonDemoBatch(cycles = 4, junctionId = 'JCT-01') {
  const res = await fetch('/api/pipeline/run-demo-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cycles, junction_id: junctionId }),
  });
  const json = await res.json();
  if (!res.ok || !json?.ok) {
    throw new Error(json?.error || `Demo batch failed (${res.status})`);
  }
  return json;
}

export async function resetExperimentSession(junctionId = 'JCT-01', note = 'Operator reset') {
  const res = await fetch('/api/pipeline/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ junction_id: junctionId, note }),
  });
  const json = await res.json();
  if (!res.ok || !json?.ok) {
    throw new Error(json?.error || `Session reset failed (${res.status})`);
  }
  return json;
}
