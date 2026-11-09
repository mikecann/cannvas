import assert from "node:assert/strict";
import test from "node:test";
import { dialBlocksWatering, minutesLeftLabel, predictedSkip, reticOutlook, runMarks, scheduleLabel, zoneMinutesLeft } from "../src/lib/retic.ts";
import { dailyRain, rainAroundRun } from "../src/lib/reticRain.ts";

const now = Date.parse("2026-09-29T15:20:00+08:00");
const zone = (entityId, open) => ({ zone: 1, entityId, name: "Zone", state: open ? "open" : "closed", open });

test("counts down a Cannvas run from its end time, rounding up", () => {
  const status = { configured: true, run: { entityId: "valve.retic_front_grass", endsAt: "2026-09-29T15:26:30+08:00" }, controllerMinutesLeft: 15 };
  assert.equal(zoneMinutesLeft(status, zone("valve.retic_front_grass", true), now), 7);
});

test("never counts a finished run below zero", () => {
  const status = { configured: true, run: { entityId: "valve.retic_front_grass", endsAt: "2026-09-29T15:19:00+08:00" } };
  assert.equal(zoneMinutesLeft(status, zone("valve.retic_front_grass", true), now), 0);
});

test("falls back to the controller's countdown for runs started elsewhere", () => {
  const status = { configured: true, run: { entityId: "valve.retic_front_grass", endsAt: "2026-09-29T15:26:00+08:00" }, controllerMinutesLeft: 9 };
  assert.equal(zoneMinutesLeft(status, zone("valve.retic_back_grass_left", true), now), 9);
  assert.equal(zoneMinutesLeft({ configured: true }, zone("valve.retic_back_grass_left", true), now), null);
});

test("closed zones have no time left", () => {
  const status = { configured: true, run: { entityId: "valve.retic_front_grass", endsAt: "2026-09-29T15:26:00+08:00" } };
  assert.equal(zoneMinutesLeft(status, zone("valve.retic_front_grass", false), now), null);
});

test("labels time left", () => {
  assert.equal(minutesLeftLabel(null), "Watering now");
  assert.equal(minutesLeftLabel(1), "Less than a minute left");
  assert.equal(minutesLeftLabel(12), "12 min left");
});

test("only the RUN dial position allows watering", () => {
  assert.equal(dialBlocksWatering("Run"), false);
  assert.equal(dialBlocksWatering("Off"), true);
  assert.equal(dialBlocksWatering("Zone 3"), true);
  assert.equal(dialBlocksWatering(null), false);
});

test("describes the schedule days and start time", () => {
  assert.equal(scheduleLabel([5, 2], "06:00"), "Tue and Fri at 6:00 am");
  assert.equal(scheduleLabel([1, 3, 5], "18:30"), "Mon, Wed and Fri at 6:30 pm");
  assert.equal(scheduleLabel([6], "12:05"), "Sat at 12:05 pm");
  assert.equal(scheduleLabel([], null), "No days");
});

// Monday 9 Nov 2026, 7:49 am in Perth. The next run is Wednesday at 6 am.
const monday = Date.parse("2026-11-09T07:49:00+08:00");
const closed = (zone, name, entityId) => ({ zone, entityId, name, state: "closed", open: false });
const zones = [closed(1, "Back grass right", "valve.retic_back_grass_right"), closed(2, "Back grass left", "valve.retic_back_grass_left"), closed(5, "Front grass", "valve.retic_front_grass")];
const ready = (extra = {}) => ({
  configured: true,
  enabled: true,
  available: true,
  dial: "Run",
  rainDetected: false,
  zones,
  schedule: {
    nextRun: "2026-11-11T06:00:00+08:00", days: [3, 7], start: "06:00", skipPastMm: 3, skipForecastMm: 5, running: false,
    lastResult: null, rainLast24h: 0, rainNext12h: 0,
    zones: [{ entityId: "valve.retic_back_grass_right", minutes: 15 }, { entityId: "valve.retic_back_grass_left", minutes: 15 }, { entityId: "valve.retic_front_grass", minutes: 10 }],
  },
  ...extra,
});

