# Robo-Pets Math Trainer Bot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Telegram-бот на GitHub Actions, который 3 раза в день проводит для Александры игровую тренировку таблицы умножения/деления 2–9 с интервальным повторением, звёздами и коллекцией карточек робо-питомцев.

**Architecture:** Один запуск = одно окно тренировки: cron-джоб GitHub Actions отправляет приветствие, ведёт диалог через long-polling `getUpdates` до 25 минут, начисляет награды и коммитит `progress.json` обратно в репо. Логика сессии отделена от Telegram интерфейсом `SessionIO`, поэтому тестируется без сети.

**Tech Stack:** TypeScript, Node 20 (глобальный `fetch`/`FormData`), tsx, vitest, Telegram Bot API напрямую (без фреймворков), GitHub Actions.

**Репозиторий:** `~/Desktop/sasha-math-bot` (публичный на GitHub). Спека: `docs/superpowers/specs/2026-07-05-math-trainer-bot-design.md`.

---

## Структура файлов

- `src/state.ts` — типы прогресса, чтение/запись `progress.json`
- `src/facts.ts` — генерация 128 фактов (64 умножение + 64 деление), подсказки-приёмы
- `src/leitner.ts` — интервальное повторение: уровни, «должен повториться», выбор примеров
- `src/phrases.ts` — приветствия, похвалы, комбо-фразы, реакции на ошибку
- `src/cards.ts` — каталог карточек робо-питомцев + streak-карточки
- `src/rewards.ts` — звёзды, дневная цель, выдача карточек, сводка коллекции
- `src/session.ts` — цикл сессии поверх `SessionIO` (моками тестируется)
- `src/telegram.ts` — тонкий клиент Telegram API + `TelegramIO` (реализация `SessionIO`)
- `src/report.ts` — отчёт родителю
- `src/index.ts` — точка входа: слот (утро/день/вечер), сборка всего
- `.github/workflows/train.yml` — cron 07:00/11:00/14:00 UTC + ручной запуск
- `tests/*.test.ts` — vitest

---

### Task 1: Каркас проекта

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `tests/smoke.test.ts`

- [ ] **Step 1: Создать package.json**

```json
{
  "name": "sasha-math-bot",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "tsx src/index.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "tsx": "^4.16.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Создать tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "tests", "scripts"]
}
```

- [ ] **Step 3: Создать .gitignore**

```
node_modules/
.env
```

- [ ] **Step 4: Установить зависимости и проверить, что vitest работает**

Создать `tests/smoke.test.ts`:

```ts
import { expect, test } from "vitest";

test("smoke", () => {
  expect(1 + 1).toBe(2);
});
```

Run: `cd ~/Desktop/sasha-math-bot && npm install && npm test`
Expected: `1 passed`

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore tests/smoke.test.ts
git commit -m "chore: project scaffolding (tsx, vitest, strict TS)"
```

---

### Task 2: Состояние (`state.ts`)

**Files:**
- Create: `src/state.ts`
- Test: `tests/state.test.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/state.test.ts
import { expect, test } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyProgress, loadProgress, saveProgress, getDay } from "../src/state.js";

test("loadProgress returns empty progress when file is missing", () => {
  const p = loadProgress(join(mkdtempSync(join(tmpdir(), "smb-")), "progress.json"));
  expect(p).toEqual(emptyProgress());
});

test("saveProgress then loadProgress round-trips", () => {
  const path = join(mkdtempSync(join(tmpdir(), "smb-")), "progress.json");
  const p = emptyProgress();
  p.totalStars = 5;
  p.facts["7x8"] = { level: 2, lastSeen: "2026-07-05T10:00:00.000Z", correct: 3, wrong: 1 };
  saveProgress(path, p);
  expect(loadProgress(path)).toEqual(p);
});

