import { expect, test } from "vitest";
import { emptyProgress, getDay, cardsWonToday } from "../src/state.js";
import { CARDS, STREAK_CARDS, cardById } from "../src/cards.js";
import {
  starsForSession, recordSession, cardChance, rollSessionCard, awardBonusCard,
  dayParticipated, finishDay, pickNewCard, collectionSummary,
} from "../src/rewards.js";

// rng, возвращающий по очереди заданные значения при последовательных вызовах.
function sequence(...vals: number[]): () => number {
  let i = 0;
  return () => vals[Math.min(i++, vals.length - 1)];
}

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

test("cardChance: 3 stars guaranteed, 2 stars 50/50, 1 star (or fewer) never", () => {
  expect(cardChance(3)).toBe(1);
  expect(cardChance(2)).toBe(0.5);
  expect(cardChance(1)).toBe(0);
  expect(cardChance(0)).toBe(0);
});

test("rollSessionCard: 3 stars always wins a card and records it for the day", () => {
  const p = emptyProgress();
  const card = rollSessionCard(p, "2026-07-05", 3, () => 0.99);
  expect(card).not.toBeNull();
  expect(p.cards).toContain(card!.id);
  expect(cardsWonToday(getDay(p, "2026-07-05"))).toEqual([card!.id]);
});

test("rollSessionCard: 1 star never wins, regardless of rng", () => {
  const p = emptyProgress();
  expect(rollSessionCard(p, "2026-07-05", 1, () => 0)).toBeNull();
  expect(cardsWonToday(getDay(p, "2026-07-05"))).toEqual([]);
});

test("rollSessionCard: 2 stars wins below the 50% threshold, loses at/above it", () => {
  const p1 = emptyProgress();
  expect(rollSessionCard(p1, "2026-07-05", 2, () => 0.3)).not.toBeNull();
  const p2 = emptyProgress();
  expect(rollSessionCard(p2, "2026-07-05", 2, () => 0.7)).toBeNull();
});

test("rollSessionCard: 2 stars at the exact 50% boundary loses (>= is a loss, not a win)", () => {
  const p = emptyProgress();
  expect(rollSessionCard(p, "2026-07-05", 2, () => 0.5)).toBeNull();
});

test("rollSessionCard returns null once the whole collection is already owned", () => {
  const p = emptyProgress();
  p.cards = CARDS.map((c) => c.id);
  expect(rollSessionCard(p, "2026-07-05", 3, () => 0)).toBeNull();
});

test("rollSessionCard draws independent rng values for the win-gate, the tier and the in-tier index", () => {
  const p = emptyProgress();
  // gate: 0.4 < cardChance(3)=1 -> win (уже само по себе требует ОТДЕЛЬНОГО первого вызова).
  // tier: 0.56 -> "rare" (55 <= 56 < 85). index: 0.99 -> последняя карта в пуле редких.
  // Если бы шанс и выбор карты по ошибке использовали одно и то же значение rng(),
  // эта комбинация дала бы другой результат — тест ловит именно такое переиспользование.
  const card = rollSessionCard(p, "2026-07-05", 3, sequence(0.4, 0.56, 0.99));
  expect(card?.rarity).toBe("rare");
});

test("awardBonusCard always draws a card regardless of rng (no chance gate)", () => {
  const p = emptyProgress();
  const card = awardBonusCard(p, "2026-07-05", () => 0.999);
  expect(card).not.toBeNull();
  expect(p.cards).toContain(card!.id);
  expect(cardsWonToday(getDay(p, "2026-07-05"))).toContain(card!.id);
});

test("awardBonusCard draws independent rng values for the tier and the in-tier index", () => {
  const p = emptyProgress();
  const card = awardBonusCard(p, "2026-07-05", sequence(0.56, 0.99));
  expect(card?.rarity).toBe("rare");
});

test("awardBonusCard returns null once the whole collection is already owned", () => {
  const p = emptyProgress();
  p.cards = CARDS.map((c) => c.id);
  expect(awardBonusCard(p, "2026-07-05")).toBeNull();
});

