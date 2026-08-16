# Multi-Child Team Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the single-child math bot into a team of many children training simultaneously in one bot, with personal progress unchanged and a cooperative weekly team trophy on top.

**Architecture:** `Progress` (one child's state) is renamed to `ChildProgress` and wrapped in a new `TeamState` keyed by `chatId`. A single `TelegramPoller` owns the one `getUpdates` loop per job run (Telegram's offset is per-bot, not per-user) and routes incoming messages to whichever child session is currently awaiting a reply; `main()` runs all due children's sessions concurrently via `Promise.all`. Personal reward logic (`rollSessionCard`, `awardBonusCard`, `finishDay`, streak, Leitner) is untouched — it just runs once per child instead of once globally. A new weekly layer (`finishWeek`) aggregates stars across active children every Sunday evening and awards a shared trophy card from a separate pool.

**Tech Stack:** TypeScript, Node 20, vitest, existing GitHub Actions + cron-job.org scheduling (unchanged).

**Spec:** `docs/superpowers/specs/2026-08-16-multi-child-team-mode-design.md`

**⚠️ Important note on intermediate state:** `Progress` is renamed to `ChildProgress` in Task 2, which immediately breaks `src/index.ts` (it still imports the old `loadProgress`/`saveProgress`/`emptyProgress` names). `index.ts` is NOT rewired until Task 11. This is expected — `npm run typecheck` and `npm test` will fail on `index.ts`/its test between Task 2 and Task 11. Verify each task's own module with a **targeted** command (e.g. `npx vitest run tests/state.test.ts`), not the full suite, until Task 11. The full `npm test && npm run typecheck` gate is Task 13.

---

## File structure

- `src/calendar.ts` — NEW: pure date helpers (`localDate` moved here, `weekStartFor`, `addDays`, `isInWeek`)
- `src/state.ts` — MODIFY: `Progress` → `ChildProgress` (+ `chatId`/`name`/`joinedAt`), new `TeamState`/`WeeklyGoal`, team load/save
- `scripts/migrate-to-team.ts` — NEW: one-time script wrapping Alexandra's existing `progress.json` into `TeamState`
- `src/rewards.ts` — MODIFY: retype to `ChildProgress` (no logic change), add `weeklyStars`/`isActiveThisWeek`/`ensureCurrentWeek`/`finishWeek`
- `src/cards.ts` — MODIFY: add `TROPHY_CARDS` pool + `pickTrophyCard`
- `src/registration.ts` — NEW: `/join CODE` handling, pure and testable
- `src/telegram.ts` — MODIFY: `dispatchUpdates` (replaces `nextReply`), `TelegramPoller`, `PolledIO` (replaces `TelegramIO`)
- `src/report.ts` — MODIFY: `parentReport` → `teamReport` (team-level, replaces per-child report)
- `src/leitner.ts`, `src/session.ts` — MODIFY: type references only (`Progress` → `ChildProgress`)
- `src/index.ts` — MODIFY: full `main()` rewrite — registration wiring, concurrent per-child sessions via the poller, Sunday weekly wrap-up
- `.github/workflows/train.yml` — MODIFY: `CHILD_CHAT_ID` secret retired, `TEAM_INVITE_CODE` added

---

### Task 1: Calendar utilities

**Files:**
- Create: `src/calendar.ts`
- Test: `tests/calendar.test.ts`
- Modify: `src/index.ts:19-26` (remove `localDate`, will import from calendar.ts in Task 11 — for now just leave index.ts as-is, this task only adds the new module)

- [ ] **Step 1: Write the failing test**

```ts
// tests/calendar.test.ts
import { expect, test } from "vitest";
import { addDays, isInWeek, localDate, weekStartFor } from "../src/calendar.js";

test("localDate formats Cyprus date as YYYY-MM-DD", () => {
  // 23:30 UTC 4 июля = 02:30 5 июля на Кипре (UTC+3 летом)
  expect(localDate(new Date("2026-07-04T23:30:00Z"))).toBe("2026-07-05");
});

test("addDays shifts a YYYY-MM-DD string forward and backward, across month/year boundaries", () => {
  expect(addDays("2026-08-16", 1)).toBe("2026-08-17");
  expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
  expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
});

test("weekStartFor returns the Monday of the week containing the date", () => {
  // 2026-08-16 is a Sunday, 2026-08-17 is a Monday (verified via `date -d`)
  expect(weekStartFor("2026-08-16")).toBe("2026-08-10");
  expect(weekStartFor("2026-08-17")).toBe("2026-08-17");
  expect(weekStartFor("2026-08-20")).toBe("2026-08-17");
});

test("isInWeek checks a date falls within [weekStart, weekStart+6]", () => {
  expect(isInWeek("2026-08-17", "2026-08-17")).toBe(true); // первый день недели
  expect(isInWeek("2026-08-23", "2026-08-17")).toBe(true); // последний день (воскресенье)
  expect(isInWeek("2026-08-24", "2026-08-17")).toBe(false); // уже следующая неделя
  expect(isInWeek("2026-08-16", "2026-08-17")).toBe(false); // предыдущая неделя
});
```

- [ ] **Step 2: Verify the reference weekday used in the test above**

