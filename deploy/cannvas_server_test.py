"""Tests for deploy/cannvas-server. Run with: python3 -m unittest deploy/cannvas_server_test.py"""

from __future__ import annotations

from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib.machinery import SourceFileLoader
from importlib.util import module_from_spec, spec_from_loader
import json
import os
from pathlib import Path
import socket
import tempfile
import threading
import time
import unittest
from urllib.error import HTTPError

HERE = Path(__file__).resolve().parent


def load_server(temp: Path):
    os.environ["CANNVAS_WEB_ROOT"] = str(temp / "release" / "www")
    os.environ["CANNVAS_HEARTBEAT_PATH"] = str(temp / "heartbeat")
    os.environ["CANNVAS_HOME_ASSISTANT_CONFIG"] = str(temp / "home-assistant.json")
    os.environ["CANNVAS_UNIFI_CONFIG"] = str(temp / "unifi.json")
    os.environ["CANNVAS_INVENTORY_CONFIG"] = str(temp / "inventory.json")
    loader = SourceFileLoader("cannvas_server", str(HERE / "cannvas-server"))
    module = module_from_spec(spec_from_loader("cannvas_server", loader))
    loader.exec_module(module)
    return module


def start(server: ThreadingHTTPServer) -> ThreadingHTTPServer:
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


class FakeUpstream(BaseHTTPRequestHandler):
    """Plays Home Assistant or Bruce. Records every request it sees."""

    requests: list[tuple[str, str | None]] = []
    redirect_to = ""

    def do_GET(self) -> None:
        FakeUpstream.requests.append((self.path, self.headers.get("Authorization")))
        if self.path == "/api/states":
            body = json.dumps([
                {"entity_id": "sensor.solis_load_power", "state": "2.5", "last_updated": "2026-09-25T01:00:00+00:00"},
                {"entity_id": "sensor.solis_grid_power", "state": "1.0", "last_updated": "2026-09-25T01:00:00+00:00"},
                {"entity_id": "sensor.solis_inverter_status", "state": "Normal", "last_updated": "2026-09-25T01:00:00+00:00"},
                {"entity_id": "light.kitchen", "state": "on"},
            ]).encode()
            self.reply(200, body, "application/json")
        elif self.path.startswith("/api/history/"):
            self.reply(200, b"[]", "application/json")
        elif self.path == "/redirect":
            self.send_response(302)
            self.send_header("Location", FakeUpstream.redirect_to)
            self.send_header("Content-Length", "0")
            self.end_headers()
        elif self.path == "/range.mp4":
            self.send_response(416)
            self.send_header("Content-Range", "bytes */1234")
            self.send_header("Content-Length", "0")
            self.end_headers()
        else:
            self.reply(200, b"video-bytes", "video/mp4")

    def reply(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args: object) -> None:
        pass


class CannvasServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.temp_dir = tempfile.TemporaryDirectory()
        temp = Path(cls.temp_dir.name)
        www = temp / "release" / "www"
        (www / "assets").mkdir(parents=True)
        (www / "empty").mkdir()
        (www / "index.html").write_text("<h1>Cannvas</h1>")
        (www / "assets" / "app-abc123.js").write_text("console.log(1)")
        # Deployment files sit next to www/ and must never be served.
        (temp / "release" / "cannvas-server").write_text("secret")
        cls.temp = temp
        cls.module = load_server(temp)
        cls.module.CannvasHandler.log_message = lambda *args: None
        cls.server = start(cls.module.CannvasServer(("127.0.0.1", 0), cls.module.CannvasHandler))
        cls.port = cls.server.server_address[1]
        cls.upstream = start(ThreadingHTTPServer(("127.0.0.1", 0), FakeUpstream))
        cls.upstream_url = f"http://127.0.0.1:{cls.upstream.server_address[1]}"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.upstream.shutdown()
        cls.temp_dir.cleanup()

    def setUp(self) -> None:
        FakeUpstream.requests = []
        self.module._VIDEO_DOWN_UNTIL = 0.0
        self.module.VIDEO_URL = self.upstream_url
        config = self.temp / "home-assistant.json"
        if config.exists():
            config.unlink()

    def request(self, method: str, path: str, body: bytes | None = None, headers: dict[str, str] | None = None):
        connection = HTTPConnection("127.0.0.1", self.port, timeout=10)
        all_headers = {"Host": f"127.0.0.1:{self.port}", **(headers or {})}
        connection.request(method, path, body=body, headers=all_headers)
        response = connection.getresponse()
        data = response.read()
        connection.close()
        return response, data

    def test_serves_index_with_revalidation(self) -> None:
        response, body = self.request("GET", "/")
        self.assertEqual(response.status, 200)
        self.assertIn(b"Cannvas", body)
        self.assertEqual(response.getheader("Cache-Control"), "no-cache")

    def test_hashed_assets_are_immutable(self) -> None:
        response, _ = self.request("GET", "/assets/app-abc123.js?v=1")
        self.assertEqual(response.status, 200)
        self.assertEqual(response.getheader("Cache-Control"), "public, max-age=31536000, immutable")

    def test_does_not_serve_files_outside_www(self) -> None:
        for path in ("/cannvas-server", "/../cannvas-server", "/%2e%2e/cannvas-server"):
            response, body = self.request("GET", path)
            self.assertEqual(response.status, 404, path)
            self.assertNotIn(b"secret", body)

    def test_directory_listings_are_disabled(self) -> None:
        for path in ("/assets/", "/empty/"):
            response, _ = self.request("GET", path)
            self.assertEqual(response.status, 404, path)

    def test_rejects_foreign_host(self) -> None:
        response, _ = self.request("GET", "/api/solar", headers={"Host": f"evil.example:{self.port}"})
        self.assertEqual(response.status, 403)

    def test_allows_localhost_name(self) -> None:
        response, _ = self.request("GET", "/", headers={"Host": f"localhost:{self.port}"})
        self.assertEqual(response.status, 200)

    def test_rejects_foreign_origin(self) -> None:
        response, _ = self.request(
            "POST", "/api/heartbeat", b"{}",
            {"Content-Type": "application/json", "Origin": "http://evil.example"},
        )
        self.assertEqual(response.status, 403)

    def test_post_requires_json(self) -> None:
        response, _ = self.request("POST", "/api/system/poweroff", b'{"confirm":"poweroff"}', {"Content-Type": "text/plain"})
        self.assertEqual(response.status, 415)

    def test_routes_ignore_query_strings(self) -> None:
        response, body = self.request("GET", "/api/solar?fresh=1")
        self.assertEqual(response.status, 200)
        self.assertEqual(json.loads(body), {"configured": False})

    def test_unknown_api_is_json_404(self) -> None:
        response, _ = self.request("GET", "/api/nope")
        self.assertEqual(response.status, 404)

    def test_heartbeat_records_boot_clock(self) -> None:
        response, _ = self.request(
            "POST", "/api/heartbeat", b"{}",
            {"Content-Type": "application/json", "Origin": f"http://127.0.0.1:{self.port}"},
        )
        self.assertEqual(response.status, 204)
        self.assertTrue(float((self.temp / "heartbeat").read_text()) > 0)
        response, _ = self.request("GET", "/api/heartbeat")
        self.assertEqual(response.status, 204)

    def test_concurrent_heartbeats_all_succeed(self) -> None:
        statuses: list[int] = []

        def ping() -> None:
            response, _ = self.request("GET", "/api/heartbeat")
            statuses.append(response.status)

        threads = [threading.Thread(target=ping) for _ in range(20)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(statuses, [204] * 20)

    def test_health_does_not_need_home_assistant(self) -> None:
        response, body = self.request("GET", "/api/health")
        self.assertEqual(response.status, 200)
        self.assertEqual(json.loads(body), {"ok": True})

    def test_solar_uses_one_states_request(self) -> None:
        (self.temp / "home-assistant.json").write_text(json.dumps({"url": self.upstream_url, "token": "t" * 40}))
        self.module._SOLAR_CACHE.update(key=None)
        response, body = self.request("GET", "/api/solar")
        self.assertEqual(response.status, 200)
        value = json.loads(body)
        self.assertEqual(value["now"]["solarKw"], 2.5)
        self.assertEqual(value["now"]["gridKw"], -1.0)
        self.assertEqual(value["status"], "Normal")
        state_requests = [path for path, _ in FakeUpstream.requests if path.startswith("/api/states")]
        self.assertEqual(state_requests, ["/api/states"])

    def test_home_assistant_redirects_are_not_followed(self) -> None:
        FakeUpstream.redirect_to = f"{self.upstream_url}/stolen"
        config = {"url": self.upstream_url, "token": "secret-token"}
        with self.assertRaises(HTTPError) as caught:
            self.module.home_assistant_request(config, "/redirect")
        self.assertEqual(caught.exception.code, 302)
        self.assertNotIn("/stolen", [path for path, _ in FakeUpstream.requests])

    def test_video_proxy_streams(self) -> None:
        response, body = self.request("GET", "/videos/clip.mp4")
        self.assertEqual(response.status, 200)
        self.assertEqual(body, b"video-bytes")

    def test_video_416_keeps_content_range(self) -> None:
        response, _ = self.request("GET", "/videos/range.mp4", headers={"Range": "bytes=5000-"})
        self.assertEqual(response.status, 416)
        self.assertEqual(response.getheader("Content-Range"), "bytes */1234")

    def test_video_circuit_breaker(self) -> None:
        # Take a free loopback port and close it, so connecting is refused at once.
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            closed_port = probe.getsockname()[1]
        self.module.VIDEO_URL = f"http://127.0.0.1:{closed_port}"
        response, _ = self.request("GET", "/videos/a.mp4")
        self.assertEqual(response.status, 502)
        started = time.monotonic()
        response, _ = self.request("GET", "/videos/b.mp4")
        self.assertEqual(response.status, 503)
        self.assertTrue(int(response.getheader("Retry-After")) > 0)
        self.assertLess(time.monotonic() - started, 1)


if __name__ == "__main__":
    unittest.main()
