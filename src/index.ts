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
