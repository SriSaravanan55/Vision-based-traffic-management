"""YOLOv8 + ByteTrack vehicle detection and multi-object tracking module."""

import time
from typing import Dict, Set, Tuple, Optional, Any, List
from .config import (
    LANES,
    VEHICLE_WEIGHTS,
    VEHICLE_LENGTH_METERS,
    COCO_VEHICLE_CLASSES,
    PEDESTRIAN_CLASS,
    COCO_CLASS_ID_MAP,
    EMERGENCY_CLASSES,
    YOLO_MODEL_PATH,
    CONFIDENCE_THRESHOLD,
    TRACKER_CONFIG,
)


class VehicleDetector:
    """Wraps Ultralytics YOLOv8 with ByteTrack for per-lane queue and unique vehicle counting."""

    def __init__(
        self,
        model_path: str = YOLO_MODEL_PATH,
        conf: float = CONFIDENCE_THRESHOLD,
        tracker: str = TRACKER_CONFIG,
    ) -> None:
        self.model_path = model_path
        self.conf = conf
        self.tracker = tracker
        self._model: Any = None

        self._seen_track_ids: Dict[str, Set[int]] = {lane: set() for lane in LANES}
        self._cumulative_counts: Dict[str, Dict[str, int]] = {
            lane: {k: 0 for k in VEHICLE_WEIGHTS} for lane in LANES
        }
        self._in_frame_counts: Dict[str, Dict[str, int]] = {
            lane: {k: 0 for k in VEHICLE_WEIGHTS} for lane in LANES
        }
        self._in_frame_track_ids: Dict[str, Set[int]] = {lane: set() for lane in LANES}
        self._pedestrian_counts: Dict[str, int] = {lane: 0 for lane in LANES}
        self._last_detections: Dict[str, List[Dict[str, Any]]] = {
            lane: [] for lane in LANES
        }
        self._track_motion: Dict[str, Dict[int, Tuple[float, float, int]]] = {
            lane: {} for lane in LANES
        }

    def _ensure_model(self) -> Any:
        if self._model is None:
            from ultralytics import YOLO

            self._model = YOLO(self.model_path)
        return self._model

    def reset_track_memory(self, lane: Optional[str] = None) -> None:
        target_lanes = [lane] if lane in LANES else list(LANES)
        for ln in target_lanes:
            self._seen_track_ids[ln] = set()
            self._cumulative_counts[ln] = {k: 0 for k in VEHICLE_WEIGHTS}
            self._in_frame_counts[ln] = {k: 0 for k in VEHICLE_WEIGHTS}
            self._in_frame_track_ids[ln] = set()
            self._pedestrian_counts[ln] = 0
            self._last_detections[ln] = []
            self._track_motion[ln] = {}

    def vehicles_currently_in_frame(self, lane: str) -> int:
        if lane not in self._in_frame_counts:
            return 0
        return sum(self._in_frame_counts[lane].values())

    def get_in_frame_counts(self, lane: str) -> Dict[str, int]:
        return dict(self._in_frame_counts.get(lane, {k: 0 for k in VEHICLE_WEIGHTS}))

    def get_pedestrian_count(self, lane: str) -> int:
        return int(self._pedestrian_counts.get(lane, 0))

    def get_last_detections(self, lane: str) -> List[Dict[str, Any]]:
        return list(self._last_detections.get(lane, []))

    def get_unique_cumulative_counts(self, lane: str) -> Dict[str, int]:
        return dict(self._cumulative_counts.get(lane, {k: 0 for k in VEHICLE_WEIGHTS}))

    def estimate_queue_length_meters(self, lane: str, sub_lanes: int = 2) -> float:
        counts = self._in_frame_counts.get(lane, {})
        total_linear_meters = sum(
            int(counts.get(v_cls, 0)) * float(VEHICLE_LENGTH_METERS.get(v_cls, 5.0))
            for v_cls in VEHICLE_WEIGHTS
        )
        return round(total_linear_meters / max(1, int(sub_lanes)), 1)

    def detect_abnormal_events(
        self, lane: str, stationary_threshold_frames: int = 15
    ) -> Optional[Dict[str, str]]:
        motion_map = self._track_motion.get(lane, {})
        for tid, (_, _, st_frames) in motion_map.items():
            if st_frames >= stationary_threshold_frames:
                return {
                    "event_type": "Potential Accident",
                    "road": lane.capitalize(),
                    "track_id": str(tid),
                    "time": time.strftime("%H:%M:%S"),
                    "status": "Requires Verification",
                }
        return None

    @staticmethod
    def _normalize_class_name(raw_name: str, cls_id: int) -> Optional[str]:
        normalized = raw_name.strip().lower().replace("-", "_").replace(" ", "_")
        if normalized in ("person", "pedestrian"):
            return PEDESTRIAN_CLASS
        if normalized in ("bike", "bicycle"):
            return "bicycle"
        if normalized in ("motorbike", "motorcycle"):
            return "motorcycle"
        if normalized in ("firetruck", "fire_engine", "fire_truck"):
            return "fire_truck"
        if normalized in ("police", "police_car", "police_vehicle"):
            return "police_vehicle"
        if normalized in COCO_VEHICLE_CLASSES or normalized in EMERGENCY_CLASSES:
            return normalized
        if cls_id in COCO_CLASS_ID_MAP:
            return COCO_CLASS_ID_MAP[cls_id]
        return None

    def process_frame(
        self, frame: Any, lane: str
    ) -> Tuple[Dict[str, int], bool, Any]:
        if lane not in LANES:
            raise ValueError(f"Unknown lane '{lane}'. Expected one of {LANES}.")

        model = self._ensure_model()
        results = model.track(
            frame,
            persist=True,
            conf=self.conf,
            tracker=self.tracker,
            verbose=False,
        )

        counts_in_frame: Dict[str, int] = {k: 0 for k in VEHICLE_WEIGHTS}
        pedestrians_in_frame = 0
        active_track_ids: Set[int] = set()
        structured_detections: List[Dict[str, Any]] = []
        emergency_present = False
        annotated_frame = frame

        if results and len(results) > 0:
            result = results[0]
            annotated_frame = result.plot()
            names_map = getattr(result, "names", None) or getattr(model, "names", {})
            boxes = getattr(result, "boxes", None)

            if boxes is not None and len(boxes) > 0:
                cls_list = boxes.cls.int().tolist() if boxes.cls is not None else []
                conf_list = (
                    boxes.conf.tolist()
                    if getattr(boxes, "conf", None) is not None
                    else [self.conf] * len(cls_list)
                )
                xyxy_list = (
                    boxes.xyxy.tolist()
                    if getattr(boxes, "xyxy", None) is not None
                    else [[0, 0, 0, 0]] * len(cls_list)
                )
                id_list = (
                    boxes.id.int().tolist()
                    if getattr(boxes, "id", None) is not None
                    else [None] * len(cls_list)
                )

                seen_in_this_frame: Set[int] = set()
                for idx, cls_id in enumerate(cls_list):
                    raw_label = str(names_map.get(cls_id, ""))
                    canonical = self._normalize_class_name(raw_label, int(cls_id))
                    if canonical is None:
                        continue

                    coords = xyxy_list[idx] if idx < len(xyxy_list) else [0, 0, 0, 0]
                    x1, y1, x2, y2 = [int(round(float(c))) for c in coords[:4]]
                    conf_val = round(float(conf_list[idx]), 2) if idx < len(conf_list) else self.conf
                    track_id = id_list[idx]

                    if track_id is not None:
                        tid = int(track_id)
                        if tid in seen_in_this_frame:
                            continue
                        seen_in_this_frame.add(tid)
                        active_track_ids.add(tid)

                        cx, cy = (x1 + x2) / 2.0, (y1 + y2) / 2.0
                        prev = self._track_motion[lane].get(tid)
                        if prev is not None:
                            dist = ((cx - prev[0]) ** 2 + (cy - prev[1]) ** 2) ** 0.5
                            st_cnt = prev[2] + 1 if dist < 3.5 else 0
                            self._track_motion[lane][tid] = (cx, cy, st_cnt)
                        else:
                            self._track_motion[lane][tid] = (cx, cy, 0)

                        if canonical != PEDESTRIAN_CLASS and tid not in self._seen_track_ids[lane]:
                            self._seen_track_ids[lane].add(tid)
                            self._cumulative_counts[lane][canonical] += 1

                    structured_detections.append(
                        {
                            "vehicle_type": canonical,
                            "confidence": conf_val,
                            "x1": x1,
                            "y1": y1,
                            "x2": x2,
                            "y2": y2,
                            "track_id": int(track_id) if track_id is not None else None,
                        }
                    )

                    if canonical == PEDESTRIAN_CLASS:
                        pedestrians_in_frame += 1
                    else:
                        counts_in_frame[canonical] += 1
                        if canonical in EMERGENCY_CLASSES:
                            emergency_present = True

        self._in_frame_counts[lane] = counts_in_frame
        self._pedestrian_counts[lane] = pedestrians_in_frame
        self._in_frame_track_ids[lane] = active_track_ids
        self._last_detections[lane] = structured_detections

        return counts_in_frame, emergency_present, annotated_frame
