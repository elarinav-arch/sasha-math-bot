import { expect, test } from "vitest";
import { CARDS, STREAK_CARDS, cardById } from "../src/cards.js";

test("30 collection cards with unique ids", () => {
  expect(CARDS).toHaveLength(30);
  const ids = [...CARDS, ...Object.values(STREAK_CARDS)].map((c) => c.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test("streak cards exist for 3, 7, 14, 30 days", () => {
  expect(Object.keys(STREAK_CARDS).map(Number).sort((a, b) => a - b)).toEqual([3, 7, 14, 30]);
});

test("cardById finds both collection and streak cards", () => {
  expect(cardById(CARDS[0].id)?.name).toBe(CARDS[0].name);
  expect(cardById(STREAK_CARDS[7].id)?.name).toBe(STREAK_CARDS[7].name);
  expect(cardById("nope")).toBeUndefined();
});
