"""Raspberry Pi / Traffic Signal Hardware Controller with Safe Simulation Mode."""

import json
import time
import uuid
from typing import Dict, Any, Optional, List
from .config import (
    LANES,
    SIMULATION_MODE,
    HARDWARE_MODE,
    YELLOW_TRANSITION_SECONDS,
    ALL_RED_CLEARANCE_SECONDS,
    MQTT_BROKER_HOST,
    MQTT_BROKER_PORT,
    MQTT_USERNAME,
    MQTT_PASSWORD,
    TOPIC_LANE_SIGNAL,
    TOPIC_SYSTEM_STATUS,
)
from .signal_controller import (
    validate_no_conflicting_greens,
    build_safe_transition_sequence,
)

# BCM GPIO pin assignment for 4-way traffic signal LED heads (12 GPIO outputs)
GPIO_PIN_MAP: Dict[str, Dict[str, int]] = {
    "north": {"RED": 17, "YELLOW": 27, "GREEN": 22},
    "south": {"RED": 23, "YELLOW": 24, "GREEN": 25},
    "east": {"RED": 5, "YELLOW": 6, "GREEN": 13},
    "west": {"RED": 19, "YELLOW": 26, "GREEN": 21},
}


class HardwareSignalController:
    """Controls physical Raspberry Pi GPIO traffic signal heads or runs in safe SIMULATION_MODE."""

    def __init__(
        self,
        simulation_mode: bool = SIMULATION_MODE,
        initial_active_green: Optional[str] = None,
    ) -> None:
        self.controller_instance_id: str = f"ctrl-{uuid.uuid4().hex[:8]}"
        self.simulation_mode = simulation_mode
        self._gpio: Any = None
        self.current_states: Dict[str, str] = {lane: "RED" for lane in LANES}
        self.active_green_lane: Optional[str] = (
            initial_active_green if initial_active_green in LANES else None
        )
        self.last_transition_log: List[Dict[str, Any]] = []
        self._init_hardware()
        if self.active_green_lane in LANES:
            self.current_states[self.active_green_lane] = "GREEN"

    def _init_hardware(self) -> None:
        """Initialize Raspberry Pi GPIO pins if HARDWARE_MODE is enabled and RPi.GPIO is present."""
        if self.simulation_mode:
            self.fail_safe_all_red(
                reason="Startup initialization in SIMULATION_MODE",
                preserve_active_green=self.active_green_lane is not None,
            )
            return

        try:
            import RPi.GPIO as GPIO  # type: ignore

            self._gpio = GPIO
            GPIO.setmode(GPIO.BCM)
            GPIO.setwarnings(False)
            for lane, pins in GPIO_PIN_MAP.items():
                for color, pin in pins.items():
                    GPIO.setup(pin, GPIO.OUT)
                    GPIO.output(pin, GPIO.HIGH if color == "RED" else GPIO.LOW)
            print("[Hardware] Raspberry Pi BCM GPIO initialized in HARDWARE_MODE.")
        except ImportError:
            print(
                "[Hardware] RPi.GPIO not available on this host; falling back to SIMULATION_MODE=True."
            )
            self.simulation_mode = True
            self.fail_safe_all_red(
                reason="Fallback to SIMULATION_MODE",
                preserve_active_green=self.active_green_lane is not None,
            )

    def _write_pins(self, states: Dict[str, str]) -> None:
        """Apply LED state dictionary after verifying no conflicting greens exist."""
        if not validate_no_conflicting_greens(states):
            self.fail_safe_all_red(reason="CONFLICTING GREEN INTERLOCK TRIGGERED")
            raise RuntimeError(
                f"Safety violation prevented: multiple GREEN signals requested in {states}"
            )

        for lane in LANES:
            target_color = str(states.get(lane, "RED")).upper()
            if target_color not in ("RED", "YELLOW", "GREEN"):
                target_color = "RED"
            self.current_states[lane] = target_color

            if not self.simulation_mode and self._gpio is not None:
                pins = GPIO_PIN_MAP[lane]
                for color, pin in pins.items():
                    self._gpio.output(
                        pin,
                        self._gpio.HIGH if color == target_color else self._gpio.LOW,
                    )

    def fail_safe_all_red(
        self, reason: str = "Fail-safe triggered", preserve_active_green: bool = False
    ) -> Dict[str, str]:
        """Force all four approaches to RED immediately."""
        for lane in LANES:
            self.current_states[lane] = "RED"
            if not self.simulation_mode and self._gpio is not None:
                pins = GPIO_PIN_MAP[lane]
                for color, pin in pins.items():
                    self._gpio.output(
                        pin,
                        self._gpio.HIGH if color == "RED" else self._gpio.LOW,
                    )
        if not preserve_active_green:
            self.active_green_lane = None
        self.last_transition_log.append(
            {
                "ts": time.strftime("%H:%M:%S"),
                "state": "ALL_RED",
                "reason": reason,
                "simulation_mode": self.simulation_mode,
            }
        )
        return dict(self.current_states)

    def transition_to_lane(
        self,
        target_lane: str,
        duration_seconds: int,
        mode: str = "ADAPTIVE",
        sleep_transitions: bool = False,
    ) -> Dict[str, Any]:
        """Transition safely from current green approach to `target_lane` via YELLOW -> ALL_RED -> GREEN."""
        if target_lane not in LANES:
            raise ValueError(f"Invalid target lane '{target_lane}'.")

        is_em = str(mode).upper() == "EMERGENCY"
        steps = build_safe_transition_sequence(
            self.active_green_lane,
            target_lane,
            is_emergency=is_em,
            green_seconds=int(duration_seconds),
        )

        for step in steps:
            step_lane = step["lane"]
            step_state = step["state"]
            wait_s = float(step["duration_s"])

            if step_lane == "all" and step_state == "RED":
                self._write_pins({ln: "RED" for ln in LANES})
                if sleep_transitions and wait_s > 0:
                    time.sleep(min(wait_s, float(ALL_RED_CLEARANCE_SECONDS)))
            elif step_state == "YELLOW" and step_lane in LANES:
                interim = {ln: "RED" for ln in LANES}
                interim[step_lane] = "YELLOW"
                self._write_pins(interim)
                if sleep_transitions and wait_s > 0:
                    time.sleep(min(wait_s, float(YELLOW_TRANSITION_SECONDS)))
            elif step_state == "GREEN" and step_lane in LANES:
                final_map = {ln: "RED" for ln in LANES}
                final_map[step_lane] = "GREEN"
                self._write_pins(final_map)
                self.active_green_lane = step_lane

        executed_phases = [
            f"{step['lane'].upper()}:{step['state']}({int(step['duration_s'])}s)"
            for step in steps
        ]
        status = {
            "controller_instance_id": self.controller_instance_id,
            "active_green_lane": self.active_green_lane,
            "duration_seconds": int(duration_seconds),
            "mode": str(mode).upper(),
            "simulation_mode": self.simulation_mode,
            "hardware_mode": HARDWARE_MODE and not self.simulation_mode,
            "interlock_ok": validate_no_conflicting_greens(self.current_states),
            "gpio_pin_map": GPIO_PIN_MAP,
            "pin_states": self.get_pin_telemetry(),
            "transition_steps": steps,
            "executed_phases": executed_phases,
        }
        self.last_transition_log = (self.last_transition_log + [status])[-20:]
        return status

    def get_status(self) -> Dict[str, Any]:
        """Return live telemetry snapshot for persistent controller status reporting."""
        last_entry = self.last_transition_log[-1] if self.last_transition_log else {}
        return {
            "controller_instance_id": self.controller_instance_id,
            "active_green_lane": self.active_green_lane,
            "simulation_mode": self.simulation_mode,
            "hardware_mode": HARDWARE_MODE and not self.simulation_mode,
            "interlock_ok": validate_no_conflicting_greens(self.current_states),
            "gpio_pin_map": GPIO_PIN_MAP,
            "pin_states": self.get_pin_telemetry(),
            "transition_steps": last_entry.get("transition_steps", []),
            "transition_history_count": len(self.last_transition_log),
        }

    def get_pin_telemetry(self) -> Dict[str, Dict[str, Any]]:
        """Return current LED state and BCM GPIO pin numbers for each road."""
        out: Dict[str, Dict[str, Any]] = {}
        for lane in LANES:
            st = self.current_states.get(lane, "RED")
            pins = GPIO_PIN_MAP[lane]
            out[lane] = {
                "signal": st,
                "bcm_pins": pins,
                "active_pin": pins.get(st, pins["RED"]),
            }
        return out

    def close(self) -> None:
        """Reset all signals to fail-safe RED and clean up GPIO resources."""
        self.fail_safe_all_red(reason="Controller shutdown")
        if not self.simulation_mode and self._gpio is not None:
            try:
                self._gpio.cleanup()
            except Exception:
                pass


