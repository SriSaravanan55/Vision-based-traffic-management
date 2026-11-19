"""Resilient MQTT bridge using paho-mqtt 2.x (CallbackAPIVersion.VERSION2)."""

import json
import time
from typing import Dict, Any, Optional
from .config import (
    LANES,
    MQTT_BROKER_HOST,
    MQTT_BROKER_PORT,
    MQTT_USERNAME,
    MQTT_PASSWORD,
    MQTT_KEEPALIVE,
    MQTT_MAX_RETRIES,
    TOPIC_LANE_COUNTS,
    TOPIC_SIGNAL_STATE,
    TOPIC_EMERGENCY,
    TOPIC_LANE_SIGNAL,
    TOPIC_LANE_STATUS,
    TOPIC_SYSTEM_STATUS,
    SIMULATION_MODE,
)


class MqttBridge:
    """Publishes intersection telemetry to an MQTT broker with automatic fallback."""

    def __init__(
        self,
        host: str = MQTT_BROKER_HOST,
        port: int = MQTT_BROKER_PORT,
        max_retries: int = MQTT_MAX_RETRIES,
    ) -> None:
        self.host = host
        self.port = int(port)
        self.max_retries = max_retries
        self.connected = False
        self._client: Any = None
        self._offline_notice_printed = False

    def connect(self) -> bool:
        try:
            import paho.mqtt.client as mqtt
        except ImportError:
            if not self._offline_notice_printed:
                print(
                    "[MQTT] paho-mqtt not installed; continuing in offline telemetry mode."
                )
                self._offline_notice_printed = True
            self.connected = False
            return False

        try:
            self._client = mqtt.Client(
                mqtt.CallbackAPIVersion.VERSION2,
                client_id="traffic_ai_pipeline",
            )
        except AttributeError:
            self._client = mqtt.Client(client_id="traffic_ai_pipeline")

        def on_connect(client: Any, userdata: Any, flags: Any, reason_code: Any, properties: Any = None) -> None:
            rc = getattr(reason_code, "value", reason_code)
            if rc == 0:
                self.connected = True

        def on_disconnect(client: Any, userdata: Any, *args: Any) -> None:
            self.connected = False

        self._client.on_connect = on_connect
        self._client.on_disconnect = on_disconnect
        if MQTT_USERNAME:
            self._client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD or None)

        for attempt in range(1, self.max_retries + 1):
            try:
                self._client.connect(self.host, self.port, keepalive=MQTT_KEEPALIVE)
                self._client.loop_start()
                self.connected = True
                print(f"[MQTT] Connected to broker at {self.host}:{self.port}")
                return True
            except Exception as exc:
                print(
                    f"[MQTT] Connection attempt {attempt}/{self.max_retries} to "
                    f"{self.host}:{self.port} failed: {exc}"
                )
                if attempt < self.max_retries:
                    time.sleep(0.4)

        if not self._offline_notice_printed:
            print(
                f"[MQTT] Broker at {self.host}:{self.port} is unreachable after "
                f"{self.max_retries} attempts. Continuing pipeline without MQTT publishing."
            )
            self._offline_notice_printed = True
        self.connected = False
        return False

    def _safe_publish(self, topic: str, payload: Dict[str, Any], qos: int = 0, retain: bool = False) -> bool:
        if not self.connected or self._client is None:
            return False
        try:
            body = json.dumps(payload)
            info = self._client.publish(topic, body, qos=qos, retain=retain)
            return info.rc == 0
        except Exception as exc:
            print(f"[MQTT] Publish warning on {topic}: {exc}. Switching to offline mode.")
            self.connected = False
            return False

    def publish_lane_counts(
        self,
        summary: Dict[str, Dict[str, Any]],
        ts: Optional[str] = None,
    ) -> None:
        timestamp = ts or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        for lane in LANES:
            lane_data = summary.get(lane, {})
            payload = {
                "ts": timestamp,
                "lane": lane,
                "raw_counts": lane_data.get("raw_counts", {}),
                "vehicle_total": int(lane_data.get("vehicle_total", 0)),
                "weighted_score": float(lane_data.get("weighted_score", 0.0)),
                "density_level": str(lane_data.get("density_level", "Low")),
                "density_share": float(lane_data.get("density_share", 0.25)),
            }
            topic = TOPIC_LANE_COUNTS.format(lane=lane)
            self._safe_publish(topic, payload, qos=0, retain=True)

    def publish_signal_state(
        self,
        summary: Dict[str, Dict[str, Any]],
        signal_plan: Dict[str, Dict[str, Any]],
        emergency_lane: Optional[str] = None,
        cycle: int = 1,
        ts: Optional[str] = None,
    ) -> None:
        timestamp = ts or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        lanes_payload: Dict[str, Dict[str, Any]] = {}
        for lane in LANES:
            s_data = summary.get(lane, {})
            p_data = signal_plan.get(lane, {})
            active_sig = str(p_data.get("active_phase_signal", "GREEN" if lane == emergency_lane else "RED"))
            mode_str = str(p_data.get("mode", "normal"))
            green_sec = int(p_data.get("green_seconds", 15))

            lanes_payload[lane] = {
                "raw_counts": s_data.get("raw_counts", {}),
                "vehicle_total": int(s_data.get("vehicle_total", 0)),
                "weighted_score": float(s_data.get("weighted_score", 0.0)),
                "density_level": str(s_data.get("density_level", "Low")),
                "density_code": str(s_data.get("density_code", "LOW")),
                "density_share": float(s_data.get("density_share", 0.25)),
                "queue_length_meters": float(s_data.get("queue_length_meters", 0.0)),
                "road_occupancy_pct": float(s_data.get("road_occupancy_pct", 0.0)),
                "average_waiting_time": float(s_data.get("average_waiting_time", 0.0)),
                "maximum_waiting_time": float(s_data.get("maximum_waiting_time", 0.0)),
                "pedestrian_count": int(s_data.get("pedestrian_count", 0)),
                "priority_score": float(p_data.get("priority_score", 0.0)),
                "starvation_flagged": bool(p_data.get("starvation_flagged", False)),
                "active_phase_signal": active_sig,
                "green_seconds": green_sec,
                "mode": mode_str,
            }

            hw_signal_payload = {
                "road": lane,
                "signal": active_sig,
                "duration": green_sec,
                "mode": "EMERGENCY" if mode_str == "emergency" else "ADAPTIVE",
                "control_mode": "SIMULATION" if SIMULATION_MODE else "HARDWARE",
                "ts": timestamp,
            }
            self._safe_publish(
                TOPIC_LANE_SIGNAL.format(lane=lane), hw_signal_payload, qos=0, retain=True
            )
            self._safe_publish(
                TOPIC_LANE_STATUS.format(lane=lane), lanes_payload[lane], qos=0, retain=True
            )

        payload = {
            "ts": timestamp,
            "cycle": int(cycle),
            "emergency_lane": emergency_lane,
            "control_mode": "SIMULATION" if SIMULATION_MODE else "HARDWARE",
            "lanes": lanes_payload,
        }
        self._safe_publish(TOPIC_SIGNAL_STATE, payload, qos=0, retain=True)
        self._safe_publish(
            TOPIC_SYSTEM_STATUS,
            {
                "ts": timestamp,
                "cycle": int(cycle),
                "simulation_mode": SIMULATION_MODE,
                "emergency_lane": emergency_lane,
                "status": "ONLINE",
            },
            qos=0,
            retain=True,
        )

    def publish_emergency(
        self,
        emergency_lane: Optional[str],
        cycle: int = 1,
        ts: Optional[str] = None,
    ) -> None:
        timestamp = ts or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        payload = {
            "ts": timestamp,
            "cycle": int(cycle),
            "active": emergency_lane is not None,
            "emergency_lane": emergency_lane,
            "green_seconds": 25 if emergency_lane else 0,
            "mode": "emergency" if emergency_lane else "normal",
        }
        self._safe_publish(TOPIC_EMERGENCY, payload, qos=1, retain=False)

    def close(self) -> None:
        if self._client is not None:
            try:
                self._client.loop_stop()
                self._client.disconnect()
            except Exception:
                pass
        self.connected = False
