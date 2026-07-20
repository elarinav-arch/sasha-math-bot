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
  card: string | null; // id карточки, выданной за этот день
  attemptedSlots?: string[]; // какие слоты дня уже запускались (дедуп частых тиков cron)
  bonusRoundDone?: boolean; // прошла бонусный раунд — карточка засчитывается, даже если звёзд не хватило
}

export interface Progress {
  facts: Record<string, FactProgress>;
  days: DayRecord[];
  streak: number;
  cards: string[];
  totalStars: number;
}

export function emptyProgress(): Progress {
  return { facts: {}, days: [], streak: 0, cards: [], totalStars: 0 };
}

export function loadProgress(path: string): Progress {
  if (!existsSync(path)) return emptyProgress();
  return JSON.parse(readFileSync(path, "utf8")) as Progress;
}

export function saveProgress(path: string, p: Progress): void {
  writeFileSync(path, JSON.stringify(p, null, 2) + "\n", "utf8");
}

export function getDay(p: Progress, date: string): DayRecord {
  let day = p.days.find((d) => d.date === date);
  if (!day) {
    day = { date, sessions: 0, stars: 0, card: null };
    p.days.push(day);
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
