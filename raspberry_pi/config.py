"""
Raspberry Pi GPIO Hardware Configuration for 4-Way Traffic Signal Control.

Defines the mapping of traffic light LEDs (Red, Yellow, Green) for North, South,
East, and West intersections to specific Raspberry Pi Broadcom (BCM) GPIO pins.

Electrical Safety Rules:
- Always use a 220 Ohm or 330 Ohm current-limiting resistor in series with each LED.
- Connect LED Anode (+) to the GPIO pin, and Cathode (-) via resistor to GND.
- Never exceed 16mA per individual GPIO pin or 50mA total across all GPIO pins.
"""

from typing import Dict, List, Tuple

# Broadcom (BCM) GPIO pin numbers for 4-way intersection traffic lights
TRAFFIC_LIGHTS: Dict[str, Dict[str, int]] = {
    "north": {
        "red": 17,     # Physical Pin 11
        "yellow": 27,  # Physical Pin 13
        "green": 22,   # Physical Pin 15
    },
    "south": {
        "red": 23,     # Physical Pin 16
        "yellow": 24,  # Physical Pin 18
        "green": 25,   # Physical Pin 22
    },
    "east": {
        "red": 5,      # Physical Pin 29
        "yellow": 6,   # Physical Pin 31
        "green": 13,   # Physical Pin 33
    },
    "west": {
        "red": 19,     # Physical Pin 35
        "yellow": 26,  # Physical Pin 37
        "green": 21,   # Physical Pin 40
    },
}

# Physical Raspberry Pi 40-Pin Header mapping for wiring verification
PHYSICAL_PIN_MAP: Dict[int, Tuple[str, str]] = {
    11: ("north", "red"),
    13: ("north", "yellow"),
    15: ("north", "green"),
    16: ("south", "red"),
    18: ("south", "yellow"),
    22: ("south", "green"),
    29: ("east", "red"),
    31: ("east", "yellow"),
    33: ("east", "green"),
    35: ("west", "red"),
    37: ("west", "yellow"),
    40: ("west", "green"),
}

# Recommended Common Ground (GND) header pins
GROUND_PINS: List[int] = [6, 9, 14, 20, 25, 30, 34, 39]

# Optional hardware inputs (Pedestrian push buttons & Emergency override)
INPUT_PINS: Dict[str, int] = {
    "pedestrian_button_north": 4,   # Physical Pin 7
    "pedestrian_button_south": 18,  # Physical Pin 12
    "pedestrian_button_east": 20,   # Physical Pin 38
    "pedestrian_button_west": 12,   # Physical Pin 32
    "emergency_manual_switch": 16,  # Physical Pin 36
}

# Signal transition & safety timing (in seconds)
TIMING_CONFIG = {
    "yellow_duration": 3,
    "all_red_clearance": 2,
    "emergency_green": 25,
    "min_green": 15,
    "max_green": 45,
    "mqtt_watchdog_timeout": 10,  # Revert to safe local cycle if MQTT is lost for >10s
}

# Active logic level: True for standard active-high wiring (HIGH = ON)
ACTIVE_HIGH: bool = True


def get_all_led_pins() -> List[int]:
    """Return a flat list of all 12 BCM pins assigned to traffic LEDs."""
    pins: List[int] = []
    for approach in TRAFFIC_LIGHTS.values():
        pins.extend(approach.values())
    return pins


def validate_pin_conflicts() -> bool:
    """Verify that all configured BCM pins are unique and do not overlap."""
    led_pins = get_all_led_pins()
    input_pins = list(INPUT_PINS.values())
    all_pins = led_pins + input_pins
    return len(all_pins) == len(set(all_pins))


if __name__ == "__main__":
    print("=" * 60)
    print("Raspberry Pi 4-Way Traffic Light GPIO Configuration")
    print("=" * 60)
    for approach, colors in TRAFFIC_LIGHTS.items():
        print(f"[{approach.upper():5s}] RED: BCM {colors['red']:2d} | YELLOW: BCM {colors['yellow']:2d} | GREEN: BCM {colors['green']:2d}")
    print("-" * 60)
    print(f"Pin conflicts detected: {not validate_pin_conflicts()}")
    print("Ready for Raspberry Pi GPIO deployment.")
    print("=" * 60)