test("says when it next waters, and that no rain is due", () => {
  assert.deepEqual(reticOutlook(ready(), { before: 0, after: 0.2 }, monday), { headline: "Next watering Wednesday, 6 am", detail: "No rain due", tone: "water" });
});

test("mentions light rain that won't stop it", () => {
  assert.equal(reticOutlook(ready(), { before: 2.1, after: 0.4 }, monday).detail, "2.5 mm of rain due, not enough to skip");
});

test("can't promise anything beyond the forecast", () => {
  assert.equal(reticOutlook(ready(), null, monday).detail, "Too far ahead to forecast rain");
});

test("predicts a skip from rain before or after the run, using the schedule's limits", () => {
  assert.deepEqual(reticOutlook(ready(), { before: 7.2, after: 0 }, monday), { headline: "Wednesday's watering will skip", detail: "7.2 mm of rain by then", tone: "skip" });
  assert.equal(predictedSkip(ready(), { before: 0, after: 5 }), "5.0 mm of rain forecast that morning");
  assert.equal(predictedSkip(ready(), { before: 2.9, after: 4.9 }), null);
});

test("a wet rain sensor only skips if it's still wet at the start time", () => {
  assert.equal(predictedSkip(ready({ rainDetected: true }), { before: 0, after: 0 }), null);
  assert.deepEqual(reticOutlook(ready({ rainDetected: true }), { before: 0, after: 0 }, monday), { headline: "Next watering Wednesday, 6 am", detail: "Unless the rain sensor's still wet then", tone: "water" });
});

test("predicts a skip when Home Assistant has no rain data, as it fails closed", () => {
  const status = ready();
  status.schedule.rainLast24h = null;
  assert.equal(reticOutlook(status, { before: 0, after: 0 }, monday).detail, "Home Assistant has no rain data");
});

test("won't promise watering while a zone can't be read", () => {
  const status = ready({ zones: [...zones.slice(0, 2), { ...zones[2], state: null }] });
  assert.deepEqual(reticOutlook(status, { before: 0, after: 0 }, monday), { headline: "Won't water", detail: "Home Assistant can't read every zone", tone: "warn" });
});

test("tells a missing forecast apart from a run beyond it", () => {
  assert.equal(reticOutlook(ready(), null, monday, false).detail, "No rain forecast right now");
  assert.equal(reticOutlook(ready(), null, monday, true).detail, "Too far ahead to forecast rain");
});

test("a run Home Assistant has just skipped isn't still shown as due", () => {
  const justAfter = Date.parse("2026-11-11T06:02:00+08:00");
  const status = ready({ history: [{ at: "2026-11-11T06:00:01+08:00", result: "skipped", reason: "4.1 mm of rain in the last 24 hours", minutes: null, rainBefore: 4.1, rainAfter: 0 }] });
  assert.deepEqual(reticOutlook(status, { before: 0, after: 0 }, justAfter), { headline: "Today's watering skipped", detail: "4.1 mm of rain in the last 24 hours", tone: "skip" });
  const stopped = ready({ history: [{ at: "2026-11-11T06:00:01+08:00", result: "stopped", reason: null, minutes: 1, rainBefore: 0, rainAfter: 0 }] });
  assert.equal(reticOutlook(stopped, { before: 0, after: 0 }, justAfter).headline, "Today's watering stopped early");
});

test("calls tomorrow's run tomorrow", () => {
  const tuesday = Date.parse("2026-11-10T20:00:00+08:00");
  assert.equal(reticOutlook(ready(), { before: 0, after: 0 }, tuesday).headline, "Next watering tomorrow, 6 am");
  assert.equal(reticOutlook(ready(), { before: 9, after: 0 }, tuesday).headline, "Tomorrow's watering will skip");
});

test("says when a scheduled run will finish", () => {
  const status = ready({
    zones: [closed(1, "Back grass right", "valve.retic_back_grass_right"), { ...closed(2, "Back grass left", "valve.retic_back_grass_left"), state: "open", open: true }, closed(5, "Front grass", "valve.retic_front_grass")],
    run: { entityId: "valve.retic_back_grass_left", endsAt: "2026-11-11T06:30:00+08:00" },
  });
  status.schedule.running = true;
  const outlook = reticOutlook(status, null, Date.parse("2026-11-11T06:22:00+08:00"));
  // 8 minutes left here, then 10 for the front grass.
  assert.deepEqual(outlook, { headline: "Watering now, done about 6:40 am", detail: "Zone 2 of 3, back grass left", tone: "watering" });
});

