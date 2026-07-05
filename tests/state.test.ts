import { expect, test } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyProgress, loadProgress, saveProgress, getDay } from "../src/state.js";

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