def run_mqtt_hardware_daemon() -> None:
    """Run standalone MQTT hardware controller listener for Raspberry Pi deployment."""
    controller = HardwareSignalController()
    try:
        import paho.mqtt.client as mqtt
    except ImportError:
        print("[Hardware] paho-mqtt not installed; cannot start MQTT listener daemon.")
        return

    client = mqtt.Client(
        mqtt.CallbackAPIVersion.VERSION2, client_id="rpi_traffic_hardware_controller"
    )
    if MQTT_USERNAME:
        client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD or None)

    def on_connect(c: Any, userdata: Any, flags: Any, reason_code: Any, properties: Any = None) -> None:
        for lane in LANES:
            c.subscribe(TOPIC_LANE_SIGNAL.format(lane=lane), qos=1)
        print(
            f"[Hardware] Listening on traffic/+/signal (SIMULATION_MODE={controller.simulation_mode})"
        )

    def on_message(c: Any, userdata: Any, msg: Any) -> None:
        try:
            payload = json.loads(msg.payload.decode("utf-8"))
            road = str(payload.get("road", "")).lower()
            sig = str(payload.get("signal", "RED")).upper()
            dur = int(payload.get("duration", 15))
            mode = str(payload.get("mode", "ADAPTIVE"))
            if road in LANES and sig == "GREEN":
                status = controller.transition_to_lane(
                    road, dur, mode=mode, sleep_transitions=False
                )
                c.publish(TOPIC_SYSTEM_STATUS, json.dumps(status), qos=0, retain=True)
        except Exception as exc:
            print(f"[Hardware] Error handling signal message: {exc}")
            controller.fail_safe_all_red(reason=str(exc))

    client.on_connect = on_connect
    client.on_message = on_message

    try:
        client.connect(MQTT_BROKER_HOST, MQTT_BROKER_PORT, keepalive=60)
        client.loop_forever()
    except KeyboardInterrupt:
        pass
    except Exception as exc:
        print(f"[Hardware] Broker unreachable ({exc}); holding fail-safe ALL RED.")
    finally:
        controller.close()


if __name__ == "__main__":
    run_mqtt_hardware_daemon()
