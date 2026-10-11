"""Tests for deploy/cannvas-voice. Run with: python3 -m unittest deploy/cannvas_voice_test.py

These cover the parts that decide what happens: which devices voice may touch,
how a model's tool call becomes Home Assistant calls and a spoken reply, and the
loopback event stream. The audio models aren't needed, so neither is numpy.
"""

from __future__ import annotations

from datetime import datetime
from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib.machinery import SourceFileLoader
from importlib.util import module_from_spec, spec_from_loader
import json
import os
from pathlib import Path
import sys
import threading
import unittest

HERE = Path(__file__).resolve().parent
# No voice.json, so only lights are voice devices unless a test names others.
os.environ["CANNVAS_VOICE_CONFIG"] = str(HERE / "missing-voice.json")
loader = SourceFileLoader("cannvas_voice", str(HERE / "cannvas-voice"))
voice = module_from_spec(spec_from_loader("cannvas_voice", loader))
# Dataclasses look their module up while the file is still loading.
sys.modules["cannvas_voice"] = voice
loader.exec_module(voice)
voice.log = lambda message: None

STATES = [
    {"entity_id": "light.tv_lamp", "state": "off", "attributes": {"friendly_name": "TV Lamp"}},
    {"entity_id": "light.tv_lamp_top", "state": "off", "attributes": {"friendly_name": "TV Lamp Top"}},
    {"entity_id": "light.tv_lamp_bottom", "state": "off", "attributes": {"friendly_name": "TV Lamp Bottom"}},
    {"entity_id": "switch.athom_outside_lights_smart_plug_v2", "state": "off", "attributes": {"friendly_name": "Xmas Lights Plug - Main"}},
    {"entity_id": "switch.athom_smart_mirror_plug_smart_plug_v2", "state": "on", "attributes": {"friendly_name": "Smart Mirror Plug"}},
    {"entity_id": "valve.retic_front_grass", "state": "closed", "attributes": {"friendly_name": "Front grass"}},
]


class FakeHomeAssistant(BaseHTTPRequestHandler):
    calls: list[tuple[str, dict]] = []
    fail: set[str] = set()

    def do_GET(self) -> None:
        self.reply(200, STATES)

    def do_POST(self) -> None:
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        FakeHomeAssistant.calls.append((self.path, body))
        self.reply(500 if body.get("entity_id") in FakeHomeAssistant.fail else 200, [])

    def reply(self, status: int, value: object) -> None:
        data = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args: object) -> None:
        pass


