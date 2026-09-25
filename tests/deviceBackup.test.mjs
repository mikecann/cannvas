import assert from "node:assert/strict";
import test from "node:test";
import {
  backupContentKey,
  boardsNeedingBackup,
  jsonLength,
  reconcileBoardRevisions,
  toBackupState,
  toBackupStrokes,
} from "../src/lib/deviceBackup.ts";
import { compactStroke } from "../src/lib/strokes.ts";

function deviceState(overrides = {}) {
  return {
    version: 2,
    revision: 7,
    tabletScheduleVersion: 1,
    updatedAt: 1000,
    boards: { "2026-09-01": [], "2026-09-02": [] },
    boardRevisions: {},
    chores: [{ id: "bed", name: "Make my bed", valueCents: 50, category: "standard", color: "#fff", position: 0, _id: "legacy" }],
    completions: [{ choreId: "bed", date: "2026-09-01", completedAt: 5 }],
    todos: [{ id: "t1", title: "Bins", assignee: "dad", priority: "low", completed: false, createdAt: 1, dueDate: undefined }],
    tabletSchedules: [{ id: "nuheart", name: "Nuheart", purpose: "Heartworm", cadenceMonths: 1, color: "#f00", dueDate: "2026-10-20" }],
    tabletCompletions: [{ id: "c1", tabletId: "nuheart", takenDate: "2026-09-20" }],
    ...overrides,
  };
}

test("the device backup leaves boards out and keeps only known fields", () => {
  const payload = toBackupState(deviceState());
  assert.equal(payload.version, 3);
  assert.equal("boards" in payload, false);
  assert.equal("boardRevisions" in payload, false);
  assert.deepEqual(payload.chores[0], { id: "bed", name: "Make my bed", valueCents: 50, category: "standard", color: "#fff", position: 0 });
  assert.deepEqual(payload.completions, [{ choreId: "bed", date: "2026-09-01" }]);
  // Convex rejects explicit undefined in validated objects, so leave it out.
  assert.equal("dueDate" in payload.todos[0], false);
  assert.equal("previousDueDate" in payload.tabletCompletions[0], false);
});

test("unknown chore categories become standard", () => {
  const payload = toBackupState(deviceState({
    chores: [{ id: "x", name: "X", valueCents: 1, category: "weekly", color: "#fff", position: 0 }],
  }));
  assert.equal(payload.chores[0].category, "standard");
});

test("backup size counts UTF-8 bytes", () => {
  assert.equal(jsonLength("é"), 4);
  assert.equal(jsonLength("🙂"), 6);
});

test("a board edit alone does not change the device backup content", () => {
  const before = backupContentKey(toBackupState(deviceState()));
  const after = backupContentKey(toBackupState(deviceState({
    revision: 8,
    updatedAt: 2000,
    boards: { "2026-09-01": [{ id: "s", color: "#000", width: 4, points: [{ x: 0.1, y: 0.1 }] }] },
  })));
  assert.equal(before, after);
});

test("existing boards without revisions are each uploaded once", () => {
  const state = deviceState();
  assert.deepEqual(boardsNeedingBackup(state, {}), ["2026-09-01", "2026-09-02"]);
  assert.deepEqual(boardsNeedingBackup(state, { "2026-09-01": 1, "2026-09-02": 1 }), []);
});

test("only boards changed since their last upload need backing up", () => {
  const state = deviceState({ boardRevisions: { "2026-09-01": 12, "2026-09-02": 4 } });
  assert.deepEqual(boardsNeedingBackup(state, { "2026-09-01": 10, "2026-09-02": 4 }), ["2026-09-01"]);
  assert.deepEqual(boardsNeedingBackup(state, {}, new Set(["2026-09-01"])), ["2026-09-02"]);
});

