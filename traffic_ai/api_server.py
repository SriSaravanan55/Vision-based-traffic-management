"""Long-running HTTP API Server for the AI-Based Smart Traffic Management System.

Runs persistently on localhost:8000 (configurable via PYTHON_API_HOST / PYTHON_API_PORT)
and maintains single in-memory engine state across HTTP requests from Express.

Usage:
    python3 -m traffic_ai.api_server
"""

import json
import logging
import os
import signal
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, Optional
from urllib.parse import parse_qs, urlparse

from .config import DB_PATH
from .engine_service import TrafficEngineService, ValidationError

logging.basicConfig(
    level=os.getenv("PYTHON_LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("traffic_ai.api_server")


class TrafficThreadingHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(self, server_address: tuple[str, int], handler_cls: type[BaseHTTPRequestHandler], service: TrafficEngineService) -> None:
        self.service = service
        super().__init__(server_address, handler_cls)


class TrafficRequestHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, format: str, *args: Any) -> None:
        logger.info("%s - %s", self.address_string(), format % args)

    def _send_json(self, status_code: int, payload: Dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self, required: bool = False) -> Dict[str, Any]:
        raw_len = self.headers.get("Content-Length")
        if not raw_len:
            if required:
                raise ValidationError("Request body is required and must be valid JSON.", code="EMPTY_BODY")
            return {}
        try:
            length = int(raw_len)
        except ValueError as exc:
            raise ValidationError("Invalid Content-Length header.", code="INVALID_HEADER") from exc

        if length <= 0:
            return {}
        if length > 2 * 1024 * 1024:
            raise ValidationError("Request payload exceeds 2 MB limit.", code="PAYLOAD_TOO_LARGE")

        raw_bytes = self.rfile.read(length)
        try:
            parsed = json.loads(raw_bytes.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValidationError(f"Malformed JSON payload: {exc}", code="INVALID_JSON") from exc

        if not isinstance(parsed, dict):
            raise ValidationError("JSON request body must be an object.", code="INVALID_JSON")
        return parsed

    @property
    def service(self) -> TrafficEngineService:
        return self.server.service  # type: ignore[attr-defined]

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)

        try:
            if path == "/health":
                health = self.service.get_health()
                status_code = 200 if health.get("ok") else 503
                self._send_json(status_code, health)
                return

            if path == "/api/config":
                self._send_json(200, {"ok": True, "data": self.service.get_config()})
                return

            if path == "/api/traffic/status":
                self._send_json(200, {"ok": True, "data": self.service.get_status()})
                return

            if path == "/api/sqlite/summary":
                self._send_json(200, {"ok": True, "data": self.service.get_sqlite_summary()})
                return

            if path == "/api/traffic/history":
                limit_str = (qs.get("limit") or ["25"])[0]
                try:
                    limit_val = int(limit_str)
                except ValueError as exc:
                    raise ValidationError(
                        f"Query parameter 'limit' must be an integer (received {limit_str!r}).",
                        code="INVALID_LIMIT",
                    ) from exc
                session_scope = (qs.get("session_id") or ["ACTIVE"])[0]
                junction_filter = (qs.get("junction_id") or [None])[0]
                history = self.service.get_history(
                    limit=limit_val,
                    session_id=session_scope,
                    junction_id=junction_filter,
                )
                self._send_json(200, {"ok": True, "data": history})
                return

            self._send_json(404, {"ok": False, "code": "NOT_FOUND", "error": f"Unknown endpoint: {path}"})
        except ValidationError as exc:
            logger.warning("GET %s validation error [%s]: %s", path, exc.code, exc.message)
            self._send_json(
                400,
                {"ok": False, "code": exc.code, "error": exc.message, "details": exc.details},
            )
        except Exception as exc:
            logger.exception("Unhandled error in GET %s: %s", path, exc)
            self._send_json(
                500,
                {"ok": False, "code": "INTERNAL_ERROR", "error": f"Python engine error: {exc}"},
            )

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        try:
            if path == "/api/pipeline/execute-cycle":
                body = self._read_json_body(required=True)
                result = self.service.execute_cycle(body)
                self._send_json(200, {"ok": True, "result": result})
                return

            if path == "/api/pipeline/run-demo-batch":
                body = self._read_json_body(required=False)
                out = self.service.run_demo_batch(body)
                self._send_json(200, out)
                return

            if path == "/api/pipeline/reset":
                body = self._read_json_body(required=False)
                out = self.service.reset_session(body)
                self._send_json(200, {"ok": True, **out})
                return

            self._send_json(404, {"ok": False, "code": "NOT_FOUND", "error": f"Unknown endpoint: {path}"})
        except ValidationError as exc:
            logger.warning("POST %s validation error [%s]: %s", path, exc.code, exc.message)
            self._send_json(
                400,
                {"ok": False, "code": exc.code, "error": exc.message, "details": exc.details},
            )
        except Exception as exc:
            logger.exception("Unhandled error in POST %s: %s", path, exc)
            self._send_json(
                500,
                {"ok": False, "code": "INTERNAL_ERROR", "error": f"Python engine error: {exc}"},
            )


def run_server(
    host: Optional[str] = None,
    port: Optional[int] = None,
    db_path: Optional[str] = None,
) -> None:
    bind_host = host or os.getenv("PYTHON_API_HOST", "127.0.0.1")
    bind_port = int(port or os.getenv("PYTHON_API_PORT", "8000"))
    resolved_db = db_path or os.getenv("TRAFFIC_DB_PATH", DB_PATH)

    service = TrafficEngineService(db_path=resolved_db)
    server = TrafficThreadingHTTPServer((bind_host, bind_port), TrafficRequestHandler, service)

    shutdown_requested = False

    def handle_signal(signum: int, _frame: Any) -> None:
        nonlocal shutdown_requested
        if shutdown_requested:
            return
        shutdown_requested = True
        logger.info("Received signal %s; shutting down Python Traffic AI service...", signum)
        server.shutdown()

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    logger.info("Persistent Python Traffic AI Service listening on http://%s:%d", bind_host, bind_port)
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        try:
            server.server_close()
        except Exception:
            pass
        service.shutdown()
        logger.info("Python Traffic AI Service stopped cleanly.")


if __name__ == "__main__":
    run_server()
