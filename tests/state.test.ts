import { expect, test } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  emptyProgress, loadProgress, saveProgress, getDay, hasAttemptedSlot, markSlotAttempted,
} from "../src/state.js";

test("loadProgress returns empty progress when file is missing", () => {
  const p = loadProgress(join(mkdtempSync(join(tmpdir(), "smb-")), "progress.json"));
  expect(p).toEqual(emptyProgress());
});

test("saveProgress then loadProgress round-trips", () => {
  const path = join(mkdtempSync(join(tmpdir(), "smb-")), "progress.json");
  const p = emptyProgress();
  p.totalStars = 5;
  p.facts["7x8"] = { level: 2, lastSeen: "2026-07-05T10:00:00.000Z", correct: 3, wrong: 1 };
  saveProgress(path, p);
  expect(loadProgress(path)).toEqual(p);
});

test("getDay creates a day record once and reuses it", () => {
  const p = emptyProgress();
  const d1 = getDay(p, "2026-07-05");
  d1.stars = 3;
  const d2 = getDay(p, "2026-07-05");
  expect(d2.stars).toBe(3);
  expect(p.days).toHaveLength(1);
});

test("hasAttemptedSlot is false for a fresh day and for days without the field (legacy data)", () => {
  const p = emptyProgress();
  const day = getDay(p, "2026-07-05");
  expect(hasAttemptedSlot(day, "morning")).toBe(false);
  delete (day as { attemptedSlots?: string[] }).attemptedSlots;
  expect(hasAttemptedSlot(day, "morning")).toBe(false);
});

test("markSlotAttempted records a slot once and is idempotent", () => {
  const p = emptyProgress();
  const day = getDay(p, "2026-07-05");
  markSlotAttempted(day, "morning");
  expect(hasAttemptedSlot(day, "morning")).toBe(true);
  expect(hasAttemptedSlot(day, "midday")).toBe(false);
  markSlotAttempted(day, "morning");
  expect(day.attemptedSlots).toEqual(["morning"]);
});
