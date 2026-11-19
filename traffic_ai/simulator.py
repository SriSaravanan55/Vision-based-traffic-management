"""Pygame 4-way intersection simulator (headless-capable via SDL_VIDEODRIVER=dummy)."""

import os
import time
from typing import Dict, Any, Optional
from .config import LANES, SIMULATOR_WIDTH, SIMULATOR_HEIGHT, SIMULATOR_FPS

COLOR_BG = (10, 15, 26)
COLOR_ROAD = (18, 28, 44)
COLOR_GRID = (30, 58, 92)
COLOR_PANEL = (15, 24, 38)
COLOR_CYAN = (79, 209, 232)
COLOR_GREEN = (0, 227, 122)
COLOR_RED = (255, 68, 68)
COLOR_AMBER = (255, 176, 32)
COLOR_GREY = (100, 116, 139)
COLOR_TEXT = (226, 232, 240)
COLOR_MUTED = (148, 163, 184)


def determine_signal_color(green_seconds: int, mode: str) -> tuple[int, int, int]:
    if mode == "hold":
        return COLOR_GREY
    if green_seconds > 0 and mode in ("normal", "emergency"):
        return COLOR_GREEN
    return COLOR_RED


class IntersectionSimulator:
    """Renders the 4-way intersection state in Pygame at 30 FPS (headless-safe)."""

    def __init__(self, headless: bool = False) -> None:
        if headless or (
            os.name != "nt"
            and not os.environ.get("DISPLAY")
            and not os.environ.get("WAYLAND_DISPLAY")
        ):
            os.environ.setdefault("SDL_VIDEODRIVER", "dummy")

        self.headless = os.environ.get("SDL_VIDEODRIVER") == "dummy"
        self._pygame: Any = None
        self._screen: Any = None
        self._clock: Any = None
        self._font_title: Any = None
        self._font_label: Any = None
        self._font_timer: Any = None
        self._font_meta: Any = None
        self.running = True

        self._init_pygame()

    def _init_pygame(self) -> None:
        try:
            import pygame

            self._pygame = pygame
            pygame.init()
            pygame.font.init()
            self._screen = pygame.display.set_mode((SIMULATOR_WIDTH, SIMULATOR_HEIGHT))
            pygame.display.set_caption(
                "AI-Based Smart Traffic Management System — 4-Way Simulator"
            )
            self._clock = pygame.time.Clock()
            self._font_title = pygame.font.SysFont("consolas,monospace", 20, bold=True)
            self._font_label = pygame.font.SysFont("consolas,monospace", 16, bold=True)
            self._font_timer = pygame.font.SysFont("consolas,monospace", 22, bold=True)
            self._font_meta = pygame.font.SysFont("consolas,monospace", 14, bold=False)
        except ImportError:
            self._pygame = None
            print(
                "[Simulator] pygame not installed; running in console countdown fallback mode."
            )
        except Exception as exc:
            try:
                os.environ["SDL_VIDEODRIVER"] = "dummy"
                import pygame

                self._pygame = pygame
                pygame.init()
                pygame.font.init()
                self._screen = pygame.display.set_mode((SIMULATOR_WIDTH, SIMULATOR_HEIGHT))
                self._clock = pygame.time.Clock()
                self._font_title = pygame.font.SysFont(None, 22)
                self._font_label = pygame.font.SysFont(None, 18)
                self._font_timer = pygame.font.SysFont(None, 24)
                self._font_meta = pygame.font.SysFont(None, 16)
            except Exception:
                self._pygame = None
                print(f"[Simulator] Headless fallback active ({exc}).")

    def render_frame(
        self,
        summary: Dict[str, Dict[str, Any]],
        signal_plan: Dict[str, Dict[str, Any]],
        remaining_timers: Dict[str, int],
        cycle: int = 1,
        emergency_lane: Optional[str] = None,
    ) -> None:
        if self._pygame is None or self._screen is None:
            return

        pygame = self._pygame
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                self.running = False
                return

        screen = self._screen
        screen.fill(COLOR_BG)

        for x in range(0, SIMULATOR_WIDTH, 28):
            pygame.draw.line(screen, (16, 30, 48), (x, 0), (x, SIMULATOR_HEIGHT), 1)
        for y in range(0, SIMULATOR_HEIGHT, 28):
            pygame.draw.line(screen, (16, 30, 48), (0, y), (SIMULATOR_WIDTH, y), 1)

        cx, cy = SIMULATOR_WIDTH // 2, SIMULATOR_HEIGHT // 2 + 20
        road_half = 85

        pygame.draw.rect(
            screen,
            COLOR_ROAD,
            (cx - road_half, 60, road_half * 2, SIMULATOR_HEIGHT - 80),
        )
        pygame.draw.rect(
            screen,
            COLOR_ROAD,
            (60, cy - road_half, SIMULATOR_WIDTH - 120, road_half * 2),
        )
        pygame.draw.rect(
            screen,
            COLOR_GRID,
            (cx - road_half, 60, road_half * 2, SIMULATOR_HEIGHT - 80),
            2,
        )
        pygame.draw.rect(
            screen,
            COLOR_GRID,
            (60, cy - road_half, SIMULATOR_WIDTH - 120, road_half * 2),
            2,
        )
        pygame.draw.rect(
            screen,
            (22, 36, 56),
            (cx - road_half, cy - road_half, road_half * 2, road_half * 2),
            1,
        )

        for y in range(70, cy - road_half - 10, 24):
            pygame.draw.line(screen, COLOR_CYAN, (cx, y), (cx, y + 12), 2)
        for y in range(cy + road_half + 10, SIMULATOR_HEIGHT - 30, 24):
            pygame.draw.line(screen, COLOR_CYAN, (cx, y), (cx, y + 12), 2)
        for x in range(70, cx - road_half - 10, 24):
            pygame.draw.line(screen, COLOR_CYAN, (x, cy), (x + 12, cy), 2)
        for x in range(cx + road_half + 10, SIMULATOR_WIDTH - 70, 24):
            pygame.draw.line(screen, COLOR_CYAN, (x, cy), (x + 12, cy), 2)

        header_text = f"JCT-01 TRAFFIC OPS SIMULATOR  |  CYCLE #{cycle:02d}"
        if emergency_lane:
            header_text += f"  |  EMERGENCY PREEMPTION: {emergency_lane.upper()} (GREEN 25s)"
        header_surf = self._font_title.render(
            header_text,
            True,
            COLOR_RED if emergency_lane else COLOR_CYAN,
        )
        screen.blit(header_surf, (24, 18))

        lane_anchors = {
            "north": (cx, cy - road_half - 115),
            "south": (cx, cy + road_half + 75),
            "west": (cx - road_half - 165, cy),
            "east": (cx + road_half + 165, cy),
        }

        for lane in LANES:
            ax, ay = lane_anchors[lane]
            s_info = summary.get(lane, {})
            p_info = signal_plan.get(lane, {})
            mode = str(p_info.get("mode", "normal"))
            rem_sec = int(remaining_timers.get(lane, p_info.get("green_seconds", 0)))
            level = str(s_info.get("density_level", "Low"))
            veh_total = int(s_info.get("vehicle_total", 0))

            sig_color = determine_signal_color(rem_sec, mode)

            card_rect = pygame.Rect(ax - 105, ay - 46, 210, 108)
            pygame.draw.rect(screen, COLOR_PANEL, card_rect, border_radius=6)
            pygame.draw.rect(screen, COLOR_GRID, card_rect, width=1, border_radius=6)

            circle_center = (ax, ay - 22)
            pygame.draw.circle(screen, (8, 12, 20), circle_center, 18)
            pygame.draw.circle(screen, sig_color, circle_center, 14)
            pygame.draw.circle(screen, COLOR_TEXT, circle_center, 18, 1)

            mode_tag = " [EMERG]" if mode == "emergency" else (" [HOLD]" if mode == "hold" else "")
            line1_color = COLOR_RED if mode == "emergency" else COLOR_TEXT
            line1_surf = self._font_label.render(f"{lane.upper()}{mode_tag}", True, line1_color)
            screen.blit(line1_surf, (ax - line1_surf.get_width() // 2, ay + 2))

            timer_str = f"{rem_sec:02d}s" if mode != "hold" else "HOLD (0s)"
            line2_surf = self._font_timer.render(timer_str, True, sig_color)
            screen.blit(line2_surf, (ax - line2_surf.get_width() // 2, ay + 20))

            line3_surf = self._font_meta.render(f"{level} ({veh_total} veh)", True, COLOR_MUTED)
            screen.blit(line3_surf, (ax - line3_surf.get_width() // 2, ay + 43))

        pygame.display.flip()

    def run_cycle_countdown(
        self,
        summary: Dict[str, Dict[str, Any]],
        signal_plan: Dict[str, Dict[str, Any]],
        cycle: int = 1,
        emergency_lane: Optional[str] = None,
        realtime: bool = True,
        max_sim_seconds: Optional[float] = None,
    ) -> None:
        remaining = {
            lane: int(signal_plan.get(lane, {}).get("green_seconds", 0))
            for lane in LANES
        }
        max_green = max(remaining.values()) if remaining else 15
        total_seconds = max(1, max_green)
        if max_sim_seconds is not None:
            steps = max(1, int(round(max_sim_seconds)))
        elif not realtime:
            steps = 1
        else:
            steps = total_seconds

        for tick_sec in range(steps):
            if not self.running:
                break
            current_timers = {
                lane: max(0, remaining[lane] - tick_sec) for lane in LANES
            }
            if self._pygame is not None:
                frames = SIMULATOR_FPS if realtime else 1
                for _ in range(frames):
                    if not self.running:
                        break
                    self.render_frame(
                        summary=summary,
                        signal_plan=signal_plan,
                        remaining_timers=current_timers,
                        cycle=cycle,
                        emergency_lane=emergency_lane,
                    )
                    if self._clock is not None and realtime:
                        self._clock.tick(SIMULATOR_FPS)
            else:
                if realtime:
                    time.sleep(1.0 / SIMULATOR_FPS)

    def close(self) -> None:
        if self._pygame is not None:
            try:
                self._pygame.quit()
            except Exception:
                pass
        self.running = False
