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
from typing import Any
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


def fake_states() -> list[dict]:
    states = [
        {"entity_id": "sensor.solis_load_power", "state": "2.5", "last_updated": "2026-09-25T01:00:00+00:00"},
        {"entity_id": "sensor.solis_grid_power", "state": "1.0", "last_updated": "2026-09-25T01:00:00+00:00"},
        {"entity_id": "sensor.solis_inverter_status", "state": "Normal", "last_updated": "2026-09-25T01:00:00+00:00"},
        {"entity_id": "sensor.power_production_now", "state": "3450", "attributes": {"unit_of_measurement": "W"}, "last_updated": "2026-09-25T02:00:00+00:00"},
        {"entity_id": "sensor.energy_production_today", "state": "15.889", "attributes": {"unit_of_measurement": "kWh"}},
        {"entity_id": "sensor.energy_production_tomorrow", "state": "8856", "attributes": {"unit_of_measurement": "Wh"}},
        {"entity_id": "sensor.power_highest_peak_time_today", "state": "2026-09-25T04:00:00+00:00"},
        {"entity_id": "light.kitchen", "state": "on"},
        {"entity_id": "valve.retic_back_grass_right", "state": "closed"},
        {"entity_id": "valve.retic_back_grass_left", "state": "closed"},
        {"entity_id": "valve.retic_back_flower_beds", "state": "unavailable"},
        {"entity_id": "valve.retic_front_garden_beds", "state": "closed"},
        {"entity_id": "valve.retic_front_grass", "state": "open"},
        {"entity_id": "script.retic_run_zone", "state": "on"},
        {"entity_id": "input_datetime.retic_run_ends", "state": "2026-09-29 15:30:00", "attributes": {"timestamp": 1790667000.0}},
        {"entity_id": "binary_sensor.retic_rain_sensor", "state": "off"},
        {"entity_id": "binary_sensor.retic_battery_voltage", "state": "off"},
        {"entity_id": "sensor.retic_battery_voltage", "state": "8.6"},
        {"entity_id": "binary_sensor.retic_power_supply", "state": "off"},
        {"entity_id": "sensor.retic_dial_position", "state": "Run"},
        {"entity_id": "sensor.retic_time_remaining", "state": "14"},
        {"entity_id": "input_boolean.retic_enabled", "state": "on"},
        {"entity_id": "script.retic_run_schedule", "state": "off"},
        {"entity_id": "input_text.retic_last_result", "state": "Skipped Tue 29 Sep, 6:00 AM: 4.1 mm of rain in the last 24 hours"},
        {"entity_id": "sensor.retic_rain_last_24h", "state": "0.2"},
        {"entity_id": "sensor.retic_rain_next_12h", "state": "1.5"},
        {"entity_id": "sensor.retic_next_run", "state": "2026-10-01T22:00:00+00:00", "attributes": {
            "days": [2, 5], "start": "06:00", "skip_past_mm": 3, "skip_forecast_mm": 5, "zones": [],
        }},
    ]
    return [FakeUpstream.state_overrides.get(str(state["entity_id"]), state) for state in states]