test("a zone run by hand points at the next scheduled run", () => {
  const status = ready({ zones: [{ ...closed(5, "Front grass", "valve.retic_front_grass"), state: "open", open: true }], controllerMinutesLeft: 4 });
  assert.deepEqual(reticOutlook(status, null, monday), { headline: "Watering front grass", detail: "Next on the schedule Wednesday, 6 am", tone: "watering" });
});

test("the switch, the controller and the dial come before the forecast", () => {
  assert.equal(reticOutlook(ready({ enabled: false }), null, monday).headline, "Retic is off");
  assert.equal(reticOutlook(ready({ enabled: null }), null, monday).headline, "Retic switch unknown");
  assert.equal(reticOutlook(ready({ available: false }), null, monday).headline, "Controller offline");
  assert.deepEqual(reticOutlook(ready({ dial: "Off" }), null, monday), { headline: "Won't water", detail: "The controller's dial is on Off. Turn it to RUN.", tone: "warn" });
  const offSeason = ready();
  offSeason.schedule.nextRun = null;
  assert.equal(reticOutlook(offSeason, null, monday).headline, "No watering scheduled");
});

test("marks each scheduled run on its local date, plus the next one", () => {
  const status = ready({
    history: [
      // 6 am in Perth is still the day before in UTC.
      { at: "2026-11-01T06:00:00+08:00", result: "stopped", reason: null, minutes: 32, rainBefore: null, rainAfter: null },
      { at: "2026-11-04T06:02:35+08:00", result: "skipped", reason: "4.1 mm", minutes: null, rainBefore: 4.1, rainAfter: 0 },
      { at: "2026-11-08T06:00:00+08:00", result: "watering", reason: null, minutes: null, rainBefore: 0, rainAfter: 0 },
    ],
  });
  assert.deepEqual([...runMarks(status, false)], [
    ["2026-11-01", "stopped"],
    ["2026-11-04", "skipped"],
    // Left as watering by a restart, so it ended early.
    ["2026-11-08", "stopped"],
    ["2026-11-11", "next"],
  ]);
  assert.equal(runMarks(status, true).get("2026-11-11"), "next-skip");
  // While Wednesday's run waters, only it is running. Sunday's stays stopped.
  const wednesday = { ...status, history: [...status.history, { at: "2026-11-11T06:00:00+08:00", result: "watering", reason: null, minutes: null, rainBefore: 0, rainAfter: 0 }] };
  wednesday.schedule = { ...status.schedule, running: true };
  const marks = runMarks(wednesday, false);
  assert.equal(marks.get("2026-11-08"), "stopped");
  assert.equal(marks.get("2026-11-11"), "running");
  assert.equal(runMarks(ready({ enabled: false }), false).size, 0);
});

test("adds up rain by local day and around a 6 am run like Home Assistant", () => {
  const time = [];
  const precipitation = [];
  for (let day = 9; day <= 11; day++) {
    for (let hour = 0; hour < 24; hour++) {
      time.push(`2026-11-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00`);
      // 1 mm an hour from 10 pm Tuesday to 3 am Wednesday, then 0.5 mm at 9 am.
      precipitation.push((day === 10 && hour >= 22) || (day === 11 && hour <= 3) ? 1 : day === 11 && hour === 9 ? 0.5 : 0);
    }
  }
  const hourly = { time, precipitation };
  assert.deepEqual(dailyRain(hourly, monday).map(({ date, mm, forecast }) => [date, mm, forecast]), [
    ["2026-11-09", 0, true], ["2026-11-10", 2, true], ["2026-11-11", 4.5, true],
  ]);
  assert.deepEqual(rainAroundRun(hourly, "2026-11-11T06:00:00+08:00"), { before: 6, after: 0.5 });
  // Monday 6 am has no 24 hours before it in this series.
  assert.equal(rainAroundRun(hourly, "2026-11-09T06:00:00+08:00"), null);
});