class FakeModel(BaseHTTPRequestHandler):
    """Answers like llama-server with whatever message the test set."""

    message: dict = {}
    requests: list[dict] = []

    def do_POST(self) -> None:
        FakeModel.requests.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
        data = json.dumps({"choices": [{"message": FakeModel.message}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args: object) -> None:
        pass


def serve(handler: type[BaseHTTPRequestHandler]) -> ThreadingHTTPServer:
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def tool_call(name: str, arguments: dict) -> dict:
    return {"content": "", "tool_calls": [{"type": "function", "function": {"name": name, "arguments": json.dumps(arguments)}}]}


class DeviceTest(unittest.TestCase):
    def test_lights_only_unless_named(self) -> None:
        names = [device.name for device in voice.voice_devices(STATES, {})]
        self.assertEqual(names, ["TV Lamp", "TV Lamp Top", "TV Lamp Bottom"])

    def test_named_switches_use_their_spoken_name(self) -> None:
        devices = voice.voice_devices(STATES, {"switch.athom_outside_lights_smart_plug_v2": "Outside Lights"})
        self.assertIn(voice.Device("switch.athom_outside_lights_smart_plug_v2", "Outside Lights"), devices)

    def test_never_the_plug_that_powers_cannvas(self) -> None:
        devices = voice.voice_devices(STATES, {"switch.athom_smart_mirror_plug_smart_plug_v2": "Mirror"})
        self.assertNotIn("switch.athom_smart_mirror_plug_smart_plug_v2", [device.entity_id for device in devices])

    def test_only_switchable_domains(self) -> None:
        devices = voice.voice_devices(STATES, {"valve.retic_front_grass": "front grass"})
        self.assertNotIn("valve.retic_front_grass", [device.entity_id for device in devices])

    def test_resolves_names_shortcuts_and_all_lights(self) -> None:
        devices = voice.voice_devices(STATES, {})
        resolve = lambda *targets: [device.name for device in voice.resolve_targets(list(targets), devices)]
        self.assertEqual(resolve("tv lamp"), ["TV Lamp"])
        self.assertEqual(resolve("top lamp"), ["TV Lamp Top"])
        self.assertEqual(resolve("all lights"), ["TV Lamp", "TV Lamp Top", "TV Lamp Bottom"])
        self.assertEqual(resolve("lights", "TV Lamp"), ["TV Lamp", "TV Lamp Top", "TV Lamp Bottom"])
        # "TV" alone could be any of the three, so it is none of them.
        self.assertEqual(resolve("tv"), [])
        self.assertEqual(resolve("kitchen"), [])


class QuickCommandTest(unittest.TestCase):
    """Everyday commands skip the language model."""

    devices = voice.voice_devices(STATES, {"switch.athom_outside_lights_smart_plug_v2": "Outside Lights"})

    def quick(self, heard: str) -> tuple[str, dict] | None:
        message = voice.quick_command(heard, self.devices)
        if message is None:
            return None
        function = message["tool_calls"][0]["function"]
        return function["name"], json.loads(function["arguments"])

    def test_switches_lights(self) -> None:
        all_lights = ["TV Lamp", "TV Lamp Top", "TV Lamp Bottom"]
        self.assertEqual(self.quick("Lights on."), ("control_devices", {"targets": all_lights, "action": "on"}))
        self.assertEqual(self.quick("Hey Canvas, turn the lights off please"), ("control_devices", {"targets": all_lights, "action": "off"}))
        self.assertEqual(self.quick("Turn off the TV lamp."), ("control_devices", {"targets": ["TV Lamp"], "action": "off"}))
        self.assertEqual(self.quick("switch on the outside lights"), ("control_devices", {"targets": ["Outside Lights"], "action": "on"}))
        self.assertEqual(self.quick("Could you turn the top lamp and the bottom lamp on?"),
                         ("control_devices", {"targets": ["TV Lamp Top", "TV Lamp Bottom"], "action": "on"}))

    def test_brightness(self) -> None:
        self.assertEqual(self.quick("Set the top lamp to 30%."), ("control_devices", {"targets": ["TV Lamp Top"], "action": "on", "brightness_pct": 30}))
        self.assertEqual(self.quick("dim the TV lamp to fifty percent"), ("control_devices", {"targets": ["TV Lamp"], "action": "on", "brightness_pct": 50}))
        self.assertIsNone(self.quick("set the top lamp to 300 percent"))

    def test_opens_screens(self) -> None:
        self.assertEqual(self.quick("Open the calendar."), ("open_app", {"app": "calendar"}))
        self.assertEqual(self.quick("show me the to-do list"), ("open_app", {"app": "to-dos"}))
        self.assertEqual(self.quick("Go home."), ("open_app", {"app": "home"}))
        self.assertEqual(self.quick("bring up Sammy cam"), ("open_app", {"app": "sammy cam"}))
        # Speech recognition sometimes hears "open" as "opened".
        self.assertEqual(self.quick("Opened the calendar."), ("open_app", {"app": "calendar"}))

    def test_leaves_everything_else_to_the_model(self) -> None:
        for heard in ("Are the lights on?", "leave the lights on", "put the kettle on", "turn off the TV",
                      "turn off the lights in the lounge", "open the garage", "tell me a joke", "What's the weather tomorrow?"):
            self.assertIsNone(self.quick(heard), heard)


class AgentTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.ha = serve(FakeHomeAssistant)
        cls.model = serve(FakeModel)

    @classmethod
    def tearDownClass(cls) -> None:
        for server in (cls.ha, cls.model):
            server.shutdown()
            server.server_close()

    def setUp(self) -> None:
        FakeHomeAssistant.calls = []
        FakeHomeAssistant.fail = set()
        FakeModel.requests = []
        config = {"url": f"http://127.0.0.1:{self.ha.server_address[1]}", "token": "token-for-tests"}
        self.agent = voice.Agent(f"http://127.0.0.1:{self.model.server_address[1]}", lambda: config)
        self.agent.refresh_devices(force=True)

    def ask(self, message: dict, heard: str = "make it cosy in here") -> object:
        FakeModel.message = message
        return self.agent.handle(heard, datetime(2026, 10, 11, 9, 5, tzinfo=voice.ZONE))

    def test_turns_lights_on(self) -> None:
        outcome = self.ask(tool_call("control_devices", {"targets": ["all lights"], "action": "on"}), "it's dark in here")
        self.assertEqual([path for path, _ in FakeHomeAssistant.calls], ["/api/services/light/turn_on"] * 3)
        self.assertEqual(outcome.reply, "Okay, the lights are on.")

    def test_one_light_off(self) -> None:
        outcome = self.ask(tool_call("control_devices", {"targets": ["TV Lamp"], "action": "off"}), "kill the tv lamp")
        self.assertEqual(FakeHomeAssistant.calls, [("/api/services/light/turn_off", {"entity_id": "light.tv_lamp"})])
        self.assertEqual(outcome.reply, "Okay, TV Lamp is off.")

    def test_brightness(self) -> None:
        outcome = self.ask(tool_call("control_devices", {"targets": ["TV Lamp Top"], "action": "on", "brightness_pct": 30}))
        self.assertEqual(FakeHomeAssistant.calls, [("/api/services/light/turn_on", {"entity_id": "light.tv_lamp_top", "brightness_pct": 30})])
        self.assertEqual(outcome.reply, "TV Lamp Top set to 30 percent.")

    def test_reports_a_device_that_fails(self) -> None:
        FakeHomeAssistant.fail = {"light.tv_lamp_bottom"}
        outcome = self.ask(tool_call("control_devices", {"targets": ["TV Lamp", "TV Lamp Bottom"], "action": "on"}))
        self.assertEqual(outcome.reply, "Okay, TV Lamp is on. TV Lamp Bottom didn't respond.")

    def test_unknown_device(self) -> None:
        outcome = self.ask(tool_call("control_devices", {"targets": ["Kitchen"], "action": "on"}))
        self.assertEqual(FakeHomeAssistant.calls, [])
        self.assertEqual(outcome.reply, "Sorry, I don't know which light you mean.")

    def test_opens_an_app(self) -> None:
        outcome = self.ask(tool_call("open_app", {"app": "calendar"}), "what's on this week")
        self.assertEqual(outcome.commands, [{"name": "open_app", "app": "calendar"}])
        self.assertEqual(outcome.reply, "Here's the calendar.")

    def test_everyday_commands_skip_the_model(self) -> None:
        outcome = self.ask({"content": "the model should not be asked"}, "lights off")
        self.assertEqual(FakeModel.requests, [])
        self.assertEqual(outcome.reply, "Okay, the lights are off.")

    def test_brightness_sent_as_a_string(self) -> None:
        self.ask(tool_call("control_devices", {"targets": ["TV Lamp"], "action": "on", "brightness_pct": "30"}))
        self.assertEqual(FakeHomeAssistant.calls, [("/api/services/light/turn_on", {"entity_id": "light.tv_lamp", "brightness_pct": 30})])

    def test_chat_reply_is_cleaned_for_speech(self) -> None:
        outcome = self.ask({"content": "**Paris** is the capital of France! 🇫🇷 It is lovely. Also a third thing."})
        self.assertEqual(outcome.reply, "Paris is the capital of France! It is lovely.")

    def test_sends_tools_and_remembers_the_conversation(self) -> None:
        self.ask({"content": "Why did the chicken cross the road?"}, "tell me a joke")
        self.ask({"content": "To get to the other side."}, "why")
        request = FakeModel.requests[-1]
        self.assertEqual([tool["function"]["name"] for tool in request["tools"]], ["control_devices", "open_app"])
        self.assertIn("TV Lamp Top", request["messages"][0]["content"])
        self.assertEqual([message["role"] for message in request["messages"]], ["system", "user", "assistant", "user"])
        self.assertTrue(request["messages"][-1]["content"].startswith("(It is Sunday 11 October, 9:05 am.)"))

    def test_model_down(self) -> None:
        self.agent.llm_url = "http://127.0.0.1:9"
        outcome = self.agent.handle("tell me a joke")
        self.assertEqual(outcome.reply, "Sorry, my brain isn't answering right now.")


class EventsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.events = voice.Events()
        voice.VoiceHandler.events = self.events
        voice.VoiceHandler.voice = None
        self.server = voice.VoiceServer(("127.0.0.1", 0), voice.VoiceHandler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.port = self.server.server_address[1]

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()

    def test_new_pages_get_the_current_state(self) -> None:
        self.events.phase("listening")
        client = self.events.subscribe()
        self.assertEqual(client.get_nowait()["phase"], "listening")

    def test_streams_events(self) -> None:
        connection = HTTPConnection("127.0.0.1", self.port, timeout=5)
        connection.request("GET", "/events", headers={"Host": f"127.0.0.1:{self.port}"})
        response = connection.getresponse()
        self.assertEqual(response.getheader("Content-Type"), "text/event-stream")
        self.assertEqual(response.readline(), b"retry: 3000\n")
        response.readline()
        self.assertIn(b'"phase": "idle"', response.readline())
        connection.close()

    def test_refuses_browsers_and_other_hosts(self) -> None:
        for headers in ({"Host": f"127.0.0.1:{self.port}", "Origin": "http://evil.example"}, {"Host": "evil.example"}):
            connection = HTTPConnection("127.0.0.1", self.port, timeout=5)
            connection.request("POST", "/listen", body=b"{}", headers=headers)
            self.assertEqual(connection.getresponse().status, 403)
            connection.close()


if __name__ == "__main__":
    unittest.main()
