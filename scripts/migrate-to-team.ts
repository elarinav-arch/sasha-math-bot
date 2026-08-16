// scripts/migrate-to-team.ts
// ОДНОРАЗОВЫЙ скрипт: оборачивает текущий плоский progress.json (прогресс одной
// Александры) в новую структуру TeamState. Запустить один раз перед первым
// деплоем командного режима: npx tsx scripts/migrate-to-team.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { ChildProgress, TeamState } from "../src/state.js";

const PATH = "progress.json";

// Чат-айди и имя реального ребёнка — это PII, а репозиторий публичный, поэтому
// оба берутся строго из переменных окружения, без литералов-заглушек в коде
// (тот же подход, что и для CHILD_CHAT_ID в src/index.ts).
export function resolveChildIdentity(
  env: NodeJS.ProcessEnv = process.env,
): { chatId: number; name: string } | null {
  const chatId = Number(env.CHILD_CHAT_ID);
  const name = env.CHILD_NAME;
  if (!env.CHILD_CHAT_ID || !Number.isFinite(chatId) || !name) return null;
  return { chatId, name };
}

function main(): void {
  const identity = resolveChildIdentity();
  if (!identity) {
    console.error("CHILD_CHAT_ID и CHILD_NAME обязательны — задайте переменные окружения перед запуском.");
    process.exit(1);
  }
  const { chatId, name } = identity;

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
    chatId,
    name,
    joinedAt: new Date(0).toISOString(), // точная дата первой регистрации не сохранялась — историческая заглушка
    facts: old.facts ?? {},
    days: old.days ?? [],
    streak: old.streak ?? 0,
    cards: old.cards ?? [],
    totalStars: old.totalStars ?? 0,
  };
  const team: TeamState = {
    children: { [chatId]: child },
    weeklyGoal: { weekStart: "", trophyAwarded: false },
    trophyCards: [],
  };
  // Бэкап на всякий случай: скрипт запускается один раз против единственной
  // реальной записи прогресса ребёнка — если что-то пойдёт не так, .bak
  // позволит откатиться вручную. (existsSync(PATH) уже проверен выше.)
  writeFileSync(PATH + ".bak", readFileSync(PATH));
  writeFileSync(PATH, JSON.stringify(team, null, 2) + "\n", "utf8");
  console.log(`Миграция выполнена: ${name} — первый ребёнок команды.`);
}

// Запускаем main только при прямом старте (не при импорте из тестов) — тот же
// приём, что и в src/index.ts.
if (process.argv[1] && process.argv[1].endsWith("migrate-to-team.ts")) {
  main();
}
