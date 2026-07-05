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

test("pickNewCard never returns an owned card and returns null when all owned", () => {
  const p = emptyProgress();
  p.cards = CARDS.map((c) => c.id);
  expect(pickNewCard(p, () => 0)).toBeNull();
  p.cards = CARDS.slice(1).map((c) => c.id);
  expect(pickNewCard(p, () => 0)!.id).toBe(CARDS[0].id);
});

test("collectionSummary lists owned cards", () => {
  const p = emptyProgress();
  p.cards = [CARDS[0].id];
  p.totalStars = 7;
  const text = collectionSummary(p);
  expect(text).toContain(CARDS[0].name);
  expect(text).toContain("7");
});
