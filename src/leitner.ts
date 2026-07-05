import type { Fact } from "./facts.js";
import type { FactProgress, Progress } from "./state.js";

// Интервалы повторения по уровням (дней)
const INTERVAL_DAYS = [0, 1, 3, 7, 14];

export function applyResult(p: Progress, key: string, correct: boolean, now: Date): void {
  let fp = p.facts[key];
  if (!fp) {
    fp = { level: 0, lastSeen: null, correct: 0, wrong: 0 };
    p.facts[key] = fp;
  }
  if (correct) {
    fp.level = Math.min(4, fp.level + 1);
    fp.correct++;
  } else {
    fp.level = Math.max(0, fp.level - 1);
    fp.wrong++;
  }
  fp.lastSeen = now.toISOString();
}

export function isDue(fp: FactProgress | undefined, now: Date): boolean {
  if (!fp || !fp.lastSeen) return true;
  const days = (now.getTime() - new Date(fp.lastSeen).getTime()) / 86_400_000;
  return days >= INTERVAL_DAYS[Math.min(fp.level, 4)];
}

// ~70% самых слабых из "созревших" + добор случайными для разнообразия
export function pickSessionFacts(
  p: Progress,
  all: Fact[],
  count: number,
  now: Date,
  rng: () => number = Math.random,
): Fact[] {
  const due = all.filter((f) => isDue(p.facts[f.key], now));
  // слабые вперёд: ниже уровень → больше ошибок → дольше не виделись
  due.sort((f1, f2) => {
    const a = p.facts[f1.key];
    const b = p.facts[f2.key];
    const byLevel = (a?.level ?? 0) - (b?.level ?? 0);
    if (byLevel !== 0) return byLevel;
    const byWrong = (b?.wrong ?? 0) - (a?.wrong ?? 0);
    if (byWrong !== 0) return byWrong;
    const ta = a?.lastSeen ? new Date(a.lastSeen).getTime() : 0;
    const tb = b?.lastSeen ? new Date(b.lastSeen).getTime() : 0;
    return ta - tb;
  });
  const picked = due.slice(0, Math.min(due.length, Math.ceil(count * 0.7)));
  const rest = all.filter((f) => !picked.includes(f) && isDue(p.facts[f.key], now));
  while (picked.length < count && rest.length > 0) {
    picked.push(rest.splice(Math.floor(rng() * rest.length), 1)[0]);
  }
  return shuffle(picked, rng);
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
