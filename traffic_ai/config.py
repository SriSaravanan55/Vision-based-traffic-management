"""Central configuration and constants for the AI-Based Smart Traffic Management System."""

import os

# Four-way intersection approaches
LANES = ("north", "south", "east", "west")

# Passenger Car Equivalent (PCE) and priority weights per vehicle class
VEHICLE_WEIGHTS = {
    "bicycle": 0.3,
    "motorcycle": 0.5,
    "car": 1.0,
    "bus": 2.0,
    "truck": 2.0,
    "ambulance": 5.0,
    "fire_truck": 5.0,
    "police_vehicle": 5.0,
}

# Standard COCO vehicle & road-user classes supported out-of-the-box by yolov8n.pt
COCO_VEHICLE_CLASSES = ("bicycle", "motorcycle", "car", "bus", "truck")
PEDESTRIAN_CLASS = "pedestrian"

# COCO class ID to canonical name mapping
COCO_CLASS_ID_MAP = {
    0: "pedestrian",
    1: "bicycle",
    2: "car",
    3: "motorcycle",
    5: "bus",
    7: "truck",
}

# Emergency vehicle classes (require custom fine-tuned YOLO weights for live video detection)
EMERGENCY_CLASSES = ("ambulance", "fire_truck", "police_vehicle")

# Density score upper thresholds (configurable via env or config):
# <= 8: Low (LOW), <= 18: Medium (MEDIUM), <= 30: High (HIGH), > 30: Very High (VERY_HIGH)
DENSITY_THRESHOLDS = {
    "Low": float(os.getenv("DENSITY_THRESHOLD_LOW", "8.0")),
    "Medium": float(os.getenv("DENSITY_THRESHOLD_MEDIUM", "18.0")),
    "High": float(os.getenv("DENSITY_THRESHOLD_HIGH", "30.0")),
}

# Multi-factor Priority Engine weights (sum = 1.00, tunable via testing data)
PRIORITY_WEIGHTS = {
    "density_weight": float(os.getenv("PRIORITY_DENSITY_WEIGHT", "0.35")),
    "queue_weight": float(os.getenv("PRIORITY_QUEUE_WEIGHT", "0.25")),
    "waiting_weight": float(os.getenv("PRIORITY_WAITING_WEIGHT", "0.20")),
    "prediction_weight": float(os.getenv("PRIORITY_PREDICTION_WEIGHT", "0.10")),
    "pedestrian_weight": float(os.getenv("PRIORITY_PEDESTRIAN_WEIGHT", "0.10")),
}

# Fairness / Starvation prevention threshold (seconds)
MAX_WAITING_TIME = int(os.getenv("MAX_WAITING_TIME", "90"))
STARVATION_PRIORITY_BOOST = float(os.getenv("STARVATION_PRIORITY_BOOST", "35.0"))
EMERGENCY_PRIORITY_BOOST = 100.0

# Safe signal transition intervals (IRC:93 / NEMA intergreen clearance)
YELLOW_TRANSITION_SECONDS = 3
ALL_RED_CLEARANCE_SECONDS = 2

# System safety mode: defaults to SIMULATION_MODE=True unless HARDWARE_MODE=true is set
HARDWARE_MODE = os.getenv("HARDWARE_MODE", "false").lower() == "true"
SIMULATION_MODE = not HARDWARE_MODE

# Adaptive signal timing constants (seconds)
MIN_GREEN = 15
MAX_GREEN = 45
K = 30
EMERGENCY_GREEN = 25

# Fixed-timer baseline per lane (seconds) for SDG 11 waiting-time comparison
FIXED_TIMER_GREEN = 30

# Physical average queue length per vehicle class (meters, including headway)
QUEUE_ESTIMATION_METHOD = "meter-estimated"
MAX_APPROACH_CAPACITY_METERS = 120.0
VEHICLE_LENGTH_METERS = {
    "bicycle": 1.9,
    "motorcycle": 2.4,
    "car": 5.2,
    "bus": 13.0,
    "truck": 11.5,
    "ambulance": 6.2,
    "fire_truck": 11.0,
    "police_vehicle": 5.4,
}

