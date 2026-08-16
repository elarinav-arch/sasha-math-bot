import { existsSync, readFileSync, writeFileSync } from "node:fs";

export interface FactProgress {
  level: number; // 0..4 (уровень Лейтнера)
  lastSeen: string | null; // ISO-время последнего показа
  correct: number;
  wrong: number;
}

export interface DayRecord {
  date: string; // YYYY-MM-DD (по Кипру)
  sessions: number;
  stars: number;
  cardsWon?: string[]; // id карточек, выигранных ЗА ЭТОТ ДЕНЬ (по одной за сессию — их может быть несколько)
  attemptedSlots?: string[]; // какие слоты дня уже запускались (дедуп частых тиков cron)
  bonusRoundDone?: boolean; // прошла бонусный раунд — гарантирует карточку, если за день не выпало ни одной
}

// Прогресс ОДНОГО ребёнка (было — весь progress.json; теперь один из многих в TeamState).
export interface ChildProgress {
  chatId: number;
  name: string; // Telegram first_name на момент /join
  joinedAt: string; // ISO-дата регистрации
  facts: Record<string, FactProgress>;
  days: DayRecord[];
  streak: number;
  cards: string[];
  totalStars: number;
}

export interface WeeklyGoal {
  weekStart: string; // YYYY-MM-DD понедельника текущей недели ("" — ещё не инициализирована)
  trophyAwarded: boolean;
}

export interface TeamState {
  children: Record<number, ChildProgress>; // ключ — chatId
  weeklyGoal: WeeklyGoal;
  trophyCards: string[]; // id полученных командой трофейных карточек (кумулятивно)
  lastEveningWrapUp?: string; // дата (YYYY-MM-DD), когда последний раз отправляли итоги недели/дня — дедуп
}

export function emptyChildProgress(chatId = 0, name = "", joinedAt = ""): ChildProgress {
  return { chatId, name, joinedAt, facts: {}, days: [], streak: 0, cards: [], totalStars: 0 };
}

export function emptyTeamState(): TeamState {
  return { children: {}, weeklyGoal: { weekStart: "", trophyAwarded: false }, trophyCards: [] };
}

export function loadTeamState(path: string): TeamState {
  if (!existsSync(path)) return emptyTeamState();
  return JSON.parse(readFileSync(path, "utf8")) as TeamState;
}

export function saveTeamState(path: string, team: TeamState): void {
  writeFileSync(path, JSON.stringify(team, null, 2) + "\n", "utf8");
}

export function getDay(child: ChildProgress, date: string): DayRecord {
  let day = child.days.find((d) => d.date === date);
  if (!day) {
    day = { date, sessions: 0, stars: 0 };
    child.days.push(day);
  }
  return day;
}

export function hasAttemptedSlot(day: DayRecord, slot: string): boolean {
  return (day.attemptedSlots ?? []).includes(slot);
}

export function markSlotAttempted(day: DayRecord, slot: string): void {
  const existing = day.attemptedSlots ?? [];
  day.attemptedSlots = existing.includes(slot) ? existing : [...existing, slot];
}

export function cardsWonToday(day: DayRecord): string[] {
  return day.cardsWon ?? [];
}

export function addCardWon(day: DayRecord, cardId: string): void {
  day.cardsWon = [...(day.cardsWon ?? []), cardId];
}
