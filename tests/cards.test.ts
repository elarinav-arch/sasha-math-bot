import { expect, test } from "vitest";
import { CARDS, STREAK_CARDS, cardById } from "../src/cards.js";

test("60 collection cards with unique ids", () => {
  expect(CARDS).toHaveLength(60);
  const ids = [...CARDS, ...Object.values(STREAK_CARDS)].map((c) => c.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test("cards are split 33 common / 18 rare / 9 legendary", () => {
  const counts = { common: 0, rare: 0, legendary: 0 };
  for (const c of CARDS) counts[c.rarity]++;
  expect(counts).toEqual({ common: 33, rare: 18, legendary: 9 });
});

test("every card has a unique name and a non-empty fact", () => {
  const names = CARDS.map((c) => c.name);
  expect(new Set(names).size).toBe(names.length);
  for (const c of CARDS) expect(c.fact?.length ?? 0).toBeGreaterThan(10);
});

test("streak cards exist for 3, 7, 14, 30 days", () => {
  expect(Object.keys(STREAK_CARDS).map(Number).sort((a, b) => a - b)).toEqual([3, 7, 14, 30]);
});

test("cardById finds both collection and streak cards", () => {
  expect(cardById(CARDS[0].id)?.name).toBe(CARDS[0].name);
  expect(cardById(STREAK_CARDS[7].id)?.name).toBe(STREAK_CARDS[7].name);
  expect(cardById("nope")).toBeUndefined();
});

test("cardById still resolves legacy robo-pet ids from before the cat-breed pivot", () => {
  // Александра уже собрала эти карточки в сезоне робо-питомцев — они не должны
  // "потеряться" после смены темы коллекции, иначе /коллекция покажет их пустыми.
  expect(cardById("c02")?.name).toBe("Дрон-щенок Пиксель");
  expect(cardById("c16")?.name).toBe("Робо-мишка Терми");
  expect(cardById("c25")?.name).toBe("Дрон-орёл Радар");
});

test("new cat card ids never collide with legacy robo-pet ids (distinct prefix)", () => {
  for (const c of CARDS) expect(c.id).toMatch(/^cat\d+$/);
});
