import { expect, test } from "vitest";
import { emptyProgress, getDay } from "../src/state.js";
import { CARDS, STREAK_CARDS } from "../src/cards.js";
import {
  starsForSession, recordSession, dayGoalMet, finishDay, pickNewCard, collectionSummary,
} from "../src/rewards.js";

test("stars: >=90% -> 3, >=70% -> 2, else 1, empty session -> 0", () => {
  expect(starsForSession(10, 10)).toBe(3);
  expect(starsForSession(9, 10)).toBe(3);
  expect(starsForSession(7, 10)).toBe(2);
  expect(starsForSession(4, 10)).toBe(1);
  expect(starsForSession(0, 0)).toBe(0);
});

test("recordSession accumulates day stars and total", () => {
  const p = emptyProgress();
  recordSession(p, "2026-07-05", 3);
  recordSession(p, "2026-07-05", 2);
  const day = getDay(p, "2026-07-05");
  expect(day.sessions).toBe(2);
  expect(day.stars).toBe(5);
  expect(p.totalStars).toBe(5);
});

test("day goal: 2+ sessions and 6+ stars", () => {
  const p = emptyProgress();
  recordSession(p, "2026-07-05", 3);
  expect(dayGoalMet(getDay(p, "2026-07-05"))).toBe(false);
  recordSession(p, "2026-07-05", 3);
  expect(dayGoalMet(getDay(p, "2026-07-05"))).toBe(true);
});

test("day goal is also met when a bonus round was completed, even short on stars", () => {
  const p = emptyProgress();
  const day = getDay(p, "2026-07-05");
  day.sessions = 2;
  day.stars = 5; // не хватает 1 звезды до обычной нормы
  expect(dayGoalMet(day)).toBe(false);
  day.bonusRoundDone = true;
  expect(dayGoalMet(day)).toBe(true);
});

test("bonus round satisfies the day goal even with zero regular sessions (the actual production case)", () => {
  const p = emptyProgress();
  const day = getDay(p, "2026-07-05");
  day.sessions = 0;
  day.stars = 0;
  day.bonusRoundDone = true;
  expect(dayGoalMet(day)).toBe(true);
});

test("finishDay awards a card and grows streak; miss resets streak", () => {
  const p = emptyProgress();
  recordSession(p, "2026-07-05", 3);
  recordSession(p, "2026-07-05", 3);
  const { card } = finishDay(p, "2026-07-05", () => 0);
  expect(card).not.toBeNull();
  expect(p.cards).toContain(card!.id);
  expect(p.streak).toBe(1);
  // следующий день без нормы — streak сбрасывается
  const r2 = finishDay(p, "2026-07-06", () => 0);
  expect(r2.card).toBeNull();
  expect(p.streak).toBe(0);
});

test("streak card awarded at 3 days", () => {
  const p = emptyProgress();
  for (const date of ["2026-07-05", "2026-07-06", "2026-07-07"]) {
    recordSession(p, date, 3);
    recordSession(p, date, 3);
    finishDay(p, date, () => 0);
  }
  expect(p.streak).toBe(3);
  expect(p.cards).toContain(STREAK_CARDS[3].id);
});

// rng, возвращающий по очереди заданные значения при последовательных вызовах
// (первый вызов внутри pickNewCard выбирает уровень редкости, второй — карту внутри уровня).
function sequence(...vals: number[]): () => number {
  let i = 0;
  return () => vals[Math.min(i++, vals.length - 1)];
}

test("pickNewCard never returns an owned card and returns null when all owned", () => {
  const p = emptyProgress();
  p.cards = CARDS.map((c) => c.id);
  expect(pickNewCard(p, () => 0)).toBeNull();
  p.cards = CARDS.slice(1).map((c) => c.id);
  expect(pickNewCard(p, () => 0)!.id).toBe(CARDS[0].id);
});

test("pickNewCard picks by rarity TIER (55/30/15), independent of how many cards are in each tier", () => {
  const p = emptyProgress(); // весь набор не собран: 18 обычных, 9 редких, 3 легендарных
  expect(pickNewCard(p, sequence(0.54, 0))!.rarity).toBe("common"); // 54 < 55
  expect(pickNewCard(p, sequence(0.56, 0))!.rarity).toBe("rare"); // 55 <= 56 < 85
  expect(pickNewCard(p, sequence(0.86, 0))!.rarity).toBe("legendary"); // 86 >= 85
});

test("pickNewCard's legendary tier odds don't shrink just because few legendary cards remain unowned", () => {
  const p = emptyProgress();
  p.cards = CARDS.filter((c) => c.rarity !== "legendary").map((c) => c.id); // остались только 3 легендарки
  expect(pickNewCard(p, sequence(0.01, 0))!.rarity).toBe("legendary");
  expect(pickNewCard(p, sequence(0.99, 0))!.rarity).toBe("legendary");
});

test("pickNewCard falls back to remaining tiers once a tier is fully collected", () => {
  const p = emptyProgress();
  p.cards = CARDS.filter((c) => c.rarity === "legendary").map((c) => c.id); // легендарки уже все собраны
  const card = pickNewCard(p, sequence(0.99, 0)); // rng, который иначе попал бы в легендарную долю
  expect(card?.rarity).not.toBe("legendary");
});

test("pickNewCard picks a specific card within the chosen tier via the second rng draw", () => {
  const p = emptyProgress();
  const first = pickNewCard(p, sequence(0.9, 0)); // легендарный уровень, первая карта
  const last = pickNewCard(p, sequence(0.9, 0.99)); // тот же уровень, последняя карта
  expect(first?.rarity).toBe("legendary");
  expect(last?.rarity).toBe("legendary");
  expect(first?.id).not.toBe(last?.id);
});

test("collectionSummary lists owned cards", () => {
  const p = emptyProgress();
  p.cards = [CARDS[0].id];
  p.totalStars = 7;
  const text = collectionSummary(p);
  expect(text).toContain(CARDS[0].name);
  expect(text).toContain("7");
});