test("dayParticipated: true via 2+ sessions, OR via a completed bonus round even with fewer sessions", () => {
  const p = emptyProgress();
  const day = getDay(p, "2026-07-05");
  day.sessions = 1;
  expect(dayParticipated(day)).toBe(false);
  day.sessions = 2;
  expect(dayParticipated(day)).toBe(true);
  day.sessions = 1;
  day.bonusRoundDone = true;
  expect(dayParticipated(day)).toBe(true);
});

test("finishDay grows the streak on participation and resets it on a miss", () => {
  const p = emptyProgress();
  recordSession(p, "2026-07-05", 1);
  recordSession(p, "2026-07-05", 1);
  const { streakCard } = finishDay(p, "2026-07-05");
  expect(streakCard).toBeNull();
  expect(p.streak).toBe(1);
  // следующий день без участия — streak сбрасывается
  const r2 = finishDay(p, "2026-07-06");
  expect(r2.streakCard).toBeNull();
  expect(p.streak).toBe(0);
});

test("finishDay preserves the streak on a bonus-round-only day (fewer than 2 regular sessions)", () => {
  const p = emptyProgress();
  p.streak = 5;
  recordSession(p, "2026-07-05", 1); // только бонусный раунд — 1 сессия за весь день
  const day = getDay(p, "2026-07-05");
  day.bonusRoundDone = true;
  finishDay(p, "2026-07-05");
  expect(p.streak).toBe(6);
});

test("streak card awarded at 3 days regardless of session-level cards", () => {
  const p = emptyProgress();
  for (const date of ["2026-07-05", "2026-07-06", "2026-07-07"]) {
    recordSession(p, date, 1);
    recordSession(p, date, 1);
    finishDay(p, date);
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

test("pickNewCard picks by rarity TIER (55/30/15), independent of how many cards are in each tier", () => {
  const p = emptyProgress(); // весь набор не собран: 33 обычных, 18 редких, 9 легендарных
  expect(pickNewCard(p, sequence(0.54, 0))!.rarity).toBe("common"); // 54 < 55
  expect(pickNewCard(p, sequence(0.56, 0))!.rarity).toBe("rare"); // 55 <= 56 < 85
  expect(pickNewCard(p, sequence(0.86, 0))!.rarity).toBe("legendary"); // 86 >= 85
});

test("pickNewCard's legendary tier odds don't shrink just because few legendary cards remain unowned", () => {
  const p = emptyProgress();
  p.cards = CARDS.filter((c) => c.rarity !== "legendary").map((c) => c.id); // остались только легендарки
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

test("collectionSummary lists owned new-season cards and reports a fraction scoped to that season only", () => {
  const p = emptyProgress();
  p.cards = [CARDS[0].id];
  p.totalStars = 7;
  const text = collectionSummary(p);
  const totalActive = CARDS.length + Object.keys(STREAK_CARDS).length;
  expect(text).toContain(`1 из ${totalActive}`);
  expect(text).toContain(CARDS[0].name);
  expect(text).toContain("7");
});

test("collectionSummary shows legacy robo-pet cards separately, without inflating the new-season fraction", () => {
  const p = emptyProgress();
  p.cards = ["c02"]; // легаси-карточка робо-питомца ("Дрон-щенок Пиксель"), сезон 2 ещё не начат
  const text = collectionSummary(p);
  const totalActive = CARDS.length + Object.keys(STREAK_CARDS).length;
  expect(text).toContain(`0 из ${totalActive}`); // ни одной карточки ТЕКУЩЕГО сезона не собрано
  expect(text).toContain(cardById("c02")!.name); // но легаси-карточка всё равно видна в тексте
});

test("collectionSummary never shows an impossible over-100% fraction even with legacy + a full new collection", () => {
  const p = emptyProgress();
  p.cards = ["c02", ...CARDS.map((c) => c.id), ...Object.values(STREAK_CARDS).map((c) => c.id)];
  const text = collectionSummary(p);
  const totalActive = CARDS.length + Object.keys(STREAK_CARDS).length;
  expect(text).toContain(`${totalActive} из ${totalActive}`);
});
