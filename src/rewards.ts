import { CARDS, STREAK_CARDS, cardById, type Card } from "./cards.js";
import { getDay, type DayRecord, type Progress } from "./state.js";

export function starsForSession(correct: number, total: number): number {
  if (total === 0) return 0;
  const acc = correct / total;
  if (acc >= 0.9) return 3;
  if (acc >= 0.7) return 2;
  return 1;
}

export function recordSession(p: Progress, date: string, stars: number): DayRecord {
  const day = getDay(p, date);
  day.sessions += 1;
  day.stars += stars;
  p.totalStars += stars;
  return day;
}

export function dayGoalMet(day: DayRecord): boolean {
  return day.sessions >= 2 && day.stars >= 6;
}

const RARITY_WEIGHT: Record<Card["rarity"], number> = { common: 70, rare: 25, legendary: 5 };

export function pickNewCard(p: Progress, rng: () => number = Math.random): Card | null {
  const pool = CARDS.filter((c) => !p.cards.includes(c.id));
  if (pool.length === 0) return null;
  const total = pool.reduce((s, c) => s + RARITY_WEIGHT[c.rarity], 0);
  let r = rng() * total;
  for (const c of pool) {
    r -= RARITY_WEIGHT[c.rarity];
    if (r <= 0) return c;
  }
  return pool[pool.length - 1];
}

// Вызывается в вечернем запуске; возвращает карточки для объявления
export function finishDay(
  p: Progress,
  date: string,
  rng: () => number = Math.random,
): { card: Card | null; streakCard: Card | null } {
  const day = getDay(p, date);
  if (!dayGoalMet(day)) {
    p.streak = 0;
    return { card: null, streakCard: null };
  }
  p.streak += 1;
  let card: Card | null = null;
  if (!day.card) {
    card = pickNewCard(p, rng);
    if (card) {
      day.card = card.id;
      p.cards.push(card.id);
    }
  }
  let streakCard: Card | null = null;
  const sc = STREAK_CARDS[p.streak];
  if (sc && !p.cards.includes(sc.id)) {
    p.cards.push(sc.id);
    streakCard = sc;
  }
  return { card, streakCard };
}

export function collectionSummary(p: Progress): string {
  const owned = p.cards.map(cardById).filter((c): c is Card => Boolean(c));
  const totalCount = CARDS.length + Object.keys(STREAK_CARDS).length;
  const head =
    `🃏 Коллекция Александры: ${owned.length} из ${totalCount} карточек\n` +
    `⭐ Всего звёзд: ${p.totalStars} | 🔥 Серия дней: ${p.streak}`;
  if (owned.length === 0) return head + "\nПока пусто — но первая карточка уже близко!";
  return head + "\n\n" + owned.map((c) => `${c.emoji} ${c.name}`).join("\n");
}