# Average idle fuel consumption (liters/hour) per vehicle class for SDG 11 CO2 metrics
IDLE_FUEL_LITERS_PER_HOUR = {
    "bicycle": 0.0,
    "motorcycle": 0.25,
    "car": 0.85,
    "bus": 2.60,
    "truck": 2.40,
    "ambulance": 1.40,
    "fire_truck": 2.80,
    "police_vehicle": 1.20,
}

# Tailpipe CO2 emission factor (kg CO2 per liter of urban mixed fuel)
CO2_KG_PER_LITER = 2.35

# Canonical 4-way arterial junction registry (single source of truth for Python + React UI)
REAL_WORLD_JUNCTIONS = {
    "JCT-01": {
        "id": "JCT-01",
        "name": "JCT-01 · 4-Way Arterial Hub",
        "label": "JCT-01 · 4-Way Arterial Hub",
        "city": "Metropolitan Sector 1",
        "coordinates": "12.9716° N, 77.5946° E",
        "controllerSpec": "Adaptive ATCS · 4-Phase Isolated Control",
        "approaches": {
            "north": {"road": "North Arterial Boulevard", "lanes": 3, "speedKmh": 50},
            "south": {"road": "South Arterial Boulevard", "lanes": 3, "speedKmh": 50},
            "east": {"road": "East Commercial Avenue", "lanes": 2, "speedKmh": 40},
            "west": {"road": "West Commercial Avenue", "lanes": 2, "speedKmh": 40},
        },
    },
    "JCT-02": {
        "id": "JCT-02",
        "name": "JCT-02 · Downtown Commercial Crossway",
        "label": "JCT-02 · Downtown Commercial Crossway",
        "city": "Central Commercial District",
        "coordinates": "12.9780° N, 77.6010° E",
        "controllerSpec": "Pedestrian & Transit Coordinated ATCS",
        "approaches": {
            "north": {"road": "Main Market Street North", "lanes": 2, "speedKmh": 35},
            "south": {"road": "Main Market Street South", "lanes": 2, "speedKmh": 35},
            "east": {"road": "Cross Commercial Lane East", "lanes": 2, "speedKmh": 35},
            "west": {"road": "Cross Commercial Lane West", "lanes": 2, "speedKmh": 35},
        },
    },
    "JCT-03": {
        "id": "JCT-03",
        "name": "JCT-03 · Outer Ring Road 4-Way Junction",
        "label": "JCT-03 · Outer Ring Road 4-Way Junction",
        "city": "Perimeter Expressway Hub",
        "coordinates": "12.9352° N, 77.6245° E",
        "controllerSpec": "High-Throughput Express Traffic Control",
        "approaches": {
            "north": {"road": "Expressway Northbound", "lanes": 3, "speedKmh": 65},
            "south": {"road": "Expressway Southbound", "lanes": 3, "speedKmh": 65},
            "east": {"road": "Industrial Access Link East", "lanes": 2, "speedKmh": 45},
            "west": {"road": "Logistics Corridor West", "lanes": 2, "speedKmh": 45},
        },
    },
    "JCT-04": {
        "id": "JCT-04",
        "name": "JCT-04 · Multi-Modal Freight Crossway",
        "label": "JCT-04 · Multi-Modal Freight Crossway",
        "city": "Metropolitan Sector 4",
        "coordinates": "12.9177° N, 77.6238° E",
        "controllerSpec": "Freight & Transit Priority ATCS",
        "approaches": {
            "north": {"road": "North Freight Corridor", "lanes": 3, "speedKmh": 55},
            "south": {"road": "Elevated Expressway South", "lanes": 3, "speedKmh": 60},
            "east": {"road": "Outer Ring Road East", "lanes": 2, "speedKmh": 50},
            "west": {"road": "Arterial Bypass West", "lanes": 2, "speedKmh": 45},
        },
    },
}

