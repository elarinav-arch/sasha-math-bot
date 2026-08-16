// scripts/migrate-to-team.ts
// ОДНОРАЗОВЫЙ скрипт: оборачивает текущий плоский progress.json (прогресс одной
// Александры) в новую структуру TeamState. Запустить один раз перед первым
// деплоем командного режима: npx tsx scripts/migrate-to-team.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { ChildProgress, TeamState } from "../src/state.js";

const PATH = "progress.json";
// Чат-айди реального ребёнка — секрет (репозиторий публичный), поэтому берём
// из переменной окружения, как и везде в проекте; литерал ниже — только
// запасной вариант, чтобы скрипт оставался однокомандным в обычном случае.
const ALEXANDRA_CHAT_ID = Number(process.env.CHILD_CHAT_ID) || 7260953209;
const ALEXANDRA_NAME = process.env.CHILD_NAME || "Александра";

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
  const child: ChildProgress = {
    chatId: ALEXANDRA_CHAT_ID,
    name: ALEXANDRA_NAME,
    joinedAt: new Date(0).toISOString(), // точная дата первой регистрации не сохранялась — историческая заглушка
    facts: old.facts ?? {},
    days: old.days ?? [],
    streak: old.streak ?? 0,
    cards: old.cards ?? [],
    totalStars: old.totalStars ?? 0,
  };
  const team: TeamState = {
    children: { [ALEXANDRA_CHAT_ID]: child },
    weeklyGoal: { weekStart: "", trophyAwarded: false },
    trophyCards: [],
  };
  // Бэкап на всякий случай: скрипт запускается один раз против единственной
  // реальной записи прогресса ребёнка — если что-то пойдёт не так, .bak
  // позволит откатиться вручную.
  if (existsSync(PATH)) writeFileSync(PATH + ".bak", readFileSync(PATH));
  writeFileSync(PATH, JSON.stringify(team, null, 2) + "\n", "utf8");
  console.log("Миграция выполнена: Александра — первый ребёнок команды.");
}

main();
