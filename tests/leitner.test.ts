import { expect, test } from "vitest";
import { emptyProgress } from "../src/state.js";
import { allFacts } from "../src/facts.js";
import { applyResult, isDue, pickSessionFacts } from "../src/leitner.js";

const NOW = new Date("2026-07-05T10:00:00Z");

test("correct answer raises level (max 4), wrong lowers it (min 0)", () => {
  const p = emptyProgress();
  applyResult(p, "7x8", true, NOW);
  expect(p.facts["7x8"].level).toBe(1);
  applyResult(p, "7x8", false, NOW);
  applyResult(p, "7x8", false, NOW);
  expect(p.facts["7x8"].level).toBe(0);
  for (let i = 0; i < 10; i++) applyResult(p, "7x8", true, NOW);
  expect(p.facts["7x8"].level).toBe(4);
  expect(p.facts["7x8"].correct).toBe(11);
  expect(p.facts["7x8"].wrong).toBe(2);
});

test("isDue: unseen facts are due; level 2 is due after 3 days, not after 1", () => {
  expect(isDue(undefined, NOW)).toBe(true);
  const fp = { level: 2, lastSeen: "2026-07-04T10:00:00Z", correct: 1, wrong: 0 };
  expect(isDue(fp, NOW)).toBe(false); // прошёл 1 день, интервал уровня 2 — 3 дня
  expect(isDue(fp, new Date("2026-07-08T10:00:00Z"))).toBe(true);
});

test("pickSessionFacts returns requested count, weak facts included", () => {
  const p = emptyProgress();
  const facts = allFacts();
  // "западающий" факт: уровень 0, много ошибок, показан давно
  p.facts["7x8"] = { level: 0, lastSeen: "2026-06-01T10:00:00Z", correct: 0, wrong: 5 };
  // выученный факт: уровень 4, показан только что — не должен попасть
  p.facts["2x2"] = { level: 4, lastSeen: "2026-07-05T09:00:00Z", correct: 20, wrong: 0 };
  const picked = pickSessionFacts(p, facts, 10, NOW, () => 0.5);
  expect(picked).toHaveLength(10);
  expect(picked.map((f) => f.key)).toContain("7x8");
  expect(picked.map((f) => f.key)).not.toContain("2x2");
  expect(new Set(picked.map((f) => f.key)).size).toBe(10);
});