class FakeUpstream(BaseHTTPRequestHandler):
    """Plays Home Assistant or Bruce. Records every request it sees."""

    requests: list[tuple[str, str | None]] = []
    posts: list[tuple[str, Any]] = []
    # Replace entries in the /api/states snapshot, keyed by entity id.
    state_overrides: dict[str, dict[str, object]] = {}
    redirect_to = ""
    # Home Assistant's clock, sent in the Date header. None sends the real time.
    date: str | None = None
    ding = "unknown"
    map_type = "image/png"
    camera_works = False
    vacuum_has_rooms = False

    def date_time_string(self, timestamp: float | None = None) -> str:
        return FakeUpstream.date or super().date_time_string(timestamp)

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length") or 0)
        FakeUpstream.posts.append((self.path, json.loads(self.rfile.read(length))))
        if self.path == "/api/services/vacuum/clean_area" and not FakeUpstream.vacuum_has_rooms:
            # What Home Assistant answers before the vacuum's rooms are matched to areas.
            message = {"message": "Area mapping is not configured for `vacuum.roborock_q7_max`. Configure the segment-to-area mapping before using this action."}
            self.reply(400, json.dumps(message).encode(), "application/json")
        else:
            self.reply(200, b"[]", "application/json")

    def do_GET(self) -> None:
        FakeUpstream.requests.append((self.path, self.headers.get("Authorization")))
        if self.path == "/api/states":
            body = json.dumps(fake_states()).encode()
            self.reply(200, body, "application/json")
        elif self.path == "/api/states/sun.sun":
            body = json.dumps({
                "entity_id": "sun.sun",
                "state": "above_horizon",
                "attributes": {
                    "next_rising": "2026-09-25T22:00:00+00:00",
                    "next_setting": "2026-09-25T10:18:00+00:00",
                    "elevation": 41.2,
                    "rising": False,
                },
            }).encode()
            self.reply(200, body, "application/json")
        elif self.path == "/api/states/light.living_room_lights":
            body = json.dumps({
                "entity_id": "light.living_room_lights",
                "state": "on",
                "last_changed": "2026-10-14T09:30:00+00:00",
                "attributes": {"friendly_name": "Living room lights", "brightness": 255, "entity_id": ["light.tv_lamp"]},
            }).encode()
            self.reply(200, body, "application/json")
        elif self.path == "/api/states/event.front_door_ding":
            body = json.dumps({"entity_id": "event.front_door_ding", "state": FakeUpstream.ding}).encode()
            self.reply(200, body, "application/json")
        elif self.path == "/api/image_proxy/image.roborock_q7_max_map_0":
            self.reply(200, b"map-bytes", FakeUpstream.map_type)
        elif self.path == "/api/camera_proxy/camera.front_door_live_view":
            if FakeUpstream.camera_works:
                self.reply(200, b"jpeg-bytes", "image/jpeg")
            else:
                # What Home Assistant says when Ring has no picture to give.
                self.reply(500, b"500: Internal Server Error", "text/plain; charset=utf-8")
        elif self.path.startswith("/api/states/"):
            entity_id = self.path.removeprefix("/api/states/")
            state = next((state for state in fake_states() if state["entity_id"] == entity_id), None)
            if state is None:
                self.reply(404, b'{"message": "Entity not found."}', "application/json")
            else:
                self.reply(200, json.dumps(state).encode(), "application/json")
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


class FakeVoice(BaseHTTPRequestHandler):
    """Plays cannvas-voice: a short event stream, the listen button and training."""

    posts: list[tuple[str, str | None, bytes]] = []

    def do_GET(self) -> None:
        if self.path == "/training":
            self.reply(200, b'{"samples": [{"id": "20261012-070000-josh-ab12"}]}')
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        self.wfile.write(b'retry: 3000\n\ndata: {"type": "state", "phase": "idle"}\n\n')

    def do_POST(self) -> None:
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        FakeVoice.posts.append((self.path, self.headers.get("Origin"), body))
        if self.path == "/training/start" and b"nobody" in body:
            self.reply(400, b'{"error": "Choose a speaker"}')
        else:
            self.reply(202, b'{"ok": true}')

    def reply(self, status: int, body: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args: object) -> None:
        pass


