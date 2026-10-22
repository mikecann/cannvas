import assert from "node:assert/strict";
import test from "node:test";
import { parseVoiceEvent, parseVoiceSample, trainingTally } from "../src/lib/voice.ts";

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

test("parses wake word training events", () => {
  assert.deepEqual(parseVoiceEvent('{"type":"training","active":false,"speaker":"josh"}'), { type: "training", active: false });
  assert.deepEqual(
    parseVoiceEvent('{"type":"training","active":true,"speaker":"josh","spot":"far","saying":"wake","endsAt":1791700000000}'),
    { type: "training", active: true, endsAt: 1791700000000, speaker: "josh", spot: "far", saying: "wake" },
  );
  assert.equal(parseVoiceEvent('{"type":"training","active":true,"speaker":"josh","spot":"far","saying":"shout","endsAt":1}'), null);
  const sample = { id: "20261012-070000-josh-ab12", at: "2026-10-12T07:00:00+08:00", speaker: "josh", spot: "far", saying: "wake", score: 0.93, wouldWake: true, heard: "Hey canvas", seconds: 1.6 };
  assert.deepEqual(parseVoiceEvent(JSON.stringify({ type: "sample", sample })), { type: "sample", sample });
  assert.equal(parseVoiceSample({ ...sample, score: "high" }), null);
});

test("tallies tries per person and mistakes on other speech", () => {
  const sample = (speaker, saying, wouldWake) => ({ id: "x", at: "", spot: "far", score: 0, heard: "", seconds: 1, speaker, saying, wouldWake });
  assert.deepEqual(trainingTally([
    sample("kelsie", "wake", true),
    sample("kelsie", "wake", false),
    sample("josh", "wake", true),
    sample("josh", "other", false),
    sample("mike", "other", true),
  ]), {
    wake: [{ speaker: "kelsie", woke: 1, tries: 2 }, { speaker: "josh", woke: 1, tries: 1 }],
    other: { mistakes: 1, tries: 2 },
  });
});
