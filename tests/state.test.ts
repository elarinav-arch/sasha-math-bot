import { expect, test } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  emptyChildProgress, emptyTeamState, loadTeamState, saveTeamState, getDay,
  hasAttemptedSlot, markSlotAttempted, cardsWonToday, addCardWon,
} from "../src/state.js";

test("emptyChildProgress defaults to placeholder identity fields", () => {
  const c = emptyChildProgress();
  expect(c).toEqual({ chatId: 0, name: "", joinedAt: "", facts: {}, days: [], streak: 0, cards: [], totalStars: 0 });
});

test("emptyChildProgress accepts an explicit identity", () => {
  const c = emptyChildProgress(42, "Саша", "2026-08-16T10:00:00.000Z");
  expect(c.chatId).toBe(42);
  expect(c.name).toBe("Саша");
  expect(c.joinedAt).toBe("2026-08-16T10:00:00.000Z");
});

test("loadTeamState returns empty team state when file is missing", () => {
  const p = loadTeamState(join(mkdtempSync(join(tmpdir(), "smb-")), "progress.json"));
  expect(p).toEqual(emptyTeamState());
});

// Fix 3: the real production progress.json (not yet migrated at the time this branch
// merges) is still in the OLD flat single-child shape — no `children` property. Without
// a check, loadTeamState would silently hand back a malformed object and the crash would
// happen three calls downstream with an opaque message. It must fail fast and clearly here.
test("loadTeamState throws a clear, actionable error on old single-child-shape data", () => {
  const path = join(mkdtempSync(join(tmpdir(), "smb-")), "progress.json");
  const oldShape = {
    facts: { "7x8": { level: 2, lastSeen: null, correct: 0, wrong: 0 } },
    days: [],
    streak: 0,
    cards: [],
    totalStars: 0,
  };
  writeFileSync(path, JSON.stringify(oldShape), "utf8");

  expect(() => loadTeamState(path)).toThrow(/migrate-to-team/);
});

test("saveTeamState then loadTeamState round-trips", () => {
  const path = join(mkdtempSync(join(tmpdir(), "smb-")), "progress.json");
  const team = emptyTeamState();
  team.children[42] = emptyChildProgress(42, "Саша", "2026-08-16T10:00:00.000Z");
  team.children[42].totalStars = 5;
  team.children[42].facts["7x8"] = { level: 2, lastSeen: "2026-07-05T10:00:00.000Z", correct: 3, wrong: 1 };
  saveTeamState(path, team);
  expect(loadTeamState(path)).toEqual(team);
});

test("getDay creates a day record once and reuses it", () => {
  const c = emptyChildProgress();
  const d1 = getDay(c, "2026-07-05");
  d1.stars = 3;
  const d2 = getDay(c, "2026-07-05");
  expect(d2.stars).toBe(3);
  expect(c.days).toHaveLength(1);
});

test("hasAttemptedSlot is false for a fresh day and for days without the field (legacy data)", () => {
  const c = emptyChildProgress();
  const day = getDay(c, "2026-07-05");
  expect(hasAttemptedSlot(day, "morning")).toBe(false);
  delete (day as { attemptedSlots?: string[] }).attemptedSlots;
  expect(hasAttemptedSlot(day, "morning")).toBe(false);
});

test("markSlotAttempted records a slot once and is idempotent", () => {
  const c = emptyChildProgress();
  const day = getDay(c, "2026-07-05");
  markSlotAttempted(day, "morning");
  expect(hasAttemptedSlot(day, "morning")).toBe(true);
  expect(hasAttemptedSlot(day, "midday")).toBe(false);
  markSlotAttempted(day, "morning");
  expect(day.attemptedSlots).toEqual(["morning"]);
});

test("cardsWonToday is empty for a fresh day and for legacy days without the field", () => {
  const c = emptyChildProgress();
  const day = getDay(c, "2026-07-05");
  expect(cardsWonToday(day)).toEqual([]);
});

test("addCardWon appends card ids won during the day (one card can be won per session)", () => {
  const c = emptyChildProgress();
  const day = getDay(c, "2026-07-05");
  addCardWon(day, "cat01");
  addCardWon(day, "cat02");
  expect(cardsWonToday(day)).toEqual(["cat01", "cat02"]);
});
