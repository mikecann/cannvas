import assert from "node:assert/strict";
import test from "node:test";
import { parseVoiceEvent } from "../src/lib/voice.ts";

test("parses the voice service's state, level and command events", () => {
  assert.deepEqual(parseVoiceEvent('{"type":"state","phase":"speaking","heard":"lights on","reply":"Okay."}'), {
    type: "state", phase: "speaking", heard: "lights on", reply: "Okay.",
  });
  assert.deepEqual(parseVoiceEvent('{"type":"state","phase":"listening"}'), { type: "state", phase: "listening", heard: "", reply: "" });
  assert.deepEqual(parseVoiceEvent('{"type":"level","value":1.7}'), { type: "level", value: 1 });
  assert.deepEqual(parseVoiceEvent('{"type":"command","name":"open_app","app":"calendar"}'), { type: "command", name: "open_app", app: "calendar" });
});

test("ignores anything it doesn't understand", () => {
  assert.equal(parseVoiceEvent("not json"), null);
  assert.equal(parseVoiceEvent("null"), null);
  assert.equal(parseVoiceEvent('{"type":"state","phase":"dancing"}'), null);
  assert.equal(parseVoiceEvent('{"type":"level","value":"loud"}'), null);
  assert.equal(parseVoiceEvent('{"type":"command","name":"rm -rf","app":"calendar"}'), null);
});