Run: `date -d 2026-08-16 +%A`
Expected: `Sunday` (if your `date` doesn't support `-d`, use `python3 -c "import datetime; print(datetime.date(2026,8,16).strftime('%A'))"`). If it prints something else, fix the `weekStartFor` test's expected values to match reality before continuing.

- [ ] **Step 3: Run test to verify it fails**

Run: `cd ~/Desktop/sasha-math-bot && npx vitest run tests/calendar.test.ts`
Expected: FAIL with `Cannot find module '../src/calendar.js'`

- [ ] **Step 4: Write minimal implementation**

```ts
// src/calendar.ts
export function localDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Nicosia",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

// Понедельник недели, к которой относится dateStr.
export function weekStartFor(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = dow === 0 ? 6 : dow - 1;
  return addDays(dateStr, -diffToMonday);
}

export function isInWeek(dateStr: string, weekStart: string): boolean {
  const end = addDays(weekStart, 6);
  return dateStr >= weekStart && dateStr <= end;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/calendar.test.ts`
Expected: 4 passed

- [ ] **Step 6: Commit**

```bash
cd ~/Desktop/sasha-math-bot
git add src/calendar.ts tests/calendar.test.ts
git commit -m "feat: add calendar utilities (localDate, weekStartFor, addDays, isInWeek)"
```

---

### Task 2: Rename Progress → ChildProgress, add TeamState wrapper

This is one atomic rename spanning every file that references `Progress`/`emptyProgress`/`loadProgress`/`saveProgress`. `emptyChildProgress` gets all-default parameters so the ~50 existing `emptyProgress()` test call sites only need a name change, not new arguments.

**Files:**
- Modify: `src/state.ts` (full rewrite of the type/function layer)
- Modify: `src/leitner.ts:7,31` (type reference only)
- Modify: `src/session.ts:33,95` (type reference only)
- Modify: `src/rewards.ts:12,33,59,73,89,109` (type reference only, no logic change)
- Modify: `src/report.ts:3` (type reference only — replaced wholesale in Task 10, this is a stopgap so it still compiles)
- Modify: `tests/state.test.ts`, `tests/rewards.test.ts`, `tests/leitner.test.ts`, `tests/session.test.ts`, `tests/report.test.ts` (rename `emptyProgress` → `emptyChildProgress`)
- Test: `tests/state.test.ts` (new tests for `ChildProgress`/`TeamState`)

- [ ] **Step 1: Write the new/changed tests for state.ts**

```ts
// tests/state.test.ts — REPLACE the whole file with this
import { expect, test } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  emptyChildProgress, emptyTeamState, loadTeamState, saveTeamState, getDay,
  hasAttemptedSlot, markSlotAttempted, cardsWonToday, addCardWon,
} from "../src/state.js";

test("emptyChildProgress defaults to placeholder identity fields", () => {
  const c = emptyChildProgress();
  expect(c).toEqual({ chatId: 0, name: "", joinedAt: "", facts: {}, days: [], streak: 0, cards: [], totalStars: 0 });
});

test("emptyChildProgress accepts an explicit identity", () => {
  const c = emptyChildProgress(42, "Саша", "2026-08-16T10:00:00.000Z");
  expect(c.chatId).toBe(42);
  expect(c.name).toBe("Саша");
  expect(c.joinedAt).toBe("2026-08-16T10:00:00.000Z");
});

test("loadTeamState returns empty team state when file is missing", () => {
  const p = loadTeamState(join(mkdtempSync(join(tmpdir(), "smb-")), "progress.json"));
  expect(p).toEqual(emptyTeamState());
});

test("saveTeamState then loadTeamState round-trips", () => {
  const path = join(mkdtempSync(join(tmpdir(), "smb-")), "progress.json");
  const team = emptyTeamState();
  team.children[42] = emptyChildProgress(42, "Саша", "2026-08-16T10:00:00.000Z");
  team.children[42].totalStars = 5;
  team.children[42].facts["7x8"] = { level: 2, lastSeen: "2026-07-05T10:00:00.000Z", correct: 3, wrong: 1 };
  saveTeamState(path, team);
  expect(loadTeamState(path)).toEqual(team);
});

test("getDay creates a day record once and reuses it", () => {
  const c = emptyChildProgress();
  const d1 = getDay(c, "2026-07-05");
  d1.stars = 3;
  const d2 = getDay(c, "2026-07-05");
  expect(d2.stars).toBe(3);
  expect(c.days).toHaveLength(1);
});

test("hasAttemptedSlot is false for a fresh day and for days without the field (legacy data)", () => {
  const c = emptyChildProgress();
  const day = getDay(c, "2026-07-05");
  expect(hasAttemptedSlot(day, "morning")).toBe(false);
  delete (day as { attemptedSlots?: string[] }).attemptedSlots;
  expect(hasAttemptedSlot(day, "morning")).toBe(false);
});

test("markSlotAttempted records a slot once and is idempotent", () => {
  const c = emptyChildProgress();
  const day = getDay(c, "2026-07-05");
  markSlotAttempted(day, "morning");
  expect(hasAttemptedSlot(day, "morning")).toBe(true);
  expect(hasAttemptedSlot(day, "midday")).toBe(false);
  markSlotAttempted(day, "morning");
  expect(day.attemptedSlots).toEqual(["morning"]);
});

test("cardsWonToday is empty for a fresh day and for legacy days without the field", () => {
  const c = emptyChildProgress();
  const day = getDay(c, "2026-07-05");
  expect(cardsWonToday(day)).toEqual([]);
});

test("addCardWon appends card ids won during the day (one card can be won per session)", () => {
  const c = emptyChildProgress();
  const day = getDay(c, "2026-07-05");
  addCardWon(day, "cat01");
  addCardWon(day, "cat02");
  expect(cardsWonToday(day)).toEqual(["cat01", "cat02"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/state.test.ts`
Expected: FAIL — `emptyChildProgress`/`emptyTeamState`/`loadTeamState`/`saveTeamState` not exported

- [ ] **Step 3: Rewrite state.ts**

```ts
// src/state.ts — full replacement
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
```

- [ ] **Step 4: Update leitner.ts's type references**

In `src/leitner.ts`, replace both occurrences of the type name:

```bash
sed -i '' 's/\bProgress\b/ChildProgress/g; s/from "\.\/state\.js"/from ".\/state.js"/' src/leitner.ts
```

Then fix the import line by hand — open `src/leitner.ts` and change:
```ts
import type { FactProgress, Progress } from "./state.js";
```
to:
```ts
import type { ChildProgress, FactProgress } from "./state.js";
```
(the `sed` above already renamed the two usages of `Progress` in function signatures to `ChildProgress`; this manual fix just cleans up the now-duplicated import line and ordering.)

- [ ] **Step 5: Update session.ts's type references**

Open `src/session.ts` and change:
```ts
import type { Progress } from "./state.js";
```
to:
```ts
import type { ChildProgress } from "./state.js";
```
Then replace both usages of `progress: Progress` (lines ~33 and ~95) with `progress: ChildProgress`.

- [ ] **Step 6: Update rewards.ts's type references (logic unchanged)**

Open `src/rewards.ts` and change the import line:
```ts
import { addCardWon, getDay, type DayRecord, type Progress } from "./state.js";
```
to:
```ts
import { addCardWon, getDay, type ChildProgress, type DayRecord } from "./state.js";
```
Then replace every `p: Progress` parameter type (in `recordSession`, `pickNewCard`, `rollSessionCard`, `awardBonusCard`, `finishDay`, `collectionSummary`) with `p: ChildProgress`. No other changes — function bodies stay exactly as they are.

- [ ] **Step 7: Update report.ts's type reference (stopgap — replaced in Task 10)**

Open `src/report.ts` and change:
```ts
import type { Progress } from "./state.js";

export function parentReport(p: Progress, date: string): string {
```
to:
```ts
import type { ChildProgress } from "./state.js";

export function parentReport(p: ChildProgress, date: string): string {
```

- [ ] **Step 8: Rename `emptyProgress` to `emptyChildProgress` in the remaining test files**

These four files only need the identifier renamed — no other changes:

```bash
cd ~/Desktop/sasha-math-bot
sed -i '' 's/emptyProgress/emptyChildProgress/g' tests/leitner.test.ts tests/rewards.test.ts tests/session.test.ts tests/report.test.ts
```

- [ ] **Step 9: Verify state.ts, leitner.ts, rewards.ts, session.ts, report.ts, and their tests compile and pass in isolation**

Run: `npx vitest run tests/state.test.ts tests/leitner.test.ts tests/rewards.test.ts tests/session.test.ts tests/report.test.ts`
Expected: all pass (report.test.ts and rewards.test.ts still reference the old `finishDay`/`parentReport` shapes, which haven't changed logic — only the type name did)

Run: `npx tsc --noEmit src/state.ts src/leitner.ts src/rewards.ts src/session.ts src/report.ts src/cards.ts src/facts.ts src/phrases.ts 2>&1 | grep -v "index.ts"`
Expected: no output (errors only in `index.ts`, which is expected and fixed in Task 11 — see the note at the top of this plan)

- [ ] **Step 10: Commit**

```bash
git add src/state.ts src/leitner.ts src/session.ts src/rewards.ts src/report.ts tests/state.test.ts tests/leitner.test.ts tests/rewards.test.ts tests/session.test.ts tests/report.test.ts
git commit -m "feat: rename Progress to ChildProgress, add TeamState wrapper

index.ts is intentionally left uncompiling by this commit — it's
rewired to the new API in a later task of this same plan."
```

---

### Task 3: One-time migration script for Alexandra's existing progress.json

**Files:**
- Create: `scripts/migrate-to-team.ts`

- [ ] **Step 1: Write the script**

```ts
// scripts/migrate-to-team.ts
// ОДНОРАЗОВЫЙ скрипт: оборачивает текущий плоский progress.json (прогресс одной
// Александры) в новую структуру TeamState. Запустить один раз перед первым
// деплоем командного режима: npx tsx scripts/migrate-to-team.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const PATH = "progress.json";
const ALEXANDRA_CHAT_ID = 7260953209;
const ALEXANDRA_NAME = "Александра";

function main(): void {
  if (!existsSync(PATH)) {
    console.log("progress.json не найден — нечего мигрировать.");
    return;
  }
  const old = JSON.parse(readFileSync(PATH, "utf8"));
  if (old.children) {
    console.log("Похоже, миграция уже выполнена (в файле уже есть team.children).");
    return;
  }
  const child = {
    chatId: ALEXANDRA_CHAT_ID,
    name: ALEXANDRA_NAME,
    joinedAt: new Date(0).toISOString(), // точная дата первой регистрации не сохранялась — историческая заглушка
    facts: old.facts ?? {},
    days: old.days ?? [],
    streak: old.streak ?? 0,
    cards: old.cards ?? [],
    totalStars: old.totalStars ?? 0,
  };
  const team = {
    children: { [ALEXANDRA_CHAT_ID]: child },
    weeklyGoal: { weekStart: "", trophyAwarded: false },
    trophyCards: [],
  };
  writeFileSync(PATH, JSON.stringify(team, null, 2) + "\n", "utf8");
  console.log("Миграция выполнена: Александра — первый ребёнок команды.");
}

main();
```

- [ ] **Step 2: Do NOT run it yet**

This script must run against the real `progress.json` exactly once, right before the new code is deployed (running it now, while `index.ts` still expects the old flat shape, would break the currently-live bot). Leave it uncommitted-but-ready; Task 13 runs it as the last step before pushing.

- [ ] **Step 3: Commit the script itself (not its effect)**

```bash
git add scripts/migrate-to-team.ts
git commit -m "chore: add one-time migration script to TeamState (not yet run)"
```

---

### Task 4: Weekly team helpers in rewards.ts

**Files:**
- Modify: `src/rewards.ts`
- Test: `tests/rewards.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/rewards.test.ts` (keep all existing tests, add these — also add `TeamState`/`emptyTeamState` to the state.js import):

```ts
// add to the import from "../src/state.js":
// import { emptyChildProgress, emptyTeamState, getDay, cardsWonToday } from "../src/state.js";
// add to the import from "../src/rewards.js":
// weeklyStars, isActiveThisWeek, ensureCurrentWeek,

test("weeklyStars sums a child's stars within the given week only", () => {
  const c = emptyChildProgress();
  recordSession(c, "2026-08-17", 3); // понедельник этой недели
  recordSession(c, "2026-08-23", 2); // воскресенье этой недели
  recordSession(c, "2026-08-24", 3); // уже следующая неделя — не должно попасть
  expect(weeklyStars(c, "2026-08-17")).toBe(5);
});

test("isActiveThisWeek is true only if a session happened within the week", () => {
  const c = emptyChildProgress();
  expect(isActiveThisWeek(c, "2026-08-17")).toBe(false);
  recordSession(c, "2026-08-20", 1);
  expect(isActiveThisWeek(c, "2026-08-17")).toBe(true);
  expect(isActiveThisWeek(c, "2026-08-24")).toBe(false); // другая неделя
});

test("ensureCurrentWeek resets the weekly goal when the stored week is stale", () => {
  const team = emptyTeamState();
  team.weeklyGoal = { weekStart: "2026-08-10", trophyAwarded: true };
  ensureCurrentWeek(team, "2026-08-17");
  expect(team.weeklyGoal).toEqual({ weekStart: "2026-08-17", trophyAwarded: false });
});

test("ensureCurrentWeek is a no-op when the stored week already matches", () => {
  const team = emptyTeamState();
  team.weeklyGoal = { weekStart: "2026-08-17", trophyAwarded: true };
  ensureCurrentWeek(team, "2026-08-17");
  expect(team.weeklyGoal).toEqual({ weekStart: "2026-08-17", trophyAwarded: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/rewards.test.ts`
Expected: FAIL — `weeklyStars`/`isActiveThisWeek`/`ensureCurrentWeek` not exported

- [ ] **Step 3: Implement in rewards.ts**

Add to `src/rewards.ts` (add `import { isInWeek } from "./calendar.js";` near the top, and add `type TeamState` to the existing `state.js` import):

```ts
export const WEEKLY_STARS_PER_CHILD = 20;

export function weeklyStars(child: ChildProgress, weekStart: string): number {
  return child.days.filter((d) => isInWeek(d.date, weekStart)).reduce((sum, d) => sum + d.stars, 0);
}

export function isActiveThisWeek(child: ChildProgress, weekStart: string): boolean {
  return child.days.some((d) => isInWeek(d.date, weekStart) && d.sessions > 0);
}

// Держит weeklyGoal привязанным к ТЕКУЩЕЙ неделе — сбрасывает счётчик, если
// сохранённая неделя устарела (первый вечерний запуск новой недели).
export function ensureCurrentWeek(team: TeamState, weekStart: string): void {
  if (team.weeklyGoal.weekStart !== weekStart) {
    team.weeklyGoal = { weekStart, trophyAwarded: false };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/rewards.test.ts`
Expected: all pass (existing + 4 new)

- [ ] **Step 5: Commit**

```bash
git add src/rewards.ts tests/rewards.test.ts
git commit -m "feat: weekly star aggregation helpers (weeklyStars, isActiveThisWeek, ensureCurrentWeek)"
```

---

### Task 5: Trophy cards + finishWeek

**Files:**
- Modify: `src/cards.ts`
- Modify: `src/rewards.ts`
- Test: `tests/cards.test.ts`, `tests/rewards.test.ts`

- [ ] **Step 1: Write the failing test for the trophy catalog**

Add to `tests/cards.test.ts`:

```ts
// add TROPHY_CARDS, pickTrophyCard to the import from "../src/cards.js"

test("TROPHY_CARDS is a small, uniquely-identified pool distinct from CARDS and LEGACY ids", () => {
  expect(TROPHY_CARDS.length).toBeGreaterThanOrEqual(8);
  const ids = TROPHY_CARDS.map((c) => c.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const c of TROPHY_CARDS) expect(c.id).toMatch(/^trophy\d+$/);
});

test("pickTrophyCard never returns an already-owned trophy and returns null when all owned", () => {
  expect(pickTrophyCard(TROPHY_CARDS.map((c) => c.id), () => 0)).toBeNull();
  expect(pickTrophyCard(TROPHY_CARDS.slice(1).map((c) => c.id), () => 0)!.id).toBe(TROPHY_CARDS[0].id);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cards.test.ts`
Expected: FAIL — `TROPHY_CARDS`/`pickTrophyCard` not exported

- [ ] **Step 3: Add the trophy catalog to cards.ts**

Add to `src/cards.ts`, after the `STREAK_CARDS` block and before `const ALL: Card[] = ...`:

```ts
// Командные трофеи — отдельный пул, выдаётся ТОЛЬКО за выполнение недельной командной
// цели (см. finishWeek в rewards.ts), никогда через обычный pickNewCard. Величественные
// коты, в отличие от милых питомцев в основной коллекции — подчёркивает особый статус.
export const TROPHY_CARDS: Card[] = [
  { id: "trophy01", name: "Снежный барс дружбы", rarity: "legendary", emoji: "🏆❄️", fact: "Команда справилась вместе — этот величественный барс достаётся всем!" },
  { id: "trophy02", name: "Огненный лев отряда", rarity: "legendary", emoji: "🏆🔥", fact: "Ни один герой не побеждает в одиночку — заслуга всей команды." },
  { id: "trophy03", name: "Штормовая пантера единства", rarity: "legendary", emoji: "🏆⚡", fact: "Вместе — быстрее и сильнее, чем поодиночке." },
  { id: "trophy04", name: "Золотой тигр недели", rarity: "legendary", emoji: "🏆🐯", fact: "Редчайшая награда — только за настоящую командную неделю." },
  { id: "trophy05", name: "Небесный рысь-страж", rarity: "legendary", emoji: "🏆🌤️", fact: "Наблюдает за командой сверху и гордится каждым участником." },
  { id: "trophy06", name: "Изумрудный ягуар отряда", rarity: "legendary", emoji: "🏆💚", fact: "Символ команды, которая не бросает друг друга." },
  { id: "trophy07", name: "Лунный волк-хранитель", rarity: "legendary", emoji: "🏆🌙", fact: "Ночью и днём — команда справляется вместе." },
  { id: "trophy08", name: "Сапфировый леопард удачи", rarity: "legendary", emoji: "🏆💙", fact: "Настоящая удача — это когда рядом надёжная команда." },
  { id: "trophy09", name: "Рубиновый феникс команды", rarity: "legendary", emoji: "🏆❤️", fact: "Даже если неделя была трудной — команда справилась и возродилась ярче." },
];

export function pickTrophyCard(ownedTrophyIds: string[], rng: () => number = Math.random): Card | null {
  const pool = TROPHY_CARDS.filter((c) => !ownedTrophyIds.includes(c.id));
  if (pool.length === 0) return null;
  return pool[Math.floor(rng() * pool.length)];
}
```

- [ ] **Step 4: Update `ALL` to include trophies (so cardById can resolve them for /коллекция-style lookups later)**

In `src/cards.ts`, change:
```ts
const ALL: Card[] = [...LEGACY_ROBO_PETS, ...CARDS, ...Object.values(STREAK_CARDS)];
```
to:
```ts
const ALL: Card[] = [...LEGACY_ROBO_PETS, ...CARDS, ...Object.values(STREAK_CARDS), ...TROPHY_CARDS];
```

- [ ] **Step 5: Run cards tests to verify they pass**

Run: `npx vitest run tests/cards.test.ts`
Expected: all pass

- [ ] **Step 6: Write the failing test for finishWeek**

Add to `tests/rewards.test.ts` (add `finishWeek` to the rewards.js import, `STREAK_CARDS` already imported from cards.js — add `TROPHY_CARDS` too):

```ts
test("finishWeek: goal not met when no child is active this week", () => {
  const team = emptyTeamState();
  const { goalMet, trophyCard } = finishWeek(team, "2026-08-17");
  expect(goalMet).toBe(false);
  expect(trophyCard).toBeNull();
});

test("finishWeek: goal scales with the number of active children, ignores inactive ones", () => {
  const team = emptyTeamState();
  team.children[1] = emptyChildProgress(1, "A", "");
  team.children[2] = emptyChildProgress(2, "B", "");
  team.children[3] = emptyChildProgress(3, "C", ""); // не тренировалась вовсе на этой неделе
  recordSession(team.children[1], "2026-08-17", 10);
  recordSession(team.children[1], "2026-08-18", 10); // 20 звёзд у A
  recordSession(team.children[2], "2026-08-17", 10);
  recordSession(team.children[2], "2026-08-18", 9); // 19 звёзд у B — итого 39, цель 2×20=40 (C не активна и не в счёт)
  expect(finishWeek(team, "2026-08-17", () => 0).goalMet).toBe(false);
  recordSession(team.children[2], "2026-08-19", 1); // добираем последнюю звезду — 40 из 40
  expect(finishWeek(team, "2026-08-17", () => 0).goalMet).toBe(true);
});

test("finishWeek awards a trophy card to the whole team and doesn't duplicate within the same week", () => {
  const team = emptyTeamState();
  team.children[1] = emptyChildProgress(1, "A", "");
  recordSession(team.children[1], "2026-08-17", 3);
  recordSession(team.children[1], "2026-08-18", 3);
  recordSession(team.children[1], "2026-08-19", 3);
  recordSession(team.children[1], "2026-08-20", 3);
  recordSession(team.children[1], "2026-08-21", 3);
  recordSession(team.children[1], "2026-08-22", 3);
  recordSession(team.children[1], "2026-08-23", 2); // 20 звёзд ровно, цель 1×20
  const first = finishWeek(team, "2026-08-17", () => 0);
  expect(first.goalMet).toBe(true);
  expect(first.trophyCard).not.toBeNull();
  expect(team.trophyCards).toContain(first.trophyCard!.id);
  // повторный вызов в ту же неделю — трофей уже выдан, не дублируется
  const second = finishWeek(team, "2026-08-17", () => 0);
  expect(second.trophyCard).toBeNull();
  expect(team.trophyCards).toHaveLength(1);
});

test("finishWeek returns trophyCard null (but goalMet true) once the whole trophy pool is exhausted", () => {
  const team = emptyTeamState();
  team.trophyCards = TROPHY_CARDS.map((c) => c.id); // весь пул уже собран
  team.children[1] = emptyChildProgress(1, "A", "");
  recordSession(team.children[1], "2026-08-17", 20);
  const { goalMet, trophyCard } = finishWeek(team, "2026-08-17", () => 0);
  expect(goalMet).toBe(true);
  expect(trophyCard).toBeNull();
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run tests/rewards.test.ts`
Expected: FAIL — `finishWeek` not exported

- [ ] **Step 8: Implement finishWeek in rewards.ts**

Add to `src/rewards.ts` (add `TROPHY_CARDS, pickTrophyCard` to the `./cards.js` import):

```ts
// Вечер воскресенья: считает командную неделю и при достижении цели выдаёт трофей
// ВСЕМ детям команды. Идемпотентно в пределах одной недели — повторный вызов
// (например, повторный тик cron) не выдаёт второй трофей.
export function finishWeek(
  team: TeamState,
  weekStart: string,
  rng: () => number = Math.random,
): { goalMet: boolean; trophyCard: Card | null } {
  ensureCurrentWeek(team, weekStart);
  const active = Object.values(team.children).filter((c) => isActiveThisWeek(c, weekStart));
  const total = active.reduce((sum, c) => sum + weeklyStars(c, weekStart), 0);
  const goal = active.length * WEEKLY_STARS_PER_CHILD;
  const goalMet = active.length > 0 && total >= goal;
  if (!goalMet) return { goalMet: false, trophyCard: null };
  if (team.weeklyGoal.trophyAwarded) return { goalMet: true, trophyCard: null };
  team.weeklyGoal.trophyAwarded = true;
  const trophy = pickTrophyCard(team.trophyCards, rng);
  if (trophy) team.trophyCards.push(trophy.id);
  return { goalMet: true, trophyCard: trophy };
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run tests/rewards.test.ts tests/cards.test.ts`
Expected: all pass

- [ ] **Step 10: Commit**

```bash
git add src/cards.ts src/rewards.ts tests/cards.test.ts tests/rewards.test.ts
git commit -m "feat: weekly team trophy (TROPHY_CARDS pool, pickTrophyCard, finishWeek)"
```

---

### Task 6: Registration (/join CODE)

**Files:**
- Create: `src/registration.ts`
- Test: `tests/registration.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/registration.test.ts
import { expect, test } from "vitest";
import { emptyTeamState } from "../src/state.js";
import { tryJoin } from "../src/registration.js";

const NOW = new Date("2026-08-16T12:00:00Z");

test("correct code registers a new child using their Telegram first name", () => {
  const team = emptyTeamState();
  const result = tryJoin(team, "/join SECRET42", "SECRET42", 100, "Саша", NOW);
  expect(result).toEqual({ kind: "welcome", name: "Саша" });
  expect(team.children[100]).toEqual({
    chatId: 100, name: "Саша", joinedAt: NOW.toISOString(),
    facts: {}, days: [], streak: 0, cards: [], totalStars: 0,
  });
});

test("wrong code does not register anyone", () => {
  const team = emptyTeamState();
  const result = tryJoin(team, "/join WRONG", "SECRET42", 100, "Саша", NOW);
  expect(result).toEqual({ kind: "wrong-code" });
  expect(team.children[100]).toBeUndefined();
});

test("text that isn't a /join command is treated as wrong-code (ignored)", () => {
  const team = emptyTeamState();
  expect(tryJoin(team, "привет!", "SECRET42", 100, "Саша", NOW)).toEqual({ kind: "wrong-code" });
});

test("an already-registered chatId gets a friendly already-member response, code not re-checked", () => {
  const team = emptyTeamState();
  tryJoin(team, "/join SECRET42", "SECRET42", 100, "Саша", NOW);
  const result = tryJoin(team, "/join WRONG-CODE-DOESNT-MATTER", "SECRET42", 100, "Саша", NOW);
  expect(result).toEqual({ kind: "already-member" });
});

test("/join is case-insensitive on the command itself but exact on the code", () => {
  const team = emptyTeamState();
  expect(tryJoin(team, "/JOIN SECRET42", "SECRET42", 100, "Саша", NOW).kind).toBe("welcome");
  expect(tryJoin(team, "/join secret42", "SECRET42", 200, "Саша", NOW).kind).toBe("wrong-code");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/registration.test.ts`
Expected: FAIL with `Cannot find module '../src/registration.js'`

- [ ] **Step 3: Implement registration.ts**

```ts
// src/registration.ts
import { emptyChildProgress, type TeamState } from "./state.js";

export type JoinResult =
  | { kind: "welcome"; name: string }
  | { kind: "already-member" }
  | { kind: "wrong-code" };

// Чистая функция (кроме мутации team при успехе) — легко тестируется без Telegram.
export function tryJoin(
  team: TeamState,
  text: string,
  expectedCode: string,
  chatId: number,
  firstName: string,
  now: Date,
): JoinResult {
  if (team.children[chatId]) return { kind: "already-member" };
  const match = text.trim().match(/^\/join\s+(\S+)$/i);
  if (!match || match[1] !== expectedCode) return { kind: "wrong-code" };
  team.children[chatId] = emptyChildProgress(chatId, firstName, now.toISOString());
  return { kind: "welcome", name: firstName };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/registration.test.ts`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add src/registration.ts tests/registration.test.ts
git commit -m "feat: /join CODE self-registration"
```

---

### Task 7: dispatchUpdates — pure multi-chat message routing

Replaces `nextReply` (which only ever picked one chat's messages out of a batch). `dispatchUpdates` delivers at most one message per chat per batch (same "first wins, rest of that batch dropped" semantics `nextReply` already had), tagged with the sender's chat and name.

**Files:**
- Modify: `src/telegram.ts`
- Test: `tests/telegram.test.ts`

- [ ] **Step 1: Write the failing test — REPLACE the `nextReply` tests with `dispatchUpdates` tests**

```ts
// tests/telegram.test.ts — replace the three existing nextReply tests with these
import { expect, test } from "vitest";
import { dispatchUpdates, type Update } from "../src/telegram.js";

function upd(id: number, chatId: number, text: string, dateSec: number, firstName?: string): Update {
  return {
    update_id: id,
    message: { message_id: id, date: dateSec, text, chat: { id: chatId }, from: firstName ? { first_name: firstName } : undefined },
  };
}

test("delivers one message per distinct chat in a batch, tagged with sender name", () => {
  const updates = [upd(10, 100, "6", 1000, "Саша"), upd(11, 200, "9", 1000, "Женя")];
  const r = dispatchUpdates(updates, 0);
  expect(r.offset).toBe(12);
  expect(r.delivered).toEqual([
    { chatId: 100, text: "6", fromName: "Саша" },
    { chatId: 200, text: "9", fromName: "Женя" },
  ]);
});

test("only the first message per chat in a batch is delivered, offset still advances past all of them", () => {
  const updates = [upd(10, 100, "6", 1000), upd(11, 100, "7", 1000)];
  const r = dispatchUpdates(updates, 0);
  expect(r.delivered).toEqual([{ chatId: 100, text: "6", fromName: "друг" }]);
  expect(r.offset).toBe(12);
});

test("ignores stale queued messages sent before notBeforeMs", () => {
  const updates = [upd(10, 100, "старое", 100), upd(11, 100, "свежее", 2000)];
  const r = dispatchUpdates(updates, 1_000_000); // notBeforeMs = 1000 сек
  expect(r.delivered).toEqual([{ chatId: 100, text: "свежее", fromName: "друг" }]);
});

test("messages without text are skipped, offset still advances", () => {
  const updates: Update[] = [{ update_id: 5, message: { message_id: 5, date: 100, chat: { id: 100 } } }];
  const r = dispatchUpdates(updates, 0);
  expect(r.delivered).toEqual([]);
  expect(r.offset).toBe(6);
});

test("empty batch returns offset 0 and no deliveries", () => {
  const r = dispatchUpdates([], 0);
  expect(r).toEqual({ offset: 0, delivered: [] });
});

test("missing sender name falls back to a friendly default", () => {
  const r = dispatchUpdates([upd(10, 100, "/join X", 1000)], 0);
  expect(r.delivered[0].fromName).toBe("друг");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/telegram.test.ts`
Expected: FAIL — `dispatchUpdates` not exported, and `Update.message` doesn't have `from`

- [ ] **Step 3: Update the `Update` interface and add `dispatchUpdates`, remove `nextReply`**

In `src/telegram.ts`, replace the `Update` interface and `nextReply` function:

```ts
export interface Update {
  update_id: number;
  message?: {
    message_id: number;
    date: number;
    text?: string;
    chat: { id: number };
    from?: { first_name?: string };
  };
}
```

```ts
export interface DeliveredMessage {
  chatId: number;
  text: string;
  fromName: string;
}

// Чистая функция: маршрутизирует пачку updates по разным чатам одновременно —
// не только один конкретный chatId, как раньше в nextReply, а сразу все.
// В пределах одной пачки от одного чата доставляется только первое сообщение
// (та же семантика, что была у nextReply — офсет всё равно продвигается за всю пачку).
export function dispatchUpdates(updates: Update[], notBeforeMs: number): { offset: number; delivered: DeliveredMessage[] } {
  let offset = 0;
  const seen = new Set<number>();
  const delivered: DeliveredMessage[] = [];
  for (const u of updates) {
    offset = Math.max(offset, u.update_id + 1);
    const m = u.message;
    if (!m?.text || seen.has(m.chat.id)) continue;
    if (m.date * 1000 < notBeforeMs) continue; // старое сообщение из очереди вне окна
    seen.add(m.chat.id);
    delivered.push({ chatId: m.chat.id, text: m.text, fromName: m.from?.first_name ?? "друг" });
  }
  return { offset, delivered };
}
```

Also delete the entire `TelegramIO` class from `src/telegram.ts` in this same step — it only exists to call `nextReply` in a loop, so it cannot compile once `nextReply` is gone, and it's fully superseded by `PolledIO` (added in Task 9) anyway. After deleting it, `src/telegram.ts` should end right after the new `dispatchUpdates` function. Leave the `Telegram` class untouched (still has `sendMessage`/`sendPhoto`/`getUpdates`).

Also delete `TelegramIO`'s own test from `tests/telegram.test.ts` — the one titled `"extendDeadline sets a fresh deadline relative to now, not additive on the stale original"` that constructs `new TelegramIO(...)`. It's superseded by an equivalent test for `PolledIO` in Task 9.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/telegram.test.ts`
Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
git add src/telegram.ts tests/telegram.test.ts
git commit -m "feat: dispatchUpdates routes a getUpdates batch to multiple chats at once

Replaces nextReply/TelegramIO's single-chat model — needed so one
TelegramPoller (added next) can serve every child's session concurrently
instead of each session polling independently."
```

---

### Task 8: TelegramPoller — the shared getUpdates loop

**Files:**
- Modify: `src/telegram.ts`
- Test: `tests/telegram.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/telegram.test.ts` (add `TelegramPoller` to the import, add `import { vi } from "vitest";`, and `import type { Telegram } from "../src/telegram.js";`):

```ts
function fakeTelegram(getUpdates: () => Promise<Update[]>): Telegram {
  return { getUpdates } as unknown as Telegram;
}

test("pollOnce resolves a waiting child's promise when their message arrives", async () => {
  const tg = fakeTelegram(async () => [upd(1, 42, "6", 1000)]);
  const poller = new TelegramPoller(tg, 0); // startedAtMs=0 — сообщение с датой 1000с не покажется устаревшим
  const waitPromise = poller.waitFor(42, 5000);
  await poller.pollOnce(() => {});
  expect(await waitPromise).toBe("6");
});

test("pollOnce routes messages from chats with no active waiter to onUnmatched", async () => {
  const tg = fakeTelegram(async () => [upd(1, 999, "/join ABC", 1000)]);
  const poller = new TelegramPoller(tg, 0);
  const unmatched: { chatId: number; text: string; fromName: string }[] = [];
  await poller.pollOnce((msg) => unmatched.push(msg));
  expect(unmatched).toEqual([{ chatId: 999, text: "/join ABC", fromName: "друг" }]);
});

test("waitFor resolves null if no matching message arrives before the timeout", async () => {
  vi.useFakeTimers();
  const tg = fakeTelegram(async () => []);
  const poller = new TelegramPoller(tg, 0);
  const p = poller.waitFor(42, 100);
  vi.advanceTimersByTime(150);
  expect(await p).toBeNull();
  vi.useRealTimers();
});

test("send delegates to the underlying Telegram client", async () => {
  const sent: { chatId: number | string; text: string }[] = [];
  const tg = { getUpdates: async () => [], sendMessage: async (chatId: number | string, text: string) => { sent.push({ chatId, text }); } } as unknown as Telegram;
  const poller = new TelegramPoller(tg, 0);
  await poller.send(42, "привет");
  expect(sent).toEqual([{ chatId: 42, text: "привет" }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/telegram.test.ts`
Expected: FAIL — `TelegramPoller` not exported

- [ ] **Step 3: Implement TelegramPoller**

Add to `src/telegram.ts` (after `dispatchUpdates`):

```ts
// Единственный объект за весь запуск джобы, который реально вызывает getUpdates.
// Telegram даёт long-polling offset НА ВЕСЬ БОТ, а не на пользователя — если бы
// каждая детская сессия сама опрашивала Telegram, они бы путали друг другу offset.
// Вместо этого сессии регистрируют ожидание через waitFor(chatId, ...), а поллер
// раздаёт пришедшие сообщения нужным ожидающим (см. PolledIO — тонкая обёртка
// вокруг этого класса, реализующая интерфейс SessionIO для одного ребёнка).
export class TelegramPoller {
  private offset = 0;
  private waiters = new Map<number, (text: string) => void>();
  private stopped = false;

  constructor(
    private tg: Telegram,
    private startedAtMs: number = Date.now(),
  ) {}

  async pollOnce(onUnmatched: (msg: DeliveredMessage) => void): Promise<void> {
    const updates = await this.tg.getUpdates(this.offset, 20);
    const { offset, delivered } = dispatchUpdates(updates, this.startedAtMs - 60_000);
    if (offset > this.offset) this.offset = offset;
    for (const msg of delivered) {
      const resolve = this.waiters.get(msg.chatId);
      if (resolve) {
        this.waiters.delete(msg.chatId);
        resolve(msg.text);
      } else {
        onUnmatched(msg);
      }
    }
  }

  async run(onUnmatched: (msg: DeliveredMessage) => void): Promise<void> {
    while (!this.stopped) await this.pollOnce(onUnmatched);
  }

  stop(): void {
    this.stopped = true;
  }

  waitFor(chatId: number, timeoutMs: number): Promise<string | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(chatId);
        resolve(null);
      }, timeoutMs);
      this.waiters.set(chatId, (text) => {
        clearTimeout(timer);
        resolve(text);
      });
    });
  }

  send(chatId: number, text: string): Promise<void> {
    return this.tg.sendMessage(chatId, text);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/telegram.test.ts`
Expected: 10 passed

- [ ] **Step 5: Commit**

```bash
git add src/telegram.ts tests/telegram.test.ts
git commit -m "feat: TelegramPoller — single shared getUpdates loop for all children"
```

---

### Task 9: PolledIO — per-child SessionIO backed by the shared poller

**Files:**
- Modify: `src/telegram.ts`
- Test: `tests/telegram.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/telegram.test.ts` (add `PolledIO` to the import):

```ts
test("PolledIO.send delegates to the poller for its own chatId", async () => {
  const sent: { chatId: number | string; text: string }[] = [];
  const tg = { getUpdates: async () => [], sendMessage: async (chatId: number | string, text: string) => { sent.push({ chatId, text }); } } as unknown as Telegram;
  const poller = new TelegramPoller(tg, 0);
  const io = new PolledIO(poller, 42, Date.now() + 60_000);
  await io.send("привет");
  expect(sent).toEqual([{ chatId: 42, text: "привет" }]);
});

test("PolledIO.waitForReply resolves via the poller when a matching message is dispatched", async () => {
  const tg = fakeTelegram(async () => [upd(1, 42, "6", 1000)]);
  const poller = new TelegramPoller(tg, 0);
  const io = new PolledIO(poller, 42, Date.now() + 60_000);
  const replyPromise = io.waitForReply(5000);
  await poller.pollOnce(() => {});
  expect(await replyPromise).toBe("6");
});

test("PolledIO.waitForReply returns null once the per-child deadline has passed, even with time left on timeoutMs", async () => {
  vi.useFakeTimers();
  const tg = fakeTelegram(async () => []);
  const poller = new TelegramPoller(tg, 0);
  const io = new PolledIO(poller, 42, Date.now() + 50); // дедлайн через 50мс
  const p = io.waitForReply(5000); // просит подождать 5с, но дедлайн раньше
  vi.advanceTimersByTime(100);
  expect(await p).toBeNull();
  vi.useRealTimers();
});

test("PolledIO.extendDeadline resets the deadline relative to now, not additive on the stale original", () => {
  const tg = fakeTelegram(async () => []);
  const poller = new TelegramPoller(tg, 0);
  const io = new PolledIO(poller, 42, 1_000_000); // старый дедлайн — в прошлом
  const before = Date.now();
  io.extendDeadline(20 * 60_000);
  const deadline = (io as unknown as { deadlineMs: number }).deadlineMs;
  expect(deadline).toBeGreaterThanOrEqual(before + 20 * 60_000 - 1000);
  expect(deadline).toBeLessThanOrEqual(before + 20 * 60_000 + 1000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/telegram.test.ts`
Expected: FAIL — `PolledIO` not exported

- [ ] **Step 3: Implement PolledIO**

Add to `src/telegram.ts` (needs `import type { SessionIO } from "./session.js";` at the top — add it):

```ts
// Реализация SessionIO для ОДНОГО ребёнка поверх общего TelegramPoller — сама
// не опрашивает Telegram, а просто регистрирует ожидание у поллера.
export class PolledIO implements SessionIO {
  private deadlineMs: number;

  constructor(
    private poller: TelegramPoller,
    private chatId: number,
    deadlineMs: number,
  ) {
    this.deadlineMs = deadlineMs;
  }

  send(text: string): Promise<void> {
    return this.poller.send(this.chatId, text);
  }

  extendDeadline(extraMs: number): void {
    this.deadlineMs = Date.now() + extraMs;
  }

  async waitForReply(timeoutMs: number): Promise<string | null> {
    const remaining = Math.min(timeoutMs, this.deadlineMs - Date.now());
    if (remaining <= 0) return null;
    return this.poller.waitFor(this.chatId, remaining);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/telegram.test.ts`
Expected: 14 passed

- [ ] **Step 5: Verify telegram.ts now compiles standalone (TelegramIO/nextReply are fully gone)**

Run: `npx tsc --noEmit src/telegram.ts src/session.ts src/state.ts 2>&1 | grep -v "index.ts"`
Expected: no output

- [ ] **Step 6: Commit**

```bash
git add src/telegram.ts tests/telegram.test.ts
git commit -m "feat: PolledIO — per-child SessionIO backed by the shared TelegramPoller"
```

---

### Task 10: teamReport replaces parentReport

**Files:**
- Modify: `src/report.ts` (full rewrite)
- Modify: `tests/report.test.ts` (full rewrite)

- [ ] **Step 1: Write the failing test — replace tests/report.test.ts entirely**

```ts
// tests/report.test.ts — full replacement
import { expect, test } from "vitest";
import { emptyChildProgress, emptyTeamState } from "../src/state.js";
import { recordSession } from "../src/rewards.js";
import { teamReport } from "../src/report.js";

test("teamReport summarizes today's and this week's team activity", () => {
  const team = emptyTeamState();
  team.children[1] = emptyChildProgress(1, "Саша", "");
  team.children[2] = emptyChildProgress(2, "Женя", "");
  recordSession(team.children[1], "2026-08-17", 3);
  recordSession(team.children[1], "2026-08-17", 2);
  recordSession(team.children[2], "2026-08-17", 1);
  team.trophyCards = ["trophy01"];
  const text = teamReport(team, "2026-08-17", "2026-08-17");
  expect(text).toContain("Детей в команде: 2");
  expect(text).toContain("тренировались сегодня: 2");
  expect(text).toContain("2 сессий, 6 ⭐"); // сегодня: 2 сессии у Саши + 1 у Жени = 3... см. ниже
});

test("teamReport counts today's sessions and stars across all children", () => {
  const team = emptyTeamState();
  team.children[1] = emptyChildProgress(1, "Саша", "");
  team.children[2] = emptyChildProgress(2, "Женя", "");
  recordSession(team.children[1], "2026-08-17", 3); // 1 сессия, 3 звезды
  recordSession(team.children[2], "2026-08-17", 2); // 1 сессия, 2 звезды
  const text = teamReport(team, "2026-08-17", "2026-08-17");
  expect(text).toContain("2 сессий, 5 ⭐");
});

test("teamReport shows weekly progress toward the goal, scaled by active children", () => {
  const team = emptyTeamState();
  team.children[1] = emptyChildProgress(1, "Саша", "");
  recordSession(team.children[1], "2026-08-17", 5);
  const text = teamReport(team, "2026-08-17", "2026-08-17");
  expect(text).toContain("5 из 20 ⭐"); // 1 активный ребёнок × 20
});

test("teamReport with an empty team doesn't crash and shows zeros", () => {
  const team = emptyTeamState();
  const text = teamReport(team, "2026-08-17", "2026-08-17");
  expect(text).toContain("Детей в команде: 0");
  expect(text).toContain("0 из 0 ⭐");
});
```

- [ ] **Step 2: Fix the first test's assertion (it was intentionally imprecise while drafting — the real total is 3 sessions/6 stars)**

Before running, fix the first test in the file above: it has `recordSession(team.children[1], "2026-08-17", 3)` then `recordSession(team.children[1], "2026-08-17", 2)` (2 sessions for child 1) plus 1 session for child 2 = 3 sessions total, 3+2+1=6 stars. Change its assertion line to:
```ts
  expect(text).toContain("3 сессий, 6 ⭐");
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/report.test.ts`
Expected: FAIL — `Cannot find module` for `teamReport` (parentReport still exists but nothing here imports it)

- [ ] **Step 4: Rewrite report.ts**

```ts
// src/report.ts — full replacement
import { weeklyStars, isActiveThisWeek, WEEKLY_STARS_PER_CHILD } from "./rewards.js";
import type { TeamState } from "./state.js";

export function teamReport(team: TeamState, date: string, weekStart: string): string {
  const children = Object.values(team.children);
  const todaySessions = children.reduce((sum, c) => sum + (c.days.find((d) => d.date === date)?.sessions ?? 0), 0);
  const todayStars = children.reduce((sum, c) => sum + (c.days.find((d) => d.date === date)?.stars ?? 0), 0);
  const activeToday = children.filter((c) => (c.days.find((d) => d.date === date)?.sessions ?? 0) > 0).length;
  const activeThisWeek = children.filter((c) => isActiveThisWeek(c, weekStart));
  const weekTotal = activeThisWeek.reduce((sum, c) => sum + weeklyStars(c, weekStart), 0);
  const weekGoal = activeThisWeek.length * WEEKLY_STARS_PER_CHILD;

  return [
    `📊 Командный отчёт за ${date}`,
    `Детей в команде: ${children.length}, тренировались сегодня: ${activeToday}`,
    `Сегодня: ${todaySessions} сессий, ${todayStars} ⭐`,
    `Неделя: ${weekTotal} из ${weekGoal} ⭐ (${activeThisWeek.length} активных)`,
    `Трофеев у команды: ${team.trophyCards.length}`,
  ].join("\n");
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/report.test.ts`
Expected: 4 passed

- [ ] **Step 6: Commit**

```bash
git add src/report.ts tests/report.test.ts
git commit -m "feat: teamReport replaces per-child parentReport"
```

---

### Task 11: index.ts rewrite — concurrent multi-child orchestration

This is where every prior task's pieces get wired together. `index.ts` finally compiles again after this task.

**Files:**
- Modify: `src/index.ts` (full rewrite)
- Modify: `tests/index.test.ts`

- [ ] **Step 1: Update tests/index.test.ts's import (localDate moved to calendar.ts)**

```ts
// tests/index.test.ts — full replacement
import { expect, test } from "vitest";
import { activeSlot } from "../src/index.js";

test("activeSlot covers contiguous windows with no gaps between them", () => {
  expect(activeSlot(new Date("2026-07-05T11:00:00Z"))).toBe("morning"); // 14:00 Кипр
  expect(activeSlot(new Date("2026-07-05T13:59:00Z"))).toBe("morning"); // 16:59 Кипр
  expect(activeSlot(new Date("2026-07-05T14:00:00Z"))).toBe("midday"); // 17:00 Кипр — граница
  expect(activeSlot(new Date("2026-07-05T15:59:00Z"))).toBe("midday"); // 18:59 Кипр
  expect(activeSlot(new Date("2026-07-05T16:00:00Z"))).toBe("evening"); // 19:00 Кипр — граница
  expect(activeSlot(new Date("2026-07-05T18:59:00Z"))).toBe("evening"); // 21:59 Кипр
});

test("activeSlot returns null before 14:00 and after 22:00 Кипр (ночь, отдых)", () => {
  expect(activeSlot(new Date("2026-07-05T09:00:00Z"))).toBeNull(); // 12:00 Кипр
  expect(activeSlot(new Date("2026-07-05T19:00:00Z"))).toBeNull(); // 22:00 Кипр
  expect(activeSlot(new Date("2026-07-05T23:00:00Z"))).toBeNull(); // 02:00 Кипр (ночь)
});
```

(the `localDate` test moved to `tests/calendar.test.ts` in Task 1 — it's not duplicated here)

- [ ] **Step 2: Rewrite index.ts**

```ts
// src/index.ts — full replacement
import { existsSync } from "node:fs";
import { allFacts } from "./facts.js";
import { localDate, weekStartFor } from "./calendar.js";
import { pickSessionFacts } from "./leitner.js";
import { teamReport } from "./report.js";
import {
  awardBonusCard, ensureCurrentWeek, finishDay, finishWeek, recordSession, rollSessionCard, starsForSession,
} from "./rewards.js";
import { rarityLabel, type Card } from "./cards.js";
import { tryJoin } from "./registration.js";
import { runSession } from "./session.js";
import {
  cardsWonToday, getDay, hasAttemptedSlot, loadTeamState, markSlotAttempted, saveTeamState,
  type ChildProgress, type TeamState,
} from "./state.js";
import { PolledIO, Telegram, TelegramPoller, type DeliveredMessage } from "./telegram.js";

export type Slot = "morning" | "midday" | "evening";

interface SlotWindow {
  slot: Slot;
  startMinutes: number; // от полуночи по кипрскому времени, включительно
  endMinutes: number; // исключительно
}

// Окна сплошные, без промежутков между ними: 14:00–17:00 / 17:00–19:00 / 19:00–22:00
// Кипр. GitHub Actions cron — best-effort и на практике срабатывает не по заданной
// частоте, а редко и нерегулярно (иногда раз в 1–3 часа, в произвольную минуту).
// Если бы между окнами были промежутки, редкое срабатывание могло попасть точно
// в промежуток и слот целиком пропадал бы (это и происходило). Сплошные окна
// гарантируют: любое срабатывание в течение дня попадёт хоть в какое-то окно.
const SLOT_SCHEDULE: SlotWindow[] = [
  { slot: "morning", startMinutes: 14 * 60, endMinutes: 17 * 60 },
  { slot: "midday", startMinutes: 17 * 60, endMinutes: 19 * 60 },
  { slot: "evening", startMinutes: 19 * 60, endMinutes: 22 * 60 }, // последнее — тут подводим итоги дня/недели
];

export function activeSlot(now: Date): Slot | null {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Nicosia",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")!.value);
  const minute = Number(parts.find((p) => p.type === "minute")!.value);
  const nowMinutes = hour * 60 + minute;
  const s = SLOT_SCHEDULE.find((w) => nowMinutes >= w.startMinutes && nowMinutes < w.endMinutes);
  return s ? s.slot : null;
}

const NEXT_TIME: Record<Slot, string> = {
  morning: "сегодня попозже 🕐",
  midday: "сегодня вечером 🌙",
  evening: "завтра 🌅",
};

const PROGRESS_PATH = "progress.json";
const QUESTIONS = 10;
const WINDOW_MINUTES = 60;
const BONUS_QUESTIONS = 5;
const BONUS_WINDOW_MINUTES = 20;

async function announceCard(tg: Telegram, chatId: number, card: Card, title: string): Promise<void> {
  const caption =
    `${title}\n${card.emoji} ${card.name}\nРедкость: ${rarityLabel(card.rarity)}` +
    (card.fact ? `\n\n${card.fact}` : "");
  const imagePath = `cards/${card.id}.png`;
  if (existsSync(imagePath)) await tg.sendPhoto(chatId, imagePath, caption);
  else await tg.sendMessage(chatId, `🃏 ${caption}`);
}

async function runChildSlot(
  poller: TelegramPoller,
  tg: Telegram,
  child: ChildProgress,
  date: string,
  slot: Slot,
): Promise<void> {
  const io = new PolledIO(poller, child.chatId, Date.now() + WINDOW_MINUTES * 60_000);
  const facts = pickSessionFacts(child, allFacts(), QUESTIONS, new Date());
  const result = await runSession(io, child, facts);

  if (result.finished && result.answered > 0) {
    const stars = starsForSession(result.correct, result.answered);
    const dayAfter = recordSession(child, date, stars);
    await io.send(
      `🏁 Итог: ${result.correct} из ${result.answered} верно!\n` +
        `${"⭐".repeat(stars)} +${stars} (за день: ${dayAfter.stars} ⭐)\n` +
        `Следующая тренировка ${NEXT_TIME[slot]} 🐾`,
    );
    const wonCard = rollSessionCard(child, date, stars);
    if (wonCard) await announceCard(tg, child.chatId, wonCard, "🃏 Новая карточка за отличную тренировку!");
  } else if (!result.finished) {
    await tg.sendMessage(
      child.chatId,
      `Сегодня не вышло потренироваться — бывает! 🙂 Команда будет ждать ${NEXT_TIME[slot]} 🐾`,
    );
  }

  if (slot === "evening") {
    const day = getDay(child, date);
    if (cardsWonToday(day).length === 0) {
      await tg.sendMessage(
        child.chatId,
        `🎯 Бонусный раунд! Ещё ${BONUS_QUESTIONS} примеров — и карточка дня твоя, что бы ни было!`,
      );
      io.extendDeadline(BONUS_WINDOW_MINUTES * 60_000);
      const bonusFacts = pickSessionFacts(child, allFacts(), BONUS_QUESTIONS, new Date());
      const bonusResult = await runSession(io, child, bonusFacts);
      if (bonusResult.finished && bonusResult.answered > 0) {
        const bonusStars = starsForSession(bonusResult.correct, bonusResult.answered);
        recordSession(child, date, bonusStars);
        day.bonusRoundDone = true;
        await io.send(
          `🏁 Бонус завершён: ${bonusResult.correct} из ${bonusResult.answered} верно! ${"⭐".repeat(bonusStars)}`,
        );
        const bonusCard = awardBonusCard(child, date);
        if (bonusCard) await announceCard(tg, child.chatId, bonusCard, "🎉 Бонусная карточка — ты справилась!");
      }
    }
    finishDay(child, date);
  }
}

async function handleUnmatched(team: TeamState, inviteCode: string, tg: Telegram, msg: DeliveredMessage): Promise<void> {
  const result = tryJoin(team, msg.text, inviteCode, msg.chatId, msg.fromName, new Date());
  if (result.kind === "welcome") {
    await tg.sendMessage(
      msg.chatId,
      `🐾 Добро пожаловать в команду, ${result.name}! Первая тренировка — на ближайшем окне (14:00 / 17:00 / 19:00 по Кипру).`,
    );
  } else if (result.kind === "already-member") {
    await tg.sendMessage(msg.chatId, "Ты уже в команде! 🐾 До следующей тренировки.");
  }
  // "wrong-code" — молчим: не подсказываем постороннему, что не так.
}

async function main(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const inviteCode = process.env.TEAM_INVITE_CODE;
  const parentChatId = process.env.PARENT_CHAT_ID ? Number(process.env.PARENT_CHAT_ID) : null;
  if (!token || !inviteCode) throw new Error("TELEGRAM_BOT_TOKEN and TEAM_INVITE_CODE are required");

  // Явный SESSION_SLOT (ручной запуск через workflow_dispatch) форсирует слот,
  // даже вне окна и даже если этот слот сегодня уже отмечен как проведённый.
  const slotEnv = process.env.SESSION_SLOT as Slot | undefined;
  const forced = Boolean(slotEnv);
  const slot: Slot | null = slotEnv || activeSlot(new Date());
  if (!slot) {
    console.log("Сейчас не окно тренировки — выхожу без действий.");
    return;
  }

  const date = localDate();
  const team = loadTeamState(PROGRESS_PATH);
  ensureCurrentWeek(team, weekStartFor(date));

  const tg = new Telegram(token);
  const poller = new TelegramPoller(tg);
  const pollerDone = poller.run((msg) => {
    void handleUnmatched(team, inviteCode, tg, msg);
  });

  const dueChildren = Object.values(team.children).filter((child) => {
    const day = getDay(child, date);
    if (!forced && hasAttemptedSlot(day, slot)) return false;
    markSlotAttempted(day, slot);
    return true;
  });

  await Promise.all(dueChildren.map((child) => runChildSlot(poller, tg, child, date, slot)));

  if (slot === "evening" && team.lastEveningWrapUp !== date) {
    team.lastEveningWrapUp = date;
    const weekStart = weekStartFor(date);
    const isSunday = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Nicosia", weekday: "short" }).format(new Date()) === "Sun";
    if (isSunday) {
      const { goalMet, trophyCard } = finishWeek(team, weekStart);
      const allChildren = Object.values(team.children);
      if (goalMet && trophyCard) {
        for (const child of allChildren) {
          await announceCard(tg, child.chatId, trophyCard, "🏆 Команда справилась на этой неделе!");
        }
      } else if (!goalMet && allChildren.length > 0) {
        for (const child of allChildren) {
          await tg.sendMessage(child.chatId, "Почти-почти! На следующей неделе команда точно справится 💪");
        }
      }
    }
    if (parentChatId) await tg.sendMessage(parentChatId, teamReport(team, date, weekStart));
  }

  poller.stop();
  await pollerDone;
  saveTeamState(PROGRESS_PATH, team);
}

// Запускаем main только при прямом старте (не при импорте из тестов)
if (process.argv[1] && process.argv[1].endsWith("index.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

- [ ] **Step 3: Run the FULL suite and typecheck for the first time since Task 2**

Run: `cd ~/Desktop/sasha-math-bot && npm test 2>&1 | tail -25 && npm run typecheck 2>&1 | tail -20`
Expected: all test files pass, `tsc --noEmit` produces no output. If `session.test.ts` or `leitner.test.ts` fail because they still import `emptyProgress` — that means Task 2's Step 8 `sed` didn't run cleanly; re-check those two files by hand.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts tests/index.test.ts
git commit -m "feat: rewrite main() for concurrent multi-child sessions via TelegramPoller

Registration, per-child training, and the Sunday-evening weekly trophy
wrap-up are now all wired together. index.ts compiles again after being
intentionally broken since the Progress->ChildProgress rename."
```

---

### Task 12: Workflow secrets — CHILD_CHAT_ID retired, TEAM_INVITE_CODE added

**Files:**
- Modify: `.github/workflows/train.yml`
- Modify: `README.md`

- [ ] **Step 1: Update train.yml's env block**

In `.github/workflows/train.yml`, find the `env:` block under the `npm start` step and change:
```yaml
        env:
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          CHILD_CHAT_ID: ${{ secrets.CHILD_CHAT_ID }}
          PARENT_CHAT_ID: ${{ secrets.PARENT_CHAT_ID }}
          SESSION_SLOT: ${{ github.event.inputs.slot }}
```
to:
```yaml
        env:
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TEAM_INVITE_CODE: ${{ secrets.TEAM_INVITE_CODE }}
          PARENT_CHAT_ID: ${{ secrets.PARENT_CHAT_ID }}
          SESSION_SLOT: ${{ github.event.inputs.slot }}
```

- [ ] **Step 2: Add a short section to README.md documenting the new setup step**

Add a new numbered step to the "Настройка" section in `README.md`, after the existing Chat ID step:

```markdown
5. **Командный режим:** придумайте код-приглашение (любая строка без пробелов,
   например `MURR2026`) и добавьте его как секрет `TEAM_INVITE_CODE`. Дети
   присоединяются, написав боту `/join КОД` со своего аккаунта — секрет
   `CHILD_CHAT_ID` больше не используется (Александра уже добавлена в команду
   через `scripts/migrate-to-team.ts`, остальным просто дайте код).
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/train.yml README.md
git commit -m "chore: retire CHILD_CHAT_ID secret, add TEAM_INVITE_CODE"
```

---

### Task 13: Full verification, migration, and manual end-to-end test

**Files:** none (verification + one-time data migration + GitHub secret/rollout steps)

- [ ] **Step 1: Full test suite and typecheck**

Run: `cd ~/Desktop/sasha-math-bot && npm test 2>&1 | tail -30 && npm run typecheck 2>&1 | tail -20`
Expected: every test file passes, no typecheck errors

- [ ] **Step 2: Grep for any remaining references to retired APIs**

Run: `grep -rn "emptyProgress\|loadProgress\|saveProgress\|CHILD_CHAT_ID\|TelegramIO\|nextReply\|parentReport\b" src/ tests/ .github/ README.md`
Expected: no output (a hit means Task 2, 7, 9, 10, or 12 missed a call site — fix it, re-run tests, commit a follow-up fix)

- [ ] **Step 3: Run the one-time migration against the real progress.json**

```bash
cd ~/Desktop/sasha-math-bot
npx tsx scripts/migrate-to-team.ts
```
Expected output: `Миграция выполнена: Александра — первый ребёнок команды.`

Verify the shape:
```bash
node -e "const t = require('./progress.json'); console.log(Object.keys(t.children).length, t.children['7260953209'].name, t.children['7260953209'].totalStars)"
```
Expected: `1 Александра <some number matching her current totalStars>`

- [ ] **Step 4: Generate and set the invite code secret**

Pick a code (e.g. a short memorable word + year), then:
```bash
gh secret set TEAM_INVITE_CODE -R elarinav-arch/sasha-math-bot -b "<the code you picked>"
```
Delete the now-unused secret:
```bash
gh secret remove CHILD_CHAT_ID -R elarinav-arch/sasha-math-bot
```

- [ ] **Step 5: Commit the migrated progress.json and push everything**

```bash
gh auth switch --hostname github.com --user elarinav-arch
git add progress.json
git commit -m "chore: migrate progress.json to TeamState (Alexandra is the first child)"
git pull --rebase
git push
```

- [ ] **Step 6: Manual smoke test — force a morning slot and confirm Alexandra still works end-to-end**

```bash
gh workflow run training -R elarinav-arch/sasha-math-bot -f slot=morning
```
Watch the run in the Actions tab or via `gh run list -R elarinav-arch/sasha-math-bot --workflow=training --limit 1`. Confirm in Telegram: Alexandra receives her normal greeting, answering works, a card can still be won, `/коллекция` still works if tested mid-session.

- [ ] **Step 7: Manual smoke test — register a second child with the invite code**

From a second Telegram account, message the bot `/join <the code from Step 4>` during an active window (or force one via `workflow_dispatch`). Confirm the welcome message arrives, and that a subsequent forced slot run gives that child their own independent training session running concurrently with Alexandra's (trigger `workflow_dispatch` with `slot=midday` after both are registered and watch both receive greetings in the same run).

- [ ] **Step 8: Confirm this plan's "known simplification" from the spec is visible in the code**

The spec explicitly calls out that a child joining mid-week counts as fully "active" for that week's goal denominator without pro-rating. No action needed here — just confirmed by reading `isActiveThisWeek`/`finishWeek` together: this is accurate, not accidentally stricter or looser than documented.