# Standard traffic demand scenario presets (region-neutral academic/municipal benchmarks)
SCENARIO_PRESETS = {
    "auto": {
        "id": "auto",
        "label": "Auto Diurnal Demand (Adaptive Cycling)",
    },
    "acceptance_east": {
        "id": "acceptance_east",
        "label": "East Corridor Rush (20 Cars + 3 Trucks · Score 26 · Share 0.62)",
        "counts": {
            "north": {"motorcycle": 4, "car": 5, "bus": 1, "truck": 0, "bicycle": 0, "ambulance": 0, "fire_truck": 0, "police_vehicle": 0},
            "south": {"motorcycle": 2, "car": 2, "bus": 0, "truck": 1, "bicycle": 0, "ambulance": 0, "fire_truck": 0, "police_vehicle": 0},
            "east": {"motorcycle": 0, "car": 20, "bus": 0, "truck": 3, "bicycle": 0, "ambulance": 0, "fire_truck": 0, "police_vehicle": 0},
            "west": {"motorcycle": 0, "car": 2, "bus": 0, "truck": 0, "bicycle": 0, "ambulance": 0, "fire_truck": 0, "police_vehicle": 0},
        },
    },
    "morning_peak": {
        "id": "morning_peak",
        "label": "09:00 AM Central Business District Commuter Surge",
        "counts": {
            "north": {"motorcycle": 16, "car": 18, "bus": 3, "truck": 1, "bicycle": 1, "ambulance": 0, "fire_truck": 0, "police_vehicle": 0},
            "south": {"motorcycle": 6, "car": 7, "bus": 1, "truck": 0, "bicycle": 0, "ambulance": 0, "fire_truck": 0, "police_vehicle": 0},
            "east": {"motorcycle": 12, "car": 14, "bus": 2, "truck": 1, "bicycle": 1, "ambulance": 0, "fire_truck": 0, "police_vehicle": 0},
            "west": {"motorcycle": 4, "car": 5, "bus": 1, "truck": 0, "bicycle": 0, "ambulance": 0, "fire_truck": 0, "police_vehicle": 0},
        },
    },
    "evening_corridor": {
        "id": "evening_corridor",
        "label": "18:30 PM Institutional & Tech Corridor Outbound Wave",
        "counts": {
            "north": {"motorcycle": 5, "car": 6, "bus": 1, "truck": 0, "bicycle": 1, "ambulance": 0, "fire_truck": 0, "police_vehicle": 0},
            "south": {"motorcycle": 22, "car": 21, "bus": 4, "truck": 1, "bicycle": 2, "ambulance": 0, "fire_truck": 0, "police_vehicle": 0},
            "east": {"motorcycle": 10, "car": 11, "bus": 2, "truck": 1, "bicycle": 0, "ambulance": 0, "fire_truck": 0, "police_vehicle": 0},
            "west": {"motorcycle": 4, "car": 4, "bus": 0, "truck": 1, "bicycle": 1, "ambulance": 0, "fire_truck": 0, "police_vehicle": 0},
        },
    },
    "heavy_ns": {
        "id": "heavy_ns",
        "label": "23:30 PM National Highway Freight & Container Surge",
        "counts": {
            "north": {"motorcycle": 2, "car": 6, "bus": 1, "truck": 9, "bicycle": 0, "ambulance": 0, "fire_truck": 0, "police_vehicle": 0},
            "south": {"motorcycle": 1, "car": 5, "bus": 1, "truck": 8, "bicycle": 0, "ambulance": 0, "fire_truck": 0, "police_vehicle": 0},
            "east": {"motorcycle": 2, "car": 3, "bus": 0, "truck": 1, "bicycle": 0, "ambulance": 0, "fire_truck": 0, "police_vehicle": 0},
            "west": {"motorcycle": 1, "car": 2, "bus": 0, "truck": 1, "bicycle": 0, "ambulance": 0, "fire_truck": 0, "police_vehicle": 0},
        },
    },
}