def closed_port() -> int:
    # Take a free loopback port and close it, so connecting is refused at once.
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


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
        cls.voice = start(ThreadingHTTPServer(("127.0.0.1", 0), FakeVoice))
        cls.voice_url = f"http://127.0.0.1:{cls.voice.server_address[1]}"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.upstream.shutdown()
        cls.voice.shutdown()
        cls.temp_dir.cleanup()

    def setUp(self) -> None:
        FakeUpstream.requests = []
        FakeUpstream.posts = []
        FakeUpstream.state_overrides = {}
        FakeUpstream.date = None
        FakeUpstream.ding = "unknown"
        FakeUpstream.map_type = "image/png"
        FakeUpstream.camera_works = False
        FakeUpstream.vacuum_has_rooms = False
        self.module._VIDEO_DOWN_UNTIL = 0.0
        self.module.VIDEO_URL = self.upstream_url
        self.module.VOICE_URL = self.voice_url
        FakeVoice.posts = []
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

    def test_solar_includes_forecast_in_kilowatts(self) -> None:
        (self.temp / "home-assistant.json").write_text(json.dumps({"url": self.upstream_url, "token": "t" * 40}))
        self.module._SOLAR_CACHE.update(key=None)
        response, body = self.request("GET", "/api/solar")
        self.assertEqual(response.status, 200)
        value = json.loads(body)
        self.assertEqual(value["forecast"], {
            "potentialKw": 3.45,
            "todayKwh": 15.889,
            # Not reported by the fake Home Assistant.
            "remainingKwh": None,
            "tomorrowKwh": 8.856,
            "peakAt": "2026-09-25T04:00:00+00:00",
        })
        # The forecast's newer timestamp must not make stale inverter data look live.
        self.assertEqual(value["updatedAt"], "2026-09-25T01:00:00+00:00")
        self.assertIn("possible", value["series"])

    def test_grid_energy_splits_import_and_export(self) -> None:
        # Positive grid power is export. 1 h exporting 2 kW, then 30 min importing 1 kW.
        points = [(0.0, 2.0), (3600.0, -1.0)]
        imported, exported = self.module.grid_energy_kwh(points, 0.0, 5400.0)
        self.assertAlmostEqual(exported, 2.0)
        self.assertAlmostEqual(imported, 0.5)

    def test_grid_energy_skips_gaps_and_clips_to_the_day(self) -> None:
        # Starts before midnight (0), goes unavailable for an hour, then imports.
        points = [(-1800.0, -2.0), (1800.0, None), (5400.0, -1.0)]
        imported, exported = self.module.grid_energy_kwh(points, 0.0, 9000.0)
        # 0.5 h at 2 kW, the gap counts for nothing, then 1 h at 1 kW.
        self.assertAlmostEqual(imported, 2.0)
        self.assertAlmostEqual(exported, 0.0)

    def test_kilo_divisor_follows_the_unit(self) -> None:
        divisor = self.module.kilo_divisor
        self.assertEqual(divisor({"attributes": {"unit_of_measurement": "W"}}), 1000)
        self.assertEqual(divisor({"attributes": {"unit_of_measurement": "kWh"}}, default=1000), 1)
        # A missing sensor keeps the unit its history is known to use.
        self.assertEqual(divisor({}, default=1000), 1000)
        self.assertEqual(divisor({}), 1)

    def test_sun_without_home_assistant(self) -> None:
        response, body = self.request("GET", "/api/sun")
        self.assertEqual(response.status, 200)
        self.assertEqual(json.loads(body), {"configured": False})

    def test_sun_reports_next_rising_and_setting(self) -> None:
        (self.temp / "home-assistant.json").write_text(json.dumps({"url": self.upstream_url, "token": "t" * 40}))
        response, body = self.request("GET", "/api/sun")
        self.assertEqual(response.status, 200)
        self.assertEqual(json.loads(body), {
            "configured": True,
            "state": "above_horizon",
            "elevation": 41.2,
            "rising": False,
            "nextRising": "2026-09-25T22:00:00+00:00",
            "nextSetting": "2026-09-25T10:18:00+00:00",
        })
        self.assertEqual(FakeUpstream.requests, [("/api/states/sun.sun", "Bearer " + "t" * 40)])

    def test_sun_hides_home_assistant_failures(self) -> None:
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            closed_port = probe.getsockname()[1]
        (self.temp / "home-assistant.json").write_text(json.dumps({"url": f"http://127.0.0.1:{closed_port}", "token": "t" * 40}))
        response, body = self.request("GET", "/api/sun")
        self.assertEqual(response.status, 502)
        self.assertEqual(json.loads(body), {"error": "Home Assistant is unavailable"})

    def test_entity_without_home_assistant(self) -> None:
        response, body = self.request("GET", "/api/home-assistant/entity?id=light.living_room_lights")
        self.assertEqual(response.status, 200)
        self.assertEqual(json.loads(body), {"configured": False})

    def test_entity_reports_one_light(self) -> None:
        (self.temp / "home-assistant.json").write_text(json.dumps({"url": self.upstream_url, "token": "t" * 40}))
        response, body = self.request("GET", "/api/home-assistant/entity?id=light.living_room_lights")
        self.assertEqual(response.status, 200)
        self.assertEqual(json.loads(body), {
            "configured": True,
            "entity": {
                "entityId": "light.living_room_lights",
                "domain": "light",
                "name": "Living room lights",
                "state": "on",
                "lastChanged": "2026-10-14T09:30:00+00:00",
                "attributes": {"brightness": 255},
            },
        })
        self.assertEqual(FakeUpstream.requests, [("/api/states/light.living_room_lights", "Bearer " + "t" * 40)])

    def test_entity_that_does_not_exist_is_null(self) -> None:
        (self.temp / "home-assistant.json").write_text(json.dumps({"url": self.upstream_url, "token": "t" * 40}))
        response, body = self.request("GET", "/api/home-assistant/entity?id=light.missing")
        self.assertEqual(response.status, 200)
        self.assertEqual(json.loads(body), {"configured": True, "entity": None})

    def test_entity_only_reads_switchable_domains(self) -> None:
        (self.temp / "home-assistant.json").write_text(json.dumps({"url": self.upstream_url, "token": "t" * 40}))
        for entity_id in ("sensor.solis_load_power", "person.mike", "light.../../config", ""):
            response, body = self.request("GET", f"/api/home-assistant/entity?id={entity_id}")
            self.assertEqual(response.status, 400, entity_id)
            self.assertEqual(json.loads(body), {"error": "That Home Assistant entity is not allowed"})
        self.assertEqual(FakeUpstream.requests, [])

    def connect_home_assistant(self) -> None:
        (self.temp / "home-assistant.json").write_text(json.dumps({"url": self.upstream_url, "token": "t" * 40}))

    def action(self, entity_id: str, action: str, **extra: str):
        body = json.dumps({"entityId": entity_id, "action": action, **extra}).encode()
        return self.request("POST", "/api/home-assistant/action", body, {"Content-Type": "application/json"})

    def test_vacuum_can_start_pause_and_go_home(self) -> None:
        self.connect_home_assistant()
        for action in ("start", "pause", "return_to_base"):
            response, _ = self.action("vacuum.roborock_q7_max", action)
            self.assertEqual(response.status, 200, action)
        self.assertEqual(FakeUpstream.posts, [
            ("/api/services/vacuum/start", {"entity_id": "vacuum.roborock_q7_max"}),
            ("/api/services/vacuum/pause", {"entity_id": "vacuum.roborock_q7_max"}),
            ("/api/services/vacuum/return_to_base", {"entity_id": "vacuum.roborock_q7_max"}),
        ])

    def test_vacuum_cleans_a_named_set_of_rooms(self) -> None:
        self.connect_home_assistant()
        FakeUpstream.vacuum_has_rooms = True
        response, _ = self.action("vacuum.roborock_q7_max", "clean_area", preset="living_room_kitchen")
        self.assertEqual(response.status, 200)
        self.assertEqual(FakeUpstream.posts, [
            ("/api/services/vacuum/clean_area", {"entity_id": "vacuum.roborock_q7_max", "cleaning_area_id": ["living_room", "kitchen"]}),
        ])

    def test_room_cleans_only_use_the_presets(self) -> None:
        self.connect_home_assistant()
        FakeUpstream.vacuum_has_rooms = True
        for extra in ({}, {"preset": "bedroom"}, {"preset": ""}, {"cleaning_area_id": "bedroom"}):
            response, body = self.action("vacuum.roborock_q7_max", "clean_area", **extra)
            self.assertEqual(response.status, 400, extra)
            self.assertEqual(json.loads(body), {"error": "That Home Assistant action is not allowed"})
        response, _ = self.action("vacuum.another_vacuum", "clean_area", preset="living_room_kitchen")
        self.assertEqual(response.status, 400)
        self.assertEqual(FakeUpstream.posts, [])

    def test_room_clean_before_the_vacuum_knows_its_rooms(self) -> None:
        self.connect_home_assistant()
        response, body = self.action("vacuum.roborock_q7_max", "clean_area", preset="living_room_kitchen")
        self.assertEqual(response.status, 409)
        self.assertEqual(json.loads(body), {"error": "The vacuum doesn't know its rooms yet"})

    def test_only_those_vacuum_actions_are_allowed(self) -> None:
        self.connect_home_assistant()
        refused = [
            ("vacuum.roborock_q7_max", "stop"),
            ("vacuum.roborock_q7_max", "locate"),
            ("vacuum.roborock_q7_max", "clean_spot"),
            ("vacuum.roborock_q7_max", "send_command"),
            ("vacuum.roborock_q7_max", "turn_on"),
            ("vacuum.another_vacuum", "start"),
            ("light.kitchen", "start"),
            ("script.anything", "return_to_base"),
        ]
        for entity_id, action in refused:
            response, body = self.action(entity_id, action)
            self.assertEqual(response.status, 400, (entity_id, action))
            self.assertEqual(json.loads(body), {"error": "That Home Assistant action is not allowed"})
        self.assertEqual(FakeUpstream.posts, [])

    def test_key_lights_switch_like_any_light(self) -> None:
        self.connect_home_assistant()
        response, _ = self.action("light.elgato_key_light_mk_2_e1a2", "turn_on")
        self.assertEqual(response.status, 200)
        self.assertEqual(FakeUpstream.posts, [("/api/services/light/turn_on", {"entity_id": "light.elgato_key_light_mk_2_e1a2"})])

    def test_vacuum_map_is_proxied_with_the_token(self) -> None:
        self.connect_home_assistant()
        response, body = self.request("GET", "/api/vacuum/map?v=2026-10-21T00:55:12Z")
        self.assertEqual(response.status, 200)
        self.assertEqual(body, b"map-bytes")
        self.assertEqual(response.getheader("Content-Type"), "image/png")
        self.assertEqual(response.getheader("Cache-Control"), "no-store")
        self.assertEqual(FakeUpstream.requests, [("/api/image_proxy/image.roborock_q7_max_map_0", "Bearer " + "t" * 40)])

    def test_only_pictures_are_proxied(self) -> None:
        self.connect_home_assistant()
        FakeUpstream.map_type = "text/html"
        response, body = self.request("GET", "/api/vacuum/map")
        self.assertEqual(response.status, 502)
        self.assertNotIn(b"map-bytes", body)

    def test_doorbell_snapshot(self) -> None:
        self.connect_home_assistant()
        FakeUpstream.camera_works = True
        response, body = self.request("GET", "/api/doorbell/snapshot?t=1")
        self.assertEqual(response.status, 200)
        self.assertEqual(body, b"jpeg-bytes")
        self.assertEqual(FakeUpstream.requests, [("/api/camera_proxy/camera.front_door_live_view", "Bearer " + "t" * 40)])

    def test_doorbell_without_a_picture(self) -> None:
        self.connect_home_assistant()
        response, body = self.request("GET", "/api/doorbell/snapshot")
        self.assertEqual(response.status, 502)
        self.assertEqual(json.loads(body), {"error": "The doorbell has no picture right now"})

    def test_pictures_need_home_assistant(self) -> None:
        for path in ("/api/vacuum/map", "/api/doorbell/snapshot"):
            response, _ = self.request("GET", path)
            self.assertEqual(response.status, 409, path)

    def test_doorbell_ding_age_uses_home_assistants_clock(self) -> None:
        self.connect_home_assistant()
        FakeUpstream.ding = "2026-10-21T01:00:00.123456+00:00"
        FakeUpstream.date = "Wed, 21 Oct 2026 01:00:12 GMT"
        response, body = self.request("GET", "/api/doorbell/ding")
        self.assertEqual(response.status, 200)
        self.assertEqual(json.loads(body), {"configured": True, "ding": "2026-10-21T01:00:00.123456+00:00", "ageSeconds": 11.9})
        self.assertEqual(FakeUpstream.requests, [("/api/states/event.front_door_ding", "Bearer " + "t" * 40)])

    def test_doorbell_that_never_rang(self) -> None:
        self.connect_home_assistant()
        response, body = self.request("GET", "/api/doorbell/ding")
        self.assertEqual(json.loads(body), {"configured": True, "ding": None, "ageSeconds": None})

    def test_doorbell_without_home_assistant(self) -> None:
        response, body = self.request("GET", "/api/doorbell/ding")
        self.assertEqual(response.status, 200)
        self.assertEqual(json.loads(body), {"configured": False})

    def post_json(self, path: str, value: object):
        return self.request("POST", path, json.dumps(value).encode(), {"Content-Type": "application/json"})

    def test_retic_without_home_assistant(self) -> None:
        response, body = self.request("GET", "/api/retic")
        self.assertEqual(response.status, 200)
        self.assertEqual(json.loads(body), {"configured": False})
        response, _ = self.post_json("/api/retic/run", {"entityId": "valve.retic_front_grass", "minutes": 5})
        self.assertEqual(response.status, 409)

    def test_retic_reports_zones_run_and_sensors(self) -> None:
        self.connect_home_assistant()
        response, body = self.request("GET", "/api/retic")
        self.assertEqual(response.status, 200)
        value = json.loads(body)
        self.assertEqual([zone["zone"] for zone in value["zones"]], [1, 2, 3, 4, 5])
        self.assertEqual(value["zones"][4], {"zone": 5, "entityId": "valve.retic_front_grass", "name": "Front grass", "state": "open", "open": True})
        # An unavailable valve is unknown, not closed.
        self.assertEqual(value["zones"][2]["state"], None)
        self.assertFalse(value["zones"][2]["open"])
        self.assertEqual(value["run"], {"entityId": "valve.retic_front_grass", "endsAt": "2026-09-29T07:30:00+00:00"})
        self.assertEqual(value["runMinutes"], [5, 10, 15])
        self.assertEqual(value["controllerMinutesLeft"], 14)
        self.assertEqual(value["dial"], "Run")
        self.assertIs(value["rainDetected"], False)
        self.assertIs(value["batteryLow"], False)
        self.assertEqual(value["batteryVolts"], 8.6)
        self.assertTrue(value["available"])
        self.assertEqual([path for path, _ in FakeUpstream.requests], ["/api/states"])

    def override_states(self, *states: dict[str, object]) -> None:
        FakeUpstream.state_overrides = {str(state["entity_id"]): state for state in states}

    def retic(self) -> dict:
        response, body = self.request("GET", "/api/retic")
        self.assertEqual(response.status, 200)
        return json.loads(body)

    def test_retic_has_no_countdown_when_the_script_is_not_timing(self) -> None:
        self.connect_home_assistant()
        # Opened on the controller or in Smart Life: the WX8's own timer applies.
        self.override_states({"entity_id": "script.retic_run_zone", "state": "off"})
        value = self.retic()
        self.assertIsNone(value["run"])
        self.assertEqual(value["controllerMinutesLeft"], 14)

    def test_retic_has_no_countdown_without_exactly_one_open_zone(self) -> None:
        self.connect_home_assistant()
        self.override_states({"entity_id": "valve.retic_back_grass_left", "state": "open"})
        self.assertIsNone(self.retic()["run"])
        self.override_states({"entity_id": "valve.retic_front_grass", "state": "closed"})
        value = self.retic()
        self.assertIsNone(value["run"])
        self.assertIsNone(value["controllerMinutesLeft"])

    def test_retic_has_no_countdown_without_an_end_time(self) -> None:
        self.connect_home_assistant()
        self.override_states({"entity_id": "input_datetime.retic_run_ends", "state": "unknown", "attributes": {}})
        self.assertIsNone(self.retic()["run"])

    def test_retic_reports_an_unreachable_controller_as_unknown(self) -> None:
        self.connect_home_assistant()
        self.override_states(
            *({"entity_id": entity, "state": "unavailable"} for _, entity, _ in self.module.RETIC_ZONES),
            *({"entity_id": entity, "state": "unavailable"} for entity in self.module.RETIC_SENSORS.values()),
        )
        value = self.retic()
        self.assertFalse(value["available"])
        self.assertIsNone(value["run"])
        for key in ("dial", "rainDetected", "batteryLow", "batteryVolts", "mainsProblem", "controllerMinutesLeft"):
            self.assertIsNone(value[key], key)

    def test_retic_reports_rain_and_a_low_battery(self) -> None:
        self.connect_home_assistant()
        self.override_states(
            {"entity_id": "binary_sensor.retic_rain_sensor", "state": "on"},
            {"entity_id": "binary_sensor.retic_battery_voltage", "state": "on"},
            {"entity_id": "binary_sensor.retic_power_supply", "state": "on"},
        )
        value = self.retic()
        self.assertIs(value["rainDetected"], True)
        self.assertIs(value["batteryLow"], True)
        self.assertIs(value["mainsProblem"], True)

    def test_retic_run_starts_the_script(self) -> None:
        self.connect_home_assistant()
        response, _ = self.post_json("/api/retic/run", {"entityId": "valve.retic_back_grass_left", "minutes": 10})
        self.assertEqual(response.status, 202)
        self.assertEqual(FakeUpstream.posts, [
            # A run by hand replaces any scheduled watering.
            ("/api/services/script/turn_off", {"entity_id": "script.retic_run_schedule"}),
            ("/api/services/script/turn_on", {"entity_id": "script.retic_run_zone", "variables": {"zone": "valve.retic_back_grass_left", "minutes": 10}}),
        ])

    def test_retic_run_is_refused_while_switched_off(self) -> None:
        self.connect_home_assistant()
        self.override_states({"entity_id": "input_boolean.retic_enabled", "state": "off"})
        response, body = self.post_json("/api/retic/run", {"entityId": "valve.retic_front_grass", "minutes": 5})
        self.assertEqual(response.status, 409)
        self.assertEqual(json.loads(body), {"error": "The retic is switched off"})
        self.override_states({"entity_id": "input_boolean.retic_enabled", "state": "unavailable"})
        response, _ = self.post_json("/api/retic/run", {"entityId": "valve.retic_front_grass", "minutes": 5})
        self.assertEqual(response.status, 409)
        self.assertEqual(FakeUpstream.posts, [])

    def test_retic_master_switch(self) -> None:
        self.connect_home_assistant()
        response, _ = self.post_json("/api/retic/enabled", {"enabled": False})
        self.assertEqual(response.status, 200)
        response, _ = self.post_json("/api/retic/enabled", {"enabled": True})
        self.assertEqual(response.status, 200)
        self.assertEqual(FakeUpstream.posts, [
            ("/api/services/input_boolean/turn_off", {"entity_id": "input_boolean.retic_enabled"}),
            ("/api/services/input_boolean/turn_on", {"entity_id": "input_boolean.retic_enabled"}),
        ])
        for body in ({"enabled": "false"}, {"enabled": 0}, {"enabled": None}, {}):
            response, _ = self.post_json("/api/retic/enabled", body)
            self.assertEqual(response.status, 400, body)
        self.assertEqual(len(FakeUpstream.posts), 2)

    def test_retic_reports_the_schedule(self) -> None:
        self.connect_home_assistant()
        value = self.retic()
        self.assertIs(value["enabled"], True)
        self.assertEqual(value["schedule"], {
            "nextRun": "2026-10-01T22:00:00+00:00",
            "days": [2, 5],
            "start": "06:00",
            "skipPastMm": 3,
            "skipForecastMm": 5,
            "running": False,
            "lastResult": "Skipped Tue 29 Sep, 6:00 AM: 4.1 mm of rain in the last 24 hours",
            "rainLast24h": 0.2,
            "rainNext12h": 1.5,
        })

    def test_retic_reports_a_scheduled_run_in_progress(self) -> None:
        self.connect_home_assistant()
        self.override_states({"entity_id": "script.retic_run_schedule", "state": "on"})
        self.assertIs(self.retic()["schedule"]["running"], True)

    def test_retic_schedule_without_the_package(self) -> None:
        self.connect_home_assistant()
        self.override_states(
            {"entity_id": "sensor.retic_next_run", "state": "unknown"},
            {"entity_id": "input_boolean.retic_enabled", "state": "unavailable"},
        )
        value = self.retic()
        self.assertIsNone(value["enabled"])
        self.assertIsNone(value["schedule"]["nextRun"])
        self.assertEqual(value["schedule"]["days"], [])

    def test_retic_run_rejects_other_entities_and_durations(self) -> None:
        self.connect_home_assistant()
        for body in (
            {"entityId": "valve.main_water", "minutes": 5},
            {"entityId": "valve.retic_zone_6", "minutes": 5},
            {"entityId": "light.kitchen", "minutes": 5},
            {"entityId": ["valve.retic_front_grass"], "minutes": 5},
            {"entityId": "valve.retic_front_grass", "minutes": 7},
            {"entityId": "valve.retic_front_grass", "minutes": 600},
            {"entityId": "valve.retic_front_grass", "minutes": "5"},
            {"entityId": "valve.retic_front_grass", "minutes": 5.0},
            {"entityId": "valve.retic_front_grass", "minutes": True},
            {"entityId": "valve.retic_front_grass"},
        ):
            response, _ = self.post_json("/api/retic/run", body)
            self.assertEqual(response.status, 400, body)
        self.assertEqual(FakeUpstream.posts, [])

    def test_retic_stop_cancels_the_timer_then_closes(self) -> None:
        self.connect_home_assistant()
        response, _ = self.post_json("/api/retic/stop", {"entityId": "valve.retic_front_grass"})
        self.assertEqual(response.status, 200)
        self.assertEqual(FakeUpstream.posts, [
            ("/api/services/script/turn_off", {"entity_id": ["script.retic_run_schedule", "script.retic_run_zone"]}),
            ("/api/services/valve/close_valve", {"entity_id": "valve.retic_front_grass"}),
        ])
        response, _ = self.post_json("/api/retic/stop", {"entityId": "valve.somewhere_else"})
        self.assertEqual(response.status, 400)
        self.assertEqual(len(FakeUpstream.posts), 2)

    def test_generic_actions_cannot_reach_retic(self) -> None:
        self.connect_home_assistant()
        refused = [
            ("script.retic_run_zone", "turn_on"),
            ("switch.retic_program_a", "turn_on"),
            ("input_boolean.retic_enabled", "turn_on"),
            ("input_boolean.retic_enabled", "turn_off"),
            ("light.retic_status", "turn_on"),
            # Valves were never in the generic allowlist, nor the vacuum's actions.
            ("valve.retic_front_grass", "turn_on"),
            ("valve.retic_front_grass", "start"),
        ]
        for entity_id, action in refused:
            response, body = self.action(entity_id, action)
            self.assertEqual(response.status, 400, (entity_id, action))
            self.assertEqual(json.loads(body), {"error": "That Home Assistant action is not allowed"})
        self.assertEqual(FakeUpstream.posts, [])
        response, _ = self.action("light.kitchen", "turn_on")
        self.assertEqual(response.status, 200)
        response, _ = self.action("vacuum.roborock_q7_max", "start")
        self.assertEqual(response.status, 200)

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
        self.module.VIDEO_URL = f"http://127.0.0.1:{closed_port()}"
        response, _ = self.request("GET", "/videos/a.mp4")
        self.assertEqual(response.status, 502)
        started = time.monotonic()
        response, _ = self.request("GET", "/videos/b.mp4")
        self.assertEqual(response.status, 503)
        self.assertTrue(int(response.getheader("Retry-After")) > 0)
        self.assertLess(time.monotonic() - started, 1)

    def test_voice_events_are_relayed(self) -> None:
        response, body = self.request("GET", "/api/voice/events")
        self.assertEqual(response.status, 200)
        self.assertEqual(response.getheader("Content-Type"), "text/event-stream")
        self.assertIn(b'"phase": "idle"', body)

    def test_voice_events_ask_the_page_to_retry_when_voice_is_down(self) -> None:
        # EventSource stops for good on an error status, so this must stay 200.
        self.module.VOICE_URL = f"http://127.0.0.1:{closed_port()}"
        response, body = self.request("GET", "/api/voice/events")
        self.assertEqual(response.status, 200)
        self.assertEqual(body, b"retry: 10000\n\n")

    def test_voice_listen_is_forwarded(self) -> None:
        response, _ = self.request(
            "POST", "/api/voice/listen", b"{}",
            {"Content-Type": "application/json", "Origin": f"http://127.0.0.1:{self.port}"},
        )
        self.assertEqual(response.status, 202)
        # The voice service refuses requests with an Origin, so none is passed on.
        self.assertEqual(FakeVoice.posts, [("/listen", None, b"{}")])

    def test_voice_training_is_relayed_with_its_answers(self) -> None:
        response, body = self.request("GET", "/api/voice/training")
        self.assertEqual((response.status, json.loads(body)["samples"][0]["id"]), (200, "20261012-070000-josh-ab12"))
        choice = json.dumps({"speaker": "josh", "spot": "far", "saying": "wake"}).encode()
        response, _ = self.request("POST", "/api/voice/training/start", choice, {"Content-Type": "application/json"})
        self.assertEqual(response.status, 202)
        self.assertEqual(FakeVoice.posts[-1], ("/training/start", None, choice))
        # The voice service's reason for refusing comes back to the page.
        response, body = self.request("POST", "/api/voice/training/start", b'{"speaker": "nobody"}', {"Content-Type": "application/json"})
        self.assertEqual((response.status, json.loads(body)), (400, {"error": "Choose a speaker"}))

    def test_voice_listen_when_voice_is_down(self) -> None:
        self.module.VOICE_URL = f"http://127.0.0.1:{closed_port()}"
        response, _ = self.request("POST", "/api/voice/listen", b"{}", {"Content-Type": "application/json"})
        self.assertEqual(response.status, 503)


if __name__ == "__main__":
    unittest.main()