test("backup strokes drop unknown fields", () => {
  const [stroke] = toBackupStrokes([{ id: "s", color: "#000", width: 4, points: [{ x: 0.1, y: 0.2, pressure: 1 }], extra: true }]);
  assert.deepEqual(stroke, { id: "s", color: "#000", width: 4, points: [{ x: 0.1, y: 0.2 }] });
});

test("strokes round points and drop near-duplicates but keep the end", () => {
  const stroke = compactStroke({
    id: "s",
    color: "#000",
    width: 4,
    points: [
      { x: 0.123456, y: 0.654321 },
      { x: 0.12346, y: 0.65432 },
      { x: 0.1236, y: 0.6545 },
      { x: 0.2, y: 0.7 },
      { x: 0.20001, y: 0.70001 },
    ],
  });
  assert.deepEqual(stroke.points, [
    { x: 0.1235, y: 0.6543 },
    { x: 0.2, y: 0.7 },
  ]);
});

test("a stroke ending with a tiny movement still ends where the finger lifted", () => {
  const stroke = compactStroke({
    id: "s",
    color: "#000",
    width: 4,
    points: [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }, { x: 0.5002, y: 0.5002 }],
  });
  assert.deepEqual(stroke.points.at(-1), { x: 0.5002, y: 0.5002 });
  assert.deepEqual(compactStroke(stroke), stroke, "compaction is stable");
});

test("single points and stickers keep every point", () => {
  const dot = compactStroke({ id: "d", color: "#000", width: 4, points: [{ x: 0.33333, y: 0.5 }] });
  assert.deepEqual(dot.points, [{ x: 0.3333, y: 0.5 }]);
  const sticker = compactStroke({ id: "k", kind: "sticker", sticker: "*", color: "#000", width: 72, points: [{ x: 0.5, y: 0.5 }] });
  assert.equal(sticker.points.length, 1);
});

test("reconciling uploads boards the server has lost", () => {
  const state = deviceState({ boardRevisions: { "2026-09-01": 5, "2026-09-02": 6 } });
  const result = reconcileBoardRevisions(state, { "2026-09-01": 5 });
  assert.deepEqual(result.backedUp, { "2026-09-01": 5 });
  assert.deepEqual(boardsNeedingBackup({ ...state, boardRevisions: result.boardRevisions }, result.backedUp), ["2026-09-02"]);
});

test("reconciling moves a board past a newer server revision", () => {
  const state = deviceState({ revision: 7, boardRevisions: { "2026-09-01": 5 } });
  const result = reconcileBoardRevisions(state, { "2026-09-01": 20 });
  assert.equal(result.boardRevisions["2026-09-01"], 21);
  assert.equal(result.revision, 21);
  assert.deepEqual(boardsNeedingBackup({ ...state, boardRevisions: result.boardRevisions }, result.backedUp), ["2026-09-01", "2026-09-02"]);
});

test("reconciling raises the device revision past every board revision", () => {
  const state = deviceState({ revision: 3, boardRevisions: { "2026-09-01": 40, "2026-09-02": 41 } });
  const result = reconcileBoardRevisions(state, { "2026-09-01": 40, "2026-09-02": 41 });
  assert.equal(result.revision, 41);
  assert.deepEqual(boardsNeedingBackup({ ...state, boardRevisions: result.boardRevisions }, result.backedUp), []);
});

test("a server revision above the cap counts as missing", () => {
  const state = deviceState({ boardRevisions: { "2026-09-01": 2 } });
  const result = reconcileBoardRevisions(state, { "2026-09-01": 1e15 });
  assert.equal(result.backedUp["2026-09-01"], undefined);
  assert.equal(result.boardRevisions["2026-09-01"], 2);
});

test("revision-zero boards the server has lost are uploaded", () => {
  const state = deviceState({ boardRevisions: { "2026-09-01": 0, "2026-09-02": 0 } });
  assert.deepEqual(boardsNeedingBackup(state, { "2026-09-01": 0 }), ["2026-09-02"]);
});