# Pre-configured video feed sources for test ingestion in Video Perception Studio
TRAFFIC_LIVE_VIDEO_FEEDS = [
    {
        "id": "feed-01",
        "title": "Arterial 4-Way Junction Traffic CCTV",
        "location": "Primary Arterial Corridor · East Approach",
        "streamType": "live_stream",
        "resolution": "1080p · 30 FPS",
        "fps": 30,
        "bitrate": "3.4 Mbps",
        "sampleVideoUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
        "defaultApproach": "east",
        "baseVehicleCounts": {"car": 18, "motorcycle": 12, "bus": 3, "truck": 2, "bicycle": 1, "ambulance": 0, "fire_truck": 0, "police_vehicle": 0},
    },
    {
        "id": "feed-02",
        "title": "Downtown Commercial Crossway Live Stream",
        "location": "Central Business Corridor · North Approach",
        "streamType": "live_stream",
        "resolution": "1080p · 30 FPS",
        "fps": 30,
        "bitrate": "4.1 Mbps",
        "sampleVideoUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
        "defaultApproach": "north",
        "baseVehicleCounts": {"car": 16, "motorcycle": 18, "bus": 4, "truck": 3, "bicycle": 0, "ambulance": 0, "fire_truck": 0, "police_vehicle": 0},
    },
    {
        "id": "feed-03",
        "title": "Expressway Inflow & Interchange CCTV",
        "location": "Outer Highway Junction · South Approach",
        "streamType": "live_stream",
        "resolution": "1080p · 25 FPS",
        "fps": 25,
        "bitrate": "2.8 Mbps",
        "sampleVideoUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4",
        "defaultApproach": "south",
        "baseVehicleCounts": {"car": 22, "motorcycle": 16, "bus": 4, "truck": 1, "bicycle": 2, "ambulance": 0, "fire_truck": 0, "police_vehicle": 0},
    },
    {
        "id": "feed-04",
        "title": "Multi-Modal Transit Terminal Traffic Feed",
        "location": "Transit Terminal Crossway · West Approach",
        "streamType": "live_stream",
        "resolution": "720p · 30 FPS",
        "fps": 30,
        "bitrate": "2.2 Mbps",
        "sampleVideoUrl": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyBlazes.mp4",
        "defaultApproach": "west",
        "baseVehicleCounts": {"car": 14, "motorcycle": 15, "bus": 5, "truck": 4, "bicycle": 3, "ambulance": 0, "fire_truck": 0, "police_vehicle": 0},
    },
]

# YOLOv8 & ByteTrack configuration
YOLO_MODEL_PATH = os.getenv("YOLO_MODEL_PATH", "yolov8n.pt")
CONFIDENCE_THRESHOLD = float(os.getenv("YOLO_CONFIDENCE", "0.5"))
TRACKER_CONFIG = os.getenv("YOLO_TRACKER", "bytetrack.yaml")

# MQTT broker configuration (credentials read strictly from environment variables)
MQTT_BROKER_HOST = os.getenv("MQTT_BROKER_HOST", "localhost")
MQTT_BROKER_PORT = int(os.getenv("MQTT_BROKER_PORT", "1883"))
MQTT_USERNAME = os.getenv("MQTT_USERNAME", "")
MQTT_PASSWORD = os.getenv("MQTT_PASSWORD", "")
MQTT_KEEPALIVE = 60
MQTT_MAX_RETRIES = 3

# MQTT topic templates (Dashboard & Raspberry Pi Hardware Controller)
TOPIC_LANE_COUNTS = "traffic/{lane}/counts"
TOPIC_SIGNAL_STATE = "traffic/signal_state"
TOPIC_EMERGENCY = "traffic/emergency"
TOPIC_LANE_SIGNAL = "traffic/{lane}/signal"
TOPIC_LANE_STATUS = "traffic/{lane}/status"
TOPIC_SYSTEM_STATUS = "traffic/system/status"

# Canonical SQLite persistence path
DB_PATH = os.getenv("TRAFFIC_DB_PATH", "data/traffic_history.db")

# Simulator configuration
SIMULATOR_WIDTH = 900
SIMULATOR_HEIGHT = 700
SIMULATOR_FPS = 30
