import { expect, test } from "vitest";
import { emptyProgress } from "../src/state.js";
import { recordSession } from "../src/rewards.js";
import { parentReport } from "../src/report.js";

test("report shows sessions, stars, streak and weak facts", () => {
  const p = emptyProgress();
  recordSession(p, "2026-07-05", 3);
  recordSession(p, "2026-07-05", 2);
  p.streak = 4;
  p.facts["7x8"] = { level: 0, lastSeen: null, correct: 1, wrong: 4 };
  p.facts["54/6"] = { level: 1, lastSeen: null, correct: 2, wrong: 2 };
  const text = parentReport(p, "2026-07-05");
  expect(text).toContain("2 из 3");
  expect(text).toContain("5");
  expect(text).toContain("7 × 8");
  expect(text).toContain("54 ÷ 6");
});

test("report without weak facts says so", () => {
  const p = emptyProgress();
  expect(parentReport(p, "2026-07-05")).toContain("Слабых мест не замечено");
});
