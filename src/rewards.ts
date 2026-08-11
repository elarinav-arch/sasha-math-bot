import { CARDS, STREAK_CARDS, cardById, type Card } from "./cards.js";
import { addCardWon, getDay, type DayRecord, type Progress } from "./state.js";

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

// Шанс на карточку СРАЗУ по итогам одной сессии — растёт вместе с точностью.
export function cardChance(stars: number): number {
  if (stars >= 3) return 1;
  if (stars === 2) return 0.5;
  return 0;
}

// Доли по УРОВНЮ редкости (в сумме 100) — легендарки специально попадаются заметно
// чаще обычной "честной" редкости, это мотивационная фишка коллекции. Выбор идёт
// в два шага (уровень редкости → конкретная карта внутри него), поэтому реальная
// вероятность уровня не зависит от того, сколько карт в нём осталось несобранными.
const RARITY_WEIGHT: Record<Card["rarity"], number> = { common: 55, rare: 30, legendary: 15 };

export function pickNewCard(p: Progress, rng: () => number = Math.random): Card | null {
  const pool = CARDS.filter((c) => !p.cards.includes(c.id));
  if (pool.length === 0) return null;

  const byRarity: Record<Card["rarity"], Card[]> = { common: [], rare: [], legendary: [] };
  for (const c of pool) byRarity[c.rarity].push(c);
  const tiers = (Object.keys(RARITY_WEIGHT) as Array<Card["rarity"]>).filter((r) => byRarity[r].length > 0);

  const total = tiers.reduce((sum, r) => sum + RARITY_WEIGHT[r], 0);
  let roll = rng() * total;
  let tier = tiers[tiers.length - 1];
  for (const r of tiers) {
    roll -= RARITY_WEIGHT[r];
    if (roll <= 0) {
      tier = r;
      break;
    }
  }

  const candidates = byRarity[tier];
  const idx = Math.min(candidates.length - 1, Math.floor(rng() * candidates.length));
  return candidates[idx];
}

// Пытается выдать карточку сразу по итогам сессии (шанс зависит от звёзд).
export function rollSessionCard(
  p: Progress,
  date: string,
  stars: number,
  rng: () => number = Math.random,
): Card | null {
  if (rng() >= cardChance(stars)) return null;
  const card = pickNewCard(p, rng);
  if (!card) return null;
  addCardWon(getDay(p, date), card.id);
  p.cards.push(card.id);
  return card;
}

// Гарантированная карточка (без шанса) — награда за прохождение бонусного раунда.
export function awardBonusCard(p: Progress, date: string, rng: () => number = Math.random): Card | null {
  const card = pickNewCard(p, rng);
  if (!card) return null;
  addCardWon(getDay(p, date), card.id);
  p.cards.push(card.id);
  return card;
}

// Для серии дней (streak) важно участие — 2+ сессии, ИЛИ пройденный бонусный раунд
// (даже если обычных сессий было меньше двух): бонусный раунд не должен стоить streak.
export function dayParticipated(day: DayRecord): boolean {
  return day.sessions >= 2 || Boolean(day.bonusRoundDone);
}

// Вызывается в вечернем запуске; отвечает только за серию дней и её награды —
// обычные карточки коллекции теперь выдаются per-session через rollSessionCard/awardBonusCard.
export function finishDay(p: Progress, date: string): { streakCard: Card | null } {
  const day = getDay(p, date);
  if (!dayParticipated(day)) {
    p.streak = 0;
    return { streakCard: null };
  }
  p.streak += 1;
  let streakCard: Card | null = null;
  const sc = STREAK_CARDS[p.streak];
  if (sc && !p.cards.includes(sc.id)) {
    p.cards.push(sc.id);
    streakCard = sc;
  }
  return { streakCard };
}

// Числитель и знаменатель дроби считаются из ОДНОГО пула (текущий сезон: коты + серии),
// иначе легаси-карточки прошлого сезона искажали бы прогресс — например, показывали бы
// "1 из 64" при нуле собранных котов, или даже "70 из 64" при полностью собранной новой
// коллекции вместе со старыми карточками (числитель превысил бы знаменатель).
export function collectionSummary(p: Progress): string {
  const activeIds = new Set([...CARDS, ...Object.values(STREAK_CARDS)].map((c) => c.id));
  const ownedActive = p.cards
    .filter((id) => activeIds.has(id))
    .map(cardById)
    .filter((c): c is Card => Boolean(c));
  const ownedLegacy = p.cards
    .filter((id) => !activeIds.has(id))
    .map(cardById)
    .filter((c): c is Card => Boolean(c));
  const totalCount = CARDS.length + Object.keys(STREAK_CARDS).length;

  const lines = [
    `🃏 Коллекция Александры: ${ownedActive.length} из ${totalCount} карточек`,
    `⭐ Всего звёзд: ${p.totalStars} | 🔥 Серия дней: ${p.streak}`,
  ];
  if (ownedActive.length === 0) lines.push("Пока пусто — но первая карточка уже близко!");
  else lines.push("", ...ownedActive.map((c) => `${c.emoji} ${c.name}`));
  if (ownedLegacy.length > 0) {
    lines.push("", `🎖️ Из прежней коллекции сохранено: ${ownedLegacy.length}`, ...ownedLegacy.map((c) => `${c.emoji} ${c.name}`));
  }
  return lines.join("\n");
}