test("getDay creates a day record once and reuses it", () => {
  const p = emptyProgress();
  const d1 = getDay(p, "2026-07-05");
  d1.stars = 3;
  const d2 = getDay(p, "2026-07-05");
  expect(d2.stars).toBe(3);
  expect(p.days).toHaveLength(1);
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run tests/state.test.ts`
Expected: FAIL — `Cannot find module '../src/state.js'`

- [ ] **Step 3: Реализовать `src/state.ts`**

```ts
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
```

- [ ] **Step 4: Прогнать тест**

Run: `npx vitest run tests/state.test.ts`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add src/state.ts tests/state.test.ts
git commit -m "feat: progress state load/save"
```

---

### Task 3: Факты и подсказки (`facts.ts`)

**Files:**
- Create: `src/facts.ts`
- Test: `tests/facts.test.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/facts.test.ts
import { expect, test } from "vitest";
import { allFacts } from "../src/facts.js";

test("generates 64 multiplication and 64 division facts with unique keys", () => {
  const facts = allFacts();
  expect(facts).toHaveLength(128);
  expect(new Set(facts.map((f) => f.key)).size).toBe(128);
});

test("multiplication fact is correct", () => {
  const f = allFacts().find((x) => x.key === "7x8")!;
  expect(f.question).toBe("7 × 8 = ?");
  expect(f.answer).toBe(56);
  expect(f.hint).toContain("5, 6, 7, 8");
});

test("division fact is correct and hints via multiplication", () => {
  const f = allFacts().find((x) => x.key === "56/8")!;
  expect(f.question).toBe("56 ÷ 8 = ?");
  expect(f.answer).toBe(7);
  expect(f.hint).toContain("8 × ? = 56");
});

test("every fact has a non-empty hint", () => {
  for (const f of allFacts()) expect(f.hint.length).toBeGreaterThan(10);
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run tests/facts.test.ts`
Expected: FAIL — `Cannot find module '../src/facts.js'`

- [ ] **Step 3: Реализовать `src/facts.ts`**

Ключ деления `"56/8"` уникален: делимое и делитель однозначно задают ответ.

```ts
export interface Fact {
  key: string; // "7x8" или "56/8"
  question: string; // "7 × 8 = ?"
  answer: number;
  hint: string;
}

export function allFacts(): Fact[] {
  const facts: Fact[] = [];
  for (let a = 2; a <= 9; a++) {
    for (let b = 2; b <= 9; b++) {
      facts.push({
        key: `${a}x${b}`,
        question: `${a} × ${b} = ?`,
        answer: a * b,
        hint: mulHint(a, b),
      });
      facts.push({
        key: `${a * b}/${b}`,
        question: `${a * b} ÷ ${b} = ?`,
        answer: a,
        hint: `Деление — это умножение наоборот: ${b} × ? = ${a * b}. Вспомни таблицу на ${b}!`,
      });
    }
  }
  return facts;
}

function mulHint(a: number, b: number): string {
  const [x, y] = a <= b ? [a, b] : [b, a];
  if (x === 7 && y === 8) return "Запоминалка: 5, 6, 7, 8 → 56 = 7 × 8!";
  if (x === 6 && y === 8) return "6 × 8: сначала 6 × 4 = 24, потом удвой → 48.";
  if (x === 6 && y === 7) return "Рифма: шестью семь — сорок два, помни это ты всегда!";
  if (y === 9) return `Приём для ×9: ${x} × 10 = ${x * 10}, теперь отними ${x}.`;
  if (y === 5 || x === 5) return "Приём для ×5: умножь на 10 и раздели пополам.";
  if (x === 4 || y === 4) return "Приём для ×4: удвой число, а потом удвой ещё раз.";
  if (x === 2) return `×2 — это просто удвоить: ${y} + ${y}.`;
  if (x === y) return `${x} × ${x} — квадрат! Вспомни соседа: ${x} × ${x - 1} = ${x * (x - 1)}, и прибавь ещё ${x}.`;
  return `Шаг назад: ${a} × ${b - 1} = ${a * (b - 1)}, теперь прибавь ещё ${a}.`;
}
```

- [ ] **Step 4: Прогнать тест**

Run: `npx vitest run tests/facts.test.ts`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add src/facts.ts tests/facts.test.ts
git commit -m "feat: multiplication/division facts with mnemonic hints"
```

---

### Task 4: Интервальное повторение (`leitner.ts`)

**Files:**
- Create: `src/leitner.ts`
- Test: `tests/leitner.test.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/leitner.test.ts
import { expect, test } from "vitest";
import { emptyProgress } from "../src/state.js";
import { allFacts } from "../src/facts.js";
import { applyResult, isDue, pickSessionFacts } from "../src/leitner.js";

const NOW = new Date("2026-07-05T10:00:00Z");

test("correct answer raises level (max 4), wrong lowers it (min 0)", () => {
  const p = emptyProgress();
  applyResult(p, "7x8", true, NOW);
  expect(p.facts["7x8"].level).toBe(1);
  applyResult(p, "7x8", false, NOW);
  applyResult(p, "7x8", false, NOW);
  expect(p.facts["7x8"].level).toBe(0);
  for (let i = 0; i < 10; i++) applyResult(p, "7x8", true, NOW);
  expect(p.facts["7x8"].level).toBe(4);
  expect(p.facts["7x8"].correct).toBe(11);
  expect(p.facts["7x8"].wrong).toBe(2);
});

test("isDue: unseen facts are due; level 2 is due after 3 days, not after 1", () => {
  expect(isDue(undefined, NOW)).toBe(true);
  const fp = { level: 2, lastSeen: "2026-07-04T10:00:00Z", correct: 1, wrong: 0 };
  expect(isDue(fp, NOW)).toBe(false); // прошёл 1 день, интервал уровня 2 — 3 дня
  expect(isDue(fp, new Date("2026-07-08T10:00:00Z"))).toBe(true);
});

test("pickSessionFacts returns requested count, weak facts included", () => {
  const p = emptyProgress();
  const facts = allFacts();
  // "западающий" факт: уровень 0, много ошибок, показан давно
  p.facts["7x8"] = { level: 0, lastSeen: "2026-06-01T10:00:00Z", correct: 0, wrong: 5 };
  // выученный факт: уровень 4, показан только что — не должен попасть
  p.facts["2x2"] = { level: 4, lastSeen: "2026-07-05T09:00:00Z", correct: 20, wrong: 0 };
  const picked = pickSessionFacts(p, facts, 10, NOW, () => 0.5);
  expect(picked).toHaveLength(10);
  expect(picked.map((f) => f.key)).toContain("7x8");
  expect(picked.map((f) => f.key)).not.toContain("2x2");
  expect(new Set(picked.map((f) => f.key)).size).toBe(10);
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run tests/leitner.test.ts`
Expected: FAIL — `Cannot find module '../src/leitner.js'`

- [ ] **Step 3: Реализовать `src/leitner.ts`**

```ts
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
```

- [ ] **Step 4: Прогнать тест**

Run: `npx vitest run tests/leitner.test.ts`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add src/leitner.ts tests/leitner.test.ts
git commit -m "feat: Leitner spaced repetition and session fact picker"
```

---

### Task 5: Фразы (`phrases.ts`)

**Files:**
- Create: `src/phrases.ts`
- Test: `tests/phrases.test.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/phrases.test.ts
import { expect, test } from "vitest";
import { GREETINGS, PRAISE, COMBO, WRONG, SECOND_TRY, pick } from "../src/phrases.js";

test("all phrase pools are non-empty", () => {
  for (const pool of [GREETINGS, PRAISE, WRONG, SECOND_TRY]) {
    expect(pool.length).toBeGreaterThanOrEqual(3);
  }
  expect(COMBO.length).toBeGreaterThanOrEqual(2);
});

test("pick is deterministic with a fixed rng", () => {
  expect(pick(["a", "b", "c"], () => 0)).toBe("a");
  expect(pick(["a", "b", "c"], () => 0.99)).toBe("c");
});

test("combo phrases include the combo number", () => {
  for (const fn of COMBO) expect(fn(4)).toContain("4");
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run tests/phrases.test.ts`
Expected: FAIL — `Cannot find module '../src/phrases.js'`

- [ ] **Step 3: Реализовать `src/phrases.ts`**

```ts
export function pick<T>(arr: readonly T[], rng: () => number = Math.random): T {
  return arr[Math.floor(rng() * arr.length)];
}

export const GREETINGS = [
  "🤖 Привет, Александра! Твой робо-питомец заряжен и готов к вылету!",
  "⚡ Александра, на связи штаб робо-питомцев! Пора на задание!",
  "🐾 Робо-котёнок мурлычет: без лучшего пилота задание не начать. Александра, ты с нами?",
  "🚀 Тревога-тревога! Вызываем пилота Александру на тренировочный вылет!",
  "💜 Александра, дроны уже разогрели моторы. Покажем им, кто тут гений математики?",
] as const;

export const PRAISE = [
  "Мощно, Александра! ⚡",
  "Точно в цель! 🎯",
  "Робо-питомец в восторге! 🤖💜",
  "Верно! Ты просто машина (в хорошем смысле)! 😎",
  "Есть! Дроны аплодируют винтами! 🚁",
] as const;

export const COMBO = [
  (n: number) => `🔥 КОМБО ×${n}! Так держать!`,
  (n: number) => `⚡⚡ Серия ${n} подряд! Дроны-убийцы нервно курят в ангаре!`,
  (n: number) => `🌟 ${n} подряд без промаха! Легенда!`,
] as const;

export const WRONG = [
  "Почти! Смотри, есть хитрость:",
  "Не беда, у робо-питомцев есть подсказка:",
  "Ничего страшного! Вот секретный приём:",
] as const;

export const SECOND_TRY = [
  "Есть! Со второй попытки — засчитано! 👏",
  "Вот это упорство! Получилось! 💪",
  "Да! Подсказка сработала, ты справилась! ✨",
] as const;
```

- [ ] **Step 4: Прогнать тест**

Run: `npx vitest run tests/phrases.test.ts`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add src/phrases.ts tests/phrases.test.ts
git commit -m "feat: motivational phrase pools"
```

---

### Task 6: Карточки (`cards.ts`)

**Files:**
- Create: `src/cards.ts`
- Test: `tests/cards.test.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/cards.test.ts
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
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run tests/cards.test.ts`
Expected: FAIL — `Cannot find module '../src/cards.js'`

- [ ] **Step 3: Реализовать `src/cards.ts`**

```ts
export type Rarity = "common" | "rare" | "legendary";

export interface Card {
  id: string;
  name: string;
  rarity: Rarity;
  emoji: string;
}

export const CARDS: Card[] = [
  { id: "c01", name: "Кибер-котёнок Байт", rarity: "common", emoji: "🐱⚡" },
  { id: "c02", name: "Дрон-щенок Пиксель", rarity: "common", emoji: "🐶🔧" },
  { id: "c03", name: "Робо-хомяк Болтик", rarity: "common", emoji: "🐹🔩" },
  { id: "c04", name: "Лазер-зайка Клик", rarity: "common", emoji: "🐰✨" },
  { id: "c05", name: "Турбо-ёжик Искра", rarity: "common", emoji: "🦔⚡" },
  { id: "c06", name: "Стальная мышка Чип", rarity: "common", emoji: "🐭💾" },
  { id: "c07", name: "Робо-утёнок Квак-3000", rarity: "common", emoji: "🦆🤖" },
  { id: "c08", name: "Кибер-черепашка Танк", rarity: "common", emoji: "🐢🛡️" },
  { id: "c09", name: "Дрон-попугай Эхо", rarity: "common", emoji: "🦜📡" },
  { id: "c10", name: "Робо-пингвин Айс", rarity: "common", emoji: "🐧❄️" },
  { id: "c11", name: "Механо-белка Гайка", rarity: "common", emoji: "🐿️🔧" },
  { id: "c12", name: "Кибер-жабка Прыг", rarity: "common", emoji: "🐸💚" },
  { id: "c13", name: "Робо-крабик Клешня", rarity: "common", emoji: "🦀⚙️" },
  { id: "c14", name: "Дрон-пчёлка Жужа", rarity: "common", emoji: "🐝🚁" },
  { id: "c15", name: "Стальной котик Винтик", rarity: "common", emoji: "🐈🔩" },
  { id: "c16", name: "Робо-мишка Терми", rarity: "common", emoji: "🐻🤖" },
  { id: "c17", name: "Кибер-щенок Вольт", rarity: "common", emoji: "🐕⚡" },
  { id: "c18", name: "Механическая сова Софа", rarity: "common", emoji: "🦉💡" },
  { id: "c19", name: "Робо-лиса Вспышка", rarity: "rare", emoji: "🦊⚡" },
  { id: "c20", name: "Мега-панда Сервер", rarity: "rare", emoji: "🐼💻" },
  { id: "c21", name: "Дрон-дельфин Сонар", rarity: "rare", emoji: "🐬📡" },
  { id: "c22", name: "Кибер-волк Рекс", rarity: "rare", emoji: "🐺🌙" },
  { id: "c23", name: "Робо-тигрёнок Байтс", rarity: "rare", emoji: "🐯⚙️" },
  { id: "c24", name: "Плазма-кошка Нова", rarity: "rare", emoji: "🐱🌟" },
  { id: "c25", name: "Дрон-орёл Радар", rarity: "rare", emoji: "🦅🛰️" },
  { id: "c26", name: "Робо-акула Мегабайт", rarity: "rare", emoji: "🦈💙" },
  { id: "c27", name: "Кибер-олень Рог-2000", rarity: "rare", emoji: "🦌✨" },
  { id: "c28", name: "Кибер-единорог Глюк", rarity: "legendary", emoji: "🦄💜" },
  { id: "c29", name: "Робо-дракон Терабайт", rarity: "legendary", emoji: "🐉🔥" },
  { id: "c30", name: "Призрачный дрон Юзи", rarity: "legendary", emoji: "👾💜" },
];

export const STREAK_CARDS: Record<number, Card> = {
  3: { id: "s03", name: "Бронзовый пропеллер — 3 дня подряд!", rarity: "rare", emoji: "🥉🚁" },
  7: { id: "s07", name: "Серебряное крыло — неделя подряд!", rarity: "rare", emoji: "🥈🕊️" },
  14: { id: "s14", name: "Золотой реактор — 2 недели подряд!", rarity: "legendary", emoji: "🥇⚡" },
  30: { id: "s30", name: "Алмазное ядро — месяц подряд!!!", rarity: "legendary", emoji: "💎🤖" },
};

const ALL: Card[] = [...CARDS, ...Object.values(STREAK_CARDS)];

export function cardById(id: string): Card | undefined {
  return ALL.find((c) => c.id === id);
}

export function rarityLabel(r: Rarity): string {
  return r === "legendary" ? "⭐ ЛЕГЕНДАРНАЯ ⭐" : r === "rare" ? "💠 редкая" : "🔹 обычная";
}
```

- [ ] **Step 4: Прогнать тест**

Run: `npx vitest run tests/cards.test.ts`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add src/cards.ts tests/cards.test.ts
git commit -m "feat: robo-pet card catalog with rarities and streak cards"
```

---

### Task 7: Награды (`rewards.ts`)

**Files:**
- Create: `src/rewards.ts`
- Test: `tests/rewards.test.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/rewards.test.ts
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
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run tests/rewards.test.ts`
Expected: FAIL — `Cannot find module '../src/rewards.js'`

- [ ] **Step 3: Реализовать `src/rewards.ts`**

```ts
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
```

- [ ] **Step 4: Прогнать тест**

Run: `npx vitest run tests/rewards.test.ts`
Expected: 7 passed

- [ ] **Step 5: Commit**

```bash
git add src/rewards.ts tests/rewards.test.ts
git commit -m "feat: stars, daily goal, card awards, streaks, collection"
```

---

### Task 8: Сессия (`session.ts`)

**Files:**
- Create: `src/session.ts`
- Test: `tests/session.test.ts`

Правила сессии:
- ответ цифрами; «стоп» разрешён после 5 отвеченных примеров;
- 1-я ошибка → подсказка + вторая попытка; верно со 2-й — засчитывается как ответ, но для Лейтнера это «ошибка» (факт придёт чаще); 2-я ошибка → показать ответ, пример вернётся в конец очереди один раз;
- «/коллекция» — показать коллекцию и продолжить;
- не-число → попросить цифры, попытка не тратится;
- таймаут до первого ответа → сессия «не состоялась»; таймаут позже → мягкое завершение с сохранением результата.

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/session.test.ts
import { expect, test } from "vitest";
import { emptyProgress } from "../src/state.js";
import { runSession, type SessionIO } from "../src/session.js";
import type { Fact } from "../src/facts.js";

function fact(key: string, q: string, answer: number): Fact {
  return { key, question: q, answer, hint: "подсказка-тест" };
}

function mockIO(replies: string[]) {
  const sent: string[] = [];
  let i = 0;
  const io: SessionIO = {
    async send(text) {
      sent.push(text);
    },
    async waitForReply() {
      return i < replies.length ? replies[i++] : null;
    },
  };
  return { io, sent };
}

const FACTS = [fact("2x3", "2 × 3 = ?", 6), fact("3x3", "3 × 3 = ?", 9)];
const rng = () => 0;

test("all correct: counts, combo praise, levels up", async () => {
  const p = emptyProgress();
  const { io, sent } = mockIO(["6", "9"]);
  const r = await runSession(io, p, FACTS, () => new Date(), rng);
  expect(r).toEqual({ answered: 2, correct: 2, finished: true });
  expect(p.facts["2x3"].level).toBe(1);
  expect(sent.join("\n")).toContain("2 × 3 = ?");
});

test("wrong then correct on 2nd try: hint shown, Leitner counts wrong, no requeue", async () => {
  const p = emptyProgress();
  const { io, sent } = mockIO(["5", "6", "9"]);
  const r = await runSession(io, p, FACTS, () => new Date(), rng);
  expect(r).toEqual({ answered: 2, correct: 1, finished: true });
  expect(sent.join("\n")).toContain("подсказка-тест");
  expect(p.facts["2x3"].wrong).toBe(1);
});

test("wrong twice: answer revealed, fact requeued once at the end", async () => {
  const p = emptyProgress();
  const { io, sent } = mockIO(["5", "5", "9", "6"]);
  const r = await runSession(io, p, FACTS, () => new Date(), rng);
  // 2x3 (двойная ошибка) + 3x3 (верно) + повтор 2x3 (верно)
  expect(r.answered).toBe(3);
  expect(r.correct).toBe(2);
  expect(sent.join("\n")).toContain("Правильный ответ: 6");
});

test("stop is refused before 5 answers, accepted after", async () => {
  const five = [
    fact("2x2", "2 × 2 = ?", 4), fact("2x3", "2 × 3 = ?", 6), fact("2x4", "2 × 4 = ?", 8),
    fact("2x5", "2 × 5 = ?", 10), fact("2x6", "2 × 6 = ?", 12), fact("2x7", "2 × 7 = ?", 14),
  ];
  const p = emptyProgress();
  const { io, sent } = mockIO(["стоп", "4", "6", "8", "10", "12", "стоп"]);
  const r = await runSession(io, p, five, () => new Date(), rng);
  expect(r).toEqual({ answered: 5, correct: 5, finished: true });
  expect(sent.join("\n")).toContain("Ещё 5");
});

test("non-numeric input asks for digits without wasting the attempt", async () => {
  const p = emptyProgress();
  const { io, sent } = mockIO(["не знаю", "6", "9"]);
  const r = await runSession(io, p, FACTS, () => new Date(), rng);
  expect(r).toEqual({ answered: 2, correct: 2, finished: true });
  expect(sent.join("\n")).toContain("цифрами");
});

test("timeout before any answer -> finished:false", async () => {
  const p = emptyProgress();
  const { io } = mockIO([]);
  const r = await runSession(io, p, FACTS, () => new Date(), rng);
  expect(r).toEqual({ answered: 0, correct: 0, finished: false });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run tests/session.test.ts`
Expected: FAIL — `Cannot find module '../src/session.js'`

- [ ] **Step 3: Реализовать `src/session.ts`**

```ts
import type { Fact } from "./facts.js";
import type { Progress } from "./state.js";
import { applyResult } from "./leitner.js";
import { collectionSummary } from "./rewards.js";
import { COMBO, GREETINGS, PRAISE, SECOND_TRY, WRONG, pick } from "./phrases.js";

export interface SessionIO {
  send(text: string): Promise<void>;
  // null = таймаут ожидания
  waitForReply(timeoutMs: number): Promise<string | null>;
}

export interface SessionResult {
  answered: number;
  correct: number; // верно с первой попытки
  finished: boolean; // false = не ответила ни разу
}

const REPLY_TIMEOUT_MS = 4 * 60 * 1000;
const MIN_TO_STOP = 5;

type Answer =
  | { kind: "correct" }
  | { kind: "second" }
  | { kind: "wrong" }
  | { kind: "stop" }
  | { kind: "timeout" };

export async function runSession(
  io: SessionIO,
  progress: Progress,
  facts: Fact[],
  now: () => Date = () => new Date(),
  rng: () => number = Math.random,
): Promise<SessionResult> {
  await io.send(
    pick(GREETINGS, rng) +
      `\n\nЗадание: ${facts.length} примеров. После ${MIN_TO_STOP} можно написать «стоп». Поехали! 🚀`,
  );

  const queue = [...facts];
  const retried = new Set<string>();
  let answered = 0;
  let correct = 0;
  let combo = 0;

  while (queue.length > 0) {
    const f = queue.shift()!;
    await io.send(`✏️ ${f.question}`);
    const a = await ask(io, progress, f, rng);

    if (a.kind === "timeout") {
      if (answered === 0) return { answered, correct, finished: false };
      await io.send("Кажется, ты убежала 🙂 Сохраняю результат — увидимся на следующей тренировке!");
      break;
    }
    if (a.kind === "stop") {
      if (answered >= MIN_TO_STOP) {
        await io.send("Окей, стоп так стоп! Ты молодец, что позанималась 💪");
        break;
      }
      await io.send(`Ещё ${MIN_TO_STOP - answered} примеров до «стоп» 🙂 Продолжаем!`);
      queue.unshift(f);
      continue;
    }

    answered++;
    if (a.kind === "correct") {
      correct++;
      combo++;
      applyResult(progress, f.key, true, now());
      let msg = pick(PRAISE, rng);
      if (combo >= 3) msg += "\n" + pick(COMBO, rng)(combo);
      await io.send(msg);
    } else {
      combo = 0;
      applyResult(progress, f.key, false, now());
      if (a.kind === "second") {
        await io.send(pick(SECOND_TRY, rng));
      } else if (!retried.has(f.key)) {
        retried.add(f.key);
        queue.push(f);
      }
    }
  }

  return { answered, correct, finished: true };
}

async function ask(io: SessionIO, progress: Progress, f: Fact, rng: () => number): Promise<Answer> {
  let attempt = 1;
  for (;;) {
    const reply = await io.waitForReply(REPLY_TIMEOUT_MS);
    if (reply === null) return { kind: "timeout" };
    const text = reply.trim().toLowerCase();
    if (text === "стоп" || text === "stop") return { kind: "stop" };
    if (text === "/коллекция" || text === "/collection") {
      await io.send(collectionSummary(progress));
      continue;
    }
    if (!/^\d+$/.test(text)) {
      await io.send("Напиши ответ цифрами 🙂 Например: 42");
      continue;
    }
    const num = Number(text);
    if (num === f.answer) return attempt === 1 ? { kind: "correct" } : { kind: "second" };
    if (attempt === 1) {
      attempt = 2;
      await io.send(`${pick(WRONG, rng)}\n💡 ${f.hint}\nПопробуй ещё раз!`);
    } else {
      await io.send(`Правильный ответ: ${f.answer}. Этот пример ещё вернётся — и ты его победишь! 💪`);
      return { kind: "wrong" };
    }
  }
}
```

- [ ] **Step 4: Прогнать тест**

Run: `npx vitest run tests/session.test.ts`
Expected: 6 passed

- [ ] **Step 5: Прогнать все тесты и typecheck**

Run: `npm test && npm run typecheck`
Expected: все зелёные, tsc без ошибок

- [ ] **Step 6: Commit**

```bash
git add src/session.ts tests/session.test.ts
git commit -m "feat: interactive session loop with hints, combo and stop rules"
```

---

### Task 9: Telegram-клиент (`telegram.ts`)

**Files:**
- Create: `src/telegram.ts`
- Test: `tests/telegram.test.ts`

Сетевые методы — тонкие обёртки (не тестируем сетью). Тестируем чистую функцию `nextReply`, которая выбирает первое подходящее сообщение из пачки updates.

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/telegram.test.ts
import { expect, test } from "vitest";
import { nextReply, type Update } from "../src/telegram.js";

function upd(id: number, chatId: number, text: string, dateSec: number): Update {
  return { update_id: id, message: { message_id: id, date: dateSec, text, chat: { id: chatId } } };
}

test("returns first message from the right chat and advances offset", () => {
  const updates = [upd(10, 999, "чужое", 1000), upd(11, 42, "6", 1000), upd(12, 42, "7", 1001)];
  const r = nextReply(updates, 42, 0);
  expect(r.text).toBe("6");
  expect(r.offset).toBe(13); // offset двигаем за всю пачку
});

test("ignores stale queued messages sent before the session window", () => {
  const updates = [upd(10, 42, "старое", 100), upd(11, 42, "свежее", 2000)];
  const r = nextReply(updates, 42, 1_000_000); // notBeforeMs = 1000 сек
  expect(r.text).toBe("свежее");
});

test("returns null text when nothing relevant", () => {
  const updates = [upd(10, 999, "чужое", 2000)];
  const r = nextReply(updates, 42, 0);
  expect(r.text).toBeNull();
  expect(r.offset).toBe(11);
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run tests/telegram.test.ts`
Expected: FAIL — `Cannot find module '../src/telegram.js'`

- [ ] **Step 3: Реализовать `src/telegram.ts`**

```ts
import { readFileSync } from "node:fs";
import type { SessionIO } from "./session.js";

const API = "https://api.telegram.org";

export interface Update {
  update_id: number;
  message?: { message_id: number; date: number; text?: string; chat: { id: number } };
}

export class Telegram {
  constructor(private token: string) {}

  private async call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${API}/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    const data = (await res.json()) as { ok: boolean; result: T; description?: string };
    if (!data.ok) throw new Error(`Telegram ${method}: ${data.description}`);
    return data.result;
  }

  async sendMessage(chatId: number | string, text: string): Promise<void> {
    await this.call("sendMessage", { chat_id: chatId, text });
  }

  async sendPhoto(chatId: number | string, filePath: string, caption: string): Promise<void> {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("caption", caption);
    form.append("photo", new Blob([readFileSync(filePath)]), "card.png");
    const res = await fetch(`${API}/bot${this.token}/sendPhoto`, { method: "POST", body: form });
    const data = (await res.json()) as { ok: boolean; description?: string };
    if (!data.ok) throw new Error(`Telegram sendPhoto: ${data.description}`);
  }

  getUpdates(offset: number, timeoutSec: number): Promise<Update[]> {
    return this.call("getUpdates", { offset, timeout: timeoutSec, allowed_updates: ["message"] });
  }
}

// Чистая функция: первое подходящее текстовое сообщение из пачки updates
export function nextReply(
  updates: Update[],
  chatId: number,
  notBeforeMs: number,
): { text: string | null; offset: number } {
  let offset = 0;
  let text: string | null = null;
  for (const u of updates) {
    offset = Math.max(offset, u.update_id + 1);
    if (text !== null) continue;
    const m = u.message;
    if (!m || m.chat.id !== chatId || !m.text) continue;
    if (m.date * 1000 < notBeforeMs) continue; // старое сообщение из очереди вне окна
    text = m.text;
  }
  return { text, offset };
}

export class TelegramIO implements SessionIO {
  private offset = 0;

  constructor(
    private tg: Telegram,
    private chatId: number,
    private startedAtMs: number,
    private deadlineMs: number,
  ) {}

  async send(text: string): Promise<void> {
    await this.tg.sendMessage(this.chatId, text);
  }

  async waitForReply(timeoutMs: number): Promise<string | null> {
    const until = Math.min(Date.now() + timeoutMs, this.deadlineMs);
    while (Date.now() < until) {
      const sec = Math.max(1, Math.min(50, Math.ceil((until - Date.now()) / 1000)));
      const updates = await this.tg.getUpdates(this.offset, sec);
      const r = nextReply(updates, this.chatId, this.startedAtMs - 60_000);
      if (r.offset > this.offset) this.offset = r.offset;
      if (r.text !== null) return r.text;
    }
    return null;
  }
}
```

- [ ] **Step 4: Прогнать тест**

Run: `npx vitest run tests/telegram.test.ts`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add src/telegram.ts tests/telegram.test.ts
git commit -m "feat: thin Telegram client and long-polling SessionIO"
```

---

### Task 10: Отчёт родителю (`report.ts`)

**Files:**
- Create: `src/report.ts`
- Test: `tests/report.test.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/report.test.ts
import { expect, test } from "vitest";
import { emptyProgress } from "../src/state.js";
import { recordSession } from "../src/rewards.js";
import { parentReport } from "../src/report.js";

test("report shows sessions, stars, streak and weak facts", () => {
  const p = emptyProgress();
  recordSession(p, "2026-07-05", 3);
  recordSession(p, "2026-07-05", 2);
  p.streak = 4;
  p.facts["7x8"] = { level: 0, lastSeen: null, correct: 1, wrong: 4 };
  p.facts["54/6"] = { level: 1, lastSeen: null, correct: 2, wrong: 2 };
  const text = parentReport(p, "2026-07-05");
  expect(text).toContain("2 из 3");
  expect(text).toContain("5");
  expect(text).toContain("7 × 8");
  expect(text).toContain("54 ÷ 6");
});

test("report without weak facts says so", () => {
  const p = emptyProgress();
  expect(parentReport(p, "2026-07-05")).toContain("Слабых мест не замечено");
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run tests/report.test.ts`
Expected: FAIL — `Cannot find module '../src/report.js'`

- [ ] **Step 3: Реализовать `src/report.ts`**

```ts
import type { Progress } from "./state.js";

export function parentReport(p: Progress, date: string): string {
  const day = p.days.find((d) => d.date === date);
  const weak = Object.entries(p.facts)
    .filter(([, f]) => f.wrong > 0 && f.level <= 1)
    .sort((a, b) => a[1].level - b[1].level || b[1].wrong - a[1].wrong)
    .slice(0, 3)
    .map(([k]) => k.replace("x", " × ").replace("/", " ÷ "));
  return [
    `📊 Отчёт за ${date}`,
    `Сессий: ${day?.sessions ?? 0} из 3, звёзд за день: ${day?.stars ?? 0} ⭐`,
    `Серия дней: ${p.streak} 🔥 | Карточек: ${p.cards.length}`,
    weak.length > 0 ? `Западают: ${weak.join(", ")}` : "Слабых мест не замечено 💪",
  ].join("\n");
}
```

- [ ] **Step 4: Прогнать тест**

Run: `npx vitest run tests/report.test.ts`
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add src/report.ts tests/report.test.ts
git commit -m "feat: daily parent report"
```

---

### Task 11: Точка входа (`index.ts`)

**Files:**
- Create: `src/index.ts`
- Test: `tests/index.test.ts`

`main()` не тестируем (сеть); тестируем чистые помощники `slotForHourUtc` и `localDate`.

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/index.test.ts
import { expect, test } from "vitest";
import { slotForHourUtc, localDate } from "../src/index.js";

test("slot detection by UTC hour", () => {
  expect(slotForHourUtc(7)).toBe("morning");
  expect(slotForHourUtc(11)).toBe("midday");
  expect(slotForHourUtc(14)).toBe("evening");
  expect(slotForHourUtc(20)).toBe("evening");
});

test("localDate formats Cyprus date as YYYY-MM-DD", () => {
  // 23:30 UTC 4 июля = 02:30 5 июля на Кипре (UTC+3 летом)
  expect(localDate(new Date("2026-07-04T23:30:00Z"))).toBe("2026-07-05");
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run tests/index.test.ts`
Expected: FAIL — `Cannot find module '../src/index.js'`

- [ ] **Step 3: Реализовать `src/index.ts`**

```ts
import { existsSync } from "node:fs";
import { allFacts } from "./facts.js";
import { pickSessionFacts } from "./leitner.js";
import { parentReport } from "./report.js";
import { dayGoalMet, finishDay, recordSession, starsForSession } from "./rewards.js";
import { rarityLabel, type Card } from "./cards.js";
import { runSession } from "./session.js";
import { getDay, loadProgress, saveProgress } from "./state.js";
import { Telegram, TelegramIO } from "./telegram.js";

export type Slot = "morning" | "midday" | "evening";

export function slotForHourUtc(h: number): Slot {
  if (h < 9) return "morning"; // cron 07:00 UTC = 10:00 Кипр
  if (h < 13) return "midday"; // cron 11:00 UTC = 14:00 Кипр
  return "evening"; // cron 14:00 UTC = 17:00 Кипр
}

export function localDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Nicosia",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

const NEXT_TIME: Record<Slot, string> = {
  morning: "сегодня в 14:00",
  midday: "сегодня в 17:00",
  evening: "завтра в 10:00",
};

const PROGRESS_PATH = "progress.json";
const QUESTIONS = 10;
const WINDOW_MINUTES = 25;

async function announceCard(tg: Telegram, chatId: number, card: Card, title: string): Promise<void> {
  const caption = `${title}\n${card.emoji} ${card.name}\nРедкость: ${rarityLabel(card.rarity)}`;
  const imagePath = `cards/${card.id}.png`;
  if (existsSync(imagePath)) await tg.sendPhoto(chatId, imagePath, caption);
  else await tg.sendMessage(chatId, `🃏 ${caption}`);
}

async function main(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = Number(process.env.CHILD_CHAT_ID);
  const parentChatId = process.env.PARENT_CHAT_ID ? Number(process.env.PARENT_CHAT_ID) : null;
  if (!token || !chatId) throw new Error("TELEGRAM_BOT_TOKEN and CHILD_CHAT_ID are required");

  const slotEnv = process.env.SESSION_SLOT as Slot | undefined;
  const slot: Slot = slotEnv || slotForHourUtc(new Date().getUTCHours());
  const date = localDate();

  const progress = loadProgress(PROGRESS_PATH);
  const facts = pickSessionFacts(progress, allFacts(), QUESTIONS, new Date());

  const tg = new Telegram(token);
  const startedAt = Date.now();
  const io = new TelegramIO(tg, chatId, startedAt, startedAt + WINDOW_MINUTES * 60_000);

  const result = await runSession(io, progress, facts);

  if (result.finished && result.answered > 0) {
    const stars = starsForSession(result.correct, result.answered);
    const day = recordSession(progress, date, stars);
    await io.send(
      `🏁 Итог: ${result.correct} из ${result.answered} верно!\n` +
        `${"⭐".repeat(stars)} +${stars} (за день: ${day.stars} ⭐)\n` +
        `Следующая тренировка ${NEXT_TIME[slot]} 🐾`,
    );
  } else if (!result.finished) {
    await tg.sendMessage(
      chatId,
      `Сегодня не вышло потренироваться — бывает! 🙂 Робо-питомцы будут ждать ${NEXT_TIME[slot]} 🐾`,
    );
  }

  if (slot === "evening") {
    const { card, streakCard } = finishDay(progress, date);
    if (card) await announceCard(tg, chatId, card, "🎉 Дневная цель выполнена! Новая карточка:");
    if (streakCard) await announceCard(tg, chatId, streakCard, `🔥 Серия ${progress.streak} дней! Особая награда:`);
    const day = getDay(progress, date);
    if (!dayGoalMet(day) && day.sessions > 0) {
      await tg.sendMessage(chatId, `Сегодня ${day.stars} ⭐ — чуть-чуть не хватило до карточки. Завтра получится! 💪`);
    }
    if (parentChatId) await tg.sendMessage(parentChatId, parentReport(progress, date));
  }

  saveProgress(PROGRESS_PATH, progress);
}

// Запускаем main только при прямом старте (не при импорте из тестов)
if (process.argv[1] && process.argv[1].endsWith("index.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Прогнать все тесты и typecheck**

Run: `npm test && npm run typecheck`
Expected: все тесты зелёные, tsc без ошибок

- [ ] **Step 5: Commit**

```bash
git add src/index.ts tests/index.test.ts
git commit -m "feat: entry point wiring slots, session, rewards and reports"
```

---

### Task 12: Workflow GitHub Actions и README

**Files:**
- Create: `.github/workflows/train.yml`, `README.md`

- [ ] **Step 1: Создать `.github/workflows/train.yml`**

```yaml
name: training

on:
  schedule:
    # 10:00, 14:00, 17:00 по Кипру (UTC+3 летом)
    - cron: "0 7,11,14 * * *"
  workflow_dispatch:
    inputs:
      slot:
        description: "morning | midday | evening"
        required: false

concurrency: training

permissions:
  contents: write

jobs:
  train:
    runs-on: ubuntu-latest
    timeout-minutes: 35
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm start
        env:
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          CHILD_CHAT_ID: ${{ secrets.CHILD_CHAT_ID }}
          PARENT_CHAT_ID: ${{ secrets.PARENT_CHAT_ID }}
          SESSION_SLOT: ${{ github.event.inputs.slot }}
      - name: Commit progress
        run: |
          git config user.name "robo-pets-bot"
          git config user.email "bot@users.noreply.github.com"
          git add progress.json
          if ! git diff --cached --quiet; then
            git commit -m "chore: progress $(date -u +%FT%H:%M)"
            git pull --rebase
            git push
          fi
```

- [ ] **Step 2: Создать README.md с инструкцией настройки**

```markdown
# Робо-питомцы 🤖🐾 — тренажёр таблицы умножения для Александры

Telegram-бот, который 3 раза в день (10:00, 14:00, 17:00 по Кипру) зовёт Александру
потренировать таблицу умножения и деления: 5–10 примеров, подсказки-приёмы,
интервальное повторение, звёзды и коллекция карточек робо-питомцев.

## Настройка

1. **Бот:** напишите [@BotFather](https://t.me/BotFather) → `/newbot` → получите `TELEGRAM_BOT_TOKEN`.
2. **Chat ID:** Александра (со своего аккаунта) отправляет боту `/start`.
   Затем откройте `https://api.telegram.org/bot<TOKEN>/getUpdates` — в ответе будет
   `message.chat.id`. Это `CHILD_CHAT_ID`. Свой `PARENT_CHAT_ID` узнайте так же
   (напишите боту со своего аккаунта) — на него приходят вечерние отчёты.
3. **GitHub:** запушьте репозиторий (публичный), в `Settings → Secrets and variables → Actions`
   добавьте `TELEGRAM_BOT_TOKEN`, `CHILD_CHAT_ID`, `PARENT_CHAT_ID`.
4. **Проверка:** вкладка Actions → workflow `training` → `Run workflow` (slot = `morning`).
   Бот должен написать приветствие в течение минуты.

## Как это работает

- GitHub Actions запускается по крону в 07:00 / 11:00 / 14:00 UTC и ждёт ответов
  до 25 минут (long polling). Вне окон бот не отвечает — время следующей тренировки
  указано в каждом сообщении.
- Прогресс хранится в `progress.json` и коммитится после каждой сессии.
- Дневная цель: 2+ сессии и 6+ звёзд → карточка робо-питомца. Серии дней дают
  особые карточки (3, 7, 14, 30 дней).
- Команды в чате: ответ цифрами, `стоп` (после 5 примеров), `/коллекция`.

## Разработка

- `npm test` — тесты (vitest), `npm run typecheck` — проверка типов.
- Ручной запуск локально: `TELEGRAM_BOT_TOKEN=... CHILD_CHAT_ID=... SESSION_SLOT=morning npm start`.
```

- [ ] **Step 3: Прогнать все тесты**

Run: `npm test && npm run typecheck`
Expected: всё зелёное

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/train.yml README.md
git commit -m "feat: GitHub Actions training schedule and setup docs"
```

---

### Task 13: Ручная end-to-end проверка (с участием Елены)

**Files:** нет новых (только секреты на GitHub)

- [ ] **Step 1: Создать бота у BotFather** — Елена получает `TELEGRAM_BOT_TOKEN` (имя боту, например, `RoboPetsMathBot`).
- [ ] **Step 2: Создать публичный репозиторий на GitHub и запушить** (`gh repo create sasha-math-bot --public --source . --push`).
- [ ] **Step 3: Добавить секреты** `TELEGRAM_BOT_TOKEN`, `CHILD_CHAT_ID` (сначала = мамин chat id для теста), `PARENT_CHAT_ID`.
- [ ] **Step 4: Запустить workflow вручную** (Actions → training → Run workflow, slot=`morning`) и пройти сессию с телефона: проверить приветствие, верный ответ, неверный ответ (подсказка + вторая попытка), «стоп» до/после 5 примеров, `/коллекция`, итог со звёздами.
- [ ] **Step 5: Запустить slot=`evening`**, добить дневную цель (2-я сессия) и проверить выдачу карточки и отчёт родителю.
- [ ] **Step 6: Проверить, что `progress.json` закоммитился** в репо после каждого запуска.
- [ ] **Step 7: Переключить `CHILD_CHAT_ID` на аккаунт Александры** (она пишет боту `/start`, id — через `getUpdates`).

---

### Task 14 (опционально, после запуска): Картинки карточек через Gemini

**Files:**
- Create: `scripts/generate-cards.ts`, `cards/*.png`

Бот уже умеет слать карточки текстом; картинки — чистое улучшение. Скрипт один раз генерирует PNG для каждой карточки из `CARDS`/`STREAK_CARDS` через Gemini API (ключ `GEMINI_API_KEY` уже есть у Елены от news-bot), кладёт в `cards/<id>.png`, коммитим в репо. Промпт: «cute chibi robot animal card, „Murder Drones" cartoon style, purple neon accents, <название>, kid-friendly, card frame». После генерации `announceCard` автоматически начнёт слать фото. Детали скрипта решить на месте (модель `gemini-2.0-flash-exp` image generation, как в news-bot).

---

## Порядок выполнения и зависимости

Task 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 (ручная) → 14 (опция).
Tasks 3–6 независимы друг от друга (все зависят от 2), но проще идти по порядку.
